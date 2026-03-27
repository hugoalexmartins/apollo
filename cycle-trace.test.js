import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendReplayEnvelope, createActionId, createCycleId } from "./cycle-trace.js";

test("cycle trace creates stable ids and writes replay envelopes", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-trace-test-"));

  try {
    process.chdir(tempDir);
    const cycleId = createCycleId("screening");
    const actionId = createActionId(cycleId, "deploy_position", 0);
    appendReplayEnvelope({
      cycle_id: cycleId,
      cycle_type: "screening",
      shortlist: [{ pool: "pool-a", ranking_score: 88.1 }],
    });

    assert.match(cycleId, /^screening-/);
    assert.equal(actionId, `${cycleId}:deploy_position:1`);

    const logDir = path.join(tempDir, "logs");
    const replayFiles = fs.readdirSync(logDir).filter((file) => file.startsWith("replay-"));
    assert.equal(replayFiles.length, 1);

    const replayContent = fs.readFileSync(path.join(logDir, replayFiles[0]), "utf8").trim();
    const parsed = JSON.parse(replayContent);
    assert.equal(parsed.cycle_id, cycleId);
    assert.equal(parsed.cycle_type, "screening");
    assert.equal(parsed.shortlist[0].pool, "pool-a");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
