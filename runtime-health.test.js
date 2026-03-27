import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { formatRuntimeHealthReport, getRuntimeHealth, updateRuntimeHealth } from "./runtime-health.js";

test("runtime health persists machine-readable heartbeat", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-runtime-health-test-"));

  try {
    process.chdir(tempDir);
    const health = updateRuntimeHealth({
      startup: { status: "ready", reason: null },
      cycles: { screening: { status: "completed", at: "2026-03-27T00:00:00.000Z" } },
      provider_health: { wallet: { status: "ok", detail: "wallet ready" } },
    });
    assert.equal(health.startup.status, "ready");
    assert.equal(getRuntimeHealth().cycles.screening.status, "completed");
    assert.match(formatRuntimeHealthReport(), /wallet: ok/i);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
