import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS_BLACKLIST_FILE = process.env.ZENITH_ADDRESS_BLACKLIST_FILE || path.join(__dirname, "address-blacklist.json");

function load() {
	if (!fs.existsSync(ADDRESS_BLACKLIST_FILE)) return {};
	try {
		const parsed = JSON.parse(fs.readFileSync(ADDRESS_BLACKLIST_FILE, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (error) {
		throw new Error(`Invalid address blacklist: ${error.message}`);
	}
}

export function isBlacklistedAddress(address) {
	if (!address) return false;
	const db = load();
	return Boolean(db[address]);
}

export function matchBlacklistedAddresses(candidates = []) {
	const db = load();
	const matches = [];
	const seen = new Set();

	for (const candidate of candidates) {
		const meta = candidate && typeof candidate === "object" ? candidate : { address: candidate };
		const address = typeof meta.address === "string" ? meta.address : null;
		if (!address || !db[address]) continue;
		const dedupeKey = `${address}:${meta.match_type || "address"}:${meta.holder_address || ""}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		matches.push({
			address,
			...db[address],
			...meta,
		});
	}

	return matches;
}
