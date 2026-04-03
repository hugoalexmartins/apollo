import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("user config store falls back to backup when primary config is corrupt", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-user-config-store-backup-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		const store = await import(`./user-config-store.js?test=${Date.now()}a`);
		store.writeUserConfigSnapshot({ minOrganic: 60 });
		store.writeUserConfigSnapshot({ minOrganic: 70 });
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, "{bad json");

		const snapshot = store.readUserConfigSnapshot();
		assert.equal(snapshot.ok, true);
		assert.equal(snapshot.source, "backup");
		assert.equal(snapshot.value.minOrganic, 60);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("user config store reports missing config when missing is not allowed", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-user-config-store-missing-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		const store = await import(`./user-config-store.js?test=${Date.now()}b`);
		const snapshot = store.readUserConfigSnapshot({ allowMissing: false });
		assert.equal(snapshot.ok, false);
		assert.match(snapshot.error, /missing user config/i);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("user config store treats falsy parsed json primitives as invalid", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-user-config-store-falsy-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, "null");
		const store = await import(`./user-config-store.js?test=${Date.now()}c`);
		const snapshot = store.readUserConfigSnapshot();
		assert.equal(snapshot.ok, false);
		assert.match(snapshot.error, /must contain a JSON object/i);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
