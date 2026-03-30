import { fetchWithTimeout } from "./fetch-utils.js";

const BASE = "https://web3.okx.com";
const CHAIN_SOLANA = "501";
const OKX_FETCH_TIMEOUT_MS = 10 * 1000;
const PUBLIC_HEADERS = { "Ok-Access-Client-type": "agent-cli" };

const pct = (value) => value != null && value !== "" ? Number.parseFloat(value) : null;
const int = (value) => value != null && value !== "" ? Number.parseInt(value, 10) : null;

async function okxGet(path) {
	const res = await fetchWithTimeout(`${BASE}${path}`, {
		headers: PUBLIC_HEADERS,
		timeoutMs: OKX_FETCH_TIMEOUT_MS,
		timeoutMessage: `OKX request timed out after ${OKX_FETCH_TIMEOUT_MS}ms`,
	});
	if (!res.ok) throw new Error(`OKX API ${res.status}: ${path}`);
	const json = await res.json();
	if (json.code !== "0" && json.code !== 0) throw new Error(`OKX error ${json.code}: ${json.msg}`);
	return json.data;
}

async function okxPost(path, body) {
	const res = await fetchWithTimeout(`${BASE}${path}`, {
		method: "POST",
		headers: { ...PUBLIC_HEADERS, "Content-Type": "application/json" },
		body: JSON.stringify(body),
		timeoutMs: OKX_FETCH_TIMEOUT_MS,
		timeoutMessage: `OKX request timed out after ${OKX_FETCH_TIMEOUT_MS}ms`,
	});
	if (!res.ok) throw new Error(`OKX API ${res.status}: ${path}`);
	const json = await res.json();
	if (json.code !== "0" && json.code !== 0) throw new Error(`OKX error ${json.code}: ${json.msg}`);
	return json.data;
}

export async function getAdvancedInfo(tokenAddress, chainIndex = CHAIN_SOLANA) {
	const path = `/api/v6/dex/market/token/advanced-info?chainIndex=${chainIndex}&tokenContractAddress=${tokenAddress}`;
	const data = await okxGet(path);
	const row = Array.isArray(data) ? data[0] : data;
	if (!row) return null;

	const tags = Array.isArray(row.tokenTags) ? row.tokenTags : [];
	return {
		risk_level: int(row.riskControlLevel),
		bundle_pct: pct(row.bundleHoldingPercent),
		sniper_pct: pct(row.sniperHoldingPercent),
		suspicious_pct: pct(row.suspiciousHoldingPercent),
		dev_holding_pct: pct(row.devHoldingPercent),
		top10_pct: pct(row.top10HoldPercent),
		creator: row.creatorAddress || null,
		tags,
		is_honeypot: tags.includes("honeypot"),
		smart_money_buy: tags.includes("smartMoneyBuy"),
		dev_sold_all: tags.includes("devHoldingStatusSellAll"),
		dev_buying_more: tags.includes("devHoldingStatusBuy"),
		low_liquidity: tags.includes("lowLiquidity"),
		dex_boost: tags.includes("dexBoost"),
		dex_screener_paid: tags.includes("dexScreenerPaid") || tags.includes("dsPaid"),
	};
}

export async function getClusterList(tokenAddress, chainIndex = CHAIN_SOLANA, limit = 5) {
	const path = `/api/v6/dex/market/token/cluster/list?chainIndex=${chainIndex}&tokenContractAddress=${tokenAddress}`;
	const data = await okxGet(path);
	const rows = data?.clusterList ?? (Array.isArray(data) ? data[0]?.clusterList ?? data[0]?.clustList ?? [] : []);
	if (!Array.isArray(rows) || rows.length === 0) return [];

	return rows.slice(0, limit).map((row) => ({
		holding_pct: pct(row.holdingPercent),
		trend: row.trendType?.trendType || row.trendType || null,
		avg_hold_days: row.averageHoldingPeriod ? Math.round(Number.parseFloat(row.averageHoldingPeriod) / 86400) : null,
		pnl_pct: pct(row.pnlPercent),
		buy_vol_usd: pct(row.buyVolume),
		sell_vol_usd: pct(row.sellVolume),
		avg_buy_price: pct(row.averageBuyPriceUsd),
		has_kol: Array.isArray(row.clusterAddressList) && row.clusterAddressList.some((entry) => entry.isKol),
		address_count: Array.isArray(row.clusterAddressList) ? row.clusterAddressList.length : 0,
	}));
}

export async function getPriceInfo(tokenAddress, chainIndex = CHAIN_SOLANA) {
	const data = await okxPost("/api/v6/dex/market/price-info", [
		{ chainIndex, tokenContractAddress: tokenAddress },
	]);
	const row = Array.isArray(data) ? data[0] : data;
	if (!row) return null;
	const price = Number.parseFloat(row.price || 0);
	const ath = Number.parseFloat(row.maxPrice || 0);
	return {
		price,
		ath,
		atl: pct(row.minPrice),
		price_vs_ath_pct: ath > 0 ? Number.parseFloat(((price / ath) * 100).toFixed(1)) : null,
		price_change_5m: pct(row.priceChange5M),
		price_change_1h: pct(row.priceChange1H),
		volume_5m: pct(row.volume5M),
		volume_1h: pct(row.volume1H),
		holders: int(row.holders),
		market_cap: pct(row.marketCap),
		liquidity: pct(row.liquidity),
	};
}

export async function getFullTokenAnalysis(tokenAddress, chainIndex = CHAIN_SOLANA) {
	const [advanced, clusters, price] = await Promise.allSettled([
		getAdvancedInfo(tokenAddress, chainIndex),
		getClusterList(tokenAddress, chainIndex),
		getPriceInfo(tokenAddress, chainIndex),
	]);

	return {
		advanced: advanced.status === "fulfilled" ? advanced.value : null,
		clusters: clusters.status === "fulfilled" ? clusters.value : [],
		price: price.status === "fulfilled" ? price.value : null,
		availability: {
			advanced: advanced.status === "fulfilled" && advanced.value ? "ok" : "unavailable",
			clusters: clusters.status === "fulfilled" ? "ok" : "unavailable",
			price: price.status === "fulfilled" && price.value ? "ok" : "unavailable",
		},
	};
}
