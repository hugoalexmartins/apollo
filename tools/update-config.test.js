import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("runUpdateConfig persists, applies, and restarts cron from the shared registry", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-update-config-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ minOrganic: 60 }, null, 2));

		const { runUpdateConfig } = await import(`./update-config.js?test=${Date.now()}`);
		const { config } = await import("../config.js");
		let cronRestarts = 0;

		const result = runUpdateConfig({
			changes: {
				maxBundlePct: 22,
				autoSwapAfterClaim: true,
				healthCheckIntervalMin: 120,
			},
			reason: "test apply",
			cronRestarter: () => {
				cronRestarts += 1;
			},
		});

		assert.equal(result.success, true);
		assert.equal(result.applied.maxBundlePct, 22);
		assert.equal(result.applied.autoSwapAfterClaim, true);
		assert.equal(result.applied.healthCheckIntervalMin, 120);
		assert.equal(cronRestarts, 1);
		assert.equal(config.screening.maxBundlePct, 22);
		assert.equal(config.management.autoSwapAfterClaim, true);
		assert.equal(config.schedule.healthCheckIntervalMin, 120);

		const persisted = JSON.parse(fs.readFileSync(process.env.ZENITH_USER_CONFIG_PATH, "utf8"));
		assert.equal(persisted.maxBundlePct, 22);
		assert.equal(persisted.autoSwapAfterClaim, true);
		assert.equal(persisted.healthCheckIntervalMin, 120);
		assert.ok(persisted._lastAgentTune);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
