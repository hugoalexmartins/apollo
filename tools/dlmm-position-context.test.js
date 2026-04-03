import assert from "node:assert/strict";
import test from "node:test";

import {
	buildTrackedPositionFallback,
	evaluateSingleSidedSolDeployOrientation,
	getPositionExecutionContext,
	resolveCanonicalPoolIdentity,
	resolveCanonicalPoolTokenView,
	resolvePoolTokenMints,
	resolveSingleSidedSolPoolOrientation,
} from "./dlmm-position-context.js";
import { classifyRangeLocation, resolveBinSnapshot } from "./dlmm-rebalance-helpers.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

test("dlmm position context builds tracked fallback deterministically", () => {
	const fallback = buildTrackedPositionFallback("pos-1", {
		getTrackedPosition: () => ({
			position: "pos-1",
			pool: "pool-1",
			pool_name: "Pool One",
			strategy: "bid_ask",
			bin_step: 100,
			volatility: 8,
			fee_tvl_ratio: 0.03,
			organic_score: 70,
			bin_range: { min: 100, max: 130 },
			active_bin_at_deploy: 120,
			initial_value_usd: 42,
		}),
	});
	assert.equal(fallback.position, "pos-1");
	assert.equal(fallback.source, "state_fallback");
	assert.equal(fallback.total_value_usd, 42);
});

test("dlmm position context falls back in dry run when live positions are unavailable", async () => {
	const context = await getPositionExecutionContext("pos-1", {
		getMyPositions: async () => ({ error: "rpc unavailable", positions: [] }),
		getPositionPnl: async () => ({ pnl_pct: 1 }),
		buildTrackedFallback: () => ({
			position: "pos-1",
			pool: "pool-1",
			pool_name: "Pool One",
			strategy: "bid_ask",
			lower_bin: 100,
			upper_bin: 130,
			active_bin: 120,
			in_range: true,
		}),
		resolveBinSnapshot,
		classifyRangeLocation,
		isDryRun: true,
	});
	assert.equal(context.context_source, "state_fallback");
	assert.equal(context.range_location.location, "near_center");
});

test("dlmm position context resolves pool token mints through injected pool getter", async () => {
	const mints = await resolvePoolTokenMints({
		poolAddress: "pool-1",
		getPool: async () => ({
			lbPair: {
				tokenXMint: { toString: () => "mint-x" },
				tokenYMint: { toString: () => "mint-y" },
			},
		}),
	});
	assert.equal(mints.token_x_mint, "mint-x");
	assert.equal(mints.token_y_mint, "mint-y");
});

test("dlmm position context resolves compatible single-sided SOL orientation when SOL is token Y", () => {
	const orientation = resolveSingleSidedSolPoolOrientation({
		token_x_mint: "mint-x",
		token_y_mint: SOL_MINT,
		solMint: SOL_MINT,
	});

	assert.equal(orientation.status, "compatible");
	assert.equal(orientation.compatible, true);
	assert.equal(orientation.sol_side, "token_y");
	assert.equal(orientation.required_amount_field, "amount_y");
});

test("dlmm position context resolves wrong-side single-sided SOL orientation when SOL is token X", () => {
	const orientation = resolveSingleSidedSolPoolOrientation({
		token_x_mint: SOL_MINT,
		token_y_mint: "mint-y",
		solMint: SOL_MINT,
	});

	assert.equal(orientation.status, "wrong_side");
	assert.equal(orientation.compatible, false);
	assert.equal(orientation.sol_side, "token_x");
	assert.equal(orientation.required_amount_field, "amount_x");
});

test("dlmm position context resolves unknown single-sided SOL orientation when pool mint metadata is missing", () => {
	const orientation = resolveSingleSidedSolPoolOrientation({
		token_x_mint: null,
		token_y_mint: SOL_MINT,
		solMint: SOL_MINT,
	});

	assert.equal(orientation.status, "unknown");
	assert.equal(orientation.compatible, false);
});

test("dlmm position context resolves canonical risk mint when SOL is token X", () => {
	const identity = resolveCanonicalPoolIdentity({
		token_x_mint: SOL_MINT,
		token_y_mint: "mint-risk",
		solMint: SOL_MINT,
	});

	assert.equal(identity.risk_mint, "mint-risk");
	assert.equal(identity.risk_token_side, "token_y");
	assert.equal(identity.counter_mint, SOL_MINT);
	assert.equal(identity.orientation_status, "wrong_side");
});

test("dlmm position context resolves canonical token view from raw token objects", () => {
	const view = resolveCanonicalPoolTokenView({
		token_x: { address: SOL_MINT, symbol: "SOL" },
		token_y: { address: "mint-risk", symbol: "RISK" },
		solMint: SOL_MINT,
	});

	assert.equal(view.risk_mint, "mint-risk");
	assert.equal(view.risk_token?.symbol, "RISK");
	assert.equal(view.counter_token?.symbol, "SOL");
});

test("dlmm position context blocks single-sided SOL deploys when SOL is token X", () => {
	const guard = evaluateSingleSidedSolDeployOrientation({
		amount_x: 0,
		amount_y: 0.5,
		token_x_mint: SOL_MINT,
		token_y_mint: "mint-y",
		solMint: SOL_MINT,
	});

	assert.equal(guard.applies, true);
	assert.equal(guard.blocked, true);
	assert.equal(guard.reason_code, "single_sided_sol_requires_token_y_sol");
	assert.equal(guard.orientation.status, "wrong_side");
});

test("dlmm position context ignores two-sided deploys for single-sided SOL guard", () => {
	const guard = evaluateSingleSidedSolDeployOrientation({
		amount_x: 1000,
		amount_y: 0.5,
		token_x_mint: "mint-x",
		token_y_mint: SOL_MINT,
		solMint: SOL_MINT,
	});

	assert.equal(guard.applies, false);
	assert.equal(guard.blocked, false);
});
