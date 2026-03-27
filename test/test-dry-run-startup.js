import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getRecoveryWorkflowReport, runBootRecovery } from "../boot-recovery.js";
import { setActionJournalPathForTests } from "../action-journal.js";
import { getStartupSnapshot, resetStartupSnapshotCache } from "../startup-snapshot.js";

async function main() {
  const originalCwd = process.cwd();
  const originalDryRun = process.env.DRY_RUN;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-dry-run-startup-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    setActionJournalPathForTests(journalPath);
    process.env.DRY_RUN = "true";

    console.log("=== Dry-run startup verification ===");

    const recovery = await runBootRecovery({
      observeOpenPositions: async () => ({ positions: [] }),
      observeTrackedPositions: async () => [],
    });
    assert.equal(recovery.status, "clear");
    assert.equal(recovery.suppress_autonomous_writes, false);

    const snapshot = await getStartupSnapshot({
      force: true,
      getWalletBalances: async () => ({ wallet: "dry-run-wallet", sol: 1.25, sol_price: 120 }),
      getMyPositions: async () => ({ positions: [], total_positions: 0 }),
      getTopCandidates: async () => ({ candidates: [], total_eligible: 0, total_screened: 0 }),
    });

    assert.equal(snapshot.wallet.wallet, "dry-run-wallet");
    assert.equal(snapshot.wallet.sol, 1.25);
    assert.equal(snapshot.positions.total_positions, 0);
    assert.deepEqual(snapshot.candidates, []);

    const report = getRecoveryWorkflowReport();
    assert.equal(report.status, "clear");
    assert.equal(report.total_manual_review_workflows, 0);
    assert.equal(report.total_unresolved_workflows, 0);

    console.log("dry-run startup verification passed");
    process.exit(0);
  } finally {
    resetStartupSnapshotCache();
    setActionJournalPathForTests(null);
    if (originalDryRun == null) {
      delete process.env.DRY_RUN;
    } else {
      process.env.DRY_RUN = originalDryRun;
    }
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  resetStartupSnapshotCache();
  setActionJournalPathForTests(null);
  console.error(error);
  process.exit(1);
});
