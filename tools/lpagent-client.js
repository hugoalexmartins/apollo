import { log } from "../logger.js";

const LPAGENT_WINDOW_MS = 60_000;
const LPAGENT_MAX_CALLS_PER_KEY = 5;
const LPAGENT_MIN_REQUEST_GAP_MS = 2_000;
const LPAGENT_RETRY_DELAYS_MS = [15_000, 30_000];

const keyUsage = new Map();
let lastRequestAtMs = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneUsage(now = Date.now()) {
  for (const [key, calls] of keyUsage.entries()) {
    const freshCalls = calls.filter((timestamp) => now - timestamp < LPAGENT_WINDOW_MS);
    if (freshCalls.length === 0) {
      keyUsage.delete(key);
      continue;
    }
    keyUsage.set(key, freshCalls);
  }
}

export function getLpAgentKeys() {
  return (process.env.LPAGENT_API_KEY || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function hasLpAgentKeys() {
  return getLpAgentKeys().length > 0;
}

export function resetLpAgentLimiterState() {
  keyUsage.clear();
  lastRequestAtMs = 0;
}

function selectLpAgentKey(now = Date.now()) {
  pruneUsage(now);

  let bestKey = null;
  let bestRemaining = -1;
  let shortestWaitMs = LPAGENT_WINDOW_MS;

  for (const key of getLpAgentKeys()) {
    const calls = keyUsage.get(key) || [];
    const remaining = LPAGENT_MAX_CALLS_PER_KEY - calls.length;
    if (remaining > bestRemaining) {
      bestRemaining = remaining;
      bestKey = key;
    }
    if (remaining <= 0 && calls.length > 0) {
      shortestWaitMs = Math.min(shortestWaitMs, Math.max(1, LPAGENT_WINDOW_MS - (now - calls[0])));
    }
  }

  if (bestKey && bestRemaining > 0) {
    keyUsage.set(bestKey, [...(keyUsage.get(bestKey) || []), now]);
    return { key: bestKey, waitMs: 0 };
  }

  return { key: null, waitMs: shortestWaitMs };
}

async function acquireLpAgentKey() {
  if (!hasLpAgentKeys()) return null;

  while (true) {
    const selection = selectLpAgentKey();
    if (selection.key) {
      return selection.key;
    }
    await sleep(selection.waitMs);
  }
}

async function enforceLpAgentGap() {
  const now = Date.now();
  const gapMs = now - lastRequestAtMs;
  if (lastRequestAtMs > 0 && gapMs < LPAGENT_MIN_REQUEST_GAP_MS) {
    await sleep(LPAGENT_MIN_REQUEST_GAP_MS - gapMs);
  }
  lastRequestAtMs = Date.now();
}

export async function fetchLpAgentJson(url) {
  if (!hasLpAgentKeys()) {
    return { disabled: true, error: "LPAGENT_API_KEY not set" };
  }

  let lastError = null;

  for (let attempt = 0; attempt <= LPAGENT_RETRY_DELAYS_MS.length; attempt += 1) {
    const apiKey = await acquireLpAgentKey();
    await enforceLpAgentGap();

    const res = await fetch(url, {
      headers: { "x-api-key": apiKey },
    });

    if (res.ok) {
      return res.json();
    }

    if (res.status === 429 && attempt < LPAGENT_RETRY_DELAYS_MS.length) {
      const waitMs = LPAGENT_RETRY_DELAYS_MS[attempt];
      log("lpagent", `LP Agent returned 429, retrying in ${Math.round(waitMs / 1000)}s`);
      lastError = new Error(`LP Agent API error: ${res.status}`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`LP Agent API error: ${res.status}`);
  }

  throw lastError || new Error("LP Agent API error: 429");
}
