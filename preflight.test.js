import assert from "node:assert/strict";
import test from "node:test";

import { config } from "./config.js";
import { clearPortfolioGuardPause } from "./portfolio-guards.js";
import {
	buildRiskOpeningPreflightReport,
	formatPreflightReport,
	validateRecordedRiskOpeningPreflight,
} from "./preflight.js";

const baseConfig = {
	management: {
		deployAmountSol: 0.5,
		gasReserve: 0.2,
	},
};

test("risk-opening preflight passes with healthy startup, clear recovery, ready wallet, and scoped approval", () => {
	const report = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-1",
		amount_sol: 0.5,
		startupSnapshot: { wallet: { sol: 1.2 } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: {
			pass: true,
			armed_until: new Date(Date.parse("2030-01-01T00:20:00.000Z")).toISOString(),
			scope: {
				allowed_tools: ["deploy_position"],
				pool_address: "pool-1",
				max_amount_sol: 0.5,
			},
		},
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});

	assert.equal(report.pass, true);
	assert.equal(report.status, "pass");
	assert.equal(report.checks.approval.pass, true);
	assert.equal(report.checks.portfolio_guard.pass, true);
	assert.equal(validateRecordedRiskOpeningPreflight(report, {
		tool_name: "deploy_position",
		pool_address: "pool-1",
		amount_sol: 0.5,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).pass, true);
});

test("risk-opening preflight records and validates token-only and dual-sided deploy shapes", () => {
	const tokenOnly = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-token-only",
		base_mint: "mint-token-only",
		amount_x: 10,
		amount_y: 0,
		startupSnapshot: { wallet: { sol: 0.25, tokens: [{ mint: "mint-token-only", balance: 10 }] } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: {
			pass: true,
			scope: {
				allowed_tools: ["deploy_position"],
				pool_address: "pool-token-only",
				max_amount_x: 10,
				max_amount_y: 0,
			},
		},
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});
	assert.equal(tokenOnly.pass, true);
	assert.equal(tokenOnly.action.amount_x, 10);
	assert.equal(tokenOnly.action.amount_y, 0);
	assert.equal(validateRecordedRiskOpeningPreflight(tokenOnly, {
		tool_name: "deploy_position",
		pool_address: "pool-token-only",
		amount_x: 10,
		amount_y: 0,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).pass, true);
	assert.equal(validateRecordedRiskOpeningPreflight(tokenOnly, {
		tool_name: "deploy_position",
		pool_address: "pool-token-only",
		amount_x: 11,
		amount_y: 0,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).reason_code, "PREFLIGHT_NOTIONAL_EXCEEDED");
	assert.equal(validateRecordedRiskOpeningPreflight(tokenOnly, {
		tool_name: "deploy_position",
		pool_address: "pool-token-only",
		amount_x: 10,
		amount_y: 0.2,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).reason_code, "PREFLIGHT_FUNDING_MODE_MISMATCH");

	const dualSided = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-dual",
		base_mint: "mint-dual",
		amount_x: 5,
		amount_y: 0.4,
		startupSnapshot: { wallet: { sol: 0.8, tokens: [{ mint: "mint-dual", balance: 5 }] } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: {
			pass: true,
			scope: {
				allowed_tools: ["deploy_position"],
				pool_address: "pool-dual",
				max_amount_x: 5,
				max_amount_y: 0.4,
			},
		},
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});
	assert.equal(dualSided.pass, true);
	assert.equal(validateRecordedRiskOpeningPreflight(dualSided, {
		tool_name: "deploy_position",
		pool_address: "pool-dual",
		amount_x: 5,
		amount_y: 0.5,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).reason_code, "PREFLIGHT_NOTIONAL_EXCEEDED");

	const solOnly = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-sol-only",
		amount_x: 0,
		amount_y: 0.4,
		startupSnapshot: { wallet: { sol: 1.2, tokens: [] } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: {
			pass: true,
			scope: {
				allowed_tools: ["deploy_position"],
				pool_address: "pool-sol-only",
				max_amount_x: 0,
				max_amount_y: 0.4,
			},
		},
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});
	assert.equal(validateRecordedRiskOpeningPreflight(solOnly, {
		tool_name: "deploy_position",
		pool_address: "pool-sol-only",
		amount_x: 1,
		amount_y: 0.4,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).reason_code, "PREFLIGHT_FUNDING_MODE_MISMATCH");

	const equalAliases = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-equal-aliases",
		amount_x: 0,
		amount_y: 0.4,
		amount_sol: 0.4,
		startupSnapshot: { wallet: { sol: 1.2, tokens: [] } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: { pass: true, scope: {} },
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});
	assert.equal(equalAliases.pass, true);
});

test("risk-opening preflight fails closed on invalid amount input and missing token readiness", () => {
	const invalidInput = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-invalid",
		amount_x: "oops",
		amount_y: 0.4,
		startupSnapshot: { wallet: { sol: 1 } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: { pass: true, scope: {} },
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});
	assert.equal(invalidInput.reason_code, "PREFLIGHT_INVALID_INPUT");

	const conflictingAlias = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-conflict",
		amount_y: 0.4,
		amount_sol: 0.9,
		startupSnapshot: { wallet: { sol: 1 } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: { pass: true, scope: {} },
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});
	assert.equal(conflictingAlias.reason_code, "PREFLIGHT_INVALID_INPUT");
	assert.match(conflictingAlias.reason, /amount_y_vs_amount_sol/);

	const missingTokenBalance = buildRiskOpeningPreflightReport({
		tool_name: "deploy_position",
		pool_address: "pool-token-missing",
		base_mint: "mint-token-missing",
		amount_x: 4,
		amount_y: 0,
		startupSnapshot: { wallet: { sol: 1, tokens: [] } },
		isFailClosedResult: () => false,
		recoveryReport: { status: "clear", incident_key: null },
		suppression: { suppressed: false, incident_key: null },
		approval: { pass: true, scope: {} },
		config: baseConfig,
		nowMs: Date.parse("2030-01-01T00:00:00.000Z"),
	});
	assert.equal(missingTokenBalance.reason_code, "PREFLIGHT_TOKEN_BALANCE_UNREADY");

	assert.equal(validateRecordedRiskOpeningPreflight({
		pass: true,
		valid_until: "2030-01-01T00:10:00.000Z",
		action: { tool_name: "deploy_position", pool_address: "pool-1", amount_x: 5, amount_y: 0.4 },
	}, {
		tool_name: "deploy_position",
		pool_address: "pool-1",
		amount_x: "bad",
		amount_y: 0.4,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).reason_code, "PREFLIGHT_INVALID_INPUT");
});

