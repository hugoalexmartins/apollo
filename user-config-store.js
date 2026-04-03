import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	readJsonSnapshotWithBackupSync,
	writeJsonSnapshotAtomicSync,
} from "./durable-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getUserConfigPath() {
	return process.env.ZENITH_USER_CONFIG_PATH || path.join(__dirname, "user-config.json");
}

function ensureObject(value) {
	if (value == null) return {};
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error("user-config.json must contain a JSON object");
	}
	return value;
}

export function readUserConfigSnapshot({ allowMissing = true } = {}) {
	const userConfigPath = getUserConfigPath();
	const snapshot = readJsonSnapshotWithBackupSync(userConfigPath);
	if (snapshot.value == null) {
		if (!snapshot.error) {
			if (snapshot.source) {
				return {
					ok: false,
					error: `Invalid user config at ${userConfigPath}: user-config.json must contain a JSON object`,
					path: userConfigPath,
					source: snapshot.source,
				};
			}
			if (!allowMissing) {
				return {
					ok: false,
					error: `Missing user config at ${userConfigPath}`,
					path: userConfigPath,
				};
			}
			return {
				ok: true,
				value: {},
				missing: true,
				path: userConfigPath,
				source: null,
			};
		}
		return {
			ok: false,
			error: `Invalid user config at ${userConfigPath}: ${snapshot.error}`,
			path: userConfigPath,
			source: snapshot.source,
		};
	}

	try {
		return {
			ok: true,
			value: ensureObject(snapshot.value),
			missing: false,
			path: userConfigPath,
			source: snapshot.source,
		};
	} catch (error) {
		return {
			ok: false,
			error: `Invalid user config at ${userConfigPath}: ${error.message}`,
			path: userConfigPath,
		};
	}
}

export function writeUserConfigSnapshot(value) {
	const userConfigPath = getUserConfigPath();
	const normalized = ensureObject(value);
	writeJsonSnapshotAtomicSync(userConfigPath, normalized);
	return {
		ok: true,
		path: userConfigPath,
	};
}
