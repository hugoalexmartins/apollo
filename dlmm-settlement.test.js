import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePostCloseSettlementObservation } from "./tools/dlmm.js";

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
