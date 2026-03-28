import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { formatRuntimeHealthReport, getRuntimeHealth, updateRuntimeHealth } from "./runtime-health.js";

test("runtime health persists machine-readable heartbeat", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-runtime-health-test-"));

  try {
    process.chdir(tempDir);
    const health = updateRuntimeHealth({
      startup: { status: "ready", reason: null },
      cycles: { screening: { status: "completed", at: "2026-03-27T00:00:00.000Z" } },
      provider_health: { wallet: { status: "ok", detail: "wallet ready" } },
    });
    assert.equal(health.startup.status, "ready");
    assert.equal(getRuntimeHealth().cycles.screening.status, "completed");
    assert.match(formatRuntimeHealthReport(), /wallet: ok/i);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("runtime health surfaces parse errors instead of silently resetting", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-runtime-health-invalid-test-"));

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "data", "runtime-health.json"), "{bad json");
		const health = getRuntimeHealth();
		assert.match(health.parse_error || "", /expected property name/i);
		assert.match(formatRuntimeHealthReport(health), /parse_error/i);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("runtime health falls back to backup snapshot when primary is missing", () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-runtime-health-backup-test-"));

	try {
		process.chdir(tempDir);
		fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
		fs.writeFileSync(
			path.join(tempDir, "data", "runtime-health.json.bak"),
			JSON.stringify({ startup: { status: "backup-ready" } }, null, 2),
		);
		const health = getRuntimeHealth();
		assert.equal(health.startup.status, "backup-ready");
		assert.equal(health.loaded_from_backup, true);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
