import assert from "node:assert/strict";
import test from "node:test";

import { classifyInstructionRuntimeGate, classifyManagementModelGate, deriveExpectedVolumeProfile, isPnlSignalStale, MANAGEMENT_SUBREASONS, planManagementRuntimeAction, resolveTargetManagementInterval } from "./runtime-policy.js";

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
  assert.equal(result.rule, MANAGEMENT_SUBREASONS.OUT_OF_RANGE);
  assert.equal(result.args.expected_volume_profile, "high");
});

test("planManagementRuntimeAction exposes explicit subreason for fee-threshold claims", () => {
  const result = planManagementRuntimeAction({
    position: "pos-3",
    in_range: true,
    age_minutes: 120,
    pnl: { pnl_pct: 1.2, fee_per_tvl_24h: 12, unclaimed_fee_usd: 8 },
    unclaimed_fees_usd: 8,
  }, config);

  assert.equal(result.toolName, "auto_compound_fees");
  assert.equal(result.rule, MANAGEMENT_SUBREASONS.FEE_THRESHOLD);
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

test("stale pnl signals suppress pnl-driven management actions", () => {
  const result = planManagementRuntimeAction({
    position: "pos-stale",
    in_range: true,
    age_minutes: 120,
    pnl: {
      stale: true,
      pnl_pct: 9,
      fee_per_tvl_24h: 2,
      unclaimed_fee_usd: 12,
    },
    unclaimed_fees_usd: 12,
  }, config);

  assert.equal(result, null);
});

test("stale pnl suppresses exit-alert closes", () => {
  const result = planManagementRuntimeAction({
    position: "pos-stale-exit",
    exitAlert: "STOP_LOSS: stale feed should not trigger close",
    in_range: true,
    age_minutes: 120,
    pnl: { stale: true, pnl_pct: -20 },
  }, config);

  assert.equal(result, null);
});

test("stale pnl still allows deterministic out-of-range rebalance", () => {
  const result = planManagementRuntimeAction({
    position: "pos-stale-oor",
    in_range: false,
    minutes_out_of_range: 8,
    pnl: { stale: true, volatility: 6 },
  }, config);

  assert.equal(result.toolName, "rebalance_on_exit");
  assert.equal(result.rule, MANAGEMENT_SUBREASONS.OUT_OF_RANGE);
});

test("isPnlSignalStale detects explicit stale markers", () => {
  assert.equal(isPnlSignalStale({ pnl: { stale: true } }), true);
  assert.equal(isPnlSignalStale({ pnl: { lagging: true } }), true);
  assert.equal(isPnlSignalStale({ pnl: { pnl_pct: 1.2 } }), false);
});

test("classifyManagementModelGate keeps model usage instruction-only", () => {
  assert.deepEqual(classifyManagementModelGate({ instruction: "close if moon soon" }), {
    route: "model",
    reason: "instruction_requires_model",
  });
  assert.deepEqual(classifyManagementModelGate({}), {
    route: "runtime",
    reason: "no_instruction",
  });
});

test("classifyInstructionRuntimeGate holds or closes on simple parsed pnl instructions", () => {
  assert.deepEqual(classifyInstructionRuntimeGate({
    instruction: "hold until pnl >= 5%",
    pnl: { pnl_pct: 2.1 },
  }), {
    route: "runtime",
    reason: "instruction_condition_not_met",
    action: "hold",
    parsed: {
      comparator: ">=",
      thresholdPct: 5,
      source: "explicit_comparator",
    },
    pnlPct: 2.1,
  });

  const closeGate = classifyInstructionRuntimeGate({
    position: "pos-i",
    instruction: "close at 5% profit",
    pnl: { pnl_pct: 5.5 },
  });
  assert.equal(closeGate.route, "runtime");
  assert.equal(closeGate.reason, "instruction_condition_met");
  assert.equal(closeGate.action, "close");
});

test("planManagementRuntimeAction deterministically closes when a parsed instruction threshold is met", () => {
  const result = planManagementRuntimeAction({
    position: "pos-inst-close",
    instruction: "hold until pnl >= 5%",
    pnl: { pnl_pct: 6.2 },
    in_range: true,
  }, config);

  assert.equal(result.toolName, "close_position");
  assert.equal(result.rule, MANAGEMENT_SUBREASONS.INSTRUCTION);
  assert.equal(result.args.position_address, "pos-inst-close");
});
