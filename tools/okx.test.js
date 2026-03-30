import assert from "node:assert/strict";
import test from "node:test";

import { getAdvancedInfo, getClusterList, getPriceInfo } from "./okx.js";

test("getAdvancedInfo normalizes tags including dsPaid alias", async () => {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		json: async () => ({
			code: "0",
			data: [{
				riskControlLevel: "4",
				bundleHoldingPercent: "35.2",
				sniperHoldingPercent: "8.1",
				suspiciousHoldingPercent: "3.4",
				creatorAddress: "creator-1",
				tokenTags: ["honeypot", "smartMoneyBuy", "devHoldingStatusSellAll", "dsPaid"],
			}],
		}),
	});

	try {
		const result = await getAdvancedInfo("mint-1");
		assert.equal(result.risk_level, 4);
		assert.equal(result.bundle_pct, 35.2);
		assert.equal(result.is_honeypot, true);
		assert.equal(result.smart_money_buy, true);
		assert.equal(result.dev_sold_all, true);
		assert.equal(result.dex_screener_paid, true);
	} finally {
		global.fetch = originalFetch;
	}
});

test("getClusterList handles public clusterList response shape", async () => {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		json: async () => ({
			code: 0,
			data: {
				clusterList: [{
					holdingPercent: "12.5",
					trendType: { trendType: "buy" },
					averageHoldingPeriod: "172800",
					pnlPercent: "25.4",
					buyVolume: "1000",
					sellVolume: "200",
					averageBuyPriceUsd: "0.0021",
					clusterAddressList: [{ isKol: true }, { isKol: false }],
				}],
			},
		}),
	});

	try {
		const result = await getClusterList("mint-1");
		assert.equal(result.length, 1);
		assert.equal(result[0].trend, "buy");
		assert.equal(result[0].avg_hold_days, 2);
		assert.equal(result[0].has_kol, true);
	} finally {
		global.fetch = originalFetch;
	}
});

test("getClusterList handles array response with clusterList key", async () => {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		json: async () => ({
			code: 0,
			data: [{
				clusterList: [{
					holdingPercent: "9.5",
					trendType: "sell",
					averageHoldingPeriod: "86400",
					clusterAddressList: [],
				}],
			}],
		}),
	});

	try {
		const result = await getClusterList("mint-1");
		assert.equal(result.length, 1);
		assert.equal(result[0].trend, "sell");
		assert.equal(result[0].avg_hold_days, 1);
	} finally {
		global.fetch = originalFetch;
	}
});

test("getPriceInfo exposes multi-timeframe price and volume fields", async () => {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		json: async () => ({
			code: "0",
			data: [{
				price: "2",
				maxPrice: "4",
				minPrice: "1",
				priceChange5M: "1.2",
				priceChange1H: "5.4",
				volume5M: "1200",
				volume1H: "34000",
				holders: "5000",
				marketCap: "900000",
				liquidity: "150000",
			}],
		}),
	});

	try {
		const result = await getPriceInfo("mint-1");
		assert.equal(result.price_vs_ath_pct, 50);
		assert.equal(result.price_change_5m, 1.2);
		assert.equal(result.price_change_1h, 5.4);
		assert.equal(result.volume_5m, 1200);
		assert.equal(result.volume_1h, 34000);
		assert.equal(result.holders, 5000);
		assert.equal(result.market_cap, 900000);
		assert.equal(result.liquidity, 150000);
	} finally {
		global.fetch = originalFetch;
	}
});
