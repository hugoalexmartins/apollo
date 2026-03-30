import assert from "node:assert/strict";
import test from "node:test";

import { createManagementCycleRunner } from "./management-cycle-runner.js";

test("management runner stays runtime-only when deterministic actions handle all positions", async () => {
	const evaluations = [];
	let agentLoopCalls = 0;
	const run = createManagementCycleRunner({
		log: () => {},
		config: { llm: { managementModel: "test-model" }, management: { outOfRangeWaitMinutes: 30 } },
		getMyPositions: async () => ({ positions: [{ position: "pos-1", pool: "pool-1", pair: "Alpha-SOL", in_range: false, minutes_out_of_range: 5 }] }),
		getWalletBalances: async () => ({ sol: 2 }),
		validateStartupSnapshot: () => null,
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		enforceManagementIntervalFromPositions: () => ({ interval: 3, maxVolatility: 1 }),
		recordPositionSnapshot: () => {},
		getPositionPnl: async () => ({ pnl_pct: 1, unclaimed_fee_usd: 0, fee_active_tvl_ratio: 0.05, in_range: false }),
		recallForPool: () => null,
		recallForManagement: () => [],
		isPnlSignalStale: () => false,
		updatePnlAndCheckExits: () => null,
		evaluatePortfolioGuard: () => ({ blocked: false }),
		runManagementRuntimeActions: async () => [{ position: "pos-1", pair: "Alpha-SOL", toolName: "rebalance_on_exit", reason: "out of range", rule: "OUT_OF_RANGE", actionId: "m-1", result: { success: true } }],
		listActionJournalWorkflowsByCycle: () => [],
		executeTool: async () => ({ success: true }),
		didRuntimeHandleManagementAction: () => true,
		classifyManagementModelGate: () => ({ route: "model" }),
		summarizeRuntimeActionResult: () => "ok",
		roundMetric: (value) => value,
		agentLoop: async () => {
			agentLoopCalls += 1;
			return { content: "" };
		},
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
		shouldTriggerFollowOnScreening: () => false,
		runTriggeredScreening: async () => {},
		recordCycleEvaluation: (value) => evaluations.push(value),
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		notifyOutOfRange: async () => {},
		getManagementBusy: () => false,
		getScreeningBusy: () => false,
		getScreeningLastTriggered: () => 0,
		setManagementBusy: () => {},
		setManagementLastRun: () => {},
	});

	await run({ cycleId: "management-test-1", screeningCooldownMs: 0 });
	assert.equal(agentLoopCalls, 0);
	assert.equal(evaluations[0].status, "runtime_only");
});

