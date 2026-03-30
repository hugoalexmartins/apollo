import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import {
	ensureMemoryRolloutState,
	getMemoryVersionStatus,
} from "./memory-rollout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_ROOT = process.env.ZENITH_MEMORY_DIR || path.join(__dirname, "data", "nuggets");
const OBSERVATIONAL_DIR = path.join(MEMORY_ROOT, "observational");
const POLICY_DIR = path.join(MEMORY_ROOT, "policy");
const DEFAULT_NUGGETS = ["strategies", "lessons", "patterns", "facts", "wallet_scores", "distribution_stats"];
const PROMPT_MEMORY_NUGGETS = new Set(["strategies", "distribution_stats"]);
const MEMORY_ROLE_TAGS = new Set(["manager", "screener", "general"]);

function matchesRole(fact, role = null) {
	if (!role) return true;
	const normalizedRole = String(role).toLowerCase();
	const factRoles = Array.isArray(fact?.tags)
		? fact.tags
			.filter((tag) => MEMORY_ROLE_TAGS.has(String(tag).toLowerCase()))
			.map((tag) => String(tag).toLowerCase())
		: [];
	return factRoles.length === 0 || factRoles.includes(normalizedRole);
}

let shelfCache = new Map();

function buildInvalidMemoryMessage(errors = []) {
	const details = (Array.isArray(errors) ? errors : [errors]).filter(Boolean).join(" | ");
	return `[INVALID MEMORY STATE] ${details || "unknown memory corruption"}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeKey(str) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 40);
}

function tokenize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function resolvePolicyDir(version) {
	return path.join(POLICY_DIR, version);
}

function resolveStoreDir({ mode = "active", version = null } = {}) {
	if (mode === "observational") return OBSERVATIONAL_DIR;
	const versions = getMemoryVersionStatus();
	const resolvedVersion = version || (mode === "shadow" ? versions.shadow_version : versions.active_version);
	return resolvePolicyDir(resolvedVersion);
}

function nuggetPath(baseDir, name) {
	return path.join(baseDir, `${name}.json`);
}

function loadNugget(baseDir, name) {
  const file = nuggetPath(baseDir, name);
  if (!fs.existsSync(file)) return { name, facts: [], invalid_state: false, error: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      name,
      facts: Array.isArray(parsed.facts) ? parsed.facts.map(normalizeFact).filter(Boolean) : [],
			invalid_state: false,
			error: null,
    };
  } catch (error) {
    return {
			name,
			facts: [],
			invalid_state: true,
			error: `${name}.json: ${error.message}`,
		};
  }
}

function saveNugget(baseDir, nugget) {
	ensureDir(baseDir);
  fs.writeFileSync(nuggetPath(baseDir, nugget.name), JSON.stringify(nugget, null, 2));
}

function normalizeFact(fact) {
  if (!fact || typeof fact !== "object") return null;

  const safeKey = sanitizeKey(fact.key);
  if (!safeKey) return null;

  const now = new Date().toISOString();
  return {
    key: safeKey,
    value: String(fact.value || "").slice(0, 400),
    hits: Number.isFinite(fact.hits) ? fact.hits : 0,
    created_at: fact.created_at || now,
    updated_at: fact.updated_at || fact.created_at || now,
    tags: Array.isArray(fact.tags) ? fact.tags.filter(Boolean).slice(0, 12) : [],
    data: fact.data && typeof fact.data === "object" ? fact.data : null,
  };
}

function createShelf(baseDir, initialErrors = []) {
	const nuggets = new Map();
	const errors = [...initialErrors];
	for (const name of DEFAULT_NUGGETS) {
		const nugget = loadNugget(baseDir, name);
		if (nugget.invalid_state && nugget.error) errors.push(nugget.error);
		nuggets.set(name, nugget);
	}
	return {
		baseDir,
		nuggets,
		invalid_state: errors.length > 0,
		errors,
		getOrCreate(name) {
			if (!this.nuggets.has(name)) {
				const nugget = loadNugget(baseDir, name);
				if (nugget.invalid_state && nugget.error && !this.errors.includes(nugget.error)) {
					this.invalid_state = true;
					this.errors.push(nugget.error);
				}
				this.nuggets.set(name, nugget);
				saveNugget(baseDir, nugget);
			}
			return this.nuggets.get(name);
		},
		get(name) {
			return this.getOrCreate(name);
		},
		list() {
			return [...this.nuggets.keys()].map((name) => ({ name }));
		},
		persist(nugget) {
			if (this.invalid_state) {
				throw new Error(buildInvalidMemoryMessage(this.errors));
			}
			saveNugget(baseDir, nugget);
		},
		get size() {
			return this.nuggets.size;
		},
	};
}

function maybeMigrateLegacyMemory() {
	const versions = ensureMemoryRolloutState();
	if (versions.invalid_state) return;
	const legacyFiles = DEFAULT_NUGGETS
		.map((name) => ({
			name,
			legacyPath: path.join(MEMORY_ROOT, `${name}.json`),
		}))
		.filter((entry) => fs.existsSync(entry.legacyPath));
	if (legacyFiles.length === 0) return;

	ensureDir(OBSERVATIONAL_DIR);
	ensureDir(resolvePolicyDir(versions.active_version));
	ensureDir(resolvePolicyDir(versions.shadow_version));

	for (const entry of legacyFiles) {
		const observationalPath = nuggetPath(OBSERVATIONAL_DIR, entry.name);
		if (!fs.existsSync(observationalPath)) {
			fs.copyFileSync(entry.legacyPath, observationalPath);
		}
		if (PROMPT_MEMORY_NUGGETS.has(entry.name)) {
			const activePolicyPath = nuggetPath(resolvePolicyDir(versions.active_version), entry.name);
			if (!fs.existsSync(activePolicyPath)) {
				fs.copyFileSync(entry.legacyPath, activePolicyPath);
			}
			const shadowPolicyPath = nuggetPath(resolvePolicyDir(versions.shadow_version), entry.name);
			if (!fs.existsSync(shadowPolicyPath)) {
				fs.copyFileSync(entry.legacyPath, shadowPolicyPath);
			}
		}
	}
}

function upsertFact(nuggetName, key, value, options = {}, storeOptions = {}) {
	const store = getShelf(storeOptions);
	if (store.invalid_state) {
		throw new Error(buildInvalidMemoryMessage(store.errors));
	}
	const nugget = store.getOrCreate(nuggetName);
  const safeKey = sanitizeKey(key);
  const factValue = String(value || "").slice(0, 400);
  const now = new Date().toISOString();
  const tags = Array.isArray(options.tags) ? options.tags.filter(Boolean).slice(0, 12) : [];
  const data = options.data && typeof options.data === "object" ? options.data : null;
  const existing = nugget.facts.find((fact) => fact.key === safeKey);

  if (existing) {
    existing.value = factValue;
    existing.updated_at = now;
    existing.hits = Math.max(Number(existing.hits) || 0, 1);
    if (options.tags !== undefined) existing.tags = tags;
    if (options.data !== undefined) existing.data = data;
  } else {
    nugget.facts.push({
      key: safeKey,
      value: factValue,
      hits: 1,
      created_at: now,
      updated_at: now,
      tags,
      data,
		});
  }

	store.persist(nugget);
  return safeKey;
}

function getFactByKey(nuggetName, key, storeOptions = {}) {
	const store = getShelf(storeOptions);
	if (store.invalid_state) {
		return {
			store,
			nugget: { name: nuggetName, facts: [] },
			fact: null,
			error: buildInvalidMemoryMessage(store.errors),
			invalid_state: true,
		};
	}
	const nugget = store.getOrCreate(nuggetName);
  const safeKey = sanitizeKey(key);
  return {
		store,
    nugget,
    fact: nugget.facts.find((entry) => entry.key === safeKey) || null,
  };
}

function round(value, decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getBinStepBucket(binStep) {
  const value = Number(binStep);
  if (!Number.isFinite(value)) return "unknown";
  if (value < 90) return "tight";
  if (value <= 110) return "standard";
  return "wide";
}

export function buildStrategyMemoryKey(strategy, binStep = null) {
  return sanitizeKey(`strategy-${String(strategy || "unknown").toLowerCase()}-${getBinStepBucket(binStep)}`);
}

function buildRoleScopedStrategyMemoryKey(strategy, binStep = null, role = null) {
	const baseKey = buildStrategyMemoryKey(strategy, binStep);
	const normalizedRole = String(role || "").toLowerCase();
	return normalizedRole ? sanitizeKey(`${baseKey}-${normalizedRole}`) : baseKey;
}

function buildLegacyStrategyMemoryKey(strategy, binStep = null) {
  return sanitizeKey(`${String(strategy || "unknown").toLowerCase()}_bs${binStep}`);
}

function scoreFact(fact, query) {
  const rawQuery = String(query || "").toLowerCase();
  const queryTokens = tokenize(query);
  const haystack = `${fact.key} ${fact.value}`.toLowerCase();

  if (!rawQuery || !haystack) return 0;
  if (fact.key.toLowerCase() === rawQuery) return 1;
  if (haystack.includes(rawQuery)) return 0.92;

  const factTokens = new Set(tokenize(haystack));
  const overlap = queryTokens.filter((token) => factTokens.has(token)).length;
  if (!queryTokens.length || overlap === 0) return 0;
  return overlap / queryTokens.length;
}

function recallBest(query, nuggetName = null, role = null, storeOptions = {}) {
	const store = getShelf(storeOptions);
	if (store.invalid_state) {
		return {
			found: false,
			query,
			nugget: nuggetName || null,
			invalid_state: true,
			error: buildInvalidMemoryMessage(store.errors),
		};
	}
  const nuggets = nuggetName
    ? [store.getOrCreate(nuggetName)]
    : [...store.list()].map(({ name }) => store.get(name));

  let best = null;

  for (const nugget of nuggets) {
    for (const fact of nugget.facts) {
			if (!matchesRole(fact, role)) continue;
      const confidence = scoreFact(fact, query);
      if (confidence < 0.34) continue;
      if (!best || confidence > best.confidence) {
        best = { nugget, fact, confidence };
      }
    }
  }

  if (!best) {
    return { found: false, query, nugget: nuggetName || null };
  }

  return {
    found: true,
    nugget: best.nugget.name,
    key: best.fact.key,
    answer: best.fact.value,
    confidence: Math.round(best.confidence * 100) / 100,
    hits: best.fact.hits,
  };
}

export function initMemory() {
	maybeMigrateLegacyMemory();
	shelfCache = new Map();
	const observational = getShelf({ mode: "observational" });
	const active = getShelf({ mode: "active" });
	const shadow = getShelf({ mode: "shadow" });
	const versions = getMemoryVersionStatus();
	log(
		"memory",
		`Memory initialized (observational=${observational.size}, active=${versions.active_version}, shadow=${versions.shadow_version})`,
	);
	return {
		observational,
		active,
		shadow,
		versions,
	};
}

export function getShelf(storeOptions = {}) {
	if (shelfCache.size === 0) {
		maybeMigrateLegacyMemory();
	}
	const mode = storeOptions.mode || "active";
	const versions = getMemoryVersionStatus();
	const initialErrors = [];
	if (mode !== "observational" && versions.invalid_state) {
		initialErrors.push(`memory-rollout: ${versions.error || "invalid rollout state"}`);
	}
	const dir = resolveStoreDir(storeOptions);
	const cacheKey = `${mode}:${dir}`;
	if (!shelfCache.has(cacheKey)) {
		ensureDir(dir);
		shelfCache.set(cacheKey, createShelf(dir, initialErrors));
	}
	return shelfCache.get(cacheKey);
}

function writeStrategyFact(pattern, result, storeTargets = [{ mode: "active" }, { mode: "shadow" }]) {
	const role = typeof pattern === "object" && pattern !== null ? String(pattern.role || "").toLowerCase() : "";
	const tags = MEMORY_ROLE_TAGS.has(role) ? [role] : undefined;
	const keys = typeof pattern === "object" && pattern !== null
		? [
			MEMORY_ROLE_TAGS.has(role)
				? buildRoleScopedStrategyMemoryKey(pattern.strategy, pattern.bin_step, role)
				: buildStrategyMemoryKey(pattern.strategy, pattern.bin_step),
		]
		: [sanitizeKey(pattern)];
	for (const target of storeTargets) {
		for (const key of keys) {
			upsertFact("strategies", key, typeof result === "string" ? result : JSON.stringify(result), { tags }, target);
		}
	}
	log("memory", `Remembered strategy: ${keys.join(",")}`);
	return keys[0];
}

export function rememberStrategy(pattern, result) {
	writeStrategyFact(pattern, result, [{ mode: "active" }, { mode: "shadow" }]);
}

export function rememberObservedStrategy(pattern, result) {
	writeStrategyFact(pattern, result, [{ mode: "observational" }, { mode: "shadow" }]);
}

export function recallForScreening(poolData, storeOptions = { mode: "active" }) {
	const store = getShelf(storeOptions);
	if (store.invalid_state) {
		return [{
			source: "memory_invalid",
			key: "invalid_memory_state",
			answer: buildInvalidMemoryMessage(store.errors),
			confidence: 0,
			invalid_state: true,
		}];
	}
  const results = [];

  if (poolData?.bin_step) {
    for (const strategy of ["bid_ask", "spot"]) {
      const keysToTry = [
				buildRoleScopedStrategyMemoryKey(strategy, poolData.bin_step, "SCREENER"),
        buildStrategyMemoryKey(strategy, poolData.bin_step),
        buildLegacyStrategyMemoryKey(strategy, poolData.bin_step),
      ];

		for (const key of keysToTry) {
				const hit = recallBest(key, "strategies", "SCREENER", storeOptions);
        if (hit.found && !results.some((result) => result.key === hit.key)) {
          results.push({ source: "strategies", ...hit });
          break;
        }
      }
    }
  }

  return results.slice(0, 2);
}

export function recallForManagement(position, storeOptions = { mode: "active" }) {
	const store = getShelf(storeOptions);
	if (store.invalid_state) {
		return [{
			source: "memory_invalid",
			key: "invalid_memory_state",
			answer: buildInvalidMemoryMessage(store.errors),
			confidence: 0,
			invalid_state: true,
		}];
	}
  const results = [];

  if (position?.strategy && position?.bin_step != null) {
    const keysToTry = [
			buildRoleScopedStrategyMemoryKey(position.strategy, position.bin_step, "MANAGER"),
      buildStrategyMemoryKey(position.strategy, position.bin_step),
      buildLegacyStrategyMemoryKey(position.strategy, position.bin_step),
    ];
		for (const key of keysToTry) {
			const hit = recallBest(key, "strategies", "MANAGER", storeOptions);
      if (hit.found) {
        results.push({ source: "strategies", ...hit });
        break;
      }
    }
	}

	const lessonHit = recallBest("management", "lessons", "MANAGER", storeOptions);
  if (lessonHit.found) results.push({ source: "lessons", ...lessonHit });

  return results;
}

export function getMemoryContext(agentType = "GENERAL", storeOptions = { mode: "active" }) {
	const store = getShelf(storeOptions);
	if (store.invalid_state) {
		return buildInvalidMemoryMessage(store.errors);
	}
  const facts = [];
	const normalizedRole = String(agentType || "GENERAL").toLowerCase();

	for (const { name } of store.list()) {
		if (!PROMPT_MEMORY_NUGGETS.has(name)) continue;
		const nugget = store.get(name);
    for (const fact of nugget.facts) {
      if ((fact.hits || 0) < 1) continue;
			if (!matchesRole(fact, normalizedRole)) continue;
      facts.push({
        nugget: name,
        key: fact.key,
        value: fact.value,
        hits: fact.hits || 0,
        updated_at: fact.updated_at || fact.created_at || "",
      });
    }
  }

  const lines = facts
    .sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return String(b.updated_at).localeCompare(String(a.updated_at));
    })
    .slice(0, 6)
    .map((fact) => `[${fact.nugget}] ${fact.key}: ${fact.value}`);

  return lines.length ? lines.join("\n") : null;
}

export function rememberFact(nuggetOrPayload, keyArg, valueArg) {
  const payload = typeof nuggetOrPayload === "object" && nuggetOrPayload !== null
    ? {
        nugget: nuggetOrPayload.nugget ?? nuggetOrPayload.topic ?? "facts",
        key: nuggetOrPayload.key,
        value: nuggetOrPayload.value,
        data: nuggetOrPayload.data,
        tags: nuggetOrPayload.tags,
      }
    : {
        nugget: nuggetOrPayload,
        key: keyArg,
        value: valueArg,
        data: null,
        tags: null,
      };

  if (!payload.key) {
    return { saved: false, error: "key required" };
  }

	const nuggetName = payload.nugget || "facts";
  const safeKey = upsertFact(nuggetName, payload.key, payload.value, {
    data: payload.data,
    tags: payload.tags,
	}, { mode: "observational" });
  log("memory", `Stored fact in ${nuggetName}: ${safeKey}`);
  return { saved: true, nugget: nuggetName, key: safeKey };
}

export function recallMemory(query, nuggetName) {
	const result = recallBest(query, nuggetName || null, "GENERAL", { mode: "observational" });
	if (!result.found) {
		const activeResult = recallBest(query, nuggetName || null, "GENERAL", { mode: "active" });
		log("memory", `Recall "${query}" -> ${activeResult.found ? activeResult.answer : "not found"}`);
		return activeResult;
	}
  log("memory", `Recall "${query}" -> ${result.found ? result.answer : "not found"}`);
  return result;
}

export function rememberWalletScores({ pool_address, pool_name = null, scored_wallets = [], scoring = {}, metadata = {} }) {
  if (!pool_address) return { saved: false, error: "pool_address required" };
  if (!Array.isArray(scored_wallets) || scored_wallets.length === 0) {
    return { saved: false, error: "scored_wallets required" };
  }

  const topWallets = scored_wallets.slice(0, 10).map((wallet) => ({
    owner: wallet.owner,
    short_owner: wallet.short_owner,
    total_score: round(wallet.score_breakdown?.total_score, 2),
    base_score: round(wallet.score_breakdown?.base_score, 2),
    dune_bonus_points: round(wallet.score_breakdown?.dune_bonus_points || 0, 2),
    metrics: wallet.metrics || {},
    score_breakdown: wallet.score_breakdown || {},
    dune_enrichment: wallet.dune_enrichment || { status: "not_attempted" },
    sampled_positions: wallet.sampled_positions || [],
  }));

  const summary = `Wallet scores for ${pool_name || pool_address.slice(0, 8)}: ${topWallets
    .slice(0, 3)
    .map((wallet) => `${wallet.short_owner || wallet.owner?.slice(0, 8)} ${wallet.total_score}`)
    .join(", ")}`;

	const safeKey = upsertFact("wallet_scores", `wallet-score-${pool_address}`, summary, {
    tags: ["wallet_scoring", "lpagent", scoring?.dune?.enabled ? "dune_enriched" : "lpagent_only"],
    data: {
      pool_address,
      pool_name,
      scored_at: new Date().toISOString(),
      scored_wallet_count: topWallets.length,
      scoring,
      metadata,
      scored_wallets: topWallets,
    },
	}, { mode: "observational" });

  log("memory", `Stored wallet scores for ${pool_address.slice(0, 8)} in ${safeKey}`);
  return { saved: true, nugget: "wallet_scores", key: safeKey, scored_wallet_count: topWallets.length };
}

export function getWalletScoreMemory(poolAddress) {
  if (!poolAddress) return { found: false, error: "poolAddress required" };

	const { store, nugget, fact, error, invalid_state } = getFactByKey("wallet_scores", `wallet-score-${poolAddress}`, { mode: "observational" });
	if (invalid_state) {
		return { found: false, pool_address: poolAddress, invalid_state: true, error };
	}
  if (!fact) {
    return { found: false, pool_address: poolAddress };
  }

  fact.hits = (fact.hits || 0) + 1;
  fact.updated_at = new Date().toISOString();
	store.persist(nugget);

  return {
    found: true,
    pool_address: poolAddress,
    scored_at: fact.data?.scored_at || fact.updated_at,
    age_minutes: fact.data?.scored_at
      ? Math.max(0, Math.round((Date.now() - new Date(fact.data.scored_at).getTime()) / 60000))
      : null,
    scoring: fact.data?.scoring || {},
    metadata: fact.data?.metadata || {},
    scored_wallets: fact.data?.scored_wallets || [],
	};
}

function rememberDistributionInternal({
  distribution_key,
  strategy = null,
  pool_address = null,
  pool_name = null,
  pnl_pct = null,
  fee_yield_pct = null,
  minutes_held = null,
  success = null,
  role = null,
}, storeOptions = [{ mode: "active" }, { mode: "shadow" }]) {
  if (!distribution_key) return { saved: false, error: "distribution_key required" };
	let finalTotalClosed = null;

	for (const storeTarget of storeOptions) {
		const { store, nugget, fact } = getFactByKey("distribution_stats", `distribution-${distribution_key}`, storeTarget);
		const existing = fact?.data && typeof fact.data === "object"
			? fact.data
			: {
				distribution_key,
				total_closed: 0,
				wins: 0,
				losses: 0,
				avg_pnl_pct: 0,
				avg_fee_yield_pct: 0,
				avg_minutes_held: 0,
				last_recorded_at: null,
				by_strategy: {},
				recent_pools: [],
			};

		const next = {
			...existing,
			total_closed: (existing.total_closed || 0) + 1,
			wins: (existing.wins || 0) + (success ? 1 : 0),
			losses: (existing.losses || 0) + (success === false ? 1 : 0),
			last_recorded_at: new Date().toISOString(),
		};

		const total = next.total_closed;
		const currentAvgPnl = Number(existing.avg_pnl_pct || 0);
		const currentAvgFeeYield = Number(existing.avg_fee_yield_pct || 0);
		const currentAvgMinutesHeld = Number(existing.avg_minutes_held || 0);

		if (typeof pnl_pct === "number" && Number.isFinite(pnl_pct)) {
			next.avg_pnl_pct = round(((currentAvgPnl * (total - 1)) + pnl_pct) / total, 2);
		}
		if (typeof fee_yield_pct === "number" && Number.isFinite(fee_yield_pct)) {
			next.avg_fee_yield_pct = round(((currentAvgFeeYield * (total - 1)) + fee_yield_pct) / total, 2);
		}
		if (typeof minutes_held === "number" && Number.isFinite(minutes_held)) {
			next.avg_minutes_held = round(((currentAvgMinutesHeld * (total - 1)) + minutes_held) / total, 2);
		}

		const strategyKey = strategy || "unknown";
		const existingStrategy = next.by_strategy[strategyKey] || {
			total_closed: 0,
			wins: 0,
			losses: 0,
			avg_pnl_pct: 0,
		};
		const strategyTotal = existingStrategy.total_closed + 1;
		next.by_strategy = {
			...next.by_strategy,
			[strategyKey]: {
				total_closed: strategyTotal,
				wins: existingStrategy.wins + (success ? 1 : 0),
				losses: existingStrategy.losses + (success === false ? 1 : 0),
				avg_pnl_pct: typeof pnl_pct === "number" && Number.isFinite(pnl_pct)
					? round(((existingStrategy.avg_pnl_pct || 0) * existingStrategy.total_closed + pnl_pct) / strategyTotal, 2)
					: existingStrategy.avg_pnl_pct,
			},
		};

		if (pool_address || pool_name) {
			const recentPools = Array.isArray(next.recent_pools) ? next.recent_pools : [];
			recentPools.push({
				pool_address,
				pool_name,
				pnl_pct: round(pnl_pct, 2),
				success: success === true,
				recorded_at: next.last_recorded_at,
			});
			next.recent_pools = recentPools.slice(-8);
		}

		next.win_rate_pct = total > 0 ? round((next.wins / total) * 100, 2) : null;
		finalTotalClosed = next.total_closed;

		const summary = `${distribution_key}: ${next.win_rate_pct}% win rate across ${next.total_closed} closed positions, avg PnL ${next.avg_pnl_pct}%`;
		const tags = [
			"distribution_success",
			strategyKey,
			...(MEMORY_ROLE_TAGS.has(String(role || "").toLowerCase()) ? [String(role).toLowerCase()] : []),
		];

		if (fact) {
			fact.value = summary;
			fact.tags = tags;
			fact.data = next;
			fact.updated_at = next.last_recorded_at;
		} else {
			nugget.facts.push({
				key: sanitizeKey(`distribution-${distribution_key}`),
				value: summary,
				hits: 0,
				created_at: next.last_recorded_at,
				updated_at: next.last_recorded_at,
				tags,
				data: next,
			});
		}

		store.persist(nugget);
	}

	log("memory", `Stored distribution stats for ${distribution_key}: ${finalTotalClosed} total closes`);
	return { saved: true, nugget: "distribution_stats", distribution_key, total_closed: finalTotalClosed };
}

export function rememberTokenTypeDistribution(payload) {
	return rememberDistributionInternal(payload, [{ mode: "active" }, { mode: "shadow" }]);
}

export function rememberObservedTokenTypeDistribution(payload) {
	return rememberDistributionInternal(payload, [{ mode: "observational" }, { mode: "shadow" }]);
}

export function getTokenTypeDistributionMemory(distributionKey = null, storeOptions = { mode: "active" }) {
	const store = getShelf(storeOptions);
	if (store.invalid_state) {
		return {
			total: 0,
			distributions: [],
			invalid_state: true,
			error: buildInvalidMemoryMessage(store.errors),
		};
	}
	const nugget = store.getOrCreate("distribution_stats");
  const facts = distributionKey
    ? nugget.facts.filter((fact) => fact.data?.distribution_key === distributionKey)
    : nugget.facts;

  return {
    total: facts.length,
    distributions: facts.map((fact) => ({
      distribution_key: fact.data?.distribution_key || fact.key,
      summary: fact.value,
		stats: fact.data || null,
		})),
	};
}

export { getMemoryVersionStatus };
