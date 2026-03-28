import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendActionLifecycle, setActionJournalPathForTests } from "./action-journal.js";
import { getEvaluationSummary, getStateSummary, markOutOfRange, markInRange, recordCycleEvaluation, recordToolOutcome, syncOpenPositions, trackPosition, updatePnlAndCheckExits } from "./state.js";

test("state evaluation records stay bounded and aggregated", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-state-test-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });

    for (let index = 0; index < 30; index += 1) {
      recordCycleEvaluation({
        cycle_type: "screening",
        status: "completed",
        summary: {
          candidates_scored: 2,
          candidates_blocked: 1,
        },
        candidates: [{ pool: `pool-${index}`, deterministic_score: 50 + index }],
      });
    }

    recordToolOutcome({ tool: "deploy_position", outcome: "blocked", reason: "max positions" });
    recordToolOutcome({ tool: "deploy_position", outcome: "success" });

    const summary = getEvaluationSummary(3);
    assert.equal(summary.counters.screening_cycles, 30);
    assert.equal(summary.counters.candidates_scored, 60);
    assert.equal(summary.counters.candidates_blocked, 30);
    assert.equal(summary.counters.tool_blocks, 1);
    assert.equal(summary.counters.write_successes, 1);
    assert.equal(summary.recent_cycles.length, 3);

    const persisted = JSON.parse(fs.readFileSync(path.join(tempDir, "state.json"), "utf8"));
    assert.equal(persisted.evaluation.recentCycles.length, 25);
    assert.equal(persisted.evaluation.recentToolOutcomes.length, 2);

    const stateSummary = getStateSummary();
    assert.equal(stateSummary.evaluation.counters.screening_cycles, 30);
    assert.equal(stateSummary.evaluation.recent_cycles.length, 3);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("state tracks explicit out-of-range direction", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-state-direction-test-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    trackPosition({
      position: "pos-1",
      pool: "pool-1",
      pool_name: "Pool One",
      strategy: "bid_ask",
      amount_sol: 0.5,
      active_bin: 10,
      initial_value_usd: 100,
    });

    markOutOfRange("pos-1", "above");
    let summary = getStateSummary();
    assert.equal(summary.positions[0].out_of_range_direction, "above");

    markInRange("pos-1");
    summary = getStateSummary();
    assert.equal(summary.positions[0].out_of_range_direction, null);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("state falls back to backup snapshot when primary is missing", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-state-backup-test-"));

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		fs.writeFileSync(
			path.join(tempDir, "state.json.bak"),
			JSON.stringify({
				positions: {
					"pos-backup-1": {
						position: "pos-backup-1",
						pool: "pool-backup-1",
						pool_name: "Backup Pool",
						amount_sol: 0.5,
						strategy: "spot",
						deployed_at: new Date().toISOString(),
					},
				},
			}, null, 2),
		);

		const summary = getStateSummary();
		assert.equal(summary.positions.length, 1);
		assert.equal(summary.positions[0].position, "pos-backup-1");
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("syncOpenPositions skips auto-close when unresolved workflow references position or pool", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-state-sync-guard-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    trackPosition({
      position: "pos-guard-1",
      pool: "pool-guard-1",
      pool_name: "Pool Guard One",
      strategy: "spot",
      amount_sol: 0.5,
      active_bin: 10,
      initial_value_usd: 100,
    });

    const statePath = path.join(tempDir, "state.json");
    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
    persisted.positions["pos-guard-1"].deployed_at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(persisted, null, 2));

    appendActionLifecycle({
      workflow_id: "cycle-guard:rebalance_on_exit:1",
      lifecycle: "intent",
      tool: "rebalance_on_exit",
      cycle_id: "cycle-guard",
      action_id: "cycle-guard:rebalance_on_exit:1",
      position_address: "pos-guard-1",
      pool_address: "pool-guard-1",
    });

    syncOpenPositions([]);

    const after = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(after.positions["pos-guard-1"].closed, false);
    assert.equal(after.positions["pos-guard-1"].closed_at, null);
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("syncOpenPositions auto-closes missing position when no unresolved workflow exists", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-state-sync-autoclose-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);

    trackPosition({
      position: "pos-close-1",
      pool: "pool-close-1",
      pool_name: "Pool Close One",
      strategy: "spot",
      amount_sol: 0.5,
      active_bin: 12,
      initial_value_usd: 100,
    });

    const statePath = path.join(tempDir, "state.json");
    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
    persisted.positions["pos-close-1"].deployed_at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(persisted, null, 2));

    syncOpenPositions([]);

    const after = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(after.positions["pos-close-1"].closed, true);
    assert.ok(after.positions["pos-close-1"].closed_at);
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updatePnlAndCheckExits ignores stale pnl updates", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-state-stale-pnl-test-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    trackPosition({
      position: "pos-stale-1",
      pool: "pool-stale-1",
      pool_name: "Pool Stale One",
      strategy: "spot",
      amount_sol: 0.5,
      active_bin: 10,
      initial_value_usd: 100,
    });

    const result = updatePnlAndCheckExits("pos-stale-1", -25, {
      management: {
        stopLossPct: -10,
        trailingTakeProfit: true,
        trailingTriggerPct: 5,
        trailingDropPct: 3,
      },
    }, { stale: true });

    assert.equal(result, null);

    const persisted = JSON.parse(fs.readFileSync(path.join(tempDir, "state.json"), "utf8"));
    assert.equal(persisted.positions["pos-stale-1"].peak_pnl_pct, 0);
    assert.equal(persisted.positions["pos-stale-1"].notes.length, 0);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
