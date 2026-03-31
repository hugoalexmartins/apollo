import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { recordPoolDeploy } from "./pool-memory.js";
import {
	deployPosition,
	finalizeCommittedWriteResult,
	rebalanceOnExit,
	resolveDeployInitialValueUsd,
	shouldIgnoreTrackedLivePosition,
} from "./tools/dlmm.js";

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

test("rebalanceOnExit does not hard-block on portfolio guard pauses", async () => {
	const originalCwd = process.cwd();
	const originalDryRun = process.env.DRY_RUN;
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-rebalance-guard-test-"));

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		process.env.DRY_RUN = "true";
		fs.writeFileSync("lessons.json", JSON.stringify({
			lessons: [],
			performance: [
				{ recorded_at: new Date().toISOString(), pnl_usd: -12, close_reason: "STOP_LOSS: one" },
				{ recorded_at: new Date().toISOString(), pnl_usd: -10, close_reason: "STOP_LOSS: two" },
				{ recorded_at: new Date().toISOString(), pnl_usd: -8, close_reason: "STOP_LOSS: three" },
			],
		}, null, 2));

		const result = await rebalanceOnExit({
			position_address: "missing-position",
			force_rebalance: true,
		});

		assert.notEqual(result.reason, "portfolio_guard_pause_active");
		assert.equal(result.blocked, undefined);
	} finally {
		if (originalDryRun == null) delete process.env.DRY_RUN;
		else process.env.DRY_RUN = originalDryRun;
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("rebalanceOnExit blocks redeploy when remaining open risk is unknown", async () => {
	const originalCwd = process.cwd();
	const originalDryRun = process.env.DRY_RUN;
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-rebalance-open-risk-test-"));

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		process.env.DRY_RUN = "true";
		const result = await rebalanceOnExit({
			position_address: "missing-position",
			force_rebalance: true,
		});
		assert.notEqual(result.error, undefined);
	} finally {
		if (originalDryRun == null) delete process.env.DRY_RUN;
		else process.env.DRY_RUN = originalDryRun;
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("suppressed failed deploy positions are ignored by live adoption", () => {
	assert.equal(shouldIgnoreTrackedLivePosition({ closed: true, suppress_live_adoption: true }), true);
	assert.equal(shouldIgnoreTrackedLivePosition({ closed: true, suppress_live_adoption: false }), false);
	assert.equal(shouldIgnoreTrackedLivePosition({ closed: false, suppress_live_adoption: true }), false);
});

test("finalizeCommittedWriteResult keeps committed writes successful while surfacing manual review", () => {
	const result = finalizeCommittedWriteResult(
		{ success: true, position: "pos-committed-1" },
		["Local close recording failed: state unavailable"],
	);

	assert.equal(result.success, true);
	assert.equal(result.manual_review_required, true);
	assert.match(result.manual_review_reason || "", /local close recording failed/i);
	assert.equal(result.warnings.length, 1);
});

test("resolveDeployInitialValueUsd prefers executor-derived basis over fallback recomputation", () => {
	const result = resolveDeployInitialValueUsd({
		initialValueUsd: 50,
		amountSol: 0.5,
		solPrice: 0,
		amountToken: 0,
		activePrice: 2,
	});

	assert.equal(result, 50);
});
