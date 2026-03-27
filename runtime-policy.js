function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundMetric(value) {
  return Number(Number(value || 0).toFixed(2));
}

export const MANAGEMENT_SUBREASONS = Object.freeze({
  EXIT_ALERT: "exit_alert",
  STOP_LOSS: "stop_loss_pct_breached",
  TAKE_PROFIT: "take_profit_pct_reached",
  OUT_OF_RANGE: "out_of_range_rebalance",
  LOW_FEE_YIELD: "fee_yield_below_floor",
  FEE_THRESHOLD: "fee_threshold_reached",
});

export function deriveExpectedVolumeProfile(snapshot = {}) {
  const feeTvlRatio = asNumber(snapshot.fee_active_tvl_ratio ?? snapshot.fee_tvl_ratio, 0);
  const volume = asNumber(snapshot.volume_window ?? snapshot.volume_24h, 0);
  const volatility = asNumber(snapshot.six_hour_volatility ?? snapshot.volatility, 0);

  if (volatility >= 18 || volume >= 250_000 || feeTvlRatio >= 1.5) return "bursty";
  if (volatility >= 10 || volume >= 75_000 || feeTvlRatio >= 0.5) return "high";
  if (volume >= 10_000 || feeTvlRatio >= 0.12) return "balanced";
  return "low";
}

export function resolveTargetManagementInterval(positions = []) {
  const maxVolatility = positions.reduce((max, position) => {
    const candidate = Number(position?.volatility ?? 0);
    return Number.isFinite(candidate) ? Math.max(max, candidate) : max;
  }, 0);

  const interval = maxVolatility >= 5 ? 3 : maxVolatility >= 2 ? 5 : 10;
  return { interval, maxVolatility: roundMetric(maxVolatility) };
}

export function isPnlSignalStale(position = {}) {
  const pnl = position?.pnl;
  if (!pnl || typeof pnl !== "object") return false;
  if (pnl.stale === true || pnl.lagging === true || pnl.status === "stale") return true;

  const observedAtMs = Number.isFinite(Number(pnl.observed_at_ms ?? pnl.as_of_ms))
    ? Number(pnl.observed_at_ms ?? pnl.as_of_ms)
    : Number.isFinite(Date.parse(pnl.observed_at ?? pnl.as_of ?? ""))
      ? Date.parse(pnl.observed_at ?? pnl.as_of)
      : null;
  const maxAgeMs = Number(pnl.max_age_ms ?? position.max_pnl_age_ms);

  if (observedAtMs == null || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return false;
  }

  return Date.now() - observedAtMs > maxAgeMs;
}

export function planManagementRuntimeAction(position, config, expectedVolumeProfile = null) {
  if (position.instruction) return null;

  const pnlSignalStale = isPnlSignalStale(position);

  const pnlPct = !pnlSignalStale && Number.isFinite(Number(position.pnl?.pnl_pct ?? position.pnl_pct))
    ? Number(position.pnl?.pnl_pct ?? position.pnl_pct)
    : null;
  const feePerTvl24h = !pnlSignalStale && Number.isFinite(Number(position.pnl?.fee_per_tvl_24h ?? position.fee_per_tvl_24h))
    ? Number(position.pnl?.fee_per_tvl_24h ?? position.fee_per_tvl_24h)
    : null;
  const feesUsd = pnlSignalStale
    ? 0
    : asNumber(position.pnl?.unclaimed_fee_usd ?? position.unclaimed_fees_usd, 0);
  const oorMinutes = asNumber(position.minutes_out_of_range, 0);
  const derivedVolumeProfile = expectedVolumeProfile || deriveExpectedVolumeProfile({
    fee_tvl_ratio: position.fee_tvl_ratio,
    volatility: position.pnl?.volatility ?? position.volatility,
    volume_window: position.volume_window,
  });

  if (position.exitAlert && !pnlSignalStale) {
    return {
      toolName: "close_position",
      args: { position_address: position.position, reason: position.exitAlert },
      reason: position.exitAlert,
      rule: MANAGEMENT_SUBREASONS.EXIT_ALERT,
    };
  }

  if (pnlPct != null && pnlPct <= config.management.emergencyPriceDropPct) {
    return {
      toolName: "close_position",
      args: { position_address: position.position, reason: "emergency stop loss" },
      reason: `pnl ${pnlPct.toFixed(2)}% <= ${config.management.emergencyPriceDropPct}%`,
      rule: MANAGEMENT_SUBREASONS.STOP_LOSS,
    };
  }

  if (pnlPct != null && pnlPct >= config.management.takeProfitFeePct) {
    return {
      toolName: "close_position",
      args: { position_address: position.position, reason: "fixed take profit" },
      reason: `pnl ${pnlPct.toFixed(2)}% >= ${config.management.takeProfitFeePct}%`,
      rule: MANAGEMENT_SUBREASONS.TAKE_PROFIT,
    };
  }

  if (position.in_range === false) {
    return {
      toolName: "rebalance_on_exit",
      args: {
        position_address: position.position,
        execute: true,
        expected_volume_profile: derivedVolumeProfile,
      },
      reason: oorMinutes > 0 ? `out of range for ${oorMinutes}m` : "out of range",
      rule: MANAGEMENT_SUBREASONS.OUT_OF_RANGE,
    };
  }

  if (feePerTvl24h != null && feePerTvl24h < config.management.minFeePerTvl24h && asNumber(position.age_minutes, 0) >= 60) {
    return {
      toolName: "close_position",
      args: { position_address: position.position, reason: "fee yield too low" },
      reason: `fee_per_tvl_24h ${feePerTvl24h.toFixed(2)} < ${config.management.minFeePerTvl24h}`,
      rule: MANAGEMENT_SUBREASONS.LOW_FEE_YIELD,
    };
  }

  if (feesUsd >= config.management.minClaimAmount) {
    return {
      toolName: "auto_compound_fees",
      args: {
        position_address: position.position,
        execute_reinvest: false,
        expected_volume_profile: derivedVolumeProfile,
      },
      reason: `fees $${feesUsd.toFixed(2)} >= $${config.management.minClaimAmount}`,
      rule: MANAGEMENT_SUBREASONS.FEE_THRESHOLD,
    };
  }

  return null;
}
