import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { recordPoolDeploy } from "./pool-memory.js";
import { deployPosition } from "./tools/dlmm.js";

test("deployPosition blocks low-yield cooldown pools before any execution path", async () => {
  const originalCwd = process.cwd();
  const originalDryRun = process.env.DRY_RUN;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-deploy-guard-test-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    process.env.DRY_RUN = "true";

    recordPoolDeploy("pool-cooldown", {
      pool_name: "Pool Cooldown",
      close_reason: "fee yield too low",
      pnl_pct: -2,
    });

    const result = await deployPosition({
      pool_address: "pool-cooldown",
      amount_sol: 0.5,
      strategy: "bid_ask",
      bins_below: 40,
      bins_above: 0,
    });

    assert.equal(result.success, false);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "pool_low_yield_cooldown_active");
    assert.ok(result.remaining_minutes > 0);
  } finally {
    if (originalDryRun == null) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = originalDryRun;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
