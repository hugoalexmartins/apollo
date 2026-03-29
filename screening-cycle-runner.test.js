import assert from "node:assert/strict";
import test from "node:test";

import { createScreeningCycleRunner } from "./screening-cycle-runner.js";

test("screening runner fails closed on startup precheck before invoking the model", async () => {
	const evaluations = [];
	const replays = [];
	const evidence = [];
	let agentLoopCalls = 0;
	let screeningLastTriggeredCalls = 0;
	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ error: "positions unavailable" }),
		getWalletBalances: async () => ({ sol: 0 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [] }),
		classifyRuntimeFailure: () => ({ reason_code: "INPUT_UNAVAILABLE", message: "positions unavailable" }),
		validateStartupSnapshot: () => ({ reason_code: "INPUT_UNAVAILABLE", message: "positions unavailable" }),
		appendReplayEnvelope: (value) => replays.push(value),
		writeEvidenceBundle: (value) => evidence.push(value),
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async () => ({}),
		inspectCandidate: async () => ({}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({}),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => {
			agentLoopCalls += 1;
			return { content: "" };
		},
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		classifyRuntimeRegime: () => ({ proposed_regime: "neutral", confidence: 1, reason: "manual" }),
		applyRegimeHysteresis: ({ classification }) => classification,
		resolveRegimePackContext: () => ({ regime: "neutral", pack: { deploy: { regime_multiplier: 1 } }, effectiveScreeningConfig: {} }),
		listCounterfactualRegimes: () => [],
		getRegimePack: () => ({ deploy: { regime_multiplier: 1 } }),
		getPerformanceSizingMultiplier: () => 1,
		getRiskSizingMultiplier: () => 1,
		getNegativeRegimeCooldown: () => ({ active: false }),
		getNegativeRegimeMemory: () => ({ active: false }),
		appendCounterfactualReview: () => {},
		listActionJournalWorkflowsByCycle: () => [],
		recordCycleEvaluation: (value) => evaluations.push(value),
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		setScreeningBusy: () => {},
		setScreeningLastTriggered: () => {
			screeningLastTriggeredCalls += 1;
		},
		setScreeningLastRun: () => {},
	});

	await run({ cycleId: "screening-test-1" });
	assert.equal(agentLoopCalls, 0);
	assert.equal(screeningLastTriggeredCalls, 0);
	assert.equal(evaluations[0].status, "failed_precheck");
	assert.equal(replays[0].reason_code, "INPUT_UNAVAILABLE");
	assert.equal(evidence[0].status, "failed_precheck");
});

test("screening runner fails closed when regime state is invalid", async () => {
	const evaluations = [];
	const evidence = [];
	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [] }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: (value) => evidence.push(value),
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async () => ({}),
		inspectCandidate: async () => ({}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({}),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: "" }),
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		classifyRuntimeRegime: () => ({ proposed_regime: "neutral", confidence: 1, reason: "manual" }),
		applyRegimeHysteresis: () => ({ invalid_state: true, error: "regime state unreadable" }),
		resolveRegimePackContext: () => ({ regime: null, pack: null, effectiveScreeningConfig: {}, invalid_state: true, error: "regime state unreadable" }),
		listCounterfactualRegimes: () => [],
		getRegimePack: () => ({ deploy: { regime_multiplier: 1 } }),
		getPerformanceSizingMultiplier: () => 1,
		getRiskSizingMultiplier: () => 1,
		getNegativeRegimeCooldown: () => ({ active: false }),
		getNegativeRegimeMemory: () => ({ active: false }),
		appendCounterfactualReview: () => {},
		listActionJournalWorkflowsByCycle: () => [],
		recordCycleEvaluation: (value) => evaluations.push(value),
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		setScreeningBusy: () => {},
		setScreeningLastTriggered: () => {},
		setScreeningLastRun: () => {},
	});

	await run({ cycleId: "screening-test-invalid-regime" });
	assert.equal(evaluations[0].status, "failed_precheck");
	assert.equal(evidence[0].reason_code, "REGIME_STATE_INVALID");
});

