import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { config } from "./config.js";
import {
	getTelegramFreeformAgentRole,
	runPreflightCheckCommand,
	runThresholdEvolutionCommand,
} from "./interactive-interface.js";
import { armGeneralWriteTools, disarmGeneralWriteTools } from "./operator-controls.js";

test("telegram free-form deploy language stays in GENERAL role", () => {
	assert.equal(getTelegramFreeformAgentRole("deploy into pool"), "GENERAL");
	assert.equal(getTelegramFreeformAgentRole("open position on best pool"), "GENERAL");
	assert.equal(getTelegramFreeformAgentRole("add liquidity"), "GENERAL");
	assert.equal(getTelegramFreeformAgentRole("close this position"), "GENERAL");
});

test("threshold evolution uses the safe live engine and records operator evidence", async () => {
	const actions = [];
	let reloaded = false;
	const blocked = await runThresholdEvolutionCommand({
		getPerformanceSummary: () => ({ total_positions_closed: 10 }),
		evolveThresholds: () => ({
			changes: {},
			rationale: {},
			rollout: {
				status: "blocked_invalid_state",
				reason_code: "EVOLVE_CONFIG_STATE_INVALID",
				error: "config unreadable",
			},
			requires_reload: false,
		}),
		reloadScreeningThresholds: () => {
			reloaded = true;
		},
		config: {},
		recordAction: (entry) => actions.push(entry),
	});
	assert.equal(blocked.status, "blocked");
	assert.equal(reloaded, false);
	assert.match(blocked.message, /config unreadable/i);
	assert.equal(actions[0].type, "evolve_thresholds_requested");
	assert.equal(actions[1].type, "evolve_thresholds_blocked");

	const noop = await runThresholdEvolutionCommand({
		getPerformanceSummary: () => ({ total_positions_closed: 10 }),
		evolveThresholds: () => ({ changes: {}, rationale: {}, rollout: { status: "no_change" }, requires_reload: false }),
		reloadScreeningThresholds: () => {
			reloaded = true;
		},
		config: {},
		recordAction: (entry) => actions.push(entry),
	});
	assert.equal(noop.status, "noop");

	const applied = await runThresholdEvolutionCommand({
		getPerformanceSummary: () => ({ total_positions_closed: 10 }),
		evolveThresholds: () => ({ changes: { minOrganic: 75 }, rationale: { minOrganic: "raised" }, rollout: { status: "started", rollout_id: "rollout-1" }, requires_reload: true }),
		reloadScreeningThresholds: () => {
			reloaded = true;
			return { success: true };
		},
		config: {},
		recordAction: (entry) => actions.push(entry),
	});
	assert.equal(applied.status, "applied");
	assert.equal(reloaded, true);
	assert.equal(actions[actions.length - 1].type, "evolve_thresholds_applied");

	const reloadFailed = await runThresholdEvolutionCommand({
		getPerformanceSummary: () => ({ total_positions_closed: 10 }),
		evolveThresholds: () => ({ changes: { minOrganic: 76 }, rationale: { minOrganic: "raised" }, rollout: { status: "started", rollout_id: "rollout-2" }, requires_reload: true }),
		reloadScreeningThresholds: () => ({ success: false, reason_code: "USER_CONFIG_INVALID", error: "bad config" }),
		config: {},
		recordAction: (entry) => actions.push(entry),
	});
	assert.equal(reloadFailed.status, "blocked");
	assert.match(reloadFailed.message, /runtime reload failed/i);
	assert.equal(actions[actions.length - 1].type, "evolve_thresholds_reload_failed");
});

test("preflight command builds and persists a report through the shared shell helper", async () => {
	const healthUpdates = [];
	const report = await runPreflightCheckCommand({
		rawInput: "tool=deploy_position pool=pool-1 amount_x=10 amount_y=0.25",
		deployAmountSol: 0.5,
		getStartupSnapshot: async () => ({ wallet: { sol: 2 }, positions: { positions: [] } }),
		getWalletBalances: async () => ({ sol: 2 }),
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getTopCandidates: async () => ({ candidates: [] }),
		buildRiskOpeningPreflightReport: ({ tool_name, pool_address, amount_x, amount_y, amount_sol, approval }) => ({
			status: approval.pass ? "pass" : "fail",
			pass: approval.pass,
			action: {
				tool_name,
				pool_address,
				amount_x: Number(amount_x),
				amount_y: Number(amount_y),
				amount_sol: Number(amount_sol),
			},
		}),
		isFailClosedResult: () => false,
		getRecoveryWorkflowReport: () => ({ status: "clear" }),
		getAutonomousWriteSuppression: () => ({ suppressed: false }),
		config: {},
		refreshRuntimeHealth: (patch) => healthUpdates.push(patch),
		evaluateApproval: () => ({ pass: true }),
	});

	assert.equal(report.status, "pass");
	assert.equal(report.action.pool_address, "pool-1");
	assert.equal(report.action.amount_x, 10);
	assert.equal(report.action.amount_y, 0.25);
	assert.equal(healthUpdates[0].preflight.status, "pass");
});

