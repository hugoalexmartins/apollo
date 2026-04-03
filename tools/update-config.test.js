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

test("runUpdateConfig reports noop when normalized values do not change", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-update-config-noop-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ minOrganic: 60 }, null, 2));

		const { runUpdateConfig } = await import(`./update-config.js?test=${Date.now()}a`);
		const result = runUpdateConfig({
			changes: { minOrganic: 60 },
			reason: "test noop",
		});

		assert.equal(result.success, true);
		assert.equal(result.noop, true);
		assert.deepEqual(result.applied, {});
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("runUpdateConfig recomputes derived minSolToOpen when deploy sizing inputs change", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-update-config-derived-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ deployAmountSol: 0.5, gasReserve: 0.2, minSolToOpen: 0.7 }, null, 2));

		const { runUpdateConfig } = await import(`./update-config.js?test=${Date.now()}b`);
		const { config } = await import("../config.js");
		const result = runUpdateConfig({
			changes: { deployAmountSol: 0.8, minSolToOpen: 1.0 },
			reason: "test derived recompute",
		});

		assert.equal(result.success, true);
		assert.equal(config.management.deployAmountSol, 0.8);
		assert.equal(config.management.minSolToOpen, 1);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("runUpdateConfig persists screening array and optional-number gates", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-update-config-screening-gates-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ minOrganic: 60 }, null, 2));

		const { runUpdateConfig } = await import(`./update-config.js?test=${Date.now()}c`);
		const { config } = await import("../config.js");
		const result = runUpdateConfig({
			changes: {
				athFilterPct: -20,
				maxBotHoldersPct: 25,
				blockedLaunchpads: ["letsbonk.fun", "pump.fun"],
			},
			reason: "test screening gates",
		});

		assert.equal(result.success, true);
		assert.equal(config.screening.athFilterPct, -20);
		assert.equal(config.screening.maxBotHoldersPct, 25);
		assert.deepEqual(config.screening.blockedLaunchpads, ["letsbonk.fun", "pump.fun"]);

		const persisted = JSON.parse(fs.readFileSync(process.env.ZENITH_USER_CONFIG_PATH, "utf8"));
		assert.equal(persisted.athFilterPct, -20);
		assert.equal(persisted.maxBotHoldersPct, 25);
		assert.deepEqual(persisted.blockedLaunchpads, ["letsbonk.fun", "pump.fun"]);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("runUpdateConfig reports write failure when user-config parent is not a directory", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-update-config-write-fail-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		const blockingPath = path.join(tempDir, "not-a-dir");
		fs.writeFileSync(blockingPath, "blocking file");
		process.env.ZENITH_USER_CONFIG_PATH = path.join(blockingPath, "user-config.json");

		const { runUpdateConfig } = await import(`./update-config.js?test=${Date.now()}d`);
		const result = runUpdateConfig({
			changes: { minOrganic: 77 },
			reason: "test write failure",
		});

		assert.equal(result.success, false);
		assert.equal(result.reason_code, "USER_CONFIG_WRITE_FAILED");
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("runUpdateConfig blocks on primitive user-config payloads", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-update-config-primitive-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, "null");

		const { runUpdateConfig } = await import(`./update-config.js?test=${Date.now()}e`);
		const result = runUpdateConfig({
			changes: { minOrganic: 77 },
			reason: "test primitive config",
		});

		assert.equal(result.success, false);
		assert.equal(result.reason_code, "USER_CONFIG_INVALID");
		assert.match(result.error, /must contain a JSON object/i);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