test("screening runner stamps last-triggered after admission and reuses the forced positions snapshot", async () => {
	const positionsSnapshot = { total_positions: 0, positions: [] };
	const triggeredAt = [];
	const getMyPositionsCalls = [];
	let passedPositionsSnapshot = null;
	const agentLoopOptions = [];
 	const candidate = {
		pool: "pool-1",
		name: "Alpha-SOL",
		deterministic_score: 91,
		fee_active_tvl_ratio: 0.5,
		fee_tvl_ratio: 0.5,
		organic_score: 88,
		bin_step: 80,
		price_change_pct: 2,
		active_tvl: 12000,
		volume_24h: 50000,
		volume_window: 50000,
		six_hour_volatility: 4,
	};

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async (args) => {
			getMyPositionsCalls.push(args);
			return positionsSnapshot;
		},
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async ({ positionsSnapshot: snapshot }) => {
			passedPositionsSnapshot = snapshot;
			return {
				candidates: [candidate],
				total_eligible: 1,
				total_screened: 1,
				blocked_summary: {},
				occupied_pools: [],
				occupied_mints: [],
				candidate_inputs: [candidate],
			};
		},
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async () => ({ strategy: "balanced", distribution_plan: {}, range_plan: {} }),
		inspectCandidate: async () => ({
			smartWallets: { in_pool: [] },
			holders: null,
			narrative: { narrative: "Alpha liquidity pool with enough narrative detail for testing." },
			scoredLpers: { message: "none", candidates: [] },
			poolMemory: null,
			activeBin: { binId: 1 },
		}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({
			score: { context_score: 91 },
			hard_blocked: false,
			hard_blocks: [],
			smart_wallet_count: 0,
			holder_metrics: null,
			wallet_score_source: "not_loaded",
			wallet_score_age_minutes: null,
		}),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async (...args) => {
			agentLoopOptions.push(args[6]);
			return { content: "" };
		},
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		classifyRuntimeRegime: () => ({ proposed_regime: "neutral", confidence: 1, reason: "manual" }),
		applyRegimeHysteresis: ({ classification }) => classification,
		resolveRegimePackContext: () => ({ regime: "neutral", reason: "manual", confidence: 1, pack: { deploy: { regime_multiplier: 1 } }, effectiveScreeningConfig: {} }),
		listCounterfactualRegimes: () => [],
		getRegimePack: () => ({ deploy: { regime_multiplier: 1 } }),
		getPerformanceSizingMultiplier: () => 1,
		getRiskSizingMultiplier: () => 1,
		getNegativeRegimeCooldown: () => ({ active: false }),
		getNegativeRegimeMemory: () => ({ active: false }),
		appendCounterfactualReview: () => {},
		listActionJournalWorkflowsByCycle: () => [],
		recordCycleEvaluation: () => {},
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		setScreeningBusy: () => {},
		setScreeningLastTriggered: (value) => triggeredAt.push(value),
		setScreeningLastRun: () => {},
	});

	await run({ cycleId: "screening-test-snapshot" });
	assert.deepEqual(getMyPositionsCalls, [{ force: true }]);
	assert.equal(passedPositionsSnapshot, positionsSnapshot);
	assert.equal(triggeredAt.length, 1);
	assert.equal(typeof triggeredAt[0], "number");
	assert.equal(agentLoopOptions.length, 1);
	assert.equal(agentLoopOptions[0].disableLiveStateTools, true);
});

test("screening runner fails closed when negative regime state is invalid inside candidate blocking", async () => {
	const evaluations = [];
	const replays = [];
	const evidence = [];

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [], total_eligible: 0, total_screened: 0, blocked_summary: { negative_regime_memory_invalid_state: 1 } }),
		classifyRuntimeFailure: () => ({ reason_code: "STATE_INVALID", message: "negative regime memory state invalid" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: (value) => replays.push(value),
		writeEvidenceBundle: (value) => evidence.push(value),
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async () => ({}),
		inspectCandidate: async () => ({}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({}),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: "" }),
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		classifyRuntimeRegime: () => ({ proposed_regime: "neutral", confidence: 1, reason: "manual" }),
		applyRegimeHysteresis: ({ classification }) => classification,
		resolveRegimePackContext: () => ({ regime: "neutral", reason: "manual", confidence: 1, pack: { deploy: { regime_multiplier: 1 } }, effectiveScreeningConfig: {} }),
		listCounterfactualRegimes: () => [],
		getRegimePack: () => ({ deploy: { regime_multiplier: 1 } }),
		getPerformanceSizingMultiplier: () => 1,
		getRiskSizingMultiplier: () => 1,
		getNegativeRegimeCooldown: () => ({ active: false }),
		getNegativeRegimeMemory: () => ({ active: false }),
		appendCounterfactualReview: () => {},
		listActionJournalWorkflowsByCycle: () => [],
		recordCycleEvaluation: (value) => evaluations.push(value),
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		setScreeningBusy: () => {},
		setScreeningLastTriggered: () => {},
		setScreeningLastRun: () => {},
	});

	await run({ cycleId: "screening-test-negative-regime-invalid" });
	assert.equal(evaluations[0].status, "failed_candidates");
	assert.equal(evaluations[0].summary.reason_code, "STATE_INVALID");
	assert.equal(replays[0].reason_code, "STATE_INVALID");
	assert.equal(evidence[0].status, "failed_candidates");
});