test("risk-opening preflight fails with stable runbook slugs for health, recovery, wallet, and approval", () => {
	const originalProtections = { ...config.protections };
	clearPortfolioGuardPause({ reason: "preflight test reset" });
	try {
		Object.assign(config.protections, {
			enabled: true,
			maxRecentRealizedLossUsd: 9999,
			recentLossWindowHours: 24,
			stopLossStreakLimit: 99,
			maxDrawdownPct: 99,
			maxOpenUnrealizedLossUsd: 9999,
			pauseMinutes: 180,
			maxReviewedCloses: 10,
		});

		const health = buildRiskOpeningPreflightReport({
			tool_name: "deploy_position",
			startupSnapshot: { reason_code: "FAIL_CLOSED", message: "snapshot failed" },
			isFailClosedResult: () => true,
			recoveryReport: { status: "clear" },
			suppression: { suppressed: false },
			approval: { pass: true, scope: {} },
			config: baseConfig,
		});
		assert.equal(health.runbook_slug, "preflight-health-check");

		const recovery = buildRiskOpeningPreflightReport({
			tool_name: "deploy_position",
			startupSnapshot: { wallet: { sol: 2 } },
			isFailClosedResult: () => false,
			recoveryReport: { status: "manual_review_required", incident_key: "wf-1" },
			suppression: { suppressed: true, reason: "manual review required" },
			approval: { pass: true, scope: {} },
			config: baseConfig,
		});
		assert.equal(recovery.runbook_slug, "preflight-recovery-block");

		const wallet = buildRiskOpeningPreflightReport({
			tool_name: "deploy_position",
			amount_sol: 0.5,
			startupSnapshot: { wallet: { sol: 0.3 } },
			isFailClosedResult: () => false,
			recoveryReport: { status: "clear" },
			suppression: { suppressed: false },
			approval: { pass: true, scope: {} },
			config: baseConfig,
		});
		assert.equal(wallet.runbook_slug, "preflight-wallet-readiness");

		const approval = buildRiskOpeningPreflightReport({
			tool_name: "deploy_position",
			startupSnapshot: { wallet: { sol: 2 } },
			isFailClosedResult: () => false,
			recoveryReport: { status: "clear" },
			suppression: { suppressed: false },
			approval: { pass: false, reason_code: "GENERAL_WRITE_TOOL_SCOPE_MISMATCH", reason: "bad scope", scope: {} },
			config: baseConfig,
		});
		assert.equal(approval.runbook_slug, "preflight-approval-scope");
		assert.match(formatPreflightReport(approval), /runbook_slug: preflight-approval-scope/i);

		Object.assign(config.protections, {
			enabled: true,
			maxRecentRealizedLossUsd: 9999,
			recentLossWindowHours: 24,
			stopLossStreakLimit: 99,
			maxDrawdownPct: 99,
			maxOpenUnrealizedLossUsd: 50,
			pauseMinutes: 180,
			maxReviewedCloses: 10,
		});
		const guard = buildRiskOpeningPreflightReport({
			tool_name: "deploy_position",
			startupSnapshot: {
				wallet: { sol: 2, sol_usd: 300 },
				positions: { positions: [{ pnl_usd: -60 }] },
			},
			isFailClosedResult: () => false,
			recoveryReport: { status: "clear" },
			suppression: { suppressed: false },
			approval: { pass: true, scope: {} },
			config: baseConfig,
		});
		assert.equal(guard.reason_code, "OPEN_RISK_LIMIT");
		clearPortfolioGuardPause({ reason: "preflight unknown-risk branch reset" });

		const unknownOpenRisk = buildRiskOpeningPreflightReport({
			tool_name: "deploy_position",
			startupSnapshot: {
				wallet: { sol: 2, sol_usd: 300 },
				positions: { positions: [{ pnl_missing: true }] },
			},
			isFailClosedResult: () => false,
			recoveryReport: { status: "clear" },
			suppression: { suppressed: false },
			approval: { pass: true, scope: {} },
			config: baseConfig,
		});
		assert.equal(unknownOpenRisk.reason_code, "OPEN_RISK_STATE_UNKNOWN");

		const staleOpenRisk = buildRiskOpeningPreflightReport({
			tool_name: "deploy_position",
			startupSnapshot: {
				wallet: { sol: 2, sol_usd: 300 },
				positions: { positions: [{ pnl_usd: -5, stale: true, status: "stale" }] },
			},
			isFailClosedResult: () => false,
			recoveryReport: { status: "clear" },
			suppression: { suppressed: false },
			approval: { pass: true, scope: {} },
			config: baseConfig,
		});
		assert.equal(staleOpenRisk.reason_code, "OPEN_RISK_STATE_UNKNOWN");
	} finally {
		Object.assign(config.protections, originalProtections);
		clearPortfolioGuardPause({ reason: "preflight test cleanup" });
	}
});

test("recorded preflight rejects stale or mismatched requests", () => {
	const report = {
		pass: true,
		valid_until: "2030-01-01T00:10:00.000Z",
		action: {
			tool_name: "deploy_position",
			pool_address: "pool-1",
			amount_sol: 0.5,
		},
	};
	assert.equal(validateRecordedRiskOpeningPreflight(report, {
		tool_name: "deploy_position",
		pool_address: "pool-2",
		amount_sol: 0.5,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).reason_code, "PREFLIGHT_POOL_MISMATCH");
	assert.equal(validateRecordedRiskOpeningPreflight(report, {
		tool_name: "deploy_position",
		pool_address: "pool-1",
		amount_sol: 0.8,
		nowMs: Date.parse("2030-01-01T00:01:00.000Z"),
	}).reason_code, "PREFLIGHT_NOTIONAL_EXCEEDED");
	assert.equal(validateRecordedRiskOpeningPreflight(report, {
		tool_name: "deploy_position",
		pool_address: "pool-1",
		amount_sol: 0.5,
		nowMs: Date.parse("2030-01-01T00:11:00.000Z"),
	}).reason_code, "PREFLIGHT_STALE");
});
