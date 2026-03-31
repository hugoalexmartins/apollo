/**
 * Strategy Library — persistent store of LP strategies.
 *
 * Users paste a tweet or description via Telegram.
 * The agent extracts structured criteria and saves it here.
 * During screening, the active strategy's criteria guide token selection and position config.
 */

import {
	readJsonSnapshotWithBackupSync,
	writeJsonSnapshotAtomicSync,
} from "./durable-store.js";
import { log } from "./logger.js";

const STRATEGY_FILE = "./strategy-library.json";

export const AUTONOMOUS_STRATEGY_PRESETS = {
	bid_ask_default: {
		id: "bid_ask_default",
		name: "Bid-Ask Default",
		author: "Zenith",
		lp_strategy: "bid_ask",
		token_criteria: {
			min_organic_score: 60,
			min_fee_tvl_ratio: 0.05,
			min_tvl: 10_000,
			max_tvl: 150_000,
			min_volume_5m: 500,
			min_holders: 500,
			min_mcap: 150_000,
			max_mcap: 10_000_000,
			min_bin_step: 80,
			max_bin_step: 125,
		},
		entry: {
			condition:
				"Activate when no stronger spot preset qualifies, or when volatility or price expansion calls for the safer fallback.",
			single_side: "sol",
		},
		range: {
			type: "wide",
			bins_below: 69,
			bins_above: 0,
			notes:
				"Single-sided SOL, 69 bins below active bin for the safer autonomous baseline.",
		},
		exit: {
			take_profit_pct: 5,
			notes:
				"Use existing runtime exits; this preset only changes deploy shape and activation.",
		},
		best_for:
			"Default autonomous deploys, hotter pools, or any finalist that does not clear the stronger spot presets.",
		activation: {
			mode: "fallback_or_hot_market",
			high_volatility_threshold: 9,
			high_price_change_pct: 12,
		},
	},
	quality_spot: {
		id: "quality_spot",
		name: "Quality Spot",
		author: "Zenith",
		lp_strategy: "spot",
		token_criteria: {
			min_organic_score: 80,
			min_fee_tvl_ratio: 0.04,
			min_holders: 1000,
		},
		entry: {
			condition:
				"Activate when top LP wallets show >=80% win rate and the pool stays high-quality and non-euphoric.",
			single_side: "sol",
		},
		range: {
			type: "balanced",
			bins_below: 18,
			bins_above: 18,
			notes:
				"Symmetric spot floor that can widen with planner bins for higher-quality range-bound pools.",
		},
		exit: {
			take_profit_pct: 5,
			notes:
				"Use existing runtime exits; this preset only changes deploy shape and activation.",
		},
		best_for:
			"High-quality pools with strong top-LP proof, calm price action, and enough holder depth.",
		activation: {
			mode: "top_lper_quality_gate",
			min_top_lper_win_rate_pct: 80,
			max_abs_price_change_pct: 8,
			max_volatility: 8,
		},
	},
	yield_spot_wide: {
		id: "yield_spot_wide",
		name: "Yield Spot Wide",
		author: "Zenith",
		lp_strategy: "spot",
		token_criteria: {
			min_organic_score: 72,
			min_fee_tvl_ratio: 0.08,
		},
		entry: {
			condition:
				"Activate when fee efficiency is strong, volatility is calm, and price action looks range-bound.",
			single_side: "sol",
		},
		range: {
			type: "wide",
			bins_below: 36,
			bins_above: 36,
			notes:
				"Wider symmetric spot floor for calm pools with strong fee/TVL but weaker wallet proof than Quality Spot.",
		},
		exit: {
			take_profit_pct: 5,
			notes:
				"Use existing runtime exits; this preset only changes deploy shape and activation.",
		},
		best_for:
			"Calm, fee-efficient pools where spot exposure makes sense even without elite top-LP confirmation.",
		activation: {
			mode: "fee_efficiency_gate",
			min_fee_tvl_ratio: 0.08,
			max_abs_price_change_pct: 6,
			max_volatility: 4,
		},
	},
};

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function asFiniteNumber(value, fallback = null) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function getTopLperWinRatePct(scoredLpers = null) {
	return asFiniteNumber(
		scoredLpers?.candidates?.[0]?.metrics?.win_rate_pct,
		null,
	);
}

