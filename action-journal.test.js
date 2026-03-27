import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendActionLifecycle,
  foldActionJournal,
  readActionJournal,
  setActionJournalPathForTests,
} from "./action-journal.js";

test("action journal appends and folds lifecycle state", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-action-journal-test-"));
  const journalPath = path.join(tempDir, "data", "workflow-actions.jsonl");

  try {
    process.chdir(tempDir);
    setActionJournalPathForTests(journalPath);

    appendActionLifecycle({
      workflow_id: "wf-1",
      lifecycle: "intent",
      tool: "rebalance_on_exit",
      position_address: "pos-1",
      pool_address: "pool-1",
    });
    appendActionLifecycle({
      workflow_id: "wf-1",
      lifecycle: "close_observed_pending_redeploy",
      tool: "rebalance_on_exit",
      position_address: "pos-1",
      pool_address: "pool-1",
    });
    appendActionLifecycle({
      workflow_id: "wf-2",
      lifecycle: "intent",
      tool: "deploy_position",
      pool_address: "pool-2",
    });
    appendActionLifecycle({
      workflow_id: "wf-2",
      lifecycle: "completed",
      tool: "deploy_position",
      pool_address: "pool-2",
    });

    const parsed = readActionJournal();
    assert.equal(parsed.parse_errors.length, 0);
    assert.equal(parsed.entries.length, 4);

    const folded = foldActionJournal(parsed.entries);
    const byId = new Map(folded.map((workflow) => [workflow.workflow_id, workflow]));
    assert.equal(byId.get("wf-1").lifecycle, "close_observed_pending_redeploy");
    assert.equal(byId.get("wf-1").tool, "rebalance_on_exit");
    assert.equal(byId.get("wf-2").lifecycle, "completed");
    assert.equal(byId.get("wf-2").history.length, 2);
  } finally {
    setActionJournalPathForTests(null);
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