test("preflight command fails closed on invalid numeric amount input", async () => {
	const healthUpdates = [];
	const report = await runPreflightCheckCommand({
		rawInput: "tool=deploy_position pool=pool-1 amount_x=oops amount_y=0.25",
		deployAmountSol: 0.5,
		getStartupSnapshot: async () => ({ wallet: { sol: 2 }, positions: { positions: [] } }),
		getWalletBalances: async () => ({ sol: 2 }),
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getTopCandidates: async () => ({ candidates: [] }),
		buildRiskOpeningPreflightReport: ({ approval }) => ({
			status: approval.pass ? "pass" : "fail",
			pass: approval.pass,
			reason_code: approval.reason_code,
			reason: approval.reason,
		}),
		isFailClosedResult: () => false,
		getRecoveryWorkflowReport: () => ({ status: "clear" }),
		getAutonomousWriteSuppression: () => ({ suppressed: false }),
		config: {},
		refreshRuntimeHealth: (patch) => healthUpdates.push(patch),
		evaluateApproval: ({ amount_x }) => ({
			pass: amount_x !== "oops",
			reason_code: amount_x === "oops" ? "GENERAL_WRITE_INVALID_AMOUNT_INPUT" : null,
			reason: amount_x === "oops" ? "Invalid deploy amount input: amount_x" : null,
		}),
	});

	assert.equal(report.status, "fail");
	assert.equal(report.reason_code, "GENERAL_WRITE_INVALID_AMOUNT_INPUT");
	assert.equal(healthUpdates[0].preflight.status, "fail");
});