function normalizeDepositSide(singleSide) {
	const value = String(singleSide || "").trim().toLowerCase();
	if (["sol", "quote", "single_sided_sol", "single-sided-sol"].includes(value)) {
		return { deposit_sidedness: "single_sided", deposit_asset: "sol" };
	}
	if (["token", "base", "single_sided_token", "single-sided-token"].includes(value)) {
		return { deposit_sidedness: "single_sided", deposit_asset: "token" };
	}
	if (["dual", "two_sided", "two-sided", "dual_sided", "both"].includes(value)) {
		return { deposit_sidedness: "two_sided", deposit_asset: "sol_and_token" };
	}
	return { deposit_sidedness: null, deposit_asset: null };
}

function formatDepositAssetLabel(depositAsset) {
	if (depositAsset === "sol_and_token") return "sol+token";
	if (depositAsset === "sol") return "sol";
	if (depositAsset === "token") return "token";
	return "deposit";
}

export function resolveDeploySemantics({
	strategy,
	bins_below = 0,
	bins_above = 0,
	single_side = null,
	amount_x = null,
	amount_y = null,
} = {}) {
	const normalizedStrategy = String(strategy || "bid_ask").trim().toLowerCase() || "bid_ask";
	const amountX = asFiniteNumber(amount_x, null);
	const amountY = asFiniteNumber(amount_y, null);
	const hasTokenLeg = amountX != null ? amountX > 0 : false;
	const hasSolLeg = amountY != null ? amountY > 0 : false;

	let deposit = { deposit_sidedness: null, deposit_asset: null };
	if (hasTokenLeg && hasSolLeg) {
		deposit = { deposit_sidedness: "two_sided", deposit_asset: "sol_and_token" };
	} else if (hasSolLeg) {
		deposit = { deposit_sidedness: "single_sided", deposit_asset: "sol" };
	} else if (hasTokenLeg) {
		deposit = { deposit_sidedness: "single_sided", deposit_asset: "token" };
	} else {
		deposit = normalizeDepositSide(single_side);
	}

	const below = asFiniteNumber(bins_below, 0) ?? 0;
	const above = asFiniteNumber(bins_above, 0) ?? 0;
	let range_shape = "active_bin_only";
	if (below > 0 && above > 0) range_shape = "two_sided_range";
	else if (below > 0) range_shape = "downside_only_range";
	else if (above > 0) range_shape = "upside_only_range";

	let spot_subtype = null;
	if (normalizedStrategy === "spot") {
		if (deposit.deposit_sidedness === "two_sided") {
			spot_subtype = "spot_two_sided";
		} else if (deposit.deposit_asset === "sol") {
			spot_subtype = "spot_single_sided_sol";
		} else if (deposit.deposit_asset === "token") {
			spot_subtype = "spot_single_sided_token";
		} else {
			spot_subtype = "spot_unspecified";
		}
	}

	const strategy_semantics_label = [
		spot_subtype || normalizedStrategy,
		deposit.deposit_sidedness
			? `${deposit.deposit_sidedness.replaceAll("_", "-")} ${formatDepositAssetLabel(deposit.deposit_asset)}`
			: "deposit unspecified",
		range_shape.replaceAll("_", "-"),
	].join(" / ");

	return {
		strategy: normalizedStrategy,
		deposit_sidedness: deposit.deposit_sidedness || "unspecified",
		deposit_asset: deposit.deposit_asset || "unknown",
		range_shape,
		spot_subtype,
		strategy_semantics_label,
	};
}

