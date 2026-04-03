import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendActionLifecycle, foldActionJournal, readActionJournal, setActionJournalPathForTests } from "./action-journal.js";
import {
	formatRecoveryWorkflowReport,
	getRecoveryWorkflowReport,
	isBootRecoveryOverrideAllowed,
	runBootRecovery,
	summarizeRecoveryBlock,
} from "./boot-recovery.js";
import { getTrackedPositions } from "./state.js";

test("boot recovery parks rebalance for manual review even when replacement is observable", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-rebalance-complete-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    appendActionLifecycle({
      workflow_id: "cycle-1:rebalance_on_exit:1",
      lifecycle: "close_observed_pending_redeploy",
      tool: "rebalance_on_exit",
      cycle_id: "cycle-1",
      action_id: "cycle-1:rebalance_on_exit:1",
      position_address: "old-pos-1",
      pool_address: "pool-1",
    });

    const decision = await runBootRecovery({
      observeOpenPositions: async () => ({
        positions: [{ position: "new-pos-9", pool: "pool-1" }],
				observation: { completeness: "complete", observed_at_ms: Date.now() },
      }),
      observeTrackedPositions: async () => [],
    });

		assert.equal(decision.suppress_autonomous_writes, true);
		assert.equal(decision.parked_manual_review_workflows.includes("cycle-1:rebalance_on_exit:1"), true);

		const folded = foldActionJournal(readActionJournal().entries);
		const resolved = folded.find((workflow) => workflow.workflow_id === "cycle-1:rebalance_on_exit:1");
		assert.equal(resolved.lifecycle, "manual_review");
	} finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("boot recovery parks deploy intent for manual review even when the target pool is observable", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-deploy-resolution-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    appendActionLifecycle({
      workflow_id: "cycle-3:deploy_position:1",
      lifecycle: "intent",
      tool: "deploy_position",
      cycle_id: "cycle-3",
      action_id: "cycle-3:deploy_position:1",
      pool_address: "pool-deploy",
    });

    let decision = await runBootRecovery({
      observeOpenPositions: async () => ({
        positions: [{ position: "open-1", pool: "pool-deploy" }],
				observation: { completeness: "complete", observed_at_ms: Date.now() },
      }),
      observeTrackedPositions: async () => [],
    });

		assert.equal(decision.suppress_autonomous_writes, true);
		assert.equal(decision.parked_manual_review_workflows.includes("cycle-3:deploy_position:1"), true);

    appendActionLifecycle({
      workflow_id: "cycle-4:deploy_position:1",
      lifecycle: "intent",
      tool: "deploy_position",
      cycle_id: "cycle-4",
      action_id: "cycle-4:deploy_position:1",
      pool_address: "pool-missing",
    });

    decision = await runBootRecovery({
			observeOpenPositions: async () => ({
				positions: [],
				observation: { completeness: "complete", observed_at_ms: Date.now() },
			}),
      observeTrackedPositions: async () => [],
    });

    assert.equal(decision.suppress_autonomous_writes, true);
    assert.equal(decision.reason_code, "UNRESOLVED_WORKFLOW");
    assert.equal(decision.parked_manual_review_workflows.includes("cycle-4:deploy_position:1"), true);

    const folded = foldActionJournal(readActionJournal().entries);
		const deployComplete = folded.find((workflow) => workflow.workflow_id === "cycle-3:deploy_position:1");
		const deployManual = folded.find((workflow) => workflow.workflow_id === "cycle-4:deploy_position:1");
		assert.equal(deployComplete.lifecycle, "manual_review");
		assert.equal(deployManual.lifecycle, "manual_review");
	} finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("boot recovery resolves close intent when target position is no longer open", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-close-resolution-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    appendActionLifecycle({
      workflow_id: "cycle-5:close_position:1",
      lifecycle: "intent",
      tool: "close_position",
      cycle_id: "cycle-5",
      action_id: "cycle-5:close_position:1",
      position_address: "pos-close-1",
    });

    const decision = await runBootRecovery({
      observeOpenPositions: async () => ({
        positions: [{ position: "other-open", pool: "pool-z" }],
				observation: { completeness: "complete", observed_at_ms: Date.now() },
      }),
      observeTrackedPositions: async () => [],
    });

    assert.equal(decision.suppress_autonomous_writes, false);
    assert.equal(decision.completed_on_boot_workflows.includes("cycle-5:close_position:1"), true);

    const folded = foldActionJournal(readActionJournal().entries);
    const closeResolved = folded.find((workflow) => workflow.workflow_id === "cycle-5:close_position:1");
    assert.equal(closeResolved.lifecycle, "completed");
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("boot recovery blocks autonomous writes when open-position observation is invalid", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-open-positions-invalid-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);

		appendActionLifecycle({
			workflow_id: "cycle-invalid:close_position:1",
			lifecycle: "intent",
			tool: "close_position",
			cycle_id: "cycle-invalid",
			action_id: "cycle-invalid:close_position:1",
			position_address: "pos-invalid-1",
		});

		const decision = await runBootRecovery({
			observeOpenPositions: async () => ({ positions: [], error: "rpc unavailable" }),
			observeTrackedPositions: async () => [],
		});

		assert.equal(decision.suppress_autonomous_writes, true);
		assert.equal(decision.reason_code, "OPEN_POSITIONS_INVALID");
		assert.equal(decision.parked_manual_review_workflows.includes("cycle-invalid:close_position:1"), true);
		assert.equal(decision.observed.open_positions_invalid, true);
	} finally {
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("boot recovery fails closed for shape-valid observations without completeness metadata", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-shape-valid-incomplete-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);

		appendActionLifecycle({
			workflow_id: "cycle-shape:close_position:1",
			lifecycle: "intent",
			tool: "close_position",
			cycle_id: "cycle-shape",
			action_id: "cycle-shape:close_position:1",
			position_address: "pos-shape-1",
		});

		const decision = await runBootRecovery({
			observeOpenPositions: async () => ({ positions: [] }),
			observeTrackedPositions: async () => [],
		});

		assert.equal(decision.suppress_autonomous_writes, true);
		assert.equal(decision.reason_code, "OPEN_POSITIONS_INVALID");
		assert.equal(decision.parked_manual_review_workflows.includes("cycle-shape:close_position:1"), true);
	} finally {
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("boot recovery fails closed when open-position observation throws", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-open-positions-throw-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);

		appendActionLifecycle({
			workflow_id: "cycle-throw:close_position:1",
			lifecycle: "intent",
			tool: "close_position",
			cycle_id: "cycle-throw",
			action_id: "cycle-throw:close_position:1",
			position_address: "pos-throw-1",
		});

		const decision = await runBootRecovery({
			observeOpenPositions: async () => {
				throw new Error("rpc boom");
			},
			observeTrackedPositions: async () => [],
		});

		assert.equal(decision.suppress_autonomous_writes, true);
		assert.equal(decision.reason_code, "OPEN_POSITIONS_INVALID");
		assert.equal(decision.parked_manual_review_workflows.includes("cycle-throw:close_position:1"), true);
		assert.match(decision.observed.open_positions_error || "", /rpc boom/i);
	} finally {
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("boot recovery re-suppresses persisted manual-review write workflows after restart", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-persisted-manual-review-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);

		appendActionLifecycle({
			workflow_id: "cycle-restart:claim_fees:1",
			lifecycle: "intent",
			tool: "claim_fees",
			cycle_id: "cycle-restart",
			action_id: "cycle-restart:claim_fees:1",
			position_address: "pos-restart-1",
		});
		appendActionLifecycle({
			workflow_id: "cycle-restart:claim_fees:1",
			lifecycle: "completed",
			tool: "claim_fees",
			cycle_id: "cycle-restart",
			action_id: "cycle-restart:claim_fees:1",
			position_address: "pos-restart-1",
		});
		appendActionLifecycle({
			workflow_id: "cycle-restart:claim_fees:1",
			lifecycle: "manual_review",
			tool: "claim_fees",
			cycle_id: "cycle-restart",
			action_id: "cycle-restart:claim_fees:1",
			position_address: "pos-restart-1",
			reason: "Post-claim settlement not observed before timeout: settlement_not_observed",
		});

		const decision = await runBootRecovery({
			observeOpenPositions: async () => ({
				positions: [],
				observation: { completeness: "complete", observed_at_ms: Date.now() },
			}),
			observeTrackedPositions: async () => [],
		});

		assert.equal(decision.suppress_autonomous_writes, true);
		assert.equal(decision.reason_code, "UNRESOLVED_WORKFLOW");
		assert.equal(decision.parked_manual_review_workflows.includes("cycle-restart:claim_fees:1"), true);
		assert.equal(decision.incident_key, "cycle-restart:claim_fees:1");
	} finally {
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("invalid state.json does not erase journal-based recovery gating", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-invalid-state-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    fs.writeFileSync(path.join(tempDir, "state.json"), "{invalid json");
    appendActionLifecycle({
      workflow_id: "cycle-2:rebalance_on_exit:1",
      lifecycle: "intent",
      tool: "rebalance_on_exit",
      cycle_id: "cycle-2",
      action_id: "cycle-2:rebalance_on_exit:1",
      position_address: "pos-2",
      pool_address: "pool-2",
    });

    const decision = await runBootRecovery({
			observeOpenPositions: async () => ({
				positions: [],
				observation: { completeness: "complete", observed_at_ms: Date.now() },
			}),
      observeTrackedPositions: async () => getTrackedPositions(true),
    });

    assert.equal(decision.suppress_autonomous_writes, true);
    assert.equal(decision.parked_manual_review_workflows[0], "cycle-2:rebalance_on_exit:1");
    assert.match(decision.observed.tracked_state_invalid || "", /Invalid state\.json/i);
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("boot recovery blocks autonomous writes when journal contains parse errors", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-boot-recovery-journal-invalid-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.writeFileSync(journalPath, "{invalid json\n");

    const decision = await runBootRecovery({
			observeOpenPositions: async () => ({
				positions: [],
				observation: { completeness: "complete", observed_at_ms: Date.now() },
			}),
      observeTrackedPositions: async () => [],
    });

    assert.equal(decision.suppress_autonomous_writes, true);
    assert.equal(decision.reason_code, "JOURNAL_INVALID");
    assert.equal(decision.journal_parse_errors.length, 1);
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recovery workflow report exposes manual-review triage without raw journal inspection", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-recovery-report-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    appendActionLifecycle({
      workflow_id: "cycle-r:rebalance_on_exit:1",
      lifecycle: "intent",
      tool: "rebalance_on_exit",
      cycle_id: "cycle-r",
      action_id: "cycle-r:rebalance_on_exit:1",
      position_address: "pos-r-1",
      pool_address: "pool-r-1",
    });
    appendActionLifecycle({
      workflow_id: "cycle-r:rebalance_on_exit:1",
      lifecycle: "manual_review",
      tool: "rebalance_on_exit",
      cycle_id: "cycle-r",
      action_id: "cycle-r:rebalance_on_exit:1",
      position_address: "pos-r-1",
      pool_address: "pool-r-1",
      reason: "operator_review_required",
    });

    const report = getRecoveryWorkflowReport();
    assert.equal(report.status, "manual_review_required");
    assert.equal(report.total_manual_review_workflows, 1);
    assert.equal(report.manual_review_workflows[0].workflow_id, "cycle-r:rebalance_on_exit:1");
    assert.equal(report.manual_review_workflows[0].reason, "operator_review_required");
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recovery workflow report includes parse-error blockers and mixed workflow sections", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-recovery-report-mixed-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    appendActionLifecycle({
      workflow_id: "cycle-m:close_position:1",
      lifecycle: "manual_review",
      tool: "close_position",
      cycle_id: "cycle-m",
      action_id: "cycle-m:close_position:1",
      position_address: "pos-m-1",
      reason: "operator_review_required",
    });
    appendActionLifecycle({
      workflow_id: "cycle-u:deploy_position:1",
      lifecycle: "intent",
      tool: "deploy_position",
      cycle_id: "cycle-u",
      action_id: "cycle-u:deploy_position:1",
      pool_address: "pool-u-1",
    });
    fs.appendFileSync(journalPath, "{bad json\n");

    const report = getRecoveryWorkflowReport();
    const text = formatRecoveryWorkflowReport(report, {
      suppressed: true,
      reason: "action journal invalid (1 parse error(s))",
    });

    assert.equal(report.status, "journal_invalid");
    assert.equal(report.total_manual_review_workflows, 1);
    assert.equal(report.total_unresolved_workflows, 1);
    assert.match(text, /journal_parse_errors: 1/i);
    assert.match(text, /Manual review workflows:/i);
    assert.match(text, /Unresolved pending workflows:/i);
    assert.match(text, /line 3:/i);
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("summarizeRecoveryBlock distinguishes journal corruption from manual-review blockers", () => {
  const invalid = summarizeRecoveryBlock({
    reason_code: "JOURNAL_INVALID",
    journal_parse_errors: [{ line: 2, error: "bad json" }],
  });
  assert.match(invalid.headline, /action journal is invalid/i);
  assert.match(invalid.detail, /parse errors: 1/i);

  const manualReview = summarizeRecoveryBlock({
    reason_code: "UNRESOLVED_WORKFLOW",
    parked_manual_review_workflows: ["cycle-1:rebalance_on_exit:1"],
  });
  assert.match(manualReview.headline, /manual_review/i);
  assert.match(manualReview.detail, /cycle-1:rebalance_on_exit:1/i);

	const invalidObservation = summarizeRecoveryBlock({
		reason_code: "OPEN_POSITIONS_INVALID",
		observed: { open_positions_error: "rpc unavailable" },
	});
	assert.match(invalidObservation.headline, /open-position observation is invalid/i);
	assert.match(invalidObservation.detail, /rpc unavailable/i);
});

