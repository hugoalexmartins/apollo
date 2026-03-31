import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	readJsonSnapshotWithBackupSync,
	writeJsonSnapshotAtomicSync,
} from "./durable-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_ROOT = process.env.ZENITH_MEMORY_DIR || path.join(__dirname, "data", "nuggets");
const MEMORY_ROLLOUT_FILE = process.env.ZENITH_MEMORY_ROLLOUT_FILE || path.join(MEMORY_ROOT, "memory-rollout.json");
const MEMORY_ROLLOUT_HISTORY = 25;

function buildDefaultState() {
	return {
		active_version: "policy-v1",
		shadow_version: "policy-shadow-v1",
		history: [],
	};
}

function isString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function isHistoryEntry(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidStateShape(value) {
	return Boolean(value)
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& isString(value.active_version)
		&& isString(value.shadow_version)
		&& Array.isArray(value.history)
		&& value.history.every(isHistoryEntry);
}

function normalizeState(value = {}) {
	return {
		active_version: isString(value.active_version) ? value.active_version : buildDefaultState().active_version,
		shadow_version: isString(value.shadow_version) ? value.shadow_version : buildDefaultState().shadow_version,
		history: Array.isArray(value.history) ? value.history.slice(-MEMORY_ROLLOUT_HISTORY) : [],
	};
}

function loadState() {
	const snapshot = readJsonSnapshotWithBackupSync(MEMORY_ROLLOUT_FILE);
	if (!snapshot.value) {
		if (!snapshot.error) return buildDefaultState();
		return {
			...buildDefaultState(),
			invalid_state: true,
			error: snapshot.error,
		};
	}
	if (!isValidStateShape(snapshot.value)) {
		return {
			...buildDefaultState(),
			invalid_state: true,
			error: "memory-rollout.json has invalid shape",
		};
	}
	return normalizeState(snapshot.value);
}

function saveState(state) {
	writeJsonSnapshotAtomicSync(MEMORY_ROLLOUT_FILE, normalizeState(state));
}

function buildNextShadowVersion(activeVersion) {
	return `policy-shadow-${Date.now()}-${String(activeVersion || "policy").replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function ensureMemoryRolloutState() {
	const state = loadState();
	if (!state.invalid_state) {
		try {
			saveState(state);
		} catch {
			return state;
		}
	}
	return state;
}

export function getMemoryRolloutState() {
	return ensureMemoryRolloutState();
}

export function getMemoryVersionStatus() {
	const state = ensureMemoryRolloutState();
	return {
		active_version: state.active_version,
		shadow_version: state.shadow_version,
		history: state.history || [],
		invalid_state: Boolean(state.invalid_state),
		error: state.error || null,
	};
}

export function promoteShadowMemoryVersion({ reason = "shadow_policy_promoted", metrics = {} } = {}) {
	const state = ensureMemoryRolloutState();
	if (state.invalid_state) return { promoted: false, reason_code: "MEMORY_ROLLOUT_INVALID", error: state.error };
	const previousActive = state.active_version;
	const promotedVersion = state.shadow_version;
	const nextShadowVersion = buildNextShadowVersion(promotedVersion);
	state.active_version = promotedVersion;
	state.shadow_version = nextShadowVersion;
	state.history = [
		...(state.history || []),
		{
			ts: new Date().toISOString(),
			status: "promoted",
			reason,
			previous_active_version: previousActive,
			promoted_version: promotedVersion,
			next_shadow_version: nextShadowVersion,
			metrics,
		},
	].slice(-MEMORY_ROLLOUT_HISTORY);
	saveState(state);
	return {
		promoted: true,
		active_version: state.active_version,
		shadow_version: state.shadow_version,
		previous_active_version: previousActive,
	};
}

export function rollbackMemoryPromotion({ reason = "shadow_policy_rolled_back" } = {}) {
	const state = ensureMemoryRolloutState();
	if (state.invalid_state) return { rolled_back: false, reason_code: "MEMORY_ROLLOUT_INVALID", error: state.error };
	const lastPromotion = [...(state.history || [])].reverse().find((entry) => entry?.status === "promoted");
	if (!lastPromotion?.previous_active_version) {
		return { rolled_back: false, reason_code: "NO_PREVIOUS_ACTIVE_VERSION" };
	}
	const previousActive = state.active_version;
	state.active_version = lastPromotion.previous_active_version;
	state.history = [
		...(state.history || []),
		{
			ts: new Date().toISOString(),
			status: "rolled_back",
			reason,
			previous_active_version: previousActive,
			restored_active_version: state.active_version,
		},
	].slice(-MEMORY_ROLLOUT_HISTORY);
	saveState(state);
	return {
		rolled_back: true,
		active_version: state.active_version,
		shadow_version: state.shadow_version,
	};
}