export function resolveAutonomousStrategyPreset({
	pool = {},
	distributionPlan = null,
	scoredLpers = null,
} = {}) {
	const plannerStrategy = String(distributionPlan?.strategy || "bid_ask")
		.trim()
		.toLowerCase();
	const volatility =
		asFiniteNumber(pool.six_hour_volatility ?? pool.volatility, 0) ?? 0;
	const feeTvlRatio =
		asFiniteNumber(pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio, 0) ?? 0;
	const organicScore = asFiniteNumber(pool.organic_score, 0) ?? 0;
	const holders = asFiniteNumber(pool.holders, 0) ?? 0;
	const absPriceChangePct = Math.abs(
		asFiniteNumber(pool.price_change_pct, 0) ?? 0,
	);
	const topLperWinRatePct = getTopLperWinRatePct(scoredLpers);

	if (
		plannerStrategy === "spot" &&
		topLperWinRatePct != null &&
		topLperWinRatePct >= 80 &&
		organicScore >= 80 &&
		holders >= 1000 &&
		feeTvlRatio >= 0.04 &&
		absPriceChangePct <= 8 &&
		volatility <= 8
	) {
		return {
			...clone(AUTONOMOUS_STRATEGY_PRESETS.quality_spot),
			activation_summary: `top LP win rate ${topLperWinRatePct.toFixed(1)}% with calm, high-quality pool context`,
		};
	}

	if (
		plannerStrategy === "spot" &&
		feeTvlRatio >= 0.08 &&
		organicScore >= 72 &&
		absPriceChangePct <= 6 &&
		volatility <= 4
	) {
		return {
			...clone(AUTONOMOUS_STRATEGY_PRESETS.yield_spot_wide),
			activation_summary: `fee/TVL ${feeTvlRatio.toFixed(3)} with calm market conditions`,
		};
	}

	const fallbackReason =
		volatility >= 9 || absPriceChangePct >= 12
			? `fallback bid_ask for hot market conditions (volatility ${volatility.toFixed(2)}, price change ${absPriceChangePct.toFixed(2)}%)`
			: "fallback bid_ask because no stronger spot preset qualified";
	return {
		...clone(AUTONOMOUS_STRATEGY_PRESETS.bid_ask_default),
		activation_summary: fallbackReason,
	};
}

function load() {
	const snapshot = readJsonSnapshotWithBackupSync(STRATEGY_FILE);
	if (!snapshot.value) {
		if (!snapshot.error) return { active: null, strategies: {} };
		log("strategy_warn", `Failed to read strategy library: ${snapshot.error}`);
		return {
			active: null,
			strategies: {},
			_invalid_state: true,
			_error: snapshot.error,
		};
	}
	if (
		typeof snapshot.value !== "object"
		|| snapshot.value == null
		|| Array.isArray(snapshot.value)
		|| (snapshot.value.strategies != null
			&& (typeof snapshot.value.strategies !== "object" || Array.isArray(snapshot.value.strategies)))
	) {
		const error = "strategy-library.json has invalid shape";
		log("strategy_warn", error);
		return {
			active: null,
			strategies: {},
			_invalid_state: true,
			_error: error,
		};
	}
	return {
		active: snapshot.value.active || null,
		strategies: snapshot.value.strategies || {},
		_loaded_from_backup: snapshot.source === "backup",
	};
}

function save(data) {
	writeJsonSnapshotAtomicSync(STRATEGY_FILE, {
		active: data.active || null,
		strategies: data.strategies || {},
	});
}

function isReviewCandidate(strategy = null) {
	return Boolean(
		strategy
		&& (strategy.status === "candidate" || strategy.auto_activate === false),
	);
}

function resolveFirstActivatableStrategyId(strategies = {}) {
	for (const [id, strategy] of Object.entries(strategies || {})) {
		if (!isReviewCandidate(strategy)) return id;
	}
	return null;
}

export function upsertAutoDerivedStrategyCandidate({
	id,
	name,
	lp_strategy = "bid_ask",
	token_criteria = {},
	entry = {},
	range = {},
	exit = {},
	best_for = "",
	evidence = {},
	raw = "",
} = {}) {
	if (!id || !name) return { error: "id and name are required" };

	const db = load();
	if (db._invalid_state) {
		return {
			blocked: true,
			reason_code: "STRATEGY_LIBRARY_INVALID",
			error: db._error,
		};
	}
	const slug = id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
	const previous = db.strategies[slug] || null;
	const now = new Date().toISOString();

	db.strategies[slug] = {
		...(previous || {}),
		id: slug,
		name,
		author: "Zenith Auto",
		lp_strategy,
		token_criteria: {
			informational_only: true,
			...token_criteria,
		},
		entry,
		range,
		exit,
		best_for,
		raw,
		auto_derived: true,
		source: "auto_derived",
		status: "candidate",
		auto_activate: false,
		evidence,
		added_at: previous?.added_at || now,
		updated_at: now,
	};

	save(db);
	log("strategy", `Auto-derived strategy candidate saved: ${name} (${slug})`);
	return {
		saved: true,
		id: slug,
		name,
		active: db.active === slug,
		status: db.strategies[slug].status,
		source: db.strategies[slug].source,
	};
}

// ─── Tool Handlers ─────────────────────────────────────────────

/**
 * Add or update a strategy.
 * The agent parses the raw tweet/text and fills in the structured fields.
 */
