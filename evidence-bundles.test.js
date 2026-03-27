import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listEvidenceBundles, writeEvidenceBundle } from "./evidence-bundles.js";

test("writeEvidenceBundle persists and lists bounded bad-cycle bundles", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-evidence-test-"));

  try {
    process.chdir(tempDir);
    const filePath = writeEvidenceBundle({
      cycle_id: "screening-123",
      cycle_type: "screening",
      status: "failed_candidates",
      reason_code: "INPUT_UNAVAILABLE",
      error: "candidates unavailable",
      written_at: new Date().toISOString(),
    });
    assert.ok(filePath);
    assert.equal(fs.existsSync(filePath), true);

    const listed = listEvidenceBundles(5);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].cycle_id, "screening-123");
    assert.equal(listed[0].reason_code, "INPUT_UNAVAILABLE");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
