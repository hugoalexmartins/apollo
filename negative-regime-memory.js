import fs from "fs";
import path from "path";

import {
	readJsonSnapshotWithBackupSync,
	writeJsonSnapshotAtomicSync,
} from "./durable-store.js";

const FILE = process.env.ZENITH_NEGATIVE_REGIME_MEMORY_FILE || path.join("./data", "negative-regime-memory.json");
const BASE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MIN_HITS_FOR_ACTIVATION = 2;
const MIN_CUMULATIVE_LOSS_FOR_ACTIVATION = 10;

function isObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCooldownShape(value) {
	return isObject(value) && isObject(value.cooldowns);
}

function load() {
	const snapshot = readJsonSnapshotWithBackupSync(FILE);
	if (!snapshot.value) {
		if (!snapshot.error) return { cooldowns: {} };
		return { cooldowns: {}, invalid_state: true, error: snapshot.error };
	}
	if (!isCooldownShape(snapshot.value)) {
		return { cooldowns: {}, invalid_state: true, error: "negative-regime-memory has invalid shape" };
	}
	return {
		cooldowns: snapshot.value?.cooldowns && typeof snapshot.value.cooldowns === "object" ? snapshot.value.cooldowns : {},
		loaded_from_backup: snapshot.source === "backup",
	};
}

function save(state) {
	fs.mkdirSync(path.dirname(FILE), { recursive: true });
	writeJsonSnapshotAtomicSync(FILE, state);
}

function normalize(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

export function buildNegativeRegimeMemoryKey({ regime_label, strategy } = {}) {
  return `${normalize(regime_label, "neutral")}|${normalize(strategy, "unknown")}`;
}

function shouldTriggerCooldown({ pnl_pct, close_reason } = {}) {
  const pnlPct = Number(pnl_pct);
  if (Number.isFinite(pnlPct) && pnlPct <= -5) return true;
  const reason = String(close_reason || "").toLowerCase();
  return reason.includes("stop loss") || reason.includes("fee yield too low") || reason.includes("volume collapse");
}

export function recordNegativeRegimeOutcome({ regime_label, strategy, pnl_pct, close_reason, nowMs = Date.now() } = {}) {
  if (!shouldTriggerCooldown({ pnl_pct, close_reason })) {
    return { recorded: false, reason: "outcome_not_negative_enough" };
  }

	const state = load();
	if (state.invalid_state) {
		return { recorded: false, invalid_state: true, error: state.error };
	}
	const key = buildNegativeRegimeMemoryKey({ regime_label, strategy });
  const existing = state.cooldowns[key];
  const lastRecordedMs = Number.isFinite(Date.parse(existing?.last_recorded_at || ""))
    ? Date.parse(existing.last_recorded_at)
    : null;
  const withinWindow = lastRecordedMs != null && (nowMs - lastRecordedMs) <= EVIDENCE_WINDOW_MS;
  const priorHits = withinWindow ? Number(existing?.hits || 0) : 0;
  const priorLoss = withinWindow ? Number(existing?.cumulative_negative_pnl_abs || 0) : 0;
  const hits = Math.max(1, priorHits + 1);
  const cumulativeLoss = Number((priorLoss + Math.max(0, Math.abs(Number(pnl_pct) || 0))).toFixed(2));
  const sampleQuality = hits >= MIN_HITS_FOR_ACTIVATION && cumulativeLoss >= MIN_CUMULATIVE_LOSS_FOR_ACTIVATION
    ? "confirmed"
    : "weak";
  const active = sampleQuality === "confirmed";
  const durationMs = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS + ((Math.max(0, hits - MIN_HITS_FOR_ACTIVATION)) * 2 * 60 * 60 * 1000));

  state.cooldowns[key] = {
    key,
    regime_label: normalize(regime_label, "neutral"),
    strategy: normalize(strategy, "unknown"),
    hits,
    sample_quality: sampleQuality,
    activation_hits_required: MIN_HITS_FOR_ACTIVATION,
    cumulative_negative_pnl_abs: cumulativeLoss,
    cooldown_until: active ? new Date(nowMs + durationMs).toISOString() : null,
    reason: `negative outcome: ${close_reason || "loss"}`,
    last_pnl_pct: Number.isFinite(Number(pnl_pct)) ? Number(pnl_pct) : null,
    first_recorded_at: withinWindow ? existing?.first_recorded_at || new Date(nowMs).toISOString() : new Date(nowMs).toISOString(),
    last_recorded_at: new Date(nowMs).toISOString(),
  };

  save(state);
  return {
    recorded: true,
    ...state.cooldowns[key],
  };
}

export function getNegativeRegimeMemory({ regime_label, strategy, nowMs = Date.now() } = {}) {
	const state = load();
	if (state.invalid_state) {
		return {
			key: buildNegativeRegimeMemoryKey({ regime_label, strategy }),
			active: true,
			cooldown_until: null,
			remaining_ms: 0,
			hits: 0,
			sample_quality: "invalid",
			cumulative_negative_pnl_abs: 0,
			reason: `negative regime memory unreadable: ${state.error}`,
			invalid_state: true,
			error: state.error,
		};
	}
	const key = buildNegativeRegimeMemoryKey({ regime_label, strategy });
  const cooldown = state.cooldowns[key];
  if (!cooldown) {
    return {
      key,
      active: false,
      cooldown_until: null,
      remaining_ms: 0,
      hits: 0,
      sample_quality: "none",
      cumulative_negative_pnl_abs: 0,
      reason: null,
    };
  }

  if (!cooldown.cooldown_until) {
    return {
      key,
      active: false,
      cooldown_until: null,
      remaining_ms: 0,
      hits: Number(cooldown.hits) || 0,
      sample_quality: cooldown.sample_quality || "weak",
      cumulative_negative_pnl_abs: Number(cooldown.cumulative_negative_pnl_abs) || 0,
      reason: cooldown.reason || null,
    };
  }

  const untilMs = Date.parse(cooldown.cooldown_until || "");
  if (!Number.isFinite(untilMs)) {
    return {
      key,
      active: true,
      cooldown_until: cooldown.cooldown_until,
      remaining_ms: 0,
      hits: Number(cooldown.hits) || 0,
      sample_quality: cooldown.sample_quality || "weak",
      cumulative_negative_pnl_abs: Number(cooldown.cumulative_negative_pnl_abs) || 0,
      reason: `negative regime memory has invalid cooldown timestamp: ${cooldown.cooldown_until}`,
			invalid_state: true,
			error: "invalid cooldown_until",
    };
  }

  const remainingMs = Math.max(0, untilMs - nowMs);
  return {
    key,
    active: remainingMs > 0,
    cooldown_until: cooldown.cooldown_until,
    remaining_ms: remainingMs,
    hits: Number(cooldown.hits) || 0,
    sample_quality: cooldown.sample_quality || "weak",
    cumulative_negative_pnl_abs: Number(cooldown.cumulative_negative_pnl_abs) || 0,
    reason: cooldown.reason || null,
  };
}