export function addStrategy({
	id,
	name,
	author = "unknown",
	lp_strategy = "bid_ask", // "bid_ask" | "spot" | "curve"
	token_criteria = {}, // { min_mcap, min_age_days, requires_kol, notes }
	entry = {}, // { condition, price_change_threshold_pct, single_side }
	range = {}, // { type, bins_below_pct, notes }
	exit = {}, // { take_profit_pct, notes }
	best_for = "", // short description of ideal conditions
	raw = "", // original tweet/text
}) {
	if (!id || !name) return { error: "id and name are required" };

	const db = load();
	if (db._invalid_state) {
		return {
			blocked: true,
			reason_code: "STRATEGY_LIBRARY_INVALID",
			error: db._error,
		};
	}

	// Slugify id
	const slug = id
		.toLowerCase()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "");

	db.strategies[slug] = {
		id: slug,
		name,
		author,
		lp_strategy,
		token_criteria,
		entry,
		range,
		exit,
		best_for,
		raw,
		added_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};

	// Auto-set as active if it's the first strategy
	if (!db.active) db.active = slug;

	save(db);
	log("strategy", `Strategy saved: ${name} (${slug})`);
	return { saved: true, id: slug, name, active: db.active === slug };
}

/**
 * List all strategies with a summary.
 */
export function listStrategies() {
	const db = load();
	if (db._invalid_state) {
		return {
			active: null,
			count: 0,
			strategies: [],
			invalid_state: true,
			error: db._error,
		};
	}
	const strategies = Object.values(db.strategies).map((s) => ({
		id: s.id,
		name: s.name,
		author: s.author,
		lp_strategy: s.lp_strategy,
		best_for: s.best_for,
		source: s.source || "manual",
		status: s.status || "active_candidate",
		active: db.active === s.id,
		added_at: s.added_at?.slice(0, 10),
	}));
	return { active: db.active, count: strategies.length, strategies };
}

/**
 * Get full details of a strategy including raw text and all criteria.
 */
export function getStrategy({ id }) {
	if (!id) return { error: "id required" };
	const db = load();
	if (db._invalid_state) {
		return {
			blocked: true,
			reason_code: "STRATEGY_LIBRARY_INVALID",
			error: db._error,
		};
	}
	const strategy = db.strategies[id];
	if (!strategy)
		return {
			error: `Strategy "${id}" not found`,
			available: Object.keys(db.strategies),
		};
	return { ...strategy, is_active: db.active === id };
}

/**
 * Set the active strategy used during screening cycles.
 */
export function setActiveStrategy({ id }) {
	if (!id) return { error: "id required" };
	const db = load();
	if (db._invalid_state) {
		return {
			blocked: true,
			reason_code: "STRATEGY_LIBRARY_INVALID",
			error: db._error,
		};
	}
	if (!db.strategies[id])
		return {
			error: `Strategy "${id}" not found`,
			available: Object.keys(db.strategies),
		};
	if (db.strategies[id].status === "candidate" || db.strategies[id].auto_activate === false) {
		return {
			blocked: true,
			reason_code: "STRATEGY_CANDIDATE_REVIEW_REQUIRED",
			error: `Strategy "${id}" is an inactive review candidate and cannot be activated directly.`,
		};
	}
	db.active = id;
	save(db);
	log("strategy", `Active strategy set to: ${db.strategies[id].name}`);
	return { active: id, name: db.strategies[id].name };
}

/**
 * Remove a strategy.
 */
export function removeStrategy({ id }) {
	if (!id) return { error: "id required" };
	const db = load();
	if (db._invalid_state) {
		return {
			blocked: true,
			reason_code: "STRATEGY_LIBRARY_INVALID",
			error: db._error,
		};
	}
	if (!db.strategies[id]) return { error: `Strategy "${id}" not found` };
	const name = db.strategies[id].name;
	delete db.strategies[id];
	if (db.active === id) db.active = resolveFirstActivatableStrategyId(db.strategies);
	save(db);
	log("strategy", `Strategy removed: ${name}`);
	return { removed: true, id, name, new_active: db.active };
}

/**
 * Get the currently active strategy — used by screening cycle.
 */
export function getActiveStrategy() {
	const db = load();
	if (db._invalid_state) return null;
	if (!db.active || !db.strategies[db.active]) return null;
	const activeStrategy = db.strategies[db.active];
	if (isReviewCandidate(activeStrategy)) return null;
	return activeStrategy;
}
