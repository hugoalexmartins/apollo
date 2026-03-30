import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fetchWithTimeout } from "./fetch-utils.js";
import { getTokenHolders } from "./token.js";
import { discoverPools, evaluateCandidateSnapshot, getTopCandidates, rankCandidateSnapshots, resetDiscoveryCache } from "./screening.js";
import { config } from "../config.js";
import { evaluateCandidateIntel } from "../screening-intel.js";

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
    token_age_hours: overrides.token_age_hours ?? 72,
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
          token_x: { address: "mint-a", symbol: "ALPHA", organic_score: 80, warnings: [], created_at: Date.now() - (6 * 60 * 60 * 1000) },
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
    assert.equal(typeof first.pools[0].token_age_hours, "number");
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

test("getTopCandidates reuses a provided positions snapshot without re-reading positions", async () => {
	let getMyPositionsCalls = 0;
	const positionsSnapshot = {
		total_positions: 1,
		positions: [{ pool: "pool-blocked", base_mint: "mint-blocked" }],
	};

	const result = await getTopCandidates({
		limit: 2,
		discoverPoolsFn: async () => ({ pools: [buildPool({ pool: "pool-blocked", baseMint: "mint-blocked" }), buildPool({ pool: "pool-ok", baseMint: "mint-ok" })] }),
		getMyPositionsFn: async () => {
			getMyPositionsCalls += 1;
			return { total_positions: 0, positions: [] };
		},
		positionsSnapshot,
	});

	assert.equal(getMyPositionsCalls, 0);
	assert.deepEqual(result.occupied_pools, ["pool-blocked"]);
	assert.equal(result.candidates.length, 1);
	assert.equal(result.candidates[0].pool, "pool-ok");
});

test("fetchWithTimeout aborts hung screening fetches", async () => {
	const originalFetch = global.fetch;
	const originalSetTimeout = global.setTimeout;
	const originalClearTimeout = global.clearTimeout;

	global.setTimeout = ((fn) => {
		fn();
		return 1;
	});
	global.clearTimeout = (() => {});
	global.fetch = async (_url, options = {}) => {
		if (options.signal?.aborted) {
			const error = new Error("This operation was aborted");
			error.name = "AbortError";
			throw error;
		}
		return new Promise(() => {});
	};

	try {
		await assert.rejects(
			fetchWithTimeout("https://example.com", { timeoutMs: 5, timeoutMessage: "screening fetch timed out" }),
			/screening fetch timed out/
		);
	} finally {
		global.fetch = originalFetch;
		global.setTimeout = originalSetTimeout;
		global.clearTimeout = originalClearTimeout;
	}
});

