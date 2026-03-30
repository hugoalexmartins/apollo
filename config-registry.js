import { normalizeOptionalNonNegativeNumber } from "./runtime-helpers.js";

const ENUM_TIMEFRAME = ["5m", "15m", "30m", "1h", "4h", "12h", "24h"];
const ENUM_CATEGORY = ["top", "new", "trending"];
const ENUM_STRATEGY = ["bid_ask", "spot", "curve"];

const MUTABLE_CONFIG_ENTRIES = [
	{ key: "minFeeActiveTvlRatio", section: "screening", field: "minFeeActiveTvlRatio", group: "Screening", kind: "number", min: 0 },
	{ key: "minTvl", section: "screening", field: "minTvl", group: "Screening", kind: "number", min: 0 },
	{ key: "maxTvl", section: "screening", field: "maxTvl", group: "Screening", kind: "number", min: 0 },
	{ key: "minVolume", section: "screening", field: "minVolume", group: "Screening", kind: "number", min: 0 },
	{ key: "minOrganic", section: "screening", field: "minOrganic", group: "Screening", kind: "number", min: 0, max: 100 },
	{ key: "minHolders", section: "screening", field: "minHolders", group: "Screening", kind: "number", min: 1, integer: true },
	{ key: "minMcap", section: "screening", field: "minMcap", group: "Screening", kind: "number", min: 0 },
	{ key: "maxMcap", section: "screening", field: "maxMcap", group: "Screening", kind: "number", min: 0 },
	{ key: "minBinStep", section: "screening", field: "minBinStep", group: "Screening", kind: "number", min: 1, integer: true },
	{ key: "maxBinStep", section: "screening", field: "maxBinStep", group: "Screening", kind: "number", min: 1, integer: true },
	{ key: "minTokenAgeHours", section: "screening", field: "minTokenAgeHours", group: "Screening", kind: "optionalNonNegativeNumber" },
	{ key: "maxTokenAgeHours", section: "screening", field: "maxTokenAgeHours", group: "Screening", kind: "optionalNonNegativeNumber" },
	{ key: "timeframe", section: "screening", field: "timeframe", group: "Screening", kind: "enum", values: ENUM_TIMEFRAME },
	{ key: "category", section: "screening", field: "category", group: "Screening", kind: "enum", values: ENUM_CATEGORY },
	{ key: "minTokenFeesSol", section: "screening", field: "minTokenFeesSol", group: "Screening", kind: "number", min: 0 },
	{ key: "maxBundlersPct", section: "screening", field: "maxBundlersPct", group: "Screening", kind: "number", min: 0, max: 100 },
	{ key: "maxTop10Pct", section: "screening", field: "maxTop10Pct", group: "Screening", kind: "number", min: 0, max: 100 },
	{ key: "maxBundlePct", section: "screening", field: "maxBundlePct", group: "Screening", kind: "number", min: 0, max: 100 },
	{ key: "protectionsEnabled", section: "protections", field: "enabled", group: "Protections", kind: "boolean" },
	{ key: "maxRecentRealizedLossUsd", section: "protections", field: "maxRecentRealizedLossUsd", group: "Protections", kind: "number", min: 0 },
	{ key: "maxDrawdownPct", section: "protections", field: "maxDrawdownPct", group: "Protections", kind: "number", min: 0, max: 100 },
	{ key: "maxOpenUnrealizedLossUsd", section: "protections", field: "maxOpenUnrealizedLossUsd", group: "Protections", kind: "number", min: 0 },
	{ key: "recentLossWindowHours", section: "protections", field: "recentLossWindowHours", group: "Protections", kind: "number", min: 1 },
	{ key: "stopLossStreakLimit", section: "protections", field: "stopLossStreakLimit", group: "Protections", kind: "number", min: 1, integer: true },
	{ key: "portfolioPauseMinutes", section: "protections", field: "pauseMinutes", group: "Protections", kind: "number", min: 1 },
	{ key: "maxReviewedCloses", section: "protections", field: "maxReviewedCloses", group: "Protections", kind: "number", min: 1, integer: true },
	{ key: "recoveryResumeOverrideMinutes", section: "protections", field: "recoveryResumeOverrideMinutes", group: "Protections", kind: "number", min: 1 },
	{ key: "minClaimAmount", section: "management", field: "minClaimAmount", group: "Management", kind: "number", min: 0 },
	{ key: "autoSwapAfterClaim", section: "management", field: "autoSwapAfterClaim", group: "Management", kind: "boolean" },
	{ key: "outOfRangeBinsToClose", section: "management", field: "outOfRangeBinsToClose", group: "Management", kind: "number", min: 1, integer: true },
	{ key: "outOfRangeWaitMinutes", section: "management", field: "outOfRangeWaitMinutes", group: "Management", kind: "number", min: 1 },
	{ key: "minVolumeToRebalance", section: "management", field: "minVolumeToRebalance", group: "Management", kind: "number", min: 0 },
	{ key: "emergencyPriceDropPct", section: "management", field: "emergencyPriceDropPct", group: "Management", kind: "number", max: 0 },
	{ key: "stopLossPct", section: "management", field: "stopLossPct", group: "Management", kind: "number", max: 0 },
	{ key: "takeProfitFeePct", section: "management", field: "takeProfitFeePct", group: "Management", kind: "number", min: 0 },
	{ key: "trailingTakeProfit", section: "management", field: "trailingTakeProfit", group: "Management", kind: "boolean" },
	{ key: "trailingTriggerPct", section: "management", field: "trailingTriggerPct", group: "Management", kind: "number", min: 0 },
	{ key: "trailingDropPct", section: "management", field: "trailingDropPct", group: "Management", kind: "number", min: 0 },
	{ key: "minFeePerTvl24h", section: "management", field: "minFeePerTvl24h", group: "Management", kind: "number", min: 0 },
	{ key: "slowReviewIntervalMin", section: "management", field: "slowReviewIntervalMin", group: "Management", kind: "number", min: 1 },
	{ key: "minSolToOpen", section: "management", field: "minSolToOpen", group: "Management", kind: "number", min: 0 },
	{ key: "deployAmountSol", section: "management", field: "deployAmountSol", group: "Management", kind: "number", min: 0.01 },
	{ key: "gasReserve", section: "management", field: "gasReserve", group: "Management", kind: "number", min: 0 },
	{ key: "positionSizePct", section: "management", field: "positionSizePct", group: "Management", kind: "number", min: 0, max: 1 },
	{ key: "maxPositions", section: "risk", field: "maxPositions", group: "Risk", kind: "number", min: 1, max: 10, integer: true },
	{ key: "maxDeployAmount", section: "risk", field: "maxDeployAmount", group: "Risk", kind: "number", min: 0.01 },
	{ key: "managementIntervalMin", section: "schedule", field: "managementIntervalMin", group: "Schedule", kind: "number", min: 1, max: 1440, integer: true },
	{ key: "screeningIntervalMin", section: "schedule", field: "screeningIntervalMin", group: "Schedule", kind: "number", min: 1, max: 1440, integer: true },
	{ key: "healthCheckIntervalMin", section: "schedule", field: "healthCheckIntervalMin", group: "Schedule", kind: "number", min: 1, max: 1440, integer: true },
	{ key: "temperature", section: "llm", field: "temperature", group: "Models", kind: "number", min: 0, max: 2 },
	{ key: "maxTokens", section: "llm", field: "maxTokens", group: "Models", kind: "number", min: 1, integer: true },
	{ key: "maxSteps", section: "llm", field: "maxSteps", group: "Models", kind: "number", min: 1, integer: true },
	{ key: "managementModel", section: "llm", field: "managementModel", group: "Models", kind: "string" },
	{ key: "screeningModel", section: "llm", field: "screeningModel", group: "Models", kind: "string" },
	{ key: "generalModel", section: "llm", field: "generalModel", group: "Models", kind: "string" },
	{ key: "strategy", section: "strategy", field: "strategy", group: "Strategy", kind: "enum", values: ENUM_STRATEGY },
	{ key: "binsBelow", section: "strategy", field: "binsBelow", group: "Strategy", kind: "number", min: 0, integer: true },
];

