import { computeAdaptiveDeployAmount, getEffectiveMinSolToOpen, normalizeOptionalNonNegativeNumber } from "./runtime-helpers.js";
import { applyMutableConfigValues, getMutableConfigEntry, normalizeMutableConfigChanges } from "./config-registry.js";
import { readUserConfigSnapshot } from "./user-config-store.js";

const initialUserConfig = readUserConfigSnapshot();
if (!initialUserConfig.ok) {
	throw new Error(initialUserConfig.error);
}
const u = initialUserConfig.value;
const legacyModel = u.llmModel ?? process.env.LLM_MODEL;

export const secretHealth = {
  wallet_key_source: process.env.WALLET_PRIVATE_KEY ? "env" : "missing",
};

// Apply wallet/RPC from user-config if not already in env
if (u.rpcUrl)    process.env.RPC_URL            ||= u.rpcUrl;
if (u.dryRun !== undefined) process.env.DRY_RUN ||= String(u.dryRun);

export const config = {
  // ─── Risk Limits ─────────────────────────
  risk: {
    maxPositions:    u.maxPositions    ?? 3,
    maxDeployAmount: u.maxDeployAmount ?? 50,
  },

  // ─── Pool Screening Thresholds ───────────
  screening: {
    minFeeActiveTvlRatio: u.minFeeActiveTvlRatio ?? 0.05,
    minTvl:            u.minTvl            ?? 10_000,
    maxTvl:            u.maxTvl            ?? 150_000,
    minVolume:         u.minVolume         ?? 500,
    minOrganic:        u.minOrganic        ?? 60,
    minHolders:        u.minHolders        ?? 500,
    minMcap:           u.minMcap           ?? 150_000,
    maxMcap:           u.maxMcap           ?? 10_000_000,
    minBinStep:        u.minBinStep        ?? 80,
    maxBinStep:        u.maxBinStep        ?? 125,
    minTokenAgeHours:  normalizeOptionalNonNegativeNumber(u.minTokenAgeHours, null),
    maxTokenAgeHours:  normalizeOptionalNonNegativeNumber(u.maxTokenAgeHours, null),
    timeframe:         u.timeframe         ?? "5m",
    category:          u.category          ?? "trending",
    minTokenFeesSol:   u.minTokenFeesSol   ?? 30,  // global fees paid (priority+jito tips). below = bundled/scam
    maxBundlersPct:    u.maxBundlersPct    ?? 30,  // max bundlers % in top 100 holders
    maxTop10Pct:       u.maxTop10Pct       ?? 60,  // max top 10 holders concentration
    maxBundlePct:      u.maxBundlePct      ?? 30,  // OKX bundle holding threshold for finalist hard block
  },

  // ─── Position Management ────────────────
  management: {
    minClaimAmount:        u.minClaimAmount        ?? 5,
    autoSwapAfterClaim:    u.autoSwapAfterClaim    ?? false,
    outOfRangeBinsToClose: u.outOfRangeBinsToClose ?? 10,
    outOfRangeWaitMinutes: u.outOfRangeWaitMinutes ?? 30,
    minVolumeToRebalance:  u.minVolumeToRebalance  ?? 1000,
    emergencyPriceDropPct: u.emergencyPriceDropPct ?? -50,
    stopLossPct:           u.stopLossPct           ?? -20,
    takeProfitFeePct:      u.takeProfitFeePct      ?? 5,
    trailingTakeProfit:    u.trailingTakeProfit    ?? true,
    trailingTriggerPct:    u.trailingTriggerPct    ?? 3,
    trailingDropPct:       u.trailingDropPct       ?? 1.5,
    minFeePerTvl24h:       u.minFeePerTvl24h       ?? 7,
    slowReviewIntervalMin: u.slowReviewIntervalMin ?? 15,
    minSolToOpen:          getEffectiveMinSolToOpen({
      minSolToOpen: u.minSolToOpen ?? 0.55,
      deployAmountSol: u.deployAmountSol ?? 0.5,
      gasReserve: u.gasReserve ?? 0.2,
    }),
    deployAmountSol:       u.deployAmountSol       ?? 0.5,
    gasReserve:            u.gasReserve            ?? 0.2,
    positionSizePct:       u.positionSizePct       ?? 0.35,
  },

  protections: {
    enabled: u.protectionsEnabled ?? true,
    maxRecentRealizedLossUsd: u.maxRecentRealizedLossUsd ?? 100,
    maxDrawdownPct: u.maxDrawdownPct ?? 25,
    maxOpenUnrealizedLossUsd: u.maxOpenUnrealizedLossUsd ?? 150,
    recentLossWindowHours: u.recentLossWindowHours ?? 24,
    stopLossStreakLimit: u.stopLossStreakLimit ?? 3,
    pauseMinutes: u.portfolioPauseMinutes ?? 180,
    maxReviewedCloses: u.maxReviewedCloses ?? 50,
    recoveryResumeOverrideMinutes: u.recoveryResumeOverrideMinutes ?? 180,
  },

  // ─── Strategy Mapping ───────────────────
  strategy: {
    strategy:  u.strategy  ?? "bid_ask",
    binsBelow: u.binsBelow ?? 69,
  },

  // ─── Scheduling ─────────────────────────
  schedule: {
    managementIntervalMin:  u.managementIntervalMin  ?? 3,
    screeningIntervalMin:   u.screeningIntervalMin   ?? 30,
    healthCheckIntervalMin: u.healthCheckIntervalMin ?? 60,
  },

  // ─── LLM Settings ──────────────────────
  llm: {
    temperature: u.temperature ?? 0.373,
    maxTokens:   u.maxTokens   ?? 4096,
    maxSteps:    u.maxSteps    ?? 20,
		managementModel: u.managementModel ?? legacyModel ?? "openrouter/healer-alpha",
		screeningModel:  u.screeningModel  ?? legacyModel ?? "openrouter/hunter-alpha",
		generalModel:    u.generalModel    ?? legacyModel ?? "openrouter/healer-alpha",
  },

  // ─── Common Token Mints ────────────────
  tokens: {
    SOL:  "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
};

const bootNormalized = normalizeMutableConfigChanges(u, config);
if (bootNormalized.errors.length > 0) {
	throw new Error(`Invalid mutable user config: ${bootNormalized.errors.join("; ")}`);
}
applyMutableConfigValues(config, bootNormalized.normalized);
recomputeManagementDerivedValues({
	minSolToOpen: Object.hasOwn(u, "minSolToOpen") ? u.minSolToOpen : config.management.minSolToOpen,
	deployAmountSol: Object.hasOwn(u, "deployAmountSol") ? u.deployAmountSol : config.management.deployAmountSol,
	gasReserve: Object.hasOwn(u, "gasReserve") ? u.gasReserve : config.management.gasReserve,
});

/**
 * Compute the optimal deploy amount for a given wallet balance.
 * Scales position size with wallet growth (compounding).
 *
 * Formula: clamp(deployable × positionSizePct, floor=deployAmountSol, ceil=maxDeployAmount)
 *
 * Examples (defaults: gasReserve=0.2, positionSizePct=0.35, floor=0.5):
 *   0.8 SOL wallet → 0.6 SOL deploy  (floor)
 *   2.0 SOL wallet → 0.63 SOL deploy
 *   3.0 SOL wallet → 0.98 SOL deploy
 *   4.0 SOL wallet → 1.33 SOL deploy
 */
export function computeDeployAmount(walletSol, {
  regimeMultiplier = 1,
  performanceMultiplier = 1,
  riskMultiplier = 1,
  skipBelowFloor = true,
  floorOverride,
  reserveOverride,
  positionSizePctOverride,
  maxDeployOverride,
} = {}) {
  const reserve  = config.management.gasReserve      ?? 0.2;
  const pct      = config.management.positionSizePct ?? 0.35;
  const floor    = config.management.deployAmountSol;
  const ceil     = config.risk.maxDeployAmount;
  return computeAdaptiveDeployAmount({
    walletSol,
    reserve: reserveOverride ?? reserve,
    floor: floorOverride ?? floor,
    ceil: maxDeployOverride ?? ceil,
    positionSizePct: positionSizePctOverride ?? pct,
    regimeMultiplier,
    performanceMultiplier,
    riskMultiplier,
    skipBelowFloor,
  });
}

export function recomputeManagementDerivedValues(overrides = {}) {
	config.management.minSolToOpen = getEffectiveMinSolToOpen({
		minSolToOpen: overrides.minSolToOpen ?? config.management.minSolToOpen,
		deployAmountSol: overrides.deployAmountSol ?? config.management.deployAmountSol,
		gasReserve: overrides.gasReserve ?? config.management.gasReserve,
	});
	return {
		minSolToOpen: config.management.minSolToOpen,
	};
}

/**
 * Reload user-config.json and apply updated screening thresholds to the
 * in-memory config object. Called after threshold evolution so the next
 * agent cycle uses the evolved values without a restart.
 */
export function reloadScreeningThresholds() {
  const snapshot = readUserConfigSnapshot();
  if (!snapshot.ok) {
		return {
			success: false,
			reason_code: "USER_CONFIG_INVALID",
			error: snapshot.error,
		};
	}

	const screeningOnly = Object.fromEntries(
		Object.entries(snapshot.value).filter(([key]) => getMutableConfigEntry(key)?.group === "Screening"),
	);
	const normalized = normalizeMutableConfigChanges(screeningOnly, config);
	if (normalized.errors.length > 0) {
		return {
			success: false,
			reason_code: "USER_CONFIG_INVALID",
			error: `Invalid screening config during reload: ${normalized.errors.join("; ")}`,
		};
	}
	applyMutableConfigValues(config, normalized.normalized, ["Screening"]);

	return {
		success: true,
		reason_code: null,
		error: null,
	};
}
