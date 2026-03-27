import { classifyRuntimeFailure, validateStartupSnapshot } from "./degraded-mode.js";

let startupSnapshotCache = null;
let startupSnapshotAt = 0;
const DEFAULT_TTL_MS = 15 * 1000;

export function resetStartupSnapshotCache() {
  startupSnapshotCache = null;
  startupSnapshotAt = 0;
}

export async function getStartupSnapshot({
  force = false,
  ttlMs = DEFAULT_TTL_MS,
  getWalletBalances,
  getMyPositions,
  getTopCandidates,
} = {}) {
  if (!force && startupSnapshotCache && Date.now() - startupSnapshotAt < ttlMs) {
    return startupSnapshotCache;
  }

  try {
    const wallet = await getWalletBalances();
    const positions = await getMyPositions();
    const candidates = await getTopCandidates({ limit: 5 });
    const snapshot = { wallet, positions, ...candidates };
    const invalid = validateStartupSnapshot({
      wallet,
      positions,
      candidates,
    });
    if (invalid) return invalid;

    startupSnapshotCache = snapshot;
    startupSnapshotAt = Date.now();
    return snapshot;
  } catch (error) {
    return classifyRuntimeFailure(error);
  }
}
