import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import { getPoolInfo, scoreTopLPers, studyTopLPers } from "./study.js";
import { getLpOverview } from "./lp-overview.js";
import { resetLpAgentLimiterState } from "./lpagent-client.js";

test("scoreTopLPers returns bounded disabled payload when LPAgent is unavailable", async () => {
  const originalKey = process.env.LPAGENT_API_KEY;

  try {
    delete process.env.LPAGENT_API_KEY;
    const result = await scoreTopLPers({ pool_address: "pool-chaos", limit: 3 });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.source_status.lpagent.enabled, false);
    assert.equal(result.source_status.lpagent.status, "missing_api_key");
    assert.match(result.message, /disabled/i);
  } finally {
    if (originalKey == null) {
      delete process.env.LPAGENT_API_KEY;
    } else {
      process.env.LPAGENT_API_KEY = originalKey;
    }
  }
});

test("studyTopLPers returns bounded disabled payload when LPAgent is unavailable", async () => {
  const originalKey = process.env.LPAGENT_API_KEY;

  try {
    delete process.env.LPAGENT_API_KEY;
    const result = await studyTopLPers({ pool_address: "pool-chaos", limit: 2 });

    assert.equal(result.pool, "pool-chaos");
    assert.deepEqual(result.patterns, []);
    assert.deepEqual(result.lpers, []);
    assert.match(result.message, /disabled/i);
  } finally {
    if (originalKey == null) {
      delete process.env.LPAGENT_API_KEY;
    } else {
      process.env.LPAGENT_API_KEY = originalKey;
    }
	}
});

test("getPoolInfo stays read-only and does not create memory side effects", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-study-readonly-test-"));
	const originalKey = process.env.LPAGENT_API_KEY;
	const originalDir = process.env.ZENITH_MEMORY_DIR;
	const originalFetch = global.fetch;

	try {
		process.env.LPAGENT_API_KEY = "test-lpagent-key";
		process.env.ZENITH_MEMORY_DIR = path.join(tempDir, "memory");
		global.fetch = async () => ({
			ok: true,
			json: async () => ({
				data: {
					type: "dlmm",
					tokenInfo: [{ data: [{ symbol: "AAA", audit: {}, organicScore: 80, holderCount: 1000 }, { symbol: "SOL" }] }],
					feeInfo: {},
					feeStats: [],
				},
			}),
		});

		const result = await getPoolInfo({ pool_address: "pool-readonly" });
		assert.equal(result.pool, "pool-readonly");
		assert.equal(fs.existsSync(process.env.ZENITH_MEMORY_DIR), false);
	} finally {
		if (originalKey == null) delete process.env.LPAGENT_API_KEY;
		else process.env.LPAGENT_API_KEY = originalKey;
		if (originalDir == null) delete process.env.ZENITH_MEMORY_DIR;
		else process.env.ZENITH_MEMORY_DIR = originalDir;
		global.fetch = originalFetch;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("shared LP Agent helper retries 429s and is reused by study and overview flows", async () => {
	const originalKey = process.env.LPAGENT_API_KEY;
	const originalPrivateKey = process.env.WALLET_PRIVATE_KEY;
	const originalFetch = global.fetch;
	const originalSetTimeout = global.setTimeout;
	const originalClearTimeout = global.clearTimeout;
	const seenKeys = [];
	let topLperAttempts = 0;

	try {
		process.env.LPAGENT_API_KEY = "key-a,key-b";
		process.env.WALLET_PRIVATE_KEY = bs58.encode(Keypair.generate().secretKey);
		resetLpAgentLimiterState();
		global.setTimeout = ((fn) => {
			fn();
			return 1;
		});
		global.clearTimeout = (() => {});
		global.fetch = async (url, options = {}) => {
			seenKeys.push(options.headers?.["x-api-key"] || null);
			if (String(url).includes("/top-lpers")) {
				topLperAttempts += 1;
				if (topLperAttempts === 1) {
					return { ok: false, status: 429 };
				}
				return {
					ok: true,
					json: async () => ({
						data: [{ owner: "wallet-1", total_lp: 5, win_rate: 0.8, total_inflow: 2000, roi: 0.1, fee_percent: 0.02, avg_age_hour: 2, total_pnl: 100 }],
					}),
				};
			}
			if (String(url).includes("/lp-positions/historical")) {
				return {
					ok: true,
					json: async () => ({ data: [] }),
				};
			}
			if (String(url).includes("/lp-positions/overview")) {
				return {
					ok: true,
					json: async () => ({
						data: [{ total_pnl: { ALL: 10 }, total_pnl_native: { ALL: 0.1 }, total_fee: { ALL: 2 }, total_fee_native: { ALL: 0.02 }, win_rate: { ALL: 0.5 }, closed_lp: { ALL: 3 }, opening_lp: 1, total_lp: 4, total_pool: 2, avg_age_hour: 5, roi: 0.1, updated_at: "2026-01-01T00:00:00.000Z" }],
					}),
				};
			}
			throw new Error(`Unexpected URL: ${url}`);
		};

		const scoreResult = await scoreTopLPers({ pool_address: "pool-shared", limit: 1 });
		const overviewResult = await getLpOverview({ force: true });

		assert.equal(topLperAttempts, 2);
		assert.equal(scoreResult.candidates.length, 1);
		assert.equal(overviewResult.total_positions, 4);
		assert.equal(new Set(seenKeys).size >= 2, true);
	} finally {
		resetLpAgentLimiterState();
		if (originalKey == null) delete process.env.LPAGENT_API_KEY;
		else process.env.LPAGENT_API_KEY = originalKey;
		if (originalPrivateKey == null) delete process.env.WALLET_PRIVATE_KEY;
		else process.env.WALLET_PRIVATE_KEY = originalPrivateKey;
		global.fetch = originalFetch;
		global.setTimeout = originalSetTimeout;
		global.clearTimeout = originalClearTimeout;
	}
});