const ENTRY_BY_KEY = new Map(MUTABLE_CONFIG_ENTRIES.map((entry) => [entry.key, entry]));
const ENTRY_BY_KEY_LOWER = new Map(MUTABLE_CONFIG_ENTRIES.map((entry) => [entry.key.toLowerCase(), entry]));

export function listMutableConfigEntries() {
	return MUTABLE_CONFIG_ENTRIES.map((entry) => ({ ...entry }));
}

export function getMutableConfigEntry(key) {
	if (!key) return null;
	return ENTRY_BY_KEY.get(key) || ENTRY_BY_KEY_LOWER.get(String(key).toLowerCase()) || null;
}

export function groupMutableConfigKeys() {
	const grouped = new Map();
	for (const entry of MUTABLE_CONFIG_ENTRIES) {
		if (!grouped.has(entry.group)) grouped.set(entry.group, []);
		grouped.get(entry.group).push(entry.key);
	}
	return grouped;
}

export function formatMutableConfigKeyHelp() {
	const grouped = groupMutableConfigKeys();
	return [...grouped.entries()]
		.map(([group, keys]) => `${group}: ${keys.join(", ")}`)
		.join("\n");
}

function normalizeByKind(entry, value, currentValue = undefined) {
	switch (entry.kind) {
		case "boolean": {
			if (typeof value === "boolean") return { ok: true, value };
			return { ok: false, error: `${entry.key} must be a boolean` };
		}
		case "number": {
			const numeric = Number(value);
			if (!Number.isFinite(numeric)) return { ok: false, error: `${entry.key} must be a finite number` };
			if (entry.integer && !Number.isInteger(numeric)) return { ok: false, error: `${entry.key} must be an integer` };
			if (entry.min != null && numeric < entry.min) return { ok: false, error: `${entry.key} must be >= ${entry.min}` };
			if (entry.max != null && numeric > entry.max) return { ok: false, error: `${entry.key} must be <= ${entry.max}` };
			return { ok: true, value: numeric };
		}
		case "string": {
			if (typeof value !== "string" || value.trim().length === 0) return { ok: false, error: `${entry.key} must be a non-empty string` };
			return { ok: true, value };
		}
		case "enum": {
			if (typeof value !== "string" || !entry.values.includes(value)) {
				return { ok: false, error: `${entry.key} must be one of: ${entry.values.join(", ")}` };
			}
			return { ok: true, value };
		}
		case "optionalNonNegativeNumber": {
			const normalized = normalizeOptionalNonNegativeNumber(value, currentValue ?? null);
			const isNullish = value == null;
			if (!isNullish && normalized === currentValue && value !== currentValue) {
				return { ok: false, error: `${entry.key} must be null or a non-negative number` };
			}
			if (entry.max != null && normalized != null && normalized > entry.max) {
				return { ok: false, error: `${entry.key} must be <= ${entry.max}` };
			}
			return { ok: true, value: normalized };
		}
		default:
			return { ok: true, value };
	}
}

