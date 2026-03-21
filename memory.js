import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = path.join(__dirname, "data", "nuggets");
const DEFAULT_NUGGETS = ["strategies", "lessons", "patterns", "facts"];

let shelf = null;

function ensureDir() {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
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

function nuggetPath(name) {
  return path.join(SAVE_DIR, `${name}.json`);
}

function loadNugget(name) {
  const file = nuggetPath(name);
  if (!fs.existsSync(file)) return { name, facts: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      name,
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
    };
  } catch {
    return { name, facts: [] };
  }
}

function saveNugget(nugget) {
  ensureDir();
  fs.writeFileSync(nuggetPath(nugget.name), JSON.stringify(nugget, null, 2));
}

function upsertFact(nuggetName, key, value) {
  const store = getShelf();
  const nugget = store.getOrCreate(nuggetName);
  const safeKey = sanitizeKey(key);
  const factValue = String(value || "").slice(0, 400);
  const now = new Date().toISOString();
  const existing = nugget.facts.find((fact) => fact.key === safeKey);

  if (existing) {
    existing.value = factValue;
    existing.updated_at = now;
  } else {
    nugget.facts.push({
      key: safeKey,
      value: factValue,
      hits: 0,
      created_at: now,
      updated_at: now,
    });
  }

  saveNugget(nugget);
  return safeKey;
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

function recallBest(query, nuggetName = null) {
  const store = getShelf();
  const nuggets = nuggetName
    ? [store.getOrCreate(nuggetName)]
    : [...store.list()].map(({ name }) => store.get(name));

  let best = null;

  for (const nugget of nuggets) {
    for (const fact of nugget.facts) {
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

  best.fact.hits = (best.fact.hits || 0) + 1;
  best.fact.updated_at = new Date().toISOString();
  saveNugget(best.nugget);

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
  ensureDir();
  const nuggets = new Map();
  for (const name of DEFAULT_NUGGETS) nuggets.set(name, loadNugget(name));

  shelf = {
    nuggets,
    getOrCreate(name) {
      if (!this.nuggets.has(name)) {
        const nugget = loadNugget(name);
        this.nuggets.set(name, nugget);
        saveNugget(nugget);
      }
      return this.nuggets.get(name);
    },
    get(name) {
      return this.getOrCreate(name);
    },
    list() {
      return [...this.nuggets.keys()].map((name) => ({ name }));
    },
    get size() {
      return this.nuggets.size;
    },
  };

  log("memory", `Memory initialized (${shelf.size} nuggets loaded from ${SAVE_DIR})`);
  return shelf;
}

export function getShelf() {
  if (!shelf) initMemory();
  return shelf;
}

export function rememberStrategy(pattern, result) {
  const key = upsertFact("strategies", pattern, typeof result === "string" ? result : JSON.stringify(result));
  log("memory", `Remembered strategy: ${key}`);
}

export function recallForScreening(poolData) {
  const results = [];

  if (poolData?.bin_step) {
    for (const strategy of ["bid_ask", "spot"]) {
      const hit = recallBest(`${strategy}_bs${poolData.bin_step}`, "strategies");
      if (hit.found && !results.some((result) => result.key === hit.key)) {
        results.push({ source: "strategies", ...hit });
      }
    }
  }

  return results;
}

export function recallForManagement(position) {
  const results = [];

  if (position?.strategy && position?.bin_step != null) {
    const hit = recallBest(`${position.strategy}_bs${position.bin_step}`, "strategies");
    if (hit.found) results.push({ source: "strategies", ...hit });
  }

  const lessonHit = recallBest("management", "lessons");
  if (lessonHit.found) results.push({ source: "lessons", ...lessonHit });

  return results;
}

export function getMemoryContext() {
  const store = getShelf();
  const lines = [];

  for (const { name } of store.list()) {
    const nugget = store.get(name);
    const relevant = nugget.facts
      .filter((fact) => (fact.hits || 0) >= 1)
      .sort((a, b) => (b.hits || 0) - (a.hits || 0))
      .slice(0, 10);

    if (!relevant.length) continue;

    lines.push(`[${name}]`);
    for (const fact of relevant) {
      lines.push(`  ${fact.key}: ${fact.value}`);
    }
  }

  return lines.length ? lines.join("\n") : null;
}

export function rememberFact(nuggetOrPayload, keyArg, valueArg) {
  const payload = typeof nuggetOrPayload === "object" && nuggetOrPayload !== null
    ? {
        nugget: nuggetOrPayload.nugget ?? nuggetOrPayload.topic ?? "facts",
        key: nuggetOrPayload.key,
        value: nuggetOrPayload.value,
      }
    : {
        nugget: nuggetOrPayload,
        key: keyArg,
        value: valueArg,
      };

  if (!payload.key) {
    return { saved: false, error: "key required" };
  }

  const nuggetName = payload.nugget || "facts";
  const safeKey = upsertFact(nuggetName, payload.key, payload.value);
  log("memory", `Stored fact in ${nuggetName}: ${safeKey}`);
  return { saved: true, nugget: nuggetName, key: safeKey };
}

export function recallMemory(query, nuggetName) {
  const result = recallBest(query, nuggetName || null);
  log("memory", `Recall "${query}" -> ${result.found ? result.answer : "not found"}`);
  return result;
}
