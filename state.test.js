import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getEvaluationSummary, getStateSummary, markOutOfRange, markInRange, recordCycleEvaluation, recordToolOutcome, trackPosition } from "./state.js";

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
