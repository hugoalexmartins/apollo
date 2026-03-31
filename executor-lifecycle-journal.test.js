import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { foldActionJournal, readActionJournal, setActionJournalPathForTests } from "./action-journal.js";
import { config } from "./config.js";
import {
	executeTool,
	getAutonomousWriteSuppression,
	resetExecutorTestOverrides,
	setAutonomousWriteSuppression,
	setExecutorTestOverrides,
} from "./tools/executor.js";

function buildApprovedMeta(cycleId, actionId) {
	return {
		cycle_id: cycleId,
		action_id: actionId,
		decision_gate: {
			required: true,
			approved: true,
			status: "approved",
			reason_code: null,
			thesis_id: `${actionId}:thesis`,
			critic_version: "v1",
			memory_version: "policy-v1",
			shadow_memory_version: "policy-shadow-v1",
		},
		thesis_id: `${actionId}:thesis`,
		decision_mode: "model",
		critic_status: "approved",
		memory_version: "policy-v1",
		shadow_memory_version: "policy-shadow-v1",
	};
}

test("executor journals intent and completion for write tools", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-lifecycle-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);
    setAutonomousWriteSuppression({ suppressed: false });

    let receivedArgs = null;
		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 0, positions: [] }),
			getWalletBalances: async () => ({ sol: 10, sol_price: 100, tokens: [] }),
			getPoolGovernanceMetadata: async () => ({ base_mint: "mint-1", bin_step: 100 }),
			tools: {
				deploy_position: async (args) => {
          receivedArgs = args;
          return { success: true, position: "pos-1", pool: "pool-1" };
        },
      },
      recordToolOutcome: () => {},
    });

		const result = await executeTool(
			"deploy_position",
			{ pool_address: "pool-1", amount_y: 0.5, base_mint: "mint-1", bin_step: 100, initial_value_usd: 1 },
			buildApprovedMeta("cycle-1", "cycle-1:deploy_position:1")
		);

    assert.equal(result.success, true);

    const journal = readActionJournal();
    assert.equal(journal.parse_errors.length, 0);
    assert.equal(journal.entries.length, 2);
    assert.equal(journal.entries[0].lifecycle, "intent");
    assert.equal(journal.entries[1].lifecycle, "completed");
    assert.equal(journal.entries[0].workflow_id, "cycle-1:deploy_position:1");
    assert.equal(journal.entries[1].workflow_id, "cycle-1:deploy_position:1");
    assert.equal(receivedArgs.decision_context.cycle_id, "cycle-1");
    assert.equal(receivedArgs.decision_context.action_id, "cycle-1:deploy_position:1");
    assert.equal(receivedArgs.decision_context.workflow_id, "cycle-1:deploy_position:1");
    assert.equal(receivedArgs.initial_value_usd, 50);

    const folded = foldActionJournal(journal.entries);
    assert.equal(folded.length, 1);
    assert.equal(folded[0].lifecycle, "completed");
  } finally {
    resetExecutorTestOverrides();
    setAutonomousWriteSuppression({ suppressed: false });
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executor writes terminal manual_review for blocked write attempts", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-blocked-lifecycle-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);
    setAutonomousWriteSuppression({ suppressed: false });

		setExecutorTestOverrides({
			getMyPositions: async () => ({
				total_positions: 1,
				positions: [{ position: "already-open", pool: "pool-block", base_mint: "mint-b" }],
			}),
			getWalletBalances: async () => ({ sol: 10, sol_price: 100, tokens: [] }),
			getPoolGovernanceMetadata: async () => ({ base_mint: "mint-b", bin_step: 100 }),
			recordToolOutcome: () => {},
		});

		const result = await executeTool(
			"deploy_position",
			{ pool_address: "pool-block", amount_y: 0.5, base_mint: "mint-b", bin_step: 100 },
			buildApprovedMeta("cycle-b", "cycle-b:deploy_position:1")
		);

    assert.equal(result.blocked, true);

    const journal = readActionJournal();
    assert.equal(journal.parse_errors.length, 0);
    assert.equal(journal.entries.length, 2);
    assert.equal(journal.entries[0].lifecycle, "intent");
    assert.equal(journal.entries[1].lifecycle, "manual_review");

    const folded = foldActionJournal(journal.entries);
    assert.equal(folded[0].lifecycle, "manual_review");
  } finally {
    resetExecutorTestOverrides();
    setAutonomousWriteSuppression({ suppressed: false });
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executor writes terminal manual_review for errored write attempts", async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-error-lifecycle-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);
    setAutonomousWriteSuppression({ suppressed: false });

		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 0, positions: [] }),
			getWalletBalances: async () => ({ sol: 10, sol_price: 100, tokens: [] }),
			getPoolGovernanceMetadata: async () => ({ base_mint: "mint-err", bin_step: 100 }),
			tools: {
				deploy_position: async () => {
          throw new Error("simulated deploy failure");
        },
      },
      recordToolOutcome: () => {},
    });

		const result = await executeTool(
			"deploy_position",
			{ pool_address: "pool-err", amount_y: 0.5, base_mint: "mint-err", bin_step: 100 },
			buildApprovedMeta("cycle-e", "cycle-e:deploy_position:1")
		);

    assert.match(result.error || "", /simulated deploy failure/i);

    const journal = readActionJournal();
    assert.equal(journal.parse_errors.length, 0);
    assert.equal(journal.entries.length, 2);
    assert.equal(journal.entries[0].lifecycle, "intent");
    assert.equal(journal.entries[1].lifecycle, "manual_review");

    const folded = foldActionJournal(journal.entries);
    assert.equal(folded[0].lifecycle, "manual_review");
  } finally {
    resetExecutorTestOverrides();
    setAutonomousWriteSuppression({ suppressed: false });
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("executor suppresses later autonomous writes after a blocked write enters manual review", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-manual-review-suppression-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");
	let positionOpen = false;

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);
		setAutonomousWriteSuppression({ suppressed: false });

		setExecutorTestOverrides({
			getMyPositions: async () => ({
				total_positions: positionOpen ? 1 : 0,
				positions: positionOpen ? [{ position: "pos-blocked-1", pool: "pool-blocked-1" }] : [],
			}),
			recordToolOutcome: () => {},
			tools: {
				close_position: async () => ({ success: true, position: "pos-blocked-1" }),
			},
		});

		const first = await executeTool(
			"close_position",
			{ position_address: "pos-blocked-1" },
			buildApprovedMeta("cycle-blocked", "cycle-blocked:close_position:1"),
		);
		assert.equal(first.blocked, true);
		assert.equal(getAutonomousWriteSuppression().suppressed, true);

		positionOpen = true;
		const second = await executeTool(
			"close_position",
			{ position_address: "pos-blocked-1" },
			buildApprovedMeta("cycle-blocked", "cycle-blocked:close_position:2"),
		);

		assert.equal(second.blocked, true);
		assert.match(second.reason || "", /manual review/i);
	} finally {
		resetExecutorTestOverrides();
		setAutonomousWriteSuppression({ suppressed: false });
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("executor blocks blacklisted deploys before execution", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-blacklist-lifecycle-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "token-blacklist.json"), JSON.stringify({
			"mint-blacklisted-1": {
				symbol: "BLK",
				reason: "rugged",
				added_at: new Date().toISOString(),
				added_by: "test",
			},
		}, null, 2));
		setActionJournalPathForTests(journalPath);
		setAutonomousWriteSuppression({ suppressed: false });

		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 0, positions: [] }),
			getWalletBalances: async () => ({ sol: 10, sol_price: 100, tokens: [] }),
			getPoolGovernanceMetadata: async () => ({ base_mint: "mint-blacklisted-1", bin_step: 100 }),
			recordToolOutcome: () => {},
		});

		const result = await executeTool(
			"deploy_position",
			{ pool_address: "pool-blacklisted", amount_y: 0.5 },
			buildApprovedMeta("cycle-blacklist", "cycle-blacklist:deploy_position:1"),
		);

		assert.equal(result.blocked, true);
		assert.match(result.reason || "", /blacklisted/i);

		const journal = readActionJournal();
		assert.equal(journal.parse_errors.length, 0);
		assert.equal(journal.entries.length, 2);
		assert.equal(journal.entries[0].lifecycle, "intent");
		assert.equal(journal.entries[1].lifecycle, "manual_review");
	} finally {
		resetExecutorTestOverrides();
		setAutonomousWriteSuppression({ suppressed: false });
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("executor re-latches expired recovery resume overrides before write execution", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-expired-override-test-"));

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setAutonomousWriteSuppression({
			suppressed: false,
			reason: "resume window",
			code: "UNRESOLVED_WORKFLOW",
			incidentKey: "incident-expired-1",
			overrideUntilMs: Date.now() - 1_000,
		});

		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 1, positions: [{ position: "pos-expired-1", pool: "pool-expired-1" }] }),
			recordToolOutcome: () => {},
			tools: {
				close_position: async () => ({ success: true, position: "pos-expired-1" }),
			},
		});

		const result = await executeTool(
			"close_position",
			{ position_address: "pos-expired-1" },
			buildApprovedMeta("cycle-expired", "cycle-expired:close_position:1"),
		);

		assert.equal(result.blocked, true);
		assert.match(result.reason || "", /resume window/i);
		assert.equal(getAutonomousWriteSuppression().suppressed, true);
	} finally {
		resetExecutorTestOverrides();
		setAutonomousWriteSuppression({ suppressed: false });
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("executor keeps successful writes successful when local follow-up requires manual review", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-success-manual-review-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);
		setAutonomousWriteSuppression({ suppressed: false });

		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 1, positions: [{ position: "pos-success-1", pool: "pool-success-1" }] }),
			recordToolOutcome: () => {},
			tools: {
				close_position: async () => ({
					success: true,
					position: "pos-success-1",
					manual_review_required: true,
					manual_review_reason: "Local close recording failed: state unavailable",
				}),
			},
		});

		const result = await executeTool(
			"close_position",
			{ position_address: "pos-success-1", skip_swap: true },
			buildApprovedMeta("cycle-success", "cycle-success:close_position:1"),
		);

		assert.equal(result.success, true);
		assert.equal(getAutonomousWriteSuppression().suppressed, true);

		const journal = readActionJournal();
		assert.equal(journal.parse_errors.length, 0);
		assert.equal(journal.entries.length, 3);
		assert.equal(journal.entries[0].lifecycle, "intent");
		assert.equal(journal.entries[1].lifecycle, "completed");
		assert.equal(journal.entries[2].lifecycle, "manual_review");
	} finally {
		resetExecutorTestOverrides();
		setAutonomousWriteSuppression({ suppressed: false });
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("executor keeps committed claim writes successful when settlement follow-up requires manual review", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-claim-success-manual-review-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);
		setAutonomousWriteSuppression({ suppressed: false });

		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 1, positions: [{ position: "pos-claim-success-1", pool: "pool-claim-success-1" }] }),
			recordToolOutcome: () => {},
			tools: {
				claim_fees: async () => ({
					success: true,
					position: "pos-claim-success-1",
					manual_review_required: true,
					manual_review_reason: "Post-claim settlement not observed before timeout: settlement_not_observed",
				}),
			},
		});

		const result = await executeTool(
			"claim_fees",
			{ position_address: "pos-claim-success-1" },
			buildApprovedMeta("cycle-claim-success", "cycle-claim-success:claim_fees:1"),
		);

		assert.equal(result.success, true);
		assert.equal(getAutonomousWriteSuppression().suppressed, true);

		const journal = readActionJournal();
		assert.equal(journal.parse_errors.length, 0);
		assert.equal(journal.entries.length, 3);
		assert.equal(journal.entries[0].lifecycle, "intent");
		assert.equal(journal.entries[1].lifecycle, "completed");
		assert.equal(journal.entries[2].lifecycle, "manual_review");
	} finally {
		resetExecutorTestOverrides();
		setAutonomousWriteSuppression({ suppressed: false });
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("executor auto-swap uses observed recovered amount and journals the swap workflow", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-auto-swap-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);
		setAutonomousWriteSuppression({ suppressed: false });

		let receivedSwapArgs = null;
		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 1, positions: [{ position: "pos-close-1", pool: "pool-close-1" }] }),
			getWalletBalances: async () => ({ sol: 10, sol_price: 100, tokens: [] }),
			recordToolOutcome: () => {},
			tools: {
				close_position: async () => ({
					success: true,
					position: "pos-close-1",
					pool: "pool-close-1",
					base_mint: "mint-close-1",
					base_amount_received: 12.5,
				}),
				swap_token: async (args) => {
					receivedSwapArgs = args;
					return { success: true, tx: "swap-tx-1" };
				},
			},
		});

		const result = await executeTool(
			"close_position",
			{ position_address: "pos-close-1" },
			buildApprovedMeta("cycle-close", "cycle-close:close_position:1"),
		);

		assert.equal(result.success, true);
		assert.ok(receivedSwapArgs);
		assert.equal(receivedSwapArgs.amount, 12.5);

		const journal = readActionJournal();
		assert.equal(journal.parse_errors.length, 0);
		const folded = foldActionJournal(journal.entries);
		assert.equal(folded.length, 2);
		assert.equal(folded.some((workflow) => workflow.workflow_id === "cycle-close:close_position:1"), true);
		assert.equal(folded.some((workflow) => workflow.workflow_id === "cycle-close:close_position:1:auto_swap_close"), true);
	} finally {
		resetExecutorTestOverrides();
		setAutonomousWriteSuppression({ suppressed: false });
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("executor auto-swap after claim uses observed claimed mint and amount", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-executor-auto-swap-claim-test-"));
	const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");
	const originalAutoSwapAfterClaim = config.management.autoSwapAfterClaim;

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		setActionJournalPathForTests(journalPath);
		setAutonomousWriteSuppression({ suppressed: false });
		config.management.autoSwapAfterClaim = true;

		let receivedSwapArgs = null;
		setExecutorTestOverrides({
			getMyPositions: async () => ({ total_positions: 1, positions: [{ position: "pos-claim-1", pool: "pool-claim-1" }] }),
			getWalletBalances: async () => ({ sol: 10, sol_price: 100, tokens: [] }),
			recordToolOutcome: () => {},
			tools: {
				claim_fees: async () => ({
					success: true,
					position: "pos-claim-1",
					claimed_mint: "mint-quote-1",
					claimed_amount_received: 4.25,
				}),
				swap_token: async (args) => {
					receivedSwapArgs = args;
					return { success: true, tx: "swap-tx-claim-1" };
				},
			},
		});

		const result = await executeTool(
			"claim_fees",
			{ position_address: "pos-claim-1" },
			buildApprovedMeta("cycle-claim", "cycle-claim:claim_fees:1"),
		);

		assert.equal(result.success, true);
		assert.ok(receivedSwapArgs);
		assert.equal(receivedSwapArgs.input_mint, "mint-quote-1");
		assert.equal(receivedSwapArgs.amount, 4.25);

		const journal = readActionJournal();
		assert.equal(journal.parse_errors.length, 0);
		const folded = foldActionJournal(journal.entries);
		assert.equal(folded.some((workflow) => workflow.workflow_id === "cycle-claim:claim_fees:1:auto_swap_claim"), true);
	} finally {
		config.management.autoSwapAfterClaim = originalAutoSwapAfterClaim;
		resetExecutorTestOverrides();
		setAutonomousWriteSuppression({ suppressed: false });
		setActionJournalPathForTests(null);
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