test("preflight command fails closed when one deploy alias is malformed", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-interactive-preflight-alias-malformed-test-"));
	const healthUpdates = [];
	const nowMs = Date.parse("2030-01-01T00:00:00.000Z");
	try {
		process.chdir(tempDir);
		armGeneralWriteTools({
			minutes: 5,
			reason: "preflight malformed alias test",
			scope: { allowed_tools: ["deploy_position"], pool_address: "pool-1", max_amount_y: 0.5 },
			nowMs,
		});
		const report = await runPreflightCheckCommand({
			rawInput: "tool=deploy_position pool=pool-1 amount_y=0.25 amount_sol=oops",
			deployAmountSol: config.management.deployAmountSol,
			getStartupSnapshot: async () => ({ wallet: { sol: 2 }, positions: { positions: [] } }),
			getWalletBalances: async () => ({ sol: 2 }),
			getMyPositions: async () => ({ total_positions: 0, positions: [] }),
			getTopCandidates: async () => ({ candidates: [] }),
			isFailClosedResult: () => false,
			getRecoveryWorkflowReport: () => ({ status: "clear" }),
			getAutonomousWriteSuppression: () => ({ suppressed: false }),
			config,
			refreshRuntimeHealth: (patch) => healthUpdates.push(patch),
		});

		assert.equal(report.status, "fail");
		assert.equal(report.reason_code, "PREFLIGHT_INVALID_INPUT");
		assert.match(report.reason, /amount_sol/);
		assert.equal(healthUpdates[0].preflight.status, "fail");
	} finally {
		disarmGeneralWriteTools({ reason: "cleanup", nowMs: nowMs + 60_000 });
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("preflight command fails closed when deploy aliases disagree", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-interactive-preflight-alias-conflict-test-"));
	const healthUpdates = [];
	const nowMs = Date.parse("2030-01-01T00:00:00.000Z");
	try {
		process.chdir(tempDir);
		armGeneralWriteTools({
			minutes: 5,
			reason: "preflight alias conflict test",
			scope: { allowed_tools: ["deploy_position"], pool_address: "pool-1", max_amount_y: 0.5 },
			nowMs,
		});
		const report = await runPreflightCheckCommand({
			rawInput: "tool=deploy_position pool=pool-1 amount_y=0.25 amount_sol=0.5",
			deployAmountSol: config.management.deployAmountSol,
			getStartupSnapshot: async () => ({ wallet: { sol: 2 }, positions: { positions: [] } }),
			getWalletBalances: async () => ({ sol: 2 }),
			getMyPositions: async () => ({ total_positions: 0, positions: [] }),
			getTopCandidates: async () => ({ candidates: [] }),
			isFailClosedResult: () => false,
			getRecoveryWorkflowReport: () => ({ status: "clear" }),
			getAutonomousWriteSuppression: () => ({ suppressed: false }),
			config,
			refreshRuntimeHealth: (patch) => healthUpdates.push(patch),
		});

		assert.equal(report.status, "fail");
		assert.equal(report.reason_code, "PREFLIGHT_INVALID_INPUT");
		assert.match(report.reason, /amount_y_vs_amount_sol/);
		assert.equal(healthUpdates[0].preflight.status, "fail");
	} finally {
		disarmGeneralWriteTools({ reason: "cleanup", nowMs: nowMs + 60_000 });
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("preflight command fails closed when amount_sol and max_sol disagree", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-interactive-preflight-sol-alias-conflict-test-"));
	const healthUpdates = [];
	const nowMs = Date.parse("2030-01-01T00:00:00.000Z");
	try {
		process.chdir(tempDir);
		armGeneralWriteTools({
			minutes: 5,
			reason: "preflight sol alias conflict test",
			scope: { allowed_tools: ["deploy_position"], pool_address: "pool-1", max_amount_y: 0.5 },
			nowMs,
		});
		const report = await runPreflightCheckCommand({
			rawInput: "tool=deploy_position pool=pool-1 amount_sol=0.25 max_sol=0.5",
			deployAmountSol: config.management.deployAmountSol,
			getStartupSnapshot: async () => ({ wallet: { sol: 2 }, positions: { positions: [] } }),
			getWalletBalances: async () => ({ sol: 2 }),
			getMyPositions: async () => ({ total_positions: 0, positions: [] }),
			getTopCandidates: async () => ({ candidates: [] }),
			isFailClosedResult: () => false,
			getRecoveryWorkflowReport: () => ({ status: "clear" }),
			getAutonomousWriteSuppression: () => ({ suppressed: false }),
			config,
			refreshRuntimeHealth: (patch) => healthUpdates.push(patch),
		});

		assert.equal(report.status, "fail");
		assert.equal(report.reason_code, "PREFLIGHT_INVALID_INPUT");
		assert.match(report.reason, /amount_sol_vs_max_sol/);
		assert.equal(healthUpdates[0].preflight.status, "fail");
	} finally {
		disarmGeneralWriteTools({ reason: "cleanup", nowMs: nowMs + 60_000 });
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("preflight command fails closed when amount_sol is valid but max_sol is malformed", async () => {
	const originalCwd = process.cwd();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-interactive-preflight-sol-alias-malformed-test-"));
	const healthUpdates = [];
	const nowMs = Date.parse("2030-01-01T00:00:00.000Z");
	try {
		process.chdir(tempDir);
		armGeneralWriteTools({
			minutes: 5,
			reason: "preflight sol alias malformed test",
			scope: { allowed_tools: ["deploy_position"], pool_address: "pool-1", max_amount_y: 0.5 },
			nowMs,
		});
		const report = await runPreflightCheckCommand({
			rawInput: "tool=deploy_position pool=pool-1 amount_sol=0.25 max_sol=oops",
			deployAmountSol: config.management.deployAmountSol,
			getStartupSnapshot: async () => ({ wallet: { sol: 2 }, positions: { positions: [] } }),
			getWalletBalances: async () => ({ sol: 2 }),
			getMyPositions: async () => ({ total_positions: 0, positions: [] }),
			getTopCandidates: async () => ({ candidates: [] }),
			isFailClosedResult: () => false,
			getRecoveryWorkflowReport: () => ({ status: "clear" }),
			getAutonomousWriteSuppression: () => ({ suppressed: false }),
			config,
			refreshRuntimeHealth: (patch) => healthUpdates.push(patch),
		});

		assert.equal(report.status, "fail");
		assert.equal(report.reason_code, "PREFLIGHT_INVALID_INPUT");
		assert.match(report.reason, /amount_sol_vs_max_sol/);
		assert.equal(healthUpdates[0].preflight.status, "fail");
	} finally {
		disarmGeneralWriteTools({ reason: "cleanup", nowMs: nowMs + 60_000 });
		process.chdir(originalCwd);
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