test("management runner uses a forced positions snapshot and passes it into agentLoop", async () => {
	const livePositions = {
		positions: [{
			position: "pos-1",
			pool: "pool-1",
			pair: "Alpha-SOL",
			in_range: true,
			minutes_out_of_range: 0,
			instruction: "close at 20%",
			age_minutes: 30,
			unclaimed_fees_usd: 1,
		}],
	};
	const walletSnapshot = { sol: 2 };
	const getMyPositionsCalls = [];
	const agentLoopOptions = [];
	let getPositionPnlCalls = 0;

	const run = createManagementCycleRunner({
		log: () => {},
		config: { llm: { managementModel: "test-model", maxSteps: 4 }, management: { outOfRangeWaitMinutes: 30 } },
		getMyPositions: async (args) => {
			getMyPositionsCalls.push(args);
			return livePositions;
		},
		getWalletBalances: async () => walletSnapshot,
		validateStartupSnapshot: () => null,
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		enforceManagementIntervalFromPositions: () => ({ interval: 3, maxVolatility: 1 }),
		recordPositionSnapshot: () => {},
		getPositionPnl: async () => {
			getPositionPnlCalls += 1;
			return {
			pnl_pct: 1,
			pnl_usd: 1,
			unclaimed_fee_usd: 0,
			all_time_fees_usd: 0,
			fee_per_tvl_24h: 0.05,
			current_value_usd: 10,
			lower_bin: 1,
			upper_bin: 2,
			active_bin: 1,
			in_range: true,
			};
		},
		recallForPool: () => null,
		recallForManagement: () => [],
		isPnlSignalStale: () => false,
		updatePnlAndCheckExits: () => null,
		evaluatePortfolioGuard: () => ({ blocked: false }),
		runManagementRuntimeActions: async () => [],
		listActionJournalWorkflowsByCycle: () => [],
		executeTool: async () => ({ success: true }),
		didRuntimeHandleManagementAction: () => false,
		classifyManagementModelGate: () => ({ route: "model" }),
		summarizeRuntimeActionResult: () => "ok",
		roundMetric: (value) => value,
		agentLoop: async (...args) => {
			agentLoopOptions.push(args[6]);
			return { content: "model-ok" };
		},
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
		shouldTriggerFollowOnScreening: () => false,
		runTriggeredScreening: async () => {},
		recordCycleEvaluation: () => {},
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		notifyOutOfRange: async () => {},
		getManagementBusy: () => false,
		getScreeningBusy: () => false,
		getScreeningLastTriggered: () => 0,
		setManagementBusy: () => {},
		setManagementLastRun: () => {},
	});

	await run({ cycleId: "management-test-snapshot", screeningCooldownMs: 0 });
	assert.deepEqual(getMyPositionsCalls, [{ force: true }]);
	assert.equal(getPositionPnlCalls, 0);
	assert.equal(agentLoopOptions.length, 2);
	assert.equal(agentLoopOptions[0].disableTools, true);
	assert.equal(agentLoopOptions[1].disableTools, true);
	assert.equal(agentLoopOptions[0].stateSnapshot.positions, livePositions);
	assert.equal(agentLoopOptions[0].stateSnapshot.portfolio, walletSnapshot);
});

test("management runner fails closed when wallet snapshot is unavailable", async () => {
	const evaluations = [];
	let agentLoopCalls = 0;

	const run = createManagementCycleRunner({
		log: () => {},
		config: { llm: { managementModel: "test-model", maxSteps: 4 }, management: { outOfRangeWaitMinutes: 30 } },
		getMyPositions: async () => ({ positions: [{ position: "pos-1", pool: "pool-1", pair: "Alpha-SOL", in_range: true }] }),
		getWalletBalances: async () => ({ error: "wallet RPC timeout" }),
		validateStartupSnapshot: ({ wallet }) => wallet?.error ? { reason_code: "INPUT_UNAVAILABLE", message: wallet.error } : null,
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		enforceManagementIntervalFromPositions: () => ({ interval: 3, maxVolatility: 1 }),
		recordPositionSnapshot: () => {},
		getPositionPnl: async () => ({ pnl_pct: 1 }),
		recallForPool: () => null,
		recallForManagement: () => [],
		isPnlSignalStale: () => false,
		updatePnlAndCheckExits: () => null,
		evaluatePortfolioGuard: () => ({ blocked: false }),
		runManagementRuntimeActions: async () => [],
		listActionJournalWorkflowsByCycle: () => [],
		executeTool: async () => ({ success: true }),
		didRuntimeHandleManagementAction: () => false,
		classifyManagementModelGate: () => ({ route: "model" }),
		summarizeRuntimeActionResult: () => "ok",
		roundMetric: (value) => value,
		agentLoop: async () => {
			agentLoopCalls += 1;
			return { content: "should not run" };
		},
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
		shouldTriggerFollowOnScreening: () => false,
		runTriggeredScreening: async () => {},
		recordCycleEvaluation: (value) => evaluations.push(value),
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		notifyOutOfRange: async () => {},
		getManagementBusy: () => false,
		getScreeningBusy: () => false,
		getScreeningLastTriggered: () => 0,
		setScreeningLastTriggered: () => {},
		setManagementBusy: () => {},
		setManagementLastRun: () => {},
	});

	await run({ cycleId: "management-test-wallet-fail", screeningCooldownMs: 0 });
	assert.equal(agentLoopCalls, 0);
	assert.equal(evaluations[0].status, "failed_precheck");
	assert.equal(evaluations[0].summary.reason_code, "INPUT_UNAVAILABLE");
});

