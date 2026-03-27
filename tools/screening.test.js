import assert from "node:assert/strict";
import test from "node:test";

import { discoverPools, evaluateCandidateSnapshot, getTopCandidates, rankCandidateSnapshots, resetDiscoveryCache } from "./screening.js";

function buildPool(overrides = {}) {
  return {
    pool: overrides.pool || "pool-a",
    name: overrides.name || "Alpha-SOL",
    base: { mint: overrides.baseMint || "mint-a", symbol: "ALPHA" },
    fee_active_tvl_ratio: overrides.fee_active_tvl_ratio ?? 0.4,
    volume_window: overrides.volume_window ?? 50000,
    organic_score: overrides.organic_score ?? 85,
    holders: overrides.holders ?? 2500,
    active_pct: overrides.active_pct ?? 88,
    volatility: overrides.volatility ?? 4,
  };
}

test("evaluateCandidateSnapshot adds deterministic score and hard blocks", () => {
  const occupiedPools = new Set(["pool-blocked"]);
  const occupiedMints = new Set(["mint-held"]);

  const blocked = evaluateCandidateSnapshot(buildPool({ pool: "pool-blocked", baseMint: "mint-held" }), {
    occupiedPools,
    occupiedMints,
  });

  assert.equal(blocked.eligible, false);
  assert.deepEqual(blocked.hard_blocks, ["pool_already_open", "base_token_already_held"]);
  assert.equal(typeof blocked.deterministic_score, "number");
  assert.equal(typeof blocked.score_breakdown.total_score, "number");
});

test("rankCandidateSnapshots sorts eligible pools by deterministic score", () => {
  const low = buildPool({ pool: "pool-low", baseMint: "mint-low", fee_active_tvl_ratio: 0.06, volume_window: 2000, organic_score: 62, holders: 700, active_pct: 60, volatility: 17 });
  const high = buildPool({ pool: "pool-high", baseMint: "mint-high", fee_active_tvl_ratio: 0.9, volume_window: 120000, organic_score: 91, holders: 3500, active_pct: 93, volatility: 5 });
  const blocked = buildPool({ pool: "pool-blocked", baseMint: "mint-blocked" });

  const ranked = rankCandidateSnapshots([low, high, blocked], {
    occupiedPools: new Set(["pool-blocked"]),
    occupiedMints: new Set(),
    limit: 3,
  });

  assert.equal(ranked.total_eligible, 2);
  assert.equal(ranked.candidates.length, 2);
  assert.equal(ranked.candidates[0].pool, "pool-high");
  assert.ok(ranked.candidates[0].deterministic_score > ranked.candidates[1].deterministic_score);
  assert.equal(ranked.blocked_summary.pool_already_open, 1);
});

test("discoverPools reuses short-lived cache for identical requests", async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        total: 1,
        data: [{
          pool_address: "pool-a",
          name: "Alpha-SOL",
          token_x: { address: "mint-a", symbol: "ALPHA", organic_score: 80, warnings: [] },
          token_y: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
          pool_type: "dlmm",
          dlmm_params: { bin_step: 80 },
          fee_pct: 1,
          active_tvl: 15000,
          fee: 200,
          volume: 50000,
          fee_active_tvl_ratio: 1.33,
          volatility: 3,
          base_token_holders: 1200,
          active_positions: 15,
          active_positions_pct: 60,
          open_positions: 10,
          pool_price: 1,
          pool_price_change_pct: 2,
          price_trend: [],
          min_price: 0.8,
          max_price: 1.2,
          volume_change_pct: 5,
          fee_change_pct: 2,
          swap_count: 10,
          unique_traders: 7,
        }],
      }),
    };
  };

  try {
    resetDiscoveryCache();
    const first = await discoverPools({ page_size: 5, timeframe: "5m", category: "trending", force: true });
    const second = await discoverPools({ page_size: 5, timeframe: "5m", category: "trending" });
    assert.equal(calls, 1);
    assert.equal(first.pools.length, 1);
    assert.equal(second.pools.length, 1);
  } finally {
    resetDiscoveryCache();
    global.fetch = originalFetch;
  }
});

test("getTopCandidates throws deterministic error for error-shaped positions payload", async () => {
  await assert.rejects(
    getTopCandidates({
      limit: 2,
      discoverPoolsFn: async () => ({ pools: [buildPool()] }),
      getMyPositionsFn: async () => ({ error: "RPC timeout" }),
    }),
    /positions unavailable: RPC timeout/
  );
});

test("getTopCandidates rejects malformed positions payload before dereference", async () => {
  await assert.rejects(
    getTopCandidates({
      limit: 2,
      discoverPoolsFn: async () => ({ pools: [buildPool()] }),
      getMyPositionsFn: async () => ({ total_positions: 0 }),
    }),
    /positions payload missing positions array/
  );
});
