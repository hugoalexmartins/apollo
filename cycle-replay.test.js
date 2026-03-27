import assert from "node:assert/strict";
import test from "node:test";

import { replayManagementEnvelope, replayScreeningEnvelope } from "./cycle-replay.js";

test("replayScreeningEnvelope reproduces deterministic shortlist ordering", () => {
  const replay = replayScreeningEnvelope({
    cycle_id: "screening-1",
    occupied_pools: [],
    occupied_mints: [],
    shortlist: [{}, {}],
    candidate_inputs: [
      {
        pool: "pool-low",
        name: "Low-SOL",
        base: { mint: "mint-low" },
        fee_active_tvl_ratio: 0.06,
        volume_window: 2000,
        organic_score: 62,
        holders: 700,
        active_pct: 60,
        volatility: 17,
      },
      {
        pool: "pool-high",
        name: "High-SOL",
        base: { mint: "mint-high" },
        fee_active_tvl_ratio: 0.9,
        volume_window: 120000,
        organic_score: 91,
        holders: 3500,
        active_pct: 93,
        volatility: 5,
      },
    ],
  });

  assert.equal(replay.shortlist[0].pool, "pool-high");
  assert.equal(replay.shortlist[1].pool, "pool-low");
});

test("replayManagementEnvelope reproduces deterministic runtime actions", () => {
  const config = {
    management: {
      emergencyPriceDropPct: -50,
      takeProfitFeePct: 5,
      minFeePerTvl24h: 7,
      minClaimAmount: 5,
    },
  };

  const replay = replayManagementEnvelope({
    cycle_id: "management-1",
    position_inputs: [
      {
        position: "pos-1",
        in_range: false,
        minutes_out_of_range: 12,
        pnl: { volatility: 6 },
      },
      {
        position: "pos-2",
        in_range: true,
        age_minutes: 120,
        pnl: { pnl_pct: 1.2, fee_per_tvl_24h: 12, unclaimed_fee_usd: 8 },
        unclaimed_fees_usd: 8,
      },
    ],
  }, config);

  assert.deepEqual(replay.actions, [
    { position: "pos-1", tool: "rebalance_on_exit", rule: "out_of_range_rebalance", reason: "out of range for 12m" },
    { position: "pos-2", tool: "auto_compound_fees", rule: "fee_threshold_reached", reason: "fees $8.00 >= $5" },
  ]);
});
