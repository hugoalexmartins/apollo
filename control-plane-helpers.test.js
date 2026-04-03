import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildStaticProviderHealth, createHeadlessTelegramCommandHandler } from "./control-plane-helpers.js";

test("static provider health surfaces missing Helius as a startup blocker", () => {
	const originalHeliusApiKey = process.env.HELIUS_API_KEY;

	try {
		delete process.env.HELIUS_API_KEY;
		const health = buildStaticProviderHealth({
			secretHealth: { wallet_key_source: "env" },
			telegramEnabled: () => false,
		});

		assert.equal(health.helius.status, "missing");
		assert.match(health.helius.detail, /wallet balances\/startup health require it/i);
	} finally {
		if (originalHeliusApiKey == null) {
			delete process.env.HELIUS_API_KEY;
		} else {
			process.env.HELIUS_API_KEY = originalHeliusApiKey;
		}
	}
});

test("static provider health treats Gatekeeper-backed default RPC as configured", () => {
	const originalHeliusApiKey = process.env.HELIUS_API_KEY;
	const originalRpcUrl = process.env.RPC_URL;
	const originalRpcSource = process.env.ZENITH_RPC_URL_SOURCE;

	try {
		delete process.env.RPC_URL;
		delete process.env.ZENITH_RPC_URL_SOURCE;
		process.env.HELIUS_API_KEY = "helius-test-key";
		const health = buildStaticProviderHealth({
			secretHealth: { wallet_key_source: "env" },
			telegramEnabled: () => false,
		});

		assert.equal(health.rpc.status, "configured");
		assert.match(health.rpc.detail, /default helius gatekeeper beta rpc derived from helius_api_key/i);
	} finally {
		if (originalRpcUrl == null) {
			delete process.env.RPC_URL;
		} else {
			process.env.RPC_URL = originalRpcUrl;
		}
		if (originalRpcSource == null) {
			delete process.env.ZENITH_RPC_URL_SOURCE;
		} else {
			process.env.ZENITH_RPC_URL_SOURCE = originalRpcSource;
		}
		if (originalHeliusApiKey == null) {
			delete process.env.HELIUS_API_KEY;
		} else {
			process.env.HELIUS_API_KEY = originalHeliusApiKey;
		}
	}
});

test("static provider health stays truthful after config boot derives the default Helius Gatekeeper RPC", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-rpc-health-config-boot-test-"));
	const originalHeliusApiKey = process.env.HELIUS_API_KEY;
	const originalRpcUrl = process.env.RPC_URL;
	const originalRpcSource = process.env.ZENITH_RPC_URL_SOURCE;
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		delete process.env.RPC_URL;
		delete process.env.ZENITH_RPC_URL_SOURCE;
		process.env.HELIUS_API_KEY = "helius-test-key";
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({}, null, 2));
		await import(`./config.js?test=${Date.now()}`);

		const health = buildStaticProviderHealth({
			secretHealth: { wallet_key_source: "env" },
			telegramEnabled: () => false,
		});

		assert.equal(health.rpc.status, "configured");
		assert.match(health.rpc.detail, /default helius gatekeeper beta rpc derived from helius_api_key/i);
	} finally {
		if (originalUserConfigPath == null) {
			delete process.env.ZENITH_USER_CONFIG_PATH;
		} else {
			process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		}
		if (originalRpcUrl == null) {
			delete process.env.RPC_URL;
		} else {
			process.env.RPC_URL = originalRpcUrl;
		}
		if (originalRpcSource == null) {
			delete process.env.ZENITH_RPC_URL_SOURCE;
		} else {
			process.env.ZENITH_RPC_URL_SOURCE = originalRpcSource;
		}
		if (originalHeliusApiKey == null) {
			delete process.env.HELIUS_API_KEY;
		} else {
			process.env.HELIUS_API_KEY = originalHeliusApiKey;
		}
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	}
});

test("static provider health stays truthful when imported after config boot derives the default Helius Gatekeeper RPC", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-rpc-health-import-order-test-"));
	const originalHeliusApiKey = process.env.HELIUS_API_KEY;
	const originalRpcUrl = process.env.RPC_URL;
	const originalRpcSource = process.env.ZENITH_RPC_URL_SOURCE;
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;

	try {
		delete process.env.RPC_URL;
		delete process.env.ZENITH_RPC_URL_SOURCE;
		process.env.HELIUS_API_KEY = "helius-test-key";
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, JSON.stringify({}, null, 2));
		await import(`./config.js?test=${Date.now()}-config-first`);
		const { buildStaticProviderHealth: buildStaticProviderHealthFresh } = await import(`./control-plane-helpers.js?test=${Date.now()}-helpers-after-config`);

		const health = buildStaticProviderHealthFresh({
			secretHealth: { wallet_key_source: "env" },
			telegramEnabled: () => false,
		});

		assert.equal(health.rpc.status, "configured");
		assert.match(health.rpc.detail, /default helius gatekeeper beta rpc derived from helius_api_key/i);
	} finally {
		if (originalUserConfigPath == null) {
			delete process.env.ZENITH_USER_CONFIG_PATH;
		} else {
			process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		}
		if (originalRpcUrl == null) {
			delete process.env.RPC_URL;
		} else {
			process.env.RPC_URL = originalRpcUrl;
		}
		if (originalRpcSource == null) {
			delete process.env.ZENITH_RPC_URL_SOURCE;
		} else {
			process.env.ZENITH_RPC_URL_SOURCE = originalRpcSource;
		}
		if (originalHeliusApiKey == null) {
			delete process.env.HELIUS_API_KEY;
		} else {
			process.env.HELIUS_API_KEY = originalHeliusApiKey;
		}
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	}
});

test("headless Telegram handler serves /health and /recovery before operator commands", async () => {
	const messages = [];
	const handler = createHeadlessTelegramCommandHandler({
		handleOperatorCommandText: async ({ text }) => ({ handled: text === "/resume ok", message: "resumed" }),
		buildOperationalHealthReport: async () => "health report",
		getRecoveryWorkflowReport: () => ({ status: "manual_review_required" }),
		getAutonomousWriteSuppression: () => ({ suppressed: true, reason: "manual review required" }),
		formatRecoveryReport: (report, suppression) => `recovery ${report.status} ${suppression.reason}`,
		sendMessage: async (value) => messages.push(value),
	});

	await handler("/health");
	await handler("/recovery");
	await handler("/resume ok");
	await handler("hello");

	assert.equal(messages[0], "health report");
	assert.equal(messages[1], "recovery manual_review_required manual review required");
	assert.equal(messages[2], "resumed");
	assert.match(messages[3], /only accepts \/health, \/recovery, and operator commands/i);
});
