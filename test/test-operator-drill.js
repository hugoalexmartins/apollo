import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendReplayEnvelope, createCycleId } from "../cycle-trace.js";
import { validateStartupSnapshot } from "../degraded-mode.js";
import { writeEvidenceBundle, listEvidenceBundles } from "../evidence-bundles.js";
import { reconcileScreeningEnvelope } from "../reconciliation.js";
import { getStartupSnapshot } from "../startup-snapshot.js";
import { getTopCandidates, rankCandidateSnapshots, resetDiscoveryCache } from "../tools/screening.js";

function buildPool(overrides = {}) {
  return {
    pool: overrides.pool || "pool-a",
    name: overrides.name || "Alpha-SOL",
    base: { mint: overrides.baseMint || "mint-a", symbol: "ALPHA" },
    fee_active_tvl_ratio: overrides.fee_active_tvl_ratio ?? 0.4,
    volume_window: overrides.volume_window ?? 50000,
    organic_score: overrides.organic_score ?? 85,
    holders: overrides.holders ?? 2500,
    active_pct: overrides.active_pct ?? 88,
    volatility: overrides.volatility ?? 4,
  };
}

async function main() {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-operator-drill-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });

    console.log("=== Operator drill: provider-free screening success reconciliation ===");
    const candidateInputs = [
      buildPool({
        pool: "pool-low",
        baseMint: "mint-low",
        fee_active_tvl_ratio: 0.06,
        volume_window: 2000,
        organic_score: 62,
        holders: 700,
        active_pct: 60,
        volatility: 17,
      }),
      buildPool({
        pool: "pool-high",
        baseMint: "mint-high",
        fee_active_tvl_ratio: 0.9,
        volume_window: 120000,
        organic_score: 91,
        holders: 3500,
        active_pct: 93,
        volatility: 5,
      }),
    ];
    const screening = await getTopCandidates({
      limit: 2,
      discoverPoolsFn: async () => ({ pools: candidateInputs }),
      getMyPositionsFn: async () => ({ positions: [], total_positions: 0 }),
    });
    const ranked = rankCandidateSnapshots(candidateInputs, { limit: 2 });
    assert.ok(Array.isArray(screening.candidates));
    assert.ok(screening.candidates.length > 0, "expected at least one deterministic candidate");

    const screeningCycleId = createCycleId("screening");
    const screeningEnvelope = {
      cycle_id: screeningCycleId,
      total_eligible: screening.total_eligible,
      shortlist: screening.candidates.map((pool) => ({ pool: pool.pool })),
      candidate_inputs: ranked.evaluations.map((pool) => ({
        pool: pool.pool,
        name: pool.name,
        base: pool.base,
        fee_active_tvl_ratio: pool.fee_active_tvl_ratio,
        volume_window: pool.volume_window,
        organic_score: pool.organic_score,
        holders: pool.holders,
        active_pct: pool.active_pct,
        volatility: pool.volatility,
      })),
      occupied_pools: [],
      occupied_mints: [],
    };
    appendReplayEnvelope({ ...screeningEnvelope, cycle_type: "screening" });

    const screeningReconciliation = reconcileScreeningEnvelope(screeningEnvelope);
    assert.equal(screeningReconciliation.status, "match");
    console.log(`screening replay status: ${screeningReconciliation.status}`);

    console.log("\n=== Operator drill: wallet error-shape precheck fails closed ===");
    const walletPrecheckFailure = validateStartupSnapshot({
      wallet: { error: "RPC timeout while fetching balances" },
      positions: { positions: [], total_positions: 0 },
      candidates: { candidates: [] },
    });
    assert.ok(walletPrecheckFailure);
    assert.equal(walletPrecheckFailure.status, "fail_closed");
    assert.equal(walletPrecheckFailure.reason_code, "INPUT_UNAVAILABLE");

    const walletFailureCycleId = createCycleId("screening");
    appendReplayEnvelope({
      cycle_id: walletFailureCycleId,
      cycle_type: "screening",
      reason_code: walletPrecheckFailure.reason_code,
      error: walletPrecheckFailure.message,
    });
    writeEvidenceBundle({
      cycle_id: walletFailureCycleId,
      cycle_type: "screening",
      status: "failed_precheck",
      reason_code: walletPrecheckFailure.reason_code,
      error: walletPrecheckFailure.message,
      written_at: new Date().toISOString(),
    });

    console.log("\n=== Operator drill: fail-closed startup cycle ===");
    const failedSnapshot = await getStartupSnapshot({
      force: true,
      getWalletBalances: async () => ({ sol: 1 }),
      getMyPositions: async () => ({}),
      getTopCandidates: async () => ({ candidates: [] }),
    });
    assert.equal(failedSnapshot.status, "fail_closed");

    const failureCycleId = createCycleId("screening");
    appendReplayEnvelope({
      cycle_id: failureCycleId,
      cycle_type: "screening",
      reason_code: failedSnapshot.reason_code,
      error: failedSnapshot.message,
    });
    writeEvidenceBundle({
      cycle_id: failureCycleId,
      cycle_type: "screening",
      status: "failed_precheck",
      reason_code: failedSnapshot.reason_code,
      error: failedSnapshot.message,
      written_at: new Date().toISOString(),
    });

    const failures = listEvidenceBundles(5);
    const walletFailure = failures.find((bundle) => bundle.cycle_id === walletFailureCycleId);
    assert.ok(walletFailure, "expected wallet-error evidence bundle");
    assert.equal(walletFailure.reason_code, walletPrecheckFailure.reason_code);
    const latestFailure = failures.find((bundle) => bundle.cycle_id === failureCycleId);
    assert.ok(latestFailure, "expected persisted evidence bundle");
    assert.equal(latestFailure.reason_code, failedSnapshot.reason_code);
    console.log(`fail-closed reasons: wallet=${walletFailure.reason_code}, startup=${latestFailure.reason_code}`);

    console.log("\nOperator drill passed.");
    process.exit(0);
  } finally {
    resetDiscoveryCache();
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
