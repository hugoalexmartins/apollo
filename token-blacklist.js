/**
 * Token blacklist — mints the agent should never deploy into.
 *
 * Agent can blacklist via Telegram ("blacklist this token, it rugged").
 * Screening filters blacklisted tokens before passing pools to the LLM.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getBlacklistFile() {
	return (
		process.env.ZENITH_TOKEN_BLACKLIST_FILE ||
		path.join(__dirname, "token-blacklist.json")
	);
}

function load() {
	const filePath = getBlacklistFile();
	if (!fs.existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (error) {
		throw new Error(`Invalid token blacklist: ${error.message}`);
	}
}

function save(data) {
	const filePath = getBlacklistFile();
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Check ─────────────────────────────────────────────────────

/**
 * Returns true if the mint is on the blacklist.
 * Used in screening.js before returning pools to the LLM.
 */
export function isBlacklisted(mint) {
	if (!mint) return false;
	try {
		const db = load();
		return !!db[mint];
	} catch (error) {
		log(
			"blacklist_warn",
			`Token blacklist unreadable, failing closed for mint ${mint}: ${error.message}`,
		);
		return true;
	}
}

// ─── Tool Handlers ─────────────────────────────────────────────

/**
 * Tool handler: add_to_blacklist
 */
export function addToBlacklist({ mint, symbol, reason }) {
	if (!mint) return { error: "mint required" };
	try {
		const db = load();

		if (db[mint]) {
			return {
				already_blacklisted: true,
				mint,
				symbol: db[mint].symbol,
				reason: db[mint].reason,
			};
		}

		db[mint] = {
			symbol: symbol || "UNKNOWN",
			reason: reason || "no reason provided",
			added_at: new Date().toISOString(),
			added_by: "agent",
		};

		save(db);
		log("blacklist", `Blacklisted ${symbol || mint}: ${reason}`);
		return { blacklisted: true, mint, symbol, reason };
	} catch (error) {
		return { error: error.message };
	}
}

/**
 * Tool handler: remove_from_blacklist
 */
export function removeFromBlacklist({ mint }) {
	if (!mint) return { error: "mint required" };
	try {
		const db = load();

		if (!db[mint]) {
			return { error: `Mint ${mint} not found on blacklist` };
		}

		const entry = db[mint];
		delete db[mint];
		save(db);
		log("blacklist", `Removed ${entry.symbol || mint} from blacklist`);
		return { removed: true, mint, was: entry };
	} catch (error) {
		return { error: error.message };
	}
}

/**
 * Tool handler: list_blacklist
 */
export function listBlacklist() {
	try {
		const db = load();
		const entries = Object.entries(db).map(([mint, info]) => ({
			mint,
			...info,
		}));

		return {
			count: entries.length,
			blacklist: entries,
		};
	} catch (error) {
		return { error: error.message };
	}
}
