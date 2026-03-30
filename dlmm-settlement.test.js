import assert from "node:assert/strict";
import test from "node:test";

import {
	evaluatePostClaimSettlementObservation,
	evaluatePostCloseSettlementObservation,
} from "./tools/dlmm-settlement.js";

test("settlement observation accepts position disappearance as valid signal", () => {
	const result = evaluatePostCloseSettlementObservation({
		previousBaseBalance: 0.25,
		observedBaseBalance: 0,
		positionStillOpen: false,
	});

  assert.equal(result.settled, true);
  assert.equal(result.signal, "position_absent_from_open_positions");
});

test("settlement observation requires a positive recovered base-token delta", () => {
	const result = evaluatePostCloseSettlementObservation({
		previousBaseBalance: 0.25,
		observedBaseBalance: 0.42,
		positionStillOpen: true,
	});

	assert.equal(result.settled, true);
	assert.equal(result.signal, "base_balance_delta_observed");
	assert.ok(Math.abs(result.observed_balance_delta - 0.17) < 1e-9);
});

test("settlement observation remains unsettled without either signal", () => {
	const result = evaluatePostCloseSettlementObservation({
		previousBaseBalance: 0.25,
		observedBaseBalance: 0,
		positionStillOpen: true,
	});

	assert.equal(result.settled, false);
	assert.equal(result.reason, "settlement_signal_not_observed");
});

test("claim settlement observation accepts token delta on any claimed mint", () => {
	const result = evaluatePostClaimSettlementObservation({
		previousBalancesByMint: {
			"mint-x": 0.25,
			"mint-y": 0.4,
		},
		observedBalancesByMint: {
			"mint-x": 0.25,
			"mint-y": 0.65,
		},
		previousUnclaimedFeeUsd: 12,
		observedUnclaimedFeeUsd: 12,
	});

	assert.equal(result.settled, true);
	assert.equal(result.signal, "token_balance_delta_observed");
	assert.equal(result.observed_mint, "mint-y");
	assert.ok(Math.abs(result.observed_amount_received - 0.25) < 1e-9);
});

test("claim settlement observation accepts unclaimed fee drop when token delta is not visible", () => {
	const result = evaluatePostClaimSettlementObservation({
		previousBalancesByMint: {
			"mint-x": 0.25,
		},
		observedBalancesByMint: {
			"mint-x": 0.25,
		},
		previousUnclaimedFeeUsd: 12,
		observedUnclaimedFeeUsd: 1.5,
	});

	assert.equal(result.settled, true);
	assert.equal(result.signal, "unclaimed_fee_drop_observed");
	assert.equal(result.observed_unclaimed_fee_delta, 10.5);
});

test("claim settlement observation remains unsettled without delta or fee drop", () => {
	const result = evaluatePostClaimSettlementObservation({
		previousBalancesByMint: {
			"mint-x": 0.25,
		},
		observedBalancesByMint: {
			"mint-x": 0.25,
		},
		previousUnclaimedFeeUsd: 12,
		observedUnclaimedFeeUsd: 12,
	});

	assert.equal(result.settled, false);
	assert.equal(result.reason, "claim_settlement_signal_not_observed");
});
