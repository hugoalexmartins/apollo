import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("hive mind uses the shared user-config path override", async () => {
	const originalConfigPath = process.env.ZENITH_USER_CONFIG_PATH;
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-hive-mind-test-"));
	const configPath = path.join(tempDir, "user-config.json");

	try {
		process.env.ZENITH_USER_CONFIG_PATH = configPath;
		fs.writeFileSync(configPath, JSON.stringify({ hiveMindUrl: "https://hive.example.com", hiveMindApiKey: "secret" }, null, 2));
		const hiveMind = await import(`./hive-mind.js?test=${Date.now()}`);
		assert.equal(hiveMind.isEnabled(), true);
	} finally {
		if (originalConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
