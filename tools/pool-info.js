/**
 * Deep pool intelligence via LP Agent Open API (GET /pools/{poolId}/info).
 * Rate limit: 5 req/min per API key — enforced in executor.
 */

import { log } from "../logger.js";
import { rememberFact } from "../nuggets-memory.js";

const LPAGENT_API = "https://api.lpagent.io/open-api/v1";
const LPAGENT_KEY = process.env.LPAGENT_API_KEY;

/**
 * @param {{ pool_address: string }} args
 */
export async function getPoolInfo({ pool_address }) {
  if (!pool_address) return { error: "pool_address required" };
  if (!LPAGENT_KEY) {
    return { error: "LPAGENT_API_KEY not set in .env — get_pool_info is disabled." };
  }

  const url = `${LPAGENT_API}/pools/${encodeURIComponent(pool_address)}/info`;
  try {
    const res = await fetch(url, { headers: { "x-api-key": LPAGENT_KEY } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) {
        return { error: "Rate limit (5/min) — wait before retrying get_pool_info." };
      }
      throw new Error(`LP Agent pool info ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const data = json.data || json;

    const tokenInfo = data.tokenInfo || [];
    const auditSummaries = tokenInfo.map((ti) => {
      const row = ti?.data?.[0] || ti?.data || ti;
      const d = Array.isArray(row) ? row[0] : row;
      if (!d || typeof d !== "object") return null;
      return {
        symbol: d.symbol,
        mint: d.id || d.mint,
        organicScore: d.organicScore,
        holderCount: d.holderCount,
        mcap: d.mcap,
      };
    }).filter(Boolean);

    const poolStats = data.poolStats || data.poolDb || null;
    const feeStats = data.feeStats;
    const feeTrend =
      Array.isArray(feeStats) && feeStats.length >= 2
        ? {
            latest: feeStats[feeStats.length - 1],
            prior: feeStats[feeStats.length - 2],
          }
        : null;

    const summary = [
      `pool=${pool_address.slice(0, 8)}`,
      auditSummaries.map((a) => `${a.symbol}:org=${a.organicScore},holders=${a.holderCount}`).join("; "),
      poolStats ? `tvl_hint=${JSON.stringify(poolStats).slice(0, 120)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    rememberFact({
      key: `pool_audit_${pool_address.slice(0, 12)}`,
      value: summary.slice(0, 500),
      topic: "pool_behavior",
    });

    log("pool-info", `get_pool_info OK ${pool_address.slice(0, 8)}`);

    return {
      pool_address,
      type: data.type,
      token_audit: auditSummaries,
      fee_info: data.feeInfo || null,
      fee_trend: feeTrend,
      pool_stats: poolStats,
      amount_x: data.amountX,
      amount_y: data.amountY,
      liquidity_viz_bins: data.liquidityViz?.bins?.length ?? 0,
      raw_excerpt: JSON.stringify(data).slice(0, 1500),
    };
  } catch (e) {
    log("pool-info", e.message);
    return { error: e.message, pool_address };
  }
}
