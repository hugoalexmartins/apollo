import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getEvaluationSummary, getStateSummary, recordCycleEvaluation, recordToolOutcome } from "./state.js";

test("state evaluation records stay bounded and aggregated", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-state-test-"));

  try {
    process.chdir(tempDir);

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