test("discoverPools filters pools whose creator is denylisted", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-creator-blacklist-test-"));
	const blacklistPath = path.join(tempDir, "creator-blacklist.json");
	const originalEnv = process.env.ZENITH_CREATOR_BLACKLIST_FILE;
	const originalFetch = global.fetch;

	fs.writeFileSync(blacklistPath, JSON.stringify({
		creatorblocked1111111111111111111111111111111: {
			reason: "known blocked deployer",
			added_by: "operator",
		},
	}, null, 2));
	process.env.ZENITH_CREATOR_BLACKLIST_FILE = blacklistPath;

	global.fetch = async () => ({
		ok: true,
		json: async () => ({
			total: 2,
			data: [
				{
					pool_address: "pool-blocked",
					name: "Blocked-SOL",
					token_x: { address: "mint-blocked", symbol: "BLK", organic_score: 80, warnings: [], created_at: Date.now() - (6 * 60 * 60 * 1000), dev: "creatorblocked1111111111111111111111111111111" },
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
				},
				{
					pool_address: "pool-ok",
					name: "Allowed-SOL",
					token_x: { address: "mint-ok", symbol: "OK", organic_score: 80, warnings: [], created_at: Date.now() - (6 * 60 * 60 * 1000), dev: "creator-ok" },
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
				},
			],
		}),
	});

	try {
		resetDiscoveryCache();
		const result = await discoverPools({ page_size: 5, timeframe: "5m", category: "trending", force: true });
		assert.equal(result.pools.length, 1);
		assert.equal(result.pools[0].pool, "pool-ok");
	} finally {
		resetDiscoveryCache();
		global.fetch = originalFetch;
		if (originalEnv) process.env.ZENITH_CREATOR_BLACKLIST_FILE = originalEnv;
		else delete process.env.ZENITH_CREATOR_BLACKLIST_FILE;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("getTokenHolders keeps holder intel when optional supply lookup times out", async () => {
	const originalFetch = global.fetch;

	global.fetch = async (url) => {
		if (String(url).includes("/holders/")) {
			return {
				ok: true,
				json: async () => ([{ address: "holder-1", amount: 50, percentage: 12.5, tags: [] }]),
			};
		}
		if (String(url).includes("/assets/search")) {
			const error = new Error("This operation was aborted");
			error.name = "AbortError";
			throw error;
		}
		throw new Error(`Unexpected URL: ${url}`);
	};

	try {
		const result = await getTokenHolders({ mint: "mint-1", limit: 5 });
		assert.equal(result.showing, 1);
		assert.equal(result.holders.length, 1);
		assert.equal(result.holders[0].pct, 12.5);
		assert.equal(result.top_10_real_holders_pct, "12.50");
	} finally {
		global.fetch = originalFetch;
	}
});

test("getTokenHolders surfaces blacklisted holder and funding addresses", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-address-blacklist-test-"));
	const blacklistPath = path.join(tempDir, "address-blacklist.json");
	const originalEnv = process.env.ZENITH_ADDRESS_BLACKLIST_FILE;
	const originalFetch = global.fetch;

	fs.writeFileSync(blacklistPath, JSON.stringify({
		bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa: { reason: "known scammer / rug-puller address" },
		D9gQ6RhKEpnobPBUdWY5bPQt2p3zGk3iVz6ChpUi2ArA: { reason: "known scammer / rug-puller address" },
	}, null, 2));
	process.env.ZENITH_ADDRESS_BLACKLIST_FILE = blacklistPath;

	global.fetch = async (url) => {
		if (String(url).includes("/holders/") && String(url).includes("addresses=")) {
			return { ok: true, json: async () => [] };
		}
		if (String(url).includes("/holders/")) {
			return {
				ok: true,
				json: async () => ([
					{
						address: "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa",
						amount: 50,
						percentage: 12.5,
						tags: [],
					},
					{
						address: "safe-holder-address-1",
						amount: 25,
						percentage: 6.25,
						tags: [],
						addressInfo: {
							fundingAddress: "D9gQ6RhKEpnobPBUdWY5bPQt2p3zGk3iVz6ChpUi2ArA",
							fundingAmount: 1,
							fundingSlot: 100,
						},
					},
				]),
			};
		}
		if (String(url).includes("/assets/search")) {
			return {
				ok: true,
				json: async () => ([{ totalSupply: 400 }]),
			};
		}
		throw new Error(`Unexpected URL: ${url}`);
	};

	try {
		const tokenModule = await import(`./token.js?test=${Date.now()}`);
		const result = await tokenModule.getTokenHolders({ mint: "mint-1", limit: 5 });
		assert.equal(result.blacklisted_addresses.length, 2);
		assert.deepEqual(
			result.blacklisted_addresses.map((entry) => entry.match_type).sort(),
			["funding", "holder"],
		);
	} finally {
		global.fetch = originalFetch;
		if (originalEnv) process.env.ZENITH_ADDRESS_BLACKLIST_FILE = originalEnv;
		else delete process.env.ZENITH_ADDRESS_BLACKLIST_FILE;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("evaluateCandidateIntel hard-blocks blacklisted scam addresses", () => {
	const intel = evaluateCandidateIntel(buildPool(), {
		smartWallets: { in_pool: [] },
		holders: {
			top_10_real_holders_pct: "15.00",
			bundlers_pct_in_top_100: "1.00",
			global_fees_sol: 90,
			blacklisted_addresses: [
				{ address: "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa", match_type: "holder" },
			],
		},
		narrative: { narrative: "Real narrative that would otherwise pass screening." },
		scoredLpers: { candidates: [] },
	});

	assert.equal(intel.hard_blocked, true);
	assert.match(intel.hard_blocks[0], /blacklisted_scam_addresses/i);
	assert.equal(intel.holder_metrics.blacklisted_address_hits, 1);
});

test("evaluateCandidateIntel hard-blocks when critical holder or OKX intel is unavailable", () => {
	const intel = evaluateCandidateIntel(buildPool(), {
		smartWallets: { in_pool: [] },
		holders: null,
		narrative: { narrative: "Real narrative that would otherwise pass screening." },
		scoredLpers: { candidates: [] },
		okx: null,
		availability: {
			holders: "unavailable",
			okx_advanced: "unavailable",
		},
	});

	assert.equal(intel.hard_blocked, true);
	assert.ok(intel.hard_blocks.includes("holder_intel_unavailable"));
	assert.ok(intel.hard_blocks.includes("okx_advanced_unavailable"));
});

test("evaluateCandidateIntel hard-blocks honeypot and excessive OKX bundle concentration", () => {
	const intel = evaluateCandidateIntel(buildPool(), {
		smartWallets: { in_pool: [{ name: "wallet-1" }] },
		holders: {
			top_10_real_holders_pct: "15.00",
			bundlers_pct_in_top_100: "1.00",
			global_fees_sol: 90,
			blacklisted_addresses: [],
		},
		narrative: { narrative: "Real narrative that would otherwise pass screening." },
		scoredLpers: { candidates: [{ score_breakdown: { total_score: 40 } }] },
		okx: {
			advanced: {
				is_honeypot: true,
				bundle_pct: config.screening.maxBundlePct + 5,
				risk_level: 4,
				sniper_pct: 9.5,
				suspicious_pct: 4.1,
				smart_money_buy: true,
				dev_sold_all: true,
				dex_boost: false,
				dex_screener_paid: true,
			},
			clusters: [{ trend: "buy", has_kol: true }],
			price: { price_vs_ath_pct: 62.5, price_change_5m: 1.1, price_change_1h: 6.2, volume_5m: 1000, volume_1h: 12000, market_cap: 500000, liquidity: 100000, holders: 3000 },
		},
	});

	assert.equal(intel.hard_blocked, true);
	assert.ok(intel.hard_blocks.includes("okx_honeypot_tag"));
	assert.ok(intel.hard_blocks.some((entry) => entry.startsWith("okx_bundle_pct")));
	assert.equal(intel.okx.smart_money_buy, true);
	assert.equal(intel.okx.cluster_has_kol, true);
	assert.ok(intel.score.context_score > intel.score.ranking_score);
});

test("evaluateCandidateIntel hard-blocks denylisted creator from OKX enrichment", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-okx-creator-test-"));
	const blacklistPath = path.join(tempDir, "creator-blacklist.json");
	const originalEnv = process.env.ZENITH_CREATOR_BLACKLIST_FILE;

	fs.writeFileSync(blacklistPath, JSON.stringify({
		creatorblocked1111111111111111111111111111111: {
			reason: "known blocked deployer",
		},
	}, null, 2));
	process.env.ZENITH_CREATOR_BLACKLIST_FILE = blacklistPath;

	try {
		const intel = evaluateCandidateIntel({
			...buildPool(),
			dev: null,
		}, {
			smartWallets: { in_pool: [] },
			holders: {
				top_10_real_holders_pct: "15.00",
				bundlers_pct_in_top_100: "1.00",
				global_fees_sol: 90,
				blacklisted_addresses: [],
			},
			narrative: { narrative: "Real narrative that would otherwise pass screening." },
			scoredLpers: { candidates: [] },
			okx: {
				advanced: {
					creator: "creatorblocked1111111111111111111111111111111",
					bundle_pct: 5,
					is_honeypot: false,
					smart_money_buy: false,
					dev_sold_all: false,
					dex_boost: false,
					dex_screener_paid: false,
				},
				clusters: [],
				price: null,
			},
		});

		assert.equal(intel.hard_blocked, true);
		assert.ok(intel.hard_blocks.some((entry) => entry.startsWith("blocked_creator")));
		assert.equal(intel.okx.creator_blocked, true);
		assert.equal(intel.okx.creator, "creatorblocked1111111111111111111111111111111");
	} finally {
		if (originalEnv) process.env.ZENITH_CREATOR_BLACKLIST_FILE = originalEnv;
		else delete process.env.ZENITH_CREATOR_BLACKLIST_FILE;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("evaluateCandidateSnapshot blocks token_too_new and token_too_old deterministically", () => {
  const originalMin = config.screening.minTokenAgeHours;
  const originalMax = config.screening.maxTokenAgeHours;
  config.screening.minTokenAgeHours = 24;
  config.screening.maxTokenAgeHours = 240;

  try {
    const tooNew = evaluateCandidateSnapshot(buildPool({ pool: "pool-new", baseMint: "mint-new", token_age_hours: 4 }));
    const tooOld = evaluateCandidateSnapshot(buildPool({ pool: "pool-old", baseMint: "mint-old", token_age_hours: 500 }));
    const eligible = evaluateCandidateSnapshot(buildPool({ pool: "pool-ok", baseMint: "mint-ok", token_age_hours: 48 }));

    assert.equal(tooNew.eligible, false);
    assert.ok(tooNew.hard_blocks.includes("token_too_new"));
    assert.equal(tooOld.eligible, false);
    assert.ok(tooOld.hard_blocks.includes("token_too_old"));
    assert.equal(eligible.eligible, true);
  } finally {
    config.screening.minTokenAgeHours = originalMin;
    config.screening.maxTokenAgeHours = originalMax;
  }
});

test("rankCandidateSnapshots includes token-age blocked summary reasons", () => {
  const originalMin = config.screening.minTokenAgeHours;
  const originalMax = config.screening.maxTokenAgeHours;
  config.screening.minTokenAgeHours = 24;
  config.screening.maxTokenAgeHours = 96;

  try {
    const ranked = rankCandidateSnapshots([
      buildPool({ pool: "pool-new", baseMint: "mint-new", token_age_hours: 2 }),
      buildPool({ pool: "pool-old", baseMint: "mint-old", token_age_hours: 240 }),
      buildPool({ pool: "pool-ok", baseMint: "mint-ok", token_age_hours: 48 }),
    ]);

    assert.equal(ranked.total_eligible, 1);
    assert.equal(ranked.candidates.length, 1);
    assert.equal(ranked.candidates[0].pool, "pool-ok");
    assert.equal(ranked.blocked_summary.token_too_new, 1);
    assert.equal(ranked.blocked_summary.token_too_old, 1);
  } finally {
    config.screening.minTokenAgeHours = originalMin;
    config.screening.maxTokenAgeHours = originalMax;
  }
});

test("evaluateCandidateSnapshot respects per-call screeningConfig overrides", () => {
  const pool = buildPool({
    pool: "pool-override",
    baseMint: "mint-override",
    organic_score: 62,
    holders: 750,
    volume_window: 900,
  });

  const strict = evaluateCandidateSnapshot(pool, {
    screeningConfig: {
      ...config.screening,
      minOrganic: 80,
      minVolume: 5000,
      minHolders: 1500,
    },
  });

  const relaxed = evaluateCandidateSnapshot(pool, {
    screeningConfig: {
      ...config.screening,
      minOrganic: 55,
      minVolume: 500,
      minHolders: 400,
    },
  });

  assert.ok(relaxed.deterministic_score > strict.deterministic_score);
});

test("rankCandidateSnapshots applies external hard block policy deterministically", () => {
  const ranked = rankCandidateSnapshots([
    buildPool({ pool: "pool-cooldown", baseMint: "mint-cooldown" }),
    buildPool({ pool: "pool-open", baseMint: "mint-open", organic_score: 90 }),
  ], {
    evaluationContext: {
      extraHardBlockFn: (pool) => {
        if (pool.pool !== "pool-cooldown") return null;
        return {
          blocked: true,
          reason: "negative_regime_cooldown",
          penalty_score: 50,
        };
      },
    },
  });

  assert.equal(ranked.total_eligible, 1);
  assert.equal(ranked.blocked_summary.negative_regime_cooldown, 1);
  assert.equal(ranked.candidates[0].pool, "pool-open");
});
