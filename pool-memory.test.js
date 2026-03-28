import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_LOW_YIELD_REASON,
  getNegativeRegimeCooldown,
  getPoolDeployCooldown,
  isLowYieldCloseReason,
  recordPositionSnapshot,
  recordPoolDeploy,
} from "./pool-memory.js";

test("recordPoolDeploy sets 4h cooldown for canonical low-yield closes", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-pool-memory-test-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });

    recordPoolDeploy("pool-1", {
      pool_name: "Pool One",
      close_reason: "fee yield too low",
      pnl_pct: -1,
    });

    const active = getPoolDeployCooldown({ pool_address: "pool-1" });
    assert.equal(active.active, true);
    assert.equal(active.reason, CANONICAL_LOW_YIELD_REASON);
    assert.ok(active.remaining_ms > 0);

    const afterFiveHours = getPoolDeployCooldown({
      pool_address: "pool-1",
      nowMs: Date.now() + (5 * 60 * 60 * 1000),
    });
    assert.equal(afterFiveHours.active, false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("isLowYieldCloseReason matches canonical reason only", () => {
  assert.equal(isLowYieldCloseReason("fee yield too low"), true);
  assert.equal(isLowYieldCloseReason("fee_yield_too_low"), true);
  assert.equal(isLowYieldCloseReason("manual close by operator"), false);
});

test("recordPoolDeploy stores deterministic negative regime cooldown keys", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-pool-regime-cooldown-test-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });

    recordPoolDeploy("pool-2", {
      pool_name: "Pool Two",
      close_reason: "stop loss",
      pnl_pct: -9,
      strategy: "bid_ask",
      regime_label: "defensive",
    });

    const cooldown = getNegativeRegimeCooldown({
      pool_address: "pool-2",
      regime_label: "defensive",
      strategy: "bid_ask",
    });
    assert.equal(cooldown.active, true);
    assert.equal(cooldown.key, "defensive|bid_ask");
    assert.ok(cooldown.remaining_ms > 0);
    assert.equal(cooldown.hits, 1);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("pool memory fails closed on corrupt state", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-pool-memory-invalid-test-"));

	try {
		process.chdir(tempDir);
		fs.writeFileSync("pool-memory.json", "{bad json");
		const cooldown = getPoolDeployCooldown({ pool_address: "pool-1" });
		assert.equal(cooldown.invalid_state, true);
		assert.equal(cooldown.active, true);
		const negative = getNegativeRegimeCooldown({ pool_address: "pool-1", regime_label: "defensive", strategy: "bid_ask" });
		assert.equal(negative.invalid_state, true);
		assert.equal(negative.active, true);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("recordPoolDeploy does not mutate corrupt pool-memory state", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-pool-memory-write-invalid-test-"));

	try {
		process.chdir(tempDir);
		fs.writeFileSync("pool-memory.json", "{bad json");
		const result = recordPoolDeploy("pool-1", { pool_name: "Pool One", pnl_pct: -1, close_reason: "loss" });
		assert.equal(result.recorded, false);
		assert.equal(result.invalid_state, true);
		assert.equal(fs.readFileSync("pool-memory.json", "utf8"), "{bad json");
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("recordPositionSnapshot does not mutate corrupt pool-memory state", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-pool-memory-snapshot-invalid-test-"));

	try {
		process.chdir(tempDir);
		fs.writeFileSync("pool-memory.json", "{bad json");
		const result = recordPositionSnapshot("pool-1", { pair: "Pool One", position: "pos-1", pnl_pct: 1 });
		assert.equal(result.recorded, false);
		assert.equal(result.invalid_state, true);
		assert.equal(fs.readFileSync("pool-memory.json", "utf8"), "{bad json");
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("pool cooldown getters fail closed on malformed timestamps", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-pool-memory-bad-ts-test-"));

	try {
		process.chdir(tempDir);
		fs.writeFileSync("pool-memory.json", JSON.stringify({
			"pool-1": {
				low_yield_cooldown_until: "not-a-date",
				low_yield_cooldown_reason: "fee yield too low",
				negative_regime_cooldowns: {
					"defensive|bid_ask": {
						cooldown_until: "still-not-a-date",
						hits: 1,
						reason: "negative regime cooldown",
					},
				},
			},
		}, null, 2));
		const poolCooldown = getPoolDeployCooldown({ pool_address: "pool-1" });
		assert.equal(poolCooldown.invalid_state, true);
		assert.equal(poolCooldown.active, true);
		const negativeCooldown = getNegativeRegimeCooldown({ pool_address: "pool-1", regime_label: "defensive", strategy: "bid_ask" });
		assert.equal(negativeCooldown.invalid_state, true);
		assert.equal(negativeCooldown.active, true);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
