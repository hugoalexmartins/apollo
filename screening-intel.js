import { config } from "./config.js";
import { isBlacklistedCreator } from "./creator-blacklist.js";
import { recallForPool } from "./pool-memory.js";
import { getWalletScoreMemory, recallForScreening } from "./memory.js";
import { checkSmartWalletsOnPool } from "./smart-wallets.js";
import { getFullTokenAnalysis } from "./tools/okx.js";
import { getTokenHolders, getTokenInfo, getTokenNarrative } from "./tools/token.js";

export function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function roundMetric(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function deriveTrendBias(pool = {}, tokenInfo = null) {
  const priceChange = asNumber(
    tokenInfo?.stats_1h?.price_change ?? pool.price_change_pct ?? pool.price_change_1h,
    0
  );

  if (priceChange >= 5) return "bullish";
  if (priceChange <= -5) return "bearish";
  return "neutral";
}

export function summarizeRuntimeActionResult(result) {
  if (!result) return "no result returned";
  if (result.blocked) return `blocked - ${result.reason || "safety check failed"}`;
  if (result.error) return `error - ${result.error}`;
  if (result.skipped) return `skipped - ${result.reason || "not needed"}`;
  if (result.rebalanced) return `rebalanced into ${result.new_position}`;
  if (result.claimed && result.compounded === false) return result.message || "fees claimed; reinvest left as plan-only";
  if (result.executed === false && result.message) return result.message;
  if (result.success) return result.message || "completed successfully";
  return "completed";
}

export function formatRangeStatus(position) {
  if (position.in_range) return "in-range ✓";
  if (position.out_of_range_direction) {
    return `OUT OF RANGE ${position.out_of_range_direction.toUpperCase()} ⚠`;
  }
  return "OUT OF RANGE ⚠";
}

export function didRuntimeHandleManagementAction(result) {
  return Boolean(
    result
    && !result.blocked
    && !result.error
    && !result.skipped
    && result.success !== false
  );
}

function formatLpWalletScore(scoreResult) {
  if (!scoreResult) return "fetch failed";
  if (scoreResult.message && (!scoreResult.candidates || scoreResult.candidates.length === 0)) return scoreResult.message;

  const ranked = (scoreResult.candidates || []).slice(0, 2);
  if (ranked.length === 0) return "no credible LP wallets scored";

  return ranked.map((wallet, index) => {
    const rank = index + 1;
    const name = wallet.short_owner || wallet.owner || `wallet_${rank}`;
    const totalScore = asNumber(wallet.score_breakdown?.total_score, 0).toFixed(1);
    const winRate = asNumber(wallet.metrics?.win_rate_pct, 0).toFixed(1);
    const feeYield = asNumber(wallet.metrics?.fee_yield_pct_of_capital, 0).toFixed(1);
    const sample = asNumber(wallet.metrics?.sampled_history_count ?? wallet.metrics?.total_lp, 0);
    return `#${rank} ${name} score=${totalScore}, win=${winRate}%, fee_yield=${feeYield}%, sample=${sample}`;
  }).join(" | ");
}

function formatPlannerContext(distributionPlan, tierPlan) {
  if (!distributionPlan?.strategy) return "planner unavailable";

  const dist = distributionPlan.distribution_plan || {};
  const tiers = tierPlan?.range_plan || {};
  const alloc = [dist.lower_allocation, dist.center_allocation, dist.upper_allocation]
    .map((value) => asNumber(value, 0).toFixed(2))
    .join("/");

  return [
    `strategy=${distributionPlan.strategy}`,
    `volume_profile=${distributionPlan.expected_volume_profile}`,
    `trend=${distributionPlan.next_step_inputs?.trend_bias || "neutral"}`,
    `token_bias=${dist.token_bias || "balanced"}`,
    `alloc=${alloc}`,
    `bins=${asNumber(tiers.bins_below, 0)}/${asNumber(tiers.bins_above, 0)}`,
  ].join(" | ");
}

function hasUsableNarrative(narrativeResult) {
  const text = narrativeResult?.narrative;
  return typeof text === "string" && text.trim().length >= 20;
}

function formatBlacklistedAddressBlock(hits = []) {
	const summary = hits
		.slice(0, 2)
		.map((hit) => `${hit.match_type || "address"}:${String(hit.address || "").slice(0, 8)}`)
		.join(", ");
	const overflow = hits.length > 2 ? `, +${hits.length - 2} more` : "";
	return `blacklisted_scam_addresses ${hits.length}${summary ? ` (${summary}${overflow})` : ""}`;
}

export function evaluateCandidateIntel(pool, {
  smartWallets,
  holders,
  narrative,
  scoredLpers,
  okx,
  availability = {},
}) {
  const smartWalletCount = smartWallets?.in_pool?.length ?? 0;
  const holdersUnavailable = availability.holders === "unavailable";
  const okxAdvancedUnavailable = availability.okx_advanced === "unavailable";
  const top10Pct = asNumber(holders?.top_10_real_holders_pct, 0);
  const bundlersPct = asNumber(holders?.bundlers_pct_in_top_100, 0);
  const globalFeesSol = asNumber(holders?.global_fees_sol, 0);
  const blacklistedAddressHits = Array.isArray(holders?.blacklisted_addresses)
		? holders.blacklisted_addresses
		: [];
  const blockedCreator = isBlacklistedCreator(pool?.dev)
		? pool.dev
		: isBlacklistedCreator(okx?.advanced?.creator)
			? okx.advanced.creator
			: null;
  const bundlePct = asNumber(okx?.advanced?.bundle_pct, 0);
  const riskLevel = okx?.advanced?.risk_level ?? null;
  const clusterKol = Array.isArray(okx?.clusters) && okx.clusters.some((cluster) => cluster.has_kol);
  const lpWalletTopScore = asNumber(scoredLpers?.candidates?.[0]?.score_breakdown?.total_score, 0);
  const hardBlocks = [];

  if (holders && globalFeesSol < config.screening.minTokenFeesSol) {
    hardBlocks.push(`global_fees_sol ${globalFeesSol.toFixed(2)} < ${config.screening.minTokenFeesSol}`);
  }
  if (holders && top10Pct > config.screening.maxTop10Pct) {
    hardBlocks.push(`top_10_pct ${top10Pct.toFixed(1)} > ${config.screening.maxTop10Pct}`);
  }
  if (holders && bundlersPct > config.screening.maxBundlersPct) {
    hardBlocks.push(`bundlers_pct ${bundlersPct.toFixed(1)} > ${config.screening.maxBundlersPct}`);
  }
  if (holdersUnavailable) {
		hardBlocks.push("holder_intel_unavailable");
	}
  if (blacklistedAddressHits.length > 0) {
		hardBlocks.push(formatBlacklistedAddressBlock(blacklistedAddressHits));
	}
  if (blockedCreator) {
		hardBlocks.push(`blocked_creator ${String(blockedCreator).slice(0, 8)}`);
	}
  if (okxAdvancedUnavailable) {
		hardBlocks.push("okx_advanced_unavailable");
	}
  if (okx?.advanced?.is_honeypot) {
		hardBlocks.push("okx_honeypot_tag");
	}
  if (okx?.advanced?.bundle_pct != null && bundlePct > config.screening.maxBundlePct) {
		hardBlocks.push(`okx_bundle_pct ${bundlePct.toFixed(1)} > ${config.screening.maxBundlePct}`);
	}
  if (smartWalletCount === 0 && !hasUsableNarrative(narrative)) {
    hardBlocks.push("missing_specific_narrative_without_smart_wallets");
  }

  const bonusBreakdown = {
    smart_wallet_bonus: roundMetric(Math.min(12, smartWalletCount * 4)),
    lp_wallet_bonus: roundMetric(Math.min(10, lpWalletTopScore / 10)),
    narrative_bonus: hasUsableNarrative(narrative) ? 4 : 0,
    okx_smart_money_bonus: okx?.advanced?.smart_money_buy ? 3 : 0,
    okx_dev_exit_bonus: okx?.advanced?.dev_sold_all ? 2 : 0,
    okx_cluster_kol_bonus: clusterKol ? 2 : 0,
  };
  const walletScoreMessage = scoredLpers?.message || null;
  const walletScoreAgeMatch = walletScoreMessage?.match(/from\s+(\d+)\s+minute/);

  return {
    hard_blocked: hardBlocks.length > 0,
    hard_blocks: hardBlocks,
    smart_wallet_count: smartWalletCount,
    holder_metrics: holders
      ? {
          top_10_pct: roundMetric(top10Pct),
          bundlers_pct: roundMetric(bundlersPct),
          global_fees_sol: roundMetric(globalFeesSol),
				blacklisted_address_hits: blacklistedAddressHits.length,
        }
      : null,
    score: {
      ranking_score: roundMetric(pool.deterministic_score || 0),
      context_score: roundMetric((pool.deterministic_score || 0) + Object.values(bonusBreakdown).reduce((sum, value) => sum + value, 0)),
      bonus_breakdown: bonusBreakdown,
    },
    okx: okx
      ? {
          risk_level: riskLevel,
          creator: okx.advanced?.creator ?? pool?.dev ?? null,
          creator_blocked: Boolean(blockedCreator),
          bundle_pct: okx.advanced?.bundle_pct ?? null,
          sniper_pct: okx.advanced?.sniper_pct ?? null,
          suspicious_pct: okx.advanced?.suspicious_pct ?? null,
          smart_money_buy: Boolean(okx.advanced?.smart_money_buy),
          dev_sold_all: Boolean(okx.advanced?.dev_sold_all),
          dex_boost: Boolean(okx.advanced?.dex_boost),
          dex_screener_paid: Boolean(okx.advanced?.dex_screener_paid),
          price_vs_ath_pct: okx.price?.price_vs_ath_pct ?? null,
          price_change_5m: okx.price?.price_change_5m ?? null,
          price_change_1h: okx.price?.price_change_1h ?? null,
          volume_5m: okx.price?.volume_5m ?? null,
          volume_1h: okx.price?.volume_1h ?? null,
          market_cap: okx.price?.market_cap ?? null,
          liquidity: okx.price?.liquidity ?? null,
          holders: okx.price?.holders ?? null,
          top_cluster_trend: okx.clusters?.[0]?.trend ?? null,
          cluster_has_kol: clusterKol,
        }
      : null,
    wallet_score_source: walletScoreMessage?.includes("reused wallet-score memory") ? "memory_cache" : "live_or_not_preloaded",
    wallet_score_age_minutes: walletScoreAgeMatch ? Number(walletScoreAgeMatch[1]) : null,
  };
}

function truncatePromptText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatCandidateSummaryLine(pool, rank) {
  return `${rank}. ${pool.name} | score=${roundMetric(pool.deterministic_score)} | fee_tvl=${pool.fee_active_tvl_ratio} | vol=$${pool.volume_window} | organic=${pool.organic_score}`;
}

export function formatCandidateInspection(candidate) {
  const { pool, smartWallets, holders, narrative, poolMemory, activeBin, scoredLpers } = candidate;
  const smartWalletCount = smartWallets?.in_pool?.length ?? 0;
  const activeBinLine = activeBin?.binId != null ? activeBin.binId : "unknown";
  const narrativeLine = truncatePromptText(narrative?.narrative, 240) || "none";
  const memoryLine = truncatePromptText(poolMemory, 180) || "none";
  const holderLine = holders
    ? `top10=${holders.top_10_real_holders_pct ?? "?"}% | bundlers=${holders.bundlers_pct_in_top_100 ?? "?"}% | fees=${holders.global_fees_sol ?? "?"} SOL`
    : "unavailable";

  return [
    `${pool.name} (${pool.pool})`,
    `score=${roundMetric(pool.deterministic_score)} | fee_tvl=${pool.fee_active_tvl_ratio} | vol=$${pool.volume_window} | tvl=$${pool.active_tvl} | organic=${pool.organic_score}`,
    `bin_step=${pool.bin_step} | active_bin=${activeBinLine}`,
    `holders: ${holderLine}`,
    `smart_wallets: ${smartWalletCount ? smartWallets.in_pool.map((wallet) => wallet.name).join(", ") : "none"}`,
    `lp_wallet_scoring: ${formatLpWalletScore(scoredLpers)}`,
    `narrative: ${narrativeLine}`,
    `pool_memory: ${memoryLine}`,
  ].join("\n");
}

export async function inspectCandidate(pool, executeTool, { includeWalletScore = true } = {}) {
  const mint = pool.base?.mint;
  const [smartWallets, holders, narrative, tokenInfo, okx, poolMemory, activeBin] = await Promise.allSettled([
    checkSmartWalletsOnPool({ pool_address: pool.pool }),
    mint ? getTokenHolders({ mint, limit: 100 }) : Promise.resolve(null),
    mint ? getTokenNarrative({ mint }) : Promise.resolve(null),
    mint ? getTokenInfo({ query: mint }) : Promise.resolve(null),
    mint ? getFullTokenAnalysis(mint) : Promise.resolve(null),
    Promise.resolve(recallForPool(pool.pool)),
    executeTool("get_active_bin", { pool_address: pool.pool }),
  ]);

  let scoredLpers = null;
  if (includeWalletScore) {
    const cachedScore = getWalletScoreMemory(pool.pool);
    scoredLpers = cachedScore.found && (cachedScore.age_minutes == null || cachedScore.age_minutes <= 360)
      ? {
          message: `reused wallet-score memory from ${cachedScore.age_minutes ?? 0} minute(s) ago`,
          candidates: cachedScore.scored_wallets || [],
        }
      : await executeTool("score_top_lpers", { pool_address: pool.pool, limit: 4 }).catch(() => null);
  }

  const sw = smartWallets.status === "fulfilled" ? smartWallets.value : null;
  const h = holders.status === "fulfilled" ? holders.value : null;
  const n = narrative.status === "fulfilled" ? narrative.value : null;
  const ti = tokenInfo.status === "fulfilled" ? tokenInfo.value?.results?.[0] : null;
  const okxInfo = okx.status === "fulfilled" ? okx.value : null;
  const mem = poolMemory.status === "fulfilled" ? poolMemory.value : null;
  const active = activeBin.status === "fulfilled" ? activeBin.value : null;
  const availability = {
		holders: mint ? (holders.status === "fulfilled" ? "ok" : "unavailable") : "skipped",
		okx_advanced: mint
			? (okx.status === "fulfilled" && okx.value?.availability?.advanced === "ok" ? "ok" : "unavailable")
			: "skipped",
	};

  return {
    pool,
    smartWallets: sw,
    holders: h,
    narrative: n,
    tokenInfo: ti,
    okx: okxInfo,
    poolMemory: mem,
    activeBin: active,
    scoredLpers,
		availability,
  };
}

export function formatCandidates(candidates) {
  if (!candidates.length) return "  No eligible pools found right now.";

  const lines = candidates.map((p, i) => {
    const name = (p.name || "unknown").padEnd(20);
    const score = `${roundMetric(p.deterministic_score ?? 0)}`.padStart(6);
    const ftvl = `${p.fee_active_tvl_ratio ?? p.fee_tvl_ratio}%`.padStart(8);
    const vol = `$${((p.volume_24h || 0) / 1000).toFixed(1)}k`.padStart(8);
    const active = `${p.active_pct}%`.padStart(6);
    const org = String(p.organic_score).padStart(4);
    return `  [${i + 1}]  ${name}  score:${score}  fee/aTVL:${ftvl}  vol:${vol}  in-range:${active}  organic:${org}`;
  });

  return [
    "  #   pool                  score  fee/aTVL     vol    in-range  organic",
    `  ${"─".repeat(76)}`,
    ...lines,
  ].join("\n");
}

export function buildCandidateContext({
  shortlist,
  inspectionRows,
}) {
  const rankedShortlist = shortlist.length > 0
    ? shortlist.map((pool, index) => formatCandidateSummaryLine(pool, index + 1)).join("\n")
    : "none";
  let candidateContext = `\nRANKED SHORTLIST (deterministic rank before enrichment):\n${rankedShortlist}\n`;
  if (inspectionRows.length > 0) {
    candidateContext += `\nFINALIST ANALYSIS (only top ${inspectionRows.length} candidate${inspectionRows.length === 1 ? "" : "s"} were enriched with smart wallets, holders, OKX market intel, narrative, planner context, and LP-wallet scoring):\n${inspectionRows.join("\n\n")}\n`;
  }
  return candidateContext;
}

export function formatFinalistInspectionBlock({
  pool,
  inspection,
  distributionPlan,
  tierPlan,
  candidateIntel,
}) {
  const sw = inspection.smartWallets;
  const h = inspection.holders;
  const n = inspection.narrative;
  const ti = inspection.tokenInfo;
  const okx = inspection.okx;
  const mem = inspection.poolMemory;
  const scoredLpers = inspection.scoredLpers || {
    message: "wallet score unavailable",
    candidates: [],
  };

  const momentum = ti?.stats_1h
    ? `1h: price${ti.stats_1h.price_change >= 0 ? "+" : ""}${ti.stats_1h.price_change}%, buyers=${ti.stats_1h.buyers}, net_buyers=${ti.stats_1h.net_buyers}`
    : null;
  const smartWalletCount = sw?.in_pool?.length ?? 0;
  const smartWalletLine = smartWalletCount
    ? `  smart_wallets: ${smartWalletCount} present -> CONFIDENCE BOOST (${sw.in_pool.map((w) => w.name).join(", ")})`
    : null;
  const holderLine = h
    ? `  holders: top_10_pct=${h.top_10_real_holders_pct ?? "?"}%, bundlers_pct=${h.bundlers_pct_in_top_100 ?? "?"}%, global_fees_sol=${h.global_fees_sol ?? "?"}`
    : null;
  const okxLine = candidateIntel.okx
    ? `  okx: risk=${candidateIntel.okx.risk_level ?? "?"}, creator=${candidateIntel.okx.creator ? String(candidateIntel.okx.creator).slice(0, 8) : "?"}${candidateIntel.okx.creator_blocked ? "(blocked)" : ""}, bundle=${candidateIntel.okx.bundle_pct ?? "?"}%, sniper=${candidateIntel.okx.sniper_pct ?? "?"}%, suspicious=${candidateIntel.okx.suspicious_pct ?? "?"}%, ath=${candidateIntel.okx.price_vs_ath_pct ?? "?"}%${candidateIntel.okx.top_cluster_trend ? `, cluster=${candidateIntel.okx.top_cluster_trend}` : ""}${candidateIntel.okx.cluster_has_kol ? ", kol_cluster=yes" : ""}`
    : null;
  const okxTagsLine = okx?.advanced
    ? `  okx_tags: ${[
        okx.advanced.is_honeypot ? "honeypot" : null,
        okx.advanced.smart_money_buy ? "smart_money_buy" : null,
        okx.advanced.dev_sold_all ? "dev_sold_all" : null,
        okx.advanced.dex_boost ? "dex_boost" : null,
        okx.advanced.dex_screener_paid ? "ds_paid" : null,
      ].filter(Boolean).join(", ") || "none"}`
    : null;
  const narrativeLine = truncatePromptText(n?.narrative, 200);
  const poolMemoryLine = truncatePromptText(mem, 140);
  const memoryHits = recallForScreening({
    name: pool.name,
    pair: pool.name,
    base_token: pool.base?.mint,
    bin_step: pool.bin_step,
  });
  const learnedMemory = memoryHits.length
    ? memoryHits.map((hit) => `[${hit.source}] ${hit.key}: ${hit.answer}`).join(" | ")
    : null;
  const learnedMemoryLine = truncatePromptText(learnedMemory, 140);

  return [
    `FINALIST: ${pool.name} (${pool.pool})`,
    `  metrics: bin_step=${pool.bin_step}, fee_tvl=${pool.fee_active_tvl_ratio}, vol=$${pool.volume_window}, tvl=$${pool.active_tvl}, organic=${pool.organic_score}`,
    `  ranking_score: ${roundMetric(pool.deterministic_score)} | context_score: ${candidateIntel.score.context_score}`,
    `  hard_gate: ${candidateIntel.hard_blocked ? `BLOCKED (${candidateIntel.hard_blocks.join(", ")})` : "pass"}`,
    smartWalletLine,
    holderLine,
    okxLine,
    okxTagsLine,
    inspection.activeBin?.binId != null ? `  active_bin: ${inspection.activeBin.binId}` : null,
    momentum ? `  momentum: ${momentum}` : null,
    narrativeLine ? `  narrative: ${narrativeLine}` : null,
    `  lp_wallet_scoring: ${formatLpWalletScore(scoredLpers)}`,
    `  planner: ${formatPlannerContext(distributionPlan, tierPlan)}`,
    poolMemoryLine ? `  pool_memory: ${poolMemoryLine}` : null,
    learnedMemoryLine ? `  learned_memory: ${learnedMemoryLine}` : null,
  ].filter(Boolean).join("\n");
}