test("management runner stamps screening trigger before follow-on empty-book screening", async () => {
	const screeningTriggeredAt = [];
	let followOnCalls = 0;

	const run = createManagementCycleRunner({
		log: () => {},
		config: { llm: { managementModel: "test-model", maxSteps: 4 }, management: { outOfRangeWaitMinutes: 30 } },
		getMyPositions: async () => ({ positions: [], total_positions: 0 }),
		getWalletBalances: async () => ({ sol: 2 }),
		validateStartupSnapshot: () => null,
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		enforceManagementIntervalFromPositions: () => ({ interval: 3, maxVolatility: 0 }),
		recordPositionSnapshot: () => {},
		getPositionPnl: async () => ({ pnl_pct: 1 }),
		recallForPool: () => null,
		recallForManagement: () => [],
		isPnlSignalStale: () => false,
		updatePnlAndCheckExits: () => null,
		evaluatePortfolioGuard: () => ({ blocked: false }),
		runManagementRuntimeActions: async () => [],
		listActionJournalWorkflowsByCycle: () => [],
		executeTool: async () => ({ success: true }),
		didRuntimeHandleManagementAction: () => false,
		classifyManagementModelGate: () => ({ route: "runtime" }),
		summarizeRuntimeActionResult: () => "ok",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: "" }),
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
		shouldTriggerFollowOnScreening: () => true,
		runTriggeredScreening: async () => {
			followOnCalls += 1;
		},
		recordCycleEvaluation: () => {},
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		notifyOutOfRange: async () => {},
		getManagementBusy: () => false,
		getScreeningBusy: () => false,
		getScreeningLastTriggered: () => 0,
		setScreeningLastTriggered: (value) => screeningTriggeredAt.push(value),
		setManagementBusy: () => {},
		setManagementLastRun: () => {},
	});

	await run({ cycleId: "management-test-follow-on", screeningCooldownMs: 0 });
	assert.equal(followOnCalls, 1);
	assert.equal(screeningTriggeredAt.length, 1);
	assert.equal(typeof screeningTriggeredAt[0], "number");
});

