import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
	if (!fs.existsSync(userConfigPath)) {
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
		};
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(userConfigPath, "utf8"));
		return {
			ok: true,
			value: ensureObject(parsed),
			missing: false,
			path: userConfigPath,
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
	fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
	fs.writeFileSync(userConfigPath, JSON.stringify(normalized, null, 2));
	return {
		ok: true,
		path: userConfigPath,
	};
}
