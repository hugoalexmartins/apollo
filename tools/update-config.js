import { config, recomputeManagementDerivedValues } from "../config.js";
import {
	applyMutableConfigValues,
	getMutableConfigEntry,
	normalizeMutableConfigChanges,
} from "../config-registry.js";
import { addLesson } from "../lessons.js";
import { log } from "../logger.js";
import { readUserConfigSnapshot, writeUserConfigSnapshot } from "../user-config-store.js";

export function runUpdateConfig({ changes = {}, reason = "", cronRestarter = null } = {}) {
	const { normalized: applied, unknown, errors } = normalizeMutableConfigChanges(changes, config);

	if (errors.length > 0) {
		log("config", `update_config validation failed — ${errors.join("; ")}`);
		return {
			success: false,
			unknown,
			reason,
			error: errors.join("; "),
			reason_code: "CONFIG_VALIDATION_FAILED",
		};
	}

	if (Object.keys(applied).length === 0) {
		log(
			"config",
			`update_config failed — unknown keys: ${JSON.stringify(unknown)}, raw changes: ${JSON.stringify(changes)}`,
		);
		return { success: false, unknown, reason };
	}

	const snapshot = readUserConfigSnapshot();
	if (!snapshot.ok) {
		log("config", `update_config blocked — ${snapshot.error}`);
		return {
			success: false,
			unknown,
			reason,
			error: snapshot.error,
			reason_code: "USER_CONFIG_INVALID",
		};
	}

	const effectiveApplied = {};
	for (const [key, val] of Object.entries(applied)) {
		const entry = getMutableConfigEntry(key);
		const before = config[entry.section][entry.field];
		if (Object.is(before, val)) continue;
		effectiveApplied[key] = val;
	}

	if (Object.keys(effectiveApplied).length === 0) {
		return { success: true, applied: {}, unknown, reason, noop: true };
	}

	const userConfig = {
		...snapshot.value,
		...effectiveApplied,
		_lastAgentTune: new Date().toISOString(),
	};
	try {
		writeUserConfigSnapshot(userConfig);
	} catch (error) {
		log("config", `update_config persist failed — ${error.message}`);
		return {
			success: false,
			unknown,
			reason,
			error: error.message,
			reason_code: "USER_CONFIG_WRITE_FAILED",
		};
	}

	const beforeConfig = JSON.parse(JSON.stringify(config));
	applyMutableConfigValues(config, effectiveApplied);
	for (const [key, val] of Object.entries(effectiveApplied)) {
		const entry = getMutableConfigEntry(key);
		const before = beforeConfig[entry.section][entry.field];
		log(
			"config",
			`update_config: config.${entry.section}.${entry.field} ${before} → ${val} (verify: ${config[entry.section][entry.field]})`,
		);
	}

	if (
		Object.hasOwn(effectiveApplied, "deployAmountSol") ||
		Object.hasOwn(effectiveApplied, "gasReserve") ||
		Object.hasOwn(effectiveApplied, "minSolToOpen")
	) {
		recomputeManagementDerivedValues({
			minSolToOpen: userConfig.minSolToOpen,
			deployAmountSol: userConfig.deployAmountSol,
			gasReserve: userConfig.gasReserve,
		});
	}

	const intervalChanged =
		Object.hasOwn(effectiveApplied, "managementIntervalMin") ||
		Object.hasOwn(effectiveApplied, "screeningIntervalMin") ||
		Object.hasOwn(effectiveApplied, "healthCheckIntervalMin");
	if (intervalChanged && cronRestarter) {
		cronRestarter();
		log(
			"config",
			`Cron restarted — management: ${config.schedule.managementIntervalMin}m, screening: ${config.schedule.screeningIntervalMin}m, health: ${config.schedule.healthCheckIntervalMin}m`,
		);
	}

	const lessonKeys = Object.keys(effectiveApplied).filter(
		(key) => key !== "managementIntervalMin" && key !== "screeningIntervalMin" && key !== "healthCheckIntervalMin",
	);
	if (lessonKeys.length > 0) {
		const summary = lessonKeys.map((key) => `${key}=${effectiveApplied[key]}`).join(", ");
		addLesson(`[SELF-TUNED] Changed ${summary} — ${reason}`, ["self_tune", "config_change"]);
	}

	log("config", `Agent self-tuned: ${JSON.stringify(effectiveApplied)} — ${reason}`);
	return { success: true, applied: effectiveApplied, unknown, reason };
}