test("boot recovery override is only allowed for unresolved workflow blocks", () => {
	assert.equal(
		isBootRecoveryOverrideAllowed(
			{ suppress_autonomous_writes: true, reason_code: "UNRESOLVED_WORKFLOW", incident_key: "wf-1|wf-2" },
			{ active: true, incident_key: "wf-1|wf-2" },
		),
		true,
	);
	assert.equal(
		isBootRecoveryOverrideAllowed(
			{ suppress_autonomous_writes: true, reason_code: "OPEN_POSITIONS_INVALID", incident_key: null },
			{ active: true, incident_key: "wf-1|wf-2" },
		),
		false,
	);
	assert.equal(
		isBootRecoveryOverrideAllowed(
			{ suppress_autonomous_writes: true, reason_code: "JOURNAL_INVALID", incident_key: null },
			{ active: true, incident_key: "wf-1|wf-2" },
		),
		false,
	);
	assert.equal(
		isBootRecoveryOverrideAllowed(
			{ suppress_autonomous_writes: false, reason_code: null, incident_key: null },
			{ active: true, incident_key: "wf-1|wf-2" },
		),
		false,
	);
	assert.equal(
		isBootRecoveryOverrideAllowed(
			{ suppress_autonomous_writes: true, reason_code: "UNRESOLVED_WORKFLOW", incident_key: "wf-1|wf-2" },
			{ active: true, incident_key: "wf-3" },
		),
		false,
	);
});
