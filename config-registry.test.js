import assert from "node:assert/strict";
import test from "node:test";

import {
	formatMutableConfigKeyHelp,
	getMutableConfigEntry,
	normalizeMutableConfigChanges,
} from "./config-registry.js";

test("config registry exposes current mutable keys for update_config surfaces", () => {
	const help = formatMutableConfigKeyHelp();
	assert.match(help, /maxBundlePct/);
	assert.match(help, /minTokenAgeHours/);
	assert.match(help, /maxTokenAgeHours/);
	assert.match(help, /healthCheckIntervalMin/);
	assert.match(help, /strategy/);
	assert.equal(getMutableConfigEntry("maxBundlePct")?.field, "maxBundlePct");
});

test("config registry normalizes and validates mutable config changes", () => {
	const currentConfig = {
		screening: { minTokenAgeHours: null, maxTokenAgeHours: null, timeframe: "5m", category: "trending", maxBundlePct: 30 },
		management: { autoSwapAfterClaim: false, deployAmountSol: 0.5, gasReserve: 0.2, minSolToOpen: 0.7 },
		llm: { temperature: 0.3 },
		strategy: { strategy: "bid_ask" },
	};

	const valid = normalizeMutableConfigChanges({
		minTokenAgeHours: 12,
		autoSwapAfterClaim: true,
		strategy: "spot",
		maxBundlePct: 25,
	}, currentConfig);
	assert.deepEqual(valid.errors, []);
	assert.equal(valid.normalized.minTokenAgeHours, 12);
	assert.equal(valid.normalized.autoSwapAfterClaim, true);
	assert.equal(valid.normalized.strategy, "spot");

	const invalid = normalizeMutableConfigChanges({
		autoSwapAfterClaim: "yes",
		strategy: "bad",
		minTokenAgeHours: -3,
	}, currentConfig);
	assert.equal(invalid.errors.length, 3);
	assert.match(invalid.errors.join("; "), /autoSwapAfterClaim/);
	assert.match(invalid.errors.join("; "), /strategy/);
	assert.match(invalid.errors.join("; "), /minTokenAgeHours/);

	const relational = normalizeMutableConfigChanges({
		minTvl: 20000,
		maxTvl: 10000,
		deployAmountSol: 1,
		maxDeployAmount: 0.5,
		managementIntervalMin: 90,
	}, {
		screening: { minTvl: 10000, maxTvl: 150000 },
		management: { deployAmountSol: 0.5, gasReserve: 0.2, minSolToOpen: 1.2 },
		risk: { maxDeployAmount: 50 },
		schedule: { managementIntervalMin: 3, screeningIntervalMin: 30, healthCheckIntervalMin: 60 },
	});
	assert.match(relational.errors.join("; "), /maxTvl must be >= minTvl/);
	assert.match(relational.errors.join("; "), /maxDeployAmount must be >= deployAmountSol/);
	assert.match(relational.errors.join("; "), /managementIntervalMin/);
});
