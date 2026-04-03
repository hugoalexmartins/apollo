import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("config boot fails closed on invalid persisted mutable config", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-config-boot-invalid-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ managementIntervalMin: 90 }, null, 2));
		await assert.rejects(
			() => import(`./config.js?test=${Date.now()}`),
			/Invalid mutable user config/i,
		);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("config boot still supports legacy llmModel as a compatibility fallback", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-config-boot-legacy-model-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;
	const originalLlmModel = process.env.LLM_MODEL;

	try {
		delete process.env.LLM_MODEL;
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ llmModel: "legacy-model" }, null, 2));
		const { config } = await import(`./config.js?test=${Date.now()}`);
		assert.equal(config.llm.managementModel, "legacy-model");
		assert.equal(config.llm.screeningModel, "legacy-model");
		assert.equal(config.llm.generalModel, "legacy-model");
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		if (originalLlmModel == null) delete process.env.LLM_MODEL;
		else process.env.LLM_MODEL = originalLlmModel;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("config boot defaults all model roles to qwen/qwen3.6-plus:free", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-config-default-models-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;
	const originalLlmModel = process.env.LLM_MODEL;

	try {
		delete process.env.LLM_MODEL;
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({}, null, 2));
		const { config } = await import(`./config.js?test=${Date.now()}`);
		assert.equal(config.llm.managementModel, "qwen/qwen3.6-plus:free");
		assert.equal(config.llm.screeningModel, "qwen/qwen3.6-plus:free");
		assert.equal(config.llm.generalModel, "qwen/qwen3.6-plus:free");
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		if (originalLlmModel == null) delete process.env.LLM_MODEL;
		else process.env.LLM_MODEL = originalLlmModel;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("config boot derives the default RPC from HELIUS_API_KEY when no override is set", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-config-rpc-default-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;
	const originalHeliusApiKey = process.env.HELIUS_API_KEY;
	const originalRpcUrl = process.env.RPC_URL;

	try {
		delete process.env.RPC_URL;
		process.env.HELIUS_API_KEY = "helius-test-key";
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({}, null, 2));
		await import(`./config.js?test=${Date.now()}`);
		assert.equal(process.env.RPC_URL, "https://beta.helius-rpc.com/?api-key=helius-test-key");
	} finally {
		if (originalRpcUrl == null) delete process.env.RPC_URL;
		else process.env.RPC_URL = originalRpcUrl;
		if (originalHeliusApiKey == null) delete process.env.HELIUS_API_KEY;
		else process.env.HELIUS_API_KEY = originalHeliusApiKey;
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("config boot applies default token-age screening gates only when keys are missing", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-config-token-age-defaults-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({}, null, 2));
		const { config: defaultConfig } = await import(`./config.js?test=${Date.now()}a`);
		assert.equal(defaultConfig.screening.minHolders, 750);
		assert.equal(defaultConfig.screening.maxTop10Pct, 30);
		assert.equal(defaultConfig.screening.minTokenAgeHours, 24);
		assert.equal(defaultConfig.screening.maxTokenAgeHours, 240);

		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ minTokenAgeHours: null, maxTokenAgeHours: null }, null, 2));
		const { config: nullConfig } = await import(`./config.js?test=${Date.now()}b`);
		assert.equal(nullConfig.screening.minTokenAgeHours, null);
		assert.equal(nullConfig.screening.maxTokenAgeHours, null);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("reloadScreeningThresholds fails closed on invalid persisted screening values", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-config-reload-invalid-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ minOrganic: 60 }, null, 2));
		const configModule = await import(`./config.js?test=${Date.now()}`);
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({ minOrganic: 101 }, null, 2));
		const result = configModule.reloadScreeningThresholds();
		assert.equal(result.success, false);
		assert.equal(result.reason_code, "USER_CONFIG_INVALID");
		assert.match(result.error, /Invalid screening config during reload/i);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("config boot fails closed on primitive user-config payloads", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-config-primitive-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, "null");
		await assert.rejects(
			() => import(`./config.js?test=${Date.now()}`),
			/user-config\.json must contain a JSON object/i,
		);
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