test("management runner escalates blocked runtime actions into model evaluation", async () => {
	const evaluations = [];
	let agentLoopCalls = 0;
	const executeCalls = [];

	const run = createManagementCycleRunner({
		log: () => {},
		config: { llm: { managementModel: "test-model", maxSteps: 4 }, management: { outOfRangeWaitMinutes: 30 } },
		getMyPositions: async () => ({ positions: [{ position: "pos-1", pool: "pool-1", pair: "Alpha-SOL", in_range: true, instruction: null, age_minutes: 30, unclaimed_fees_usd: 0 }] }),
		getWalletBalances: async () => ({ sol: 2 }),
		validateStartupSnapshot: () => null,
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		enforceManagementIntervalFromPositions: () => ({ interval: 3, maxVolatility: 1 }),
		recordPositionSnapshot: () => {},
		getPositionPnl: async () => ({ pnl_pct: 6, pnl_usd: 10, unclaimed_fee_usd: 0, all_time_fees_usd: 0, fee_per_tvl_24h: 0.05, current_value_usd: 10, lower_bin: 1, upper_bin: 2, active_bin: 1, in_range: true }),
		recallForPool: () => null,
		recallForManagement: () => [],
		isPnlSignalStale: () => false,
		updatePnlAndCheckExits: () => null,
		evaluatePortfolioGuard: () => ({ blocked: false }),
		runManagementRuntimeActions: async () => [{ position: "pos-1", pair: "Alpha-SOL", toolName: "close_position", reason: "runtime close", rule: "RULE", actionId: "m-1", result: { blocked: true, reason: "runtime blocked" } }],
		listActionJournalWorkflowsByCycle: () => [],
		executeTool: async (name, args, meta) => {
			executeCalls.push({ name, args, meta });
			return { success: true, tool: name };
		},
		didRuntimeHandleManagementAction: () => false,
		classifyManagementModelGate: () => ({ route: "runtime" }),
		summarizeRuntimeActionResult: () => "blocked",
		roundMetric: (value) => value,
		agentLoop: async () => {
			agentLoopCalls += 1;
			return agentLoopCalls === 1
				? { content: JSON.stringify({ action: "close", position: "pos-1", summary: "Close it.", confidence: { score: 0.8, label: "high" }, evidence: [{ source: "instruction", summary: "threshold reached", supports_action: true, freshness: "fresh" }, { source: "position_state", summary: "position remains eligible for close", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 1 }, contradictions: [], invalidation_conditions: ["position no longer open"] }) }
				: { content: JSON.stringify({ action: "hold", position: "pos-1", summary: "Hold.", confidence: { score: 0.6, label: "medium" }, evidence: [{ source: "shadow", summary: "hold", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 1 }, contradictions: [], invalidation_conditions: ["market changes"] }) };
		},
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
		shouldTriggerFollowOnScreening: () => false,
		runTriggeredScreening: async () => {},
		recordCycleEvaluation: (value) => evaluations.push(value),
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		notifyOutOfRange: async () => {},
		getManagementBusy: () => false,
		getScreeningBusy: () => false,
		getScreeningLastTriggered: () => 0,
		setScreeningLastTriggered: () => {},
		setManagementBusy: () => {},
		setManagementLastRun: () => {},
	});

	await run({ cycleId: "management-test-runtime-escalation", screeningCooldownMs: 0 });
	assert.equal(agentLoopCalls, 2);
	assert.equal(executeCalls.length, 1);
	assert.equal(executeCalls[0].name, "close_position");
	assert.equal(evaluations[0].status, "completed");
});

test("management runner marks failed_write when model-approved write errors", async () => {
	const evaluations = [];
	const run = createManagementCycleRunner({
		log: () => {},
		config: { llm: { managementModel: "test-model", maxSteps: 4 }, management: { outOfRangeWaitMinutes: 30 } },
		getMyPositions: async () => ({ positions: [{ position: "pos-1", pool: "pool-1", pair: "Alpha-SOL", in_range: true, instruction: "close at 5%", age_minutes: 30, unclaimed_fees_usd: 0 }] }),
		getWalletBalances: async () => ({ sol: 2 }),
		validateStartupSnapshot: () => null,
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		enforceManagementIntervalFromPositions: () => ({ interval: 3, maxVolatility: 1 }),
		recordPositionSnapshot: () => {},
		getPositionPnl: async () => ({ pnl_pct: 6, pnl_usd: 10, unclaimed_fee_usd: 0, all_time_fees_usd: 0, fee_per_tvl_24h: 0.05, current_value_usd: 10, lower_bin: 1, upper_bin: 2, active_bin: 1, in_range: true }),
		recallForPool: () => null,
		recallForManagement: () => [],
		isPnlSignalStale: () => false,
		updatePnlAndCheckExits: () => null,
		evaluatePortfolioGuard: () => ({ blocked: false }),
		runManagementRuntimeActions: async () => [],
		listActionJournalWorkflowsByCycle: () => [],
		executeTool: async () => ({ error: "tx failed" }),
		didRuntimeHandleManagementAction: () => false,
		classifyManagementModelGate: () => ({ route: "model" }),
		summarizeRuntimeActionResult: () => "error",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: JSON.stringify({ action: "close", position: "pos-1", summary: "Close it.", confidence: { score: 0.8, label: "high" }, evidence: [{ source: "instruction", summary: "threshold reached", supports_action: true, freshness: "fresh" }, { source: "position_state", summary: "position remains eligible for close", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 1 }, contradictions: [], invalidation_conditions: ["position no longer open"] }) }),
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
		shouldTriggerFollowOnScreening: () => false,
		runTriggeredScreening: async () => {},
		recordCycleEvaluation: (value) => evaluations.push(value),
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		notifyOutOfRange: async () => {},
		getManagementBusy: () => false,
		getScreeningBusy: () => false,
		getScreeningLastTriggered: () => 0,
		setScreeningLastTriggered: () => {},
		setManagementBusy: () => {},
		setManagementLastRun: () => {},
	});

	await run({ cycleId: "management-test-failed-write", screeningCooldownMs: 0 });
	assert.equal(evaluations[0].status, "failed_write");
});
