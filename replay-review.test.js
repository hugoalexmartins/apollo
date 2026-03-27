import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendReplayEnvelope } from "./cycle-trace.js";
import { getReplayReview, getReplayReviewStats } from "./replay-review.js";

test("replay review finds envelope and reports deterministic match", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-replay-review-test-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync("logs", { recursive: true });

    appendReplayEnvelope({
      cycle_id: "management-review-1",
      cycle_type: "management",
      position_inputs: [],
      runtime_actions: [],
    });

    const review = getReplayReview("management-review-1");
    assert.equal(review.found, true);
    assert.equal(review.reconciliation.status, "match");

    const stats = getReplayReviewStats(10);
    assert.equal(stats.total, 1);
    assert.equal(stats.matches, 1);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
