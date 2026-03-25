import assert from "node:assert/strict";
import test from "node:test";

import { deriveExpectedVolumeProfile, planManagementRuntimeAction, resolveTargetManagementInterval } from "./runtime-policy.js";

const config = {
  management: {
    emergencyPriceDropPct: -50,
    takeProfitFeePct: 5,
    minFeePerTvl24h: 7,
    minClaimAmount: 5,
  },
};

test("resolveTargetManagementInterval uses the max open-position volatility", () => {
  const result = resolveTargetManagementInterval([
    { volatility: 1.2 },
    { volatility: 5.4 },
    { volatility: 2.8 },
  ]);

  assert.equal(result.interval, 3);
  assert.equal(result.maxVolatility, 5.4);
});

test("planManagementRuntimeAction favors rebalance when out of range", () => {
  const result = planManagementRuntimeAction({
    position: "pos-1",
    in_range: false,
    minutes_out_of_range: 12,
    pnl: { volatility: 6 },
  }, config, "high");

  assert.equal(result.toolName, "rebalance_on_exit");
  assert.equal(result.rule, "out_of_range_rebalance");
  assert.equal(result.args.expected_volume_profile, "high");
});

test("planManagementRuntimeAction only escalates to model when no deterministic rule applies", () => {
  const result = planManagementRuntimeAction({
    position: "pos-2",
    in_range: true,
    age_minutes: 20,
    pnl: { pnl_pct: 1.4, fee_per_tvl_24h: 12, unclaimed_fee_usd: 1.5 },
    unclaimed_fees_usd: 1.5,
  }, config);

  assert.equal(result, null);
});

test("deriveExpectedVolumeProfile remains bounded and deterministic", () => {
  assert.equal(deriveExpectedVolumeProfile({ fee_tvl_ratio: 0.02, volume_window: 500, volatility: 1 }), "low");
  assert.equal(deriveExpectedVolumeProfile({ fee_tvl_ratio: 0.7, volume_window: 100000, volatility: 11 }), "high");
  assert.equal(deriveExpectedVolumeProfile({ fee_tvl_ratio: 2.1, volume_window: 300000, volatility: 19 }), "bursty");
});
