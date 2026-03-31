import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	addStrategy,
	getActiveStrategy,
	removeStrategy,
	resolveAutonomousStrategyPreset,
	resolveDeploySemantics,
	setActiveStrategy,
	upsertAutoDerivedStrategyCandidate,
} from "./strategy-library.js";

test("resolveAutonomousStrategyPreset selects quality_spot for strong top-LP quality signals", () => {
	const preset = resolveAutonomousStrategyPreset({
		pool: {
			six_hour_volatility: 4,
			fee_active_tvl_ratio: 0.05,
			organic_score: 84,
			holders: 2400,
			price_change_pct: 3,
		},
		distributionPlan: { strategy: "spot" },
		scoredLpers: {
			candidates: [{ metrics: { win_rate_pct: 82 } }],
		},
	});

	assert.equal(preset.id, "quality_spot");
	assert.equal(preset.lp_strategy, "spot");
	assert.match(preset.activation_summary || "", /top LP win rate/i);
});

test("resolveAutonomousStrategyPreset selects yield_spot_wide for calm fee-efficient pools", () => {
	const preset = resolveAutonomousStrategyPreset({
		pool: {
			six_hour_volatility: 3,
			fee_active_tvl_ratio: 0.09,
			organic_score: 75,
			holders: 700,
			price_change_pct: 4,
		},
		distributionPlan: { strategy: "spot" },
		scoredLpers: { candidates: [] },
	});

	assert.equal(preset.id, "yield_spot_wide");
	assert.equal(preset.lp_strategy, "spot");
	assert.match(preset.activation_summary || "", /fee\/TVL/i);
});

test("resolveAutonomousStrategyPreset falls back to bid_ask_default for hotter or weaker pools", () => {
	const preset = resolveAutonomousStrategyPreset({
		pool: {
			six_hour_volatility: 12,
			fee_active_tvl_ratio: 0.02,
			organic_score: 66,
			holders: 420,
			price_change_pct: 18,
		},
		distributionPlan: { strategy: "bid_ask" },
		scoredLpers: { candidates: [] },
	});

	assert.equal(preset.id, "bid_ask_default");
	assert.equal(preset.lp_strategy, "bid_ask");
	assert.match(preset.activation_summary || "", /fallback bid_ask/i);
});

test("resolveDeploySemantics exposes clear spot subtype and range labels", () => {
	const semantics = resolveDeploySemantics({
		strategy: "spot",
		bins_below: 18,
		bins_above: 18,
		amount_x: 0,
		amount_y: 1,
	});

	assert.equal(semantics.spot_subtype, "spot_single_sided_sol");
	assert.equal(semantics.deposit_sidedness, "single_sided");
	assert.equal(semantics.deposit_asset, "sol");
	assert.equal(semantics.range_shape, "two_sided_range");
	assert.match(semantics.strategy_semantics_label, /spot_single_sided_sol/i);
});

test("resolveDeploySemantics distinguishes two-sided spot deposits", () => {
	const semantics = resolveDeploySemantics({
		strategy: "spot",
		bins_below: 12,
		bins_above: 12,
		amount_x: 1.5,
		amount_y: 0.8,
	});

	assert.equal(semantics.spot_subtype, "spot_two_sided");
	assert.equal(semantics.deposit_sidedness, "two_sided");
	assert.equal(semantics.deposit_asset, "sol_and_token");
	assert.equal(semantics.range_shape, "two_sided_range");
});

test("upsertAutoDerivedStrategyCandidate saves inactive review candidates without auto-activating them", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "zenith-auto-strategy-lib-test-"),
	);

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		const result = upsertAutoDerivedStrategyCandidate({
			id: "auto_spot_candidate",
			name: "Auto Spot Candidate",
			lp_strategy: "spot",
			entry: { condition: "candidate only", single_side: "sol" },
			range: { type: "balanced", bins_below: 18, bins_above: 18 },
			best_for: "derived from closes",
			evidence: { positions_analyzed: 5, win_rate_pct: 80 },
		});

		assert.equal(result.saved, true);
		assert.equal(result.active, false);

		const persisted = JSON.parse(
			fs.readFileSync(path.join(tempDir, "strategy-library.json"), "utf8"),
		);
		assert.equal(persisted.active, null);
		assert.equal(
			persisted.strategies.auto_spot_candidate.source,
			"auto_derived",
		);
		assert.equal(persisted.strategies.auto_spot_candidate.status, "candidate");
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("upsertAutoDerivedStrategyCandidate fails closed on corrupt strategy library state", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "zenith-auto-strategy-invalid-state-test-"),
	);

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "strategy-library.json"), "{bad json");

		const result = upsertAutoDerivedStrategyCandidate({
			id: "auto_bid_ask_candidate",
			name: "Auto Bid-Ask Candidate",
			lp_strategy: "bid_ask",
		});

		assert.equal(result.blocked, true);
		assert.equal(result.reason_code, "STRATEGY_LIBRARY_INVALID");
		assert.match(
			fs.readFileSync(path.join(tempDir, "strategy-library.json"), "utf8"),
			/bad json/,
		);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("setActiveStrategy blocks direct activation of auto-derived candidates", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "zenith-auto-strategy-activation-test-"),
	);

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		upsertAutoDerivedStrategyCandidate({
			id: "auto_spot_candidate",
			name: "Auto Spot Candidate",
			lp_strategy: "spot",
			evidence: { positions_analyzed: 5 },
		});

		const result = setActiveStrategy({ id: "auto_spot_candidate" });
		assert.equal(result.blocked, true);
		assert.equal(result.reason_code, "STRATEGY_CANDIDATE_REVIEW_REQUIRED");
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("removing an active manual strategy does not promote auto-derived candidates", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "zenith-auto-strategy-removal-test-"),
	);

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
		addStrategy({
			id: "manual_bid_ask",
			name: "Manual Bid Ask",
			lp_strategy: "bid_ask",
		});
		upsertAutoDerivedStrategyCandidate({
			id: "auto_spot_candidate",
			name: "Auto Spot Candidate",
			lp_strategy: "spot",
			evidence: { positions_analyzed: 5 },
		});

		const removal = removeStrategy({ id: "manual_bid_ask" });
		assert.equal(removal.removed, true);
		assert.equal(removal.new_active, null);
		assert.equal(getActiveStrategy(), null);

		const persisted = JSON.parse(
			fs.readFileSync(path.join(tempDir, "strategy-library.json"), "utf8"),
		);
		assert.equal(persisted.active, null);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