export function normalizeMutableConfigChanges(changes = {}, currentConfig) {
	const normalized = {};
	const unknown = [];
	const errors = [];

	for (const [key, rawValue] of Object.entries(changes || {})) {
		const entry = getMutableConfigEntry(key);
		if (!entry) {
			unknown.push(key);
			continue;
		}
		const currentValue = currentConfig?.[entry.section]?.[entry.field];
		const result = normalizeByKind(entry, rawValue, currentValue);
		if (!result.ok) {
			errors.push(result.error);
			continue;
		}
		normalized[entry.key] = result.value;
	}

	const candidateConfig = currentConfig ? JSON.parse(JSON.stringify(currentConfig)) : {};
	for (const [key, value] of Object.entries(normalized)) {
		const entry = getMutableConfigEntry(key);
		candidateConfig[entry.section] ||= {};
		candidateConfig[entry.section][entry.field] = value;
	}

	const relationErrors = [];
	const screening = candidateConfig.screening || {};
	const management = candidateConfig.management || {};
	const risk = candidateConfig.risk || {};
	const schedule = candidateConfig.schedule || {};
	if (Number.isFinite(screening.minTvl) && Number.isFinite(screening.maxTvl) && screening.maxTvl < screening.minTvl) {
		relationErrors.push("maxTvl must be >= minTvl");
	}
	if (Number.isFinite(screening.minMcap) && Number.isFinite(screening.maxMcap) && screening.maxMcap < screening.minMcap) {
		relationErrors.push("maxMcap must be >= minMcap");
	}
	if (screening.minTokenAgeHours != null && screening.maxTokenAgeHours != null && screening.maxTokenAgeHours < screening.minTokenAgeHours) {
		relationErrors.push("maxTokenAgeHours must be >= minTokenAgeHours");
	}
	if (Number.isFinite(risk.maxDeployAmount) && Number.isFinite(management.deployAmountSol) && risk.maxDeployAmount < management.deployAmountSol) {
		relationErrors.push("maxDeployAmount must be >= deployAmountSol");
	}
	if (Number.isFinite(management.minSolToOpen) && Number.isFinite(management.deployAmountSol) && Number.isFinite(management.gasReserve)) {
		const minimum = management.deployAmountSol + management.gasReserve;
		if (management.minSolToOpen < minimum) {
			relationErrors.push(`minSolToOpen must be >= deployAmountSol + gasReserve (${minimum})`);
		}
	}
	for (const [key, value] of Object.entries({
		managementIntervalMin: schedule.managementIntervalMin,
		screeningIntervalMin: schedule.screeningIntervalMin,
		healthCheckIntervalMin: schedule.healthCheckIntervalMin,
	})) {
		if (value == null) continue;
		if (!(value < 60 || value === 60 || (value < 1440 && value % 60 === 0) || value === 1440)) {
			relationErrors.push(`${key} must be <60 minutes, exactly 60, a whole-hour multiple under 1440, or exactly 1440`);
		}
	}

	return {
		normalized,
		unknown,
		errors: [...errors, ...relationErrors],
	};
}

export function applyMutableConfigValues(targetConfig, values = {}, groups = null) {
	const allowedGroups = groups ? new Set(groups) : null;
	for (const entry of MUTABLE_CONFIG_ENTRIES) {
		if (allowedGroups && !allowedGroups.has(entry.group)) continue;
		if (!Object.hasOwn(values, entry.key)) continue;
		targetConfig[entry.section][entry.field] = values[entry.key];
	}
	return targetConfig;
}
