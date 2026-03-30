import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getCreatorBlacklistFile() {
	return process.env.ZENITH_CREATOR_BLACKLIST_FILE || path.join(__dirname, "creator-blacklist.json");
}

function load() {
	const filePath = getCreatorBlacklistFile();
	if (!fs.existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (error) {
		throw new Error(`Invalid creator blacklist: ${error.message}`);
	}
}

export function isBlacklistedCreator(address) {
	if (!address) return false;
	const db = load();
	return Boolean(db[address]);
}
