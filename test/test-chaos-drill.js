import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendReplayEnvelope, createCycleId } from "../cycle-trace.js";
import { writeEvidenceBundle, listEvidenceBundles } from "../evidence-bundles.js";
import { runManagementRuntimeActions } from "../management-runtime.js";
import { reconcileManagementEnvelope } from "../reconciliation.js";
import { resetStartupSnapshotCache, getStartupSnapshot } from "../startup-snapshot.js";
import { scoreTopLPers } from "../tools/study.js";

const config = {
  management: {
    emergencyPriceDropPct: -50,
    takeProfitFeePct: 5,
    minFeePerTvl24h: 7,
    minClaimAmount: 5,
  },
};

async function main() {
  const originalCwd = process.cwd();
  const originalLpAgentKey = process.env.LPAGENT_API_KEY;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-chaos-drill-"));

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });

    console.log("=== Chaos drill: screening RPC timeout fail-closed ===");
    const timeoutSnapshot = await getStartupSnapshot({
      force: true,
      getWalletBalances: async () => ({ sol: 1 }),
      getMyPositions: async () => {
        throw new Error("RPC timeout while fetching positions");
      },
      getTopCandidates: async () => ({ candidates: [], total_eligible: 0, total_screened: 0 }),
    });
    assert.equal(timeoutSnapshot.status, "fail_closed");
    assert.equal(timeoutSnapshot.reason_code, "INPUT_UNAVAILABLE");

    const timeoutCycleId = createCycleId("screening");
    appendReplayEnvelope({
      cycle_id: timeoutCycleId,
      cycle_type: "screening",
      reason_code: timeoutSnapshot.reason_code,
      error: timeoutSnapshot.message,
    });
    writeEvidenceBundle({
      cycle_id: timeoutCycleId,
      cycle_type: "screening",
      status: "failed_precheck",
      reason_code: timeoutSnapshot.reason_code,
      error: timeoutSnapshot.message,
      written_at: new Date().toISOString(),
    });
    resetStartupSnapshotCache();

    console.log("=== Chaos drill: screening candidate partial failure fail-closed ===");
    const partialSnapshot = await getStartupSnapshot({
      force: true,
      getWalletBalances: async () => ({ sol: 1 }),
      getMyPositions: async () => ({ positions: [], total_positions: 0 }),
      getTopCandidates: async () => ({
        candidates: [{ pool: "pool-1" }],
        error: "candidate API partial failure",
      }),
    });
    assert.equal(partialSnapshot.status, "fail_closed");
    assert.equal(partialSnapshot.reason_code, "INPUT_UNAVAILABLE");

    const partialCycleId = createCycleId("screening");
    appendReplayEnvelope({
      cycle_id: partialCycleId,
      cycle_type: "screening",
      reason_code: partialSnapshot.reason_code,
      error: partialSnapshot.message,
    });
    writeEvidenceBundle({
      cycle_id: partialCycleId,
      cycle_type: "screening",
      status: "failed_candidates",
      reason_code: partialSnapshot.reason_code,
      error: partialSnapshot.message,
      written_at: new Date().toISOString(),
    });
    resetStartupSnapshotCache();

    const failures = listEvidenceBundles(10);
    assert.ok(failures.find((bundle) => bundle.cycle_id === timeoutCycleId));
    assert.ok(failures.find((bundle) => bundle.cycle_id === partialCycleId));

    console.log("=== Chaos drill: stale management signals stay suppressed ===");
    const managementCycleId = createCycleId("management");
    const positionInputs = [
      {
        position: "pos-stale-exit",
        pair: "Alpha-SOL",
        in_range: true,
        exitAlert: "STOP_LOSS: stale feed should not trigger close",
        pnl: { stale: true, pnl_pct: -18 },
      },
      {
        position: "pos-stale-oor",
        pair: "Beta-SOL",
        in_range: false,
        minutes_out_of_range: 11,
        pnl: { stale: true, volatility: 6 },
      },
      {
        position: "pos-stale-fees",
        pair: "Gamma-SOL",
        in_range: true,
        age_minutes: 120,
        pnl: { stale: true, fee_per_tvl_24h: 2, unclaimed_fee_usd: 12 },
        unclaimed_fees_usd: 12,
      },
    ];
    const calls = [];
    const runtimeActions = await runManagementRuntimeActions(positionInputs, {
      cycleId: managementCycleId,
      config,
      executeTool: async (name, args, meta) => {
        calls.push({ name, args, meta });
        return { success: true, tool: name };
      },
    });
    assert.equal(calls.length, 0);
    assert.equal(runtimeActions.length, 0);

    const managementEnvelope = {
      cycle_id: managementCycleId,
      position_inputs: positionInputs,
      runtime_actions: runtimeActions.map((action) => ({
        position: action.position,
        tool: action.toolName,
        rule: action.rule,
      })),
    };
    appendReplayEnvelope({ ...managementEnvelope, cycle_type: "management" });
    const reconciliation = reconcileManagementEnvelope(managementEnvelope, config);
    assert.equal(reconciliation.status, "match");

    console.log("=== Chaos drill: LPAgent unavailable remains bounded ===");
    delete process.env.LPAGENT_API_KEY;
    const lpAgentFallback = await scoreTopLPers({ pool_address: "pool-chaos", limit: 2 });
    assert.equal(lpAgentFallback.source_status.lpagent.status, "missing_api_key");
    assert.deepEqual(lpAgentFallback.candidates, []);

    console.log("Chaos drill passed.");
    process.exit(0);
  } finally {
    resetStartupSnapshotCache();
    if (originalLpAgentKey == null) {
      delete process.env.LPAGENT_API_KEY;
    } else {
      process.env.LPAGENT_API_KEY = originalLpAgentKey;
    }
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
