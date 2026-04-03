import assert from "node:assert/strict";
import test from "node:test";

import { createScreeningCycleRunner } from "./screening-cycle-runner.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

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
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

test("screening runner marks discovery failure as failed_candidates instead of no-candidate skip", async () => {
	const evaluations = [];
	let agentLoopCalls = 0;
	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => {
			throw new Error("candidate provider timeout");
		},
		getTopCandidates: async () => ({ candidates: [] }),
		classifyRuntimeFailure: () => ({ reason_code: "INPUT_UNAVAILABLE", message: "candidate provider timeout" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
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
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

	await run({ cycleId: "screening-test-discovery-failure" });
	assert.equal(agentLoopCalls, 0);
	assert.equal(evaluations[0].status, "failed_candidates");
	assert.equal(evaluations[0].summary.reason_code, "INPUT_UNAVAILABLE");
});

test("screening runner keeps deterministic candidate evidence on no-candidate skips", async () => {
	const evaluations = [];
	const replays = [];
	const blockedEvaluation = {
		pool: "pool-new",
		name: "Fresh-SOL",
		deterministic_score: 18,
		eligibility_reason: "token_too_new",
		hard_blocks: ["token_too_new"],
		hard_blocked: true,
	};
	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({
			candidates: [],
			total_eligible: 0,
			total_screened: 1,
			blocked_summary: { token_too_new: 1 },
			candidate_evaluations: [blockedEvaluation],
			candidate_inputs: [{ pool: "pool-new", name: "Fresh-SOL" }],
			occupied_pools: [],
			occupied_mints: [],
		}),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: (value) => replays.push(value),
		writeEvidenceBundle: () => {},
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
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

	await run({ cycleId: "screening-test-no-candidates-evidence" });
	assert.equal(evaluations[0].status, "skipped_no_candidates");
	assert.equal(evaluations[0].candidates[0].eligibility_reason, "token_too_new");
	assert.deepEqual(evaluations[0].candidates[0].hard_blocks, ["token_too_new"]);
	assert.equal(replays[0].status, "skipped_no_candidates");
	assert.equal(replays[0].candidate_evaluations[0].eligibility_reason, "token_too_new");
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
		base: { mint: "mint-alpha", symbol: "ALPHA" },
		quote: { mint: SOL_MINT, symbol: "SOL" },
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
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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
	assert.equal(agentLoopOptions.length, 2);
	assert.equal(agentLoopOptions[0].disableTools, true);
	assert.equal(agentLoopOptions[1].disableTools, true);
});

test("screening runner does not execute a finalist that intelligence marked as hard blocked", async () => {
	const evaluations = [];
	const executeCalls = [];
	const candidate = {
		pool: "pool-1",
		name: "Alpha-SOL",
		base: { mint: "mint-alpha", symbol: "ALPHA" },
		quote: { mint: SOL_MINT, symbol: "SOL" },
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
	let agentLoopCalls = 0;

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({
			candidates: [candidate],
			total_eligible: 1,
			total_screened: 1,
			blocked_summary: {},
			occupied_pools: [],
			occupied_mints: [],
			candidate_inputs: [candidate],
		}),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name) => {
			executeCalls.push(name);
			if (name === "choose_distribution_strategy") return { strategy: "bid_ask", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: {} };
			return { success: true };
		},
		inspectCandidate: async () => ({
			smartWallets: { in_pool: [] },
			holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100 },
			narrative: { narrative: "Narrative would normally pass." },
			scoredLpers: { message: "none", candidates: [] },
			poolMemory: null,
			activeBin: { binId: 1 },
		}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({
			score: { context_score: 91 },
			hard_blocked: true,
			hard_blocks: ["blacklisted_scam_addresses 1 (holder:bwamJzzt)"],
			smart_wallet_count: 0,
			holder_metrics: { blacklisted_address_hits: 1 },
			wallet_score_source: "not_loaded",
			wallet_score_age_minutes: null,
		}),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => {
			agentLoopCalls += 1;
			return agentLoopCalls === 1
				? {
					content: JSON.stringify({
						action: "deploy",
						selected_pool: "pool-1",
						summary: "Deploy this pool.",
						confidence: { score: 0.82, label: "high" },
						evidence: [
							{ source: "ranking", summary: "highest deterministic score", supports_action: true, freshness: "fresh" },
							{ source: "planner", summary: "planner likes the range", supports_action: true, freshness: "fresh" },
						],
						freshness: { status: "fresh", oldest_signal_minutes: 2 },
						contradictions: [],
						invalidation_conditions: ["candidate becomes blocked", "signals go stale"],
					}),
				}
				: {
					content: JSON.stringify({
						action: "hold",
						selected_pool: null,
						summary: "Shadow holds.",
						confidence: { score: 0.6, label: "medium" },
						evidence: [{ source: "shadow", summary: "hold", supports_action: true, freshness: "fresh" }],
						freshness: { status: "fresh", oldest_signal_minutes: 2 },
						contradictions: [],
						invalidation_conditions: ["market context changes"],
					}),
				};
		},
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

	await run({ cycleId: "screening-test-blacklisted-finalist" });
	assert.equal(executeCalls.includes("deploy_position"), false);
	assert.equal(evaluations[0].status, "held");
	assert.equal(evaluations[0].summary.theses_blocked, 1);
});

test("screening runner backfills finalists after enriched hard blocks", async () => {
	const evaluations = [];
	let deployArgs = null;
	const candidates = [
		{ pool: "pool-1", name: "Alpha-SOL", base: { mint: "mint-alpha", symbol: "ALPHA" }, quote: { mint: SOL_MINT, symbol: "SOL" }, deterministic_score: 95, fee_active_tvl_ratio: 0.5, fee_tvl_ratio: 0.5, organic_score: 88, bin_step: 80, price_change_pct: 2, active_tvl: 12000, volume_24h: 50000, volume_window: 50000, six_hour_volatility: 4 },
		{ pool: "pool-2", name: "Beta-SOL", base: { mint: "mint-beta", symbol: "BETA" }, quote: { mint: SOL_MINT, symbol: "SOL" }, deterministic_score: 90, fee_active_tvl_ratio: 0.5, fee_tvl_ratio: 0.5, organic_score: 86, bin_step: 80, price_change_pct: 2, active_tvl: 11000, volume_24h: 45000, volume_window: 45000, six_hour_volatility: 4 },
		{ pool: "pool-3", name: "Gamma-SOL", base: { mint: "mint-gamma", symbol: "GAMMA" }, quote: { mint: SOL_MINT, symbol: "SOL" }, deterministic_score: 88, fee_active_tvl_ratio: 0.5, fee_tvl_ratio: 0.5, organic_score: 84, bin_step: 80, price_change_pct: 2, active_tvl: 10000, volume_24h: 42000, volume_window: 42000, six_hour_volatility: 4 },
	];
	let agentLoopCalls = 0;

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates, total_eligible: 3, total_screened: 3, blocked_summary: {}, occupied_pools: [], occupied_mints: [], candidate_inputs: candidates }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => ({ lp_strategy: "spot", name: "Spot" }),
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name, args) => {
			if (name === "choose_distribution_strategy") return { strategy: "spot", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: {} };
			if (name === "deploy_position") {
				deployArgs = args;
				return { success: true };
			}
			return {};
		},
		inspectCandidate: async () => ({ smartWallets: { in_pool: [] }, holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100, blacklisted_addresses: [] }, narrative: { narrative: "Narrative passes." }, scoredLpers: { message: "none", candidates: [] }, okx: { advanced: { bundle_pct: 1, is_honeypot: false, creator: null }, availability: { advanced: "ok" }, clusters: [], price: null }, poolMemory: null, activeBin: { binId: 1 }, availability: { holders: "ok", okx_advanced: "ok" } }),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: (pool) => ({ score: { context_score: pool.deterministic_score }, hard_blocked: pool.pool === "pool-1", hard_blocks: pool.pool === "pool-1" ? ["blocked top finalist"] : [], smart_wallet_count: 0, holder_metrics: null, okx: null, wallet_score_source: "not_loaded", wallet_score_age_minutes: null }),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => {
			agentLoopCalls += 1;
			return agentLoopCalls === 1
				? { content: JSON.stringify({ action: "deploy", selected_pool: "pool-3", summary: "Deploy replacement finalist.", confidence: { score: 0.82, label: "high" }, evidence: [{ source: "ranking", summary: "replacement finalist chosen", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["candidate becomes blocked", "signals go stale"] }) }
				: { content: JSON.stringify({ action: "hold", selected_pool: null, summary: "Shadow holds.", confidence: { score: 0.6, label: "medium" }, evidence: [{ source: "shadow", summary: "hold", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["market context changes"] }) };
		},
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

	await run({ cycleId: "screening-test-finalist-backfill" });
	assert.equal(deployArgs.pool_address, "pool-3");
	assert.equal(deployArgs.strategy, "spot");
	assert.equal(evaluations[0].status, "completed");
});

test("screening runner passes tokenInfo into finalist intel evaluation", async () => {
	let sawTokenInfo = false;
	const candidate = { pool: "pool-1", name: "Alpha-SOL", base: { mint: "mint-alpha", symbol: "ALPHA" }, quote: { mint: SOL_MINT, symbol: "SOL" }, deterministic_score: 91, fee_active_tvl_ratio: 0.5, fee_tvl_ratio: 0.5, organic_score: 88, bin_step: 80, price_change_pct: 2, active_tvl: 12000, volume_24h: 50000, volume_window: 50000, six_hour_volatility: 4 };

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [candidate], total_eligible: 1, total_screened: 1, blocked_summary: {}, occupied_pools: [], occupied_mints: [], candidate_inputs: [candidate] }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => ({ lp_strategy: "spot", name: "Spot" }),
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name) => {
			if (name === "choose_distribution_strategy") return { strategy: "spot", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: {} };
			if (name === "deploy_position") return { success: true };
			return {};
		},
		inspectCandidate: async () => ({ smartWallets: { in_pool: [] }, holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100, blacklisted_addresses: [] }, narrative: { narrative: "Narrative passes." }, tokenInfo: { launchpad: "pump.fun", audit: { bot_holders_pct: "8.00" } }, scoredLpers: { message: "none", candidates: [] }, okx: { advanced: { bundle_pct: 1, is_honeypot: false, creator: null }, availability: { advanced: "ok" }, clusters: [], price: { price_vs_ath_pct: 70 } }, poolMemory: null, activeBin: { binId: 1 }, availability: { holders: "ok", okx_advanced: "ok" } }),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: (_pool, context) => {
			sawTokenInfo = context.tokenInfo?.launchpad === "pump.fun" && context.tokenInfo?.audit?.bot_holders_pct === "8.00";
			return { score: { context_score: 91 }, hard_blocked: false, hard_blocks: [], smart_wallet_count: 0, holder_metrics: null, okx: null, wallet_score_source: "not_loaded", wallet_score_age_minutes: null };
		},
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: JSON.stringify({ action: "deploy", selected_pool: "pool-1", summary: "Deploy it.", confidence: { score: 0.82, label: "high" }, evidence: [{ source: "ranking", summary: "top score", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["candidate becomes blocked", "signals go stale"] }) }),
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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
		setScreeningLastTriggered: () => {},
		setScreeningLastRun: () => {},
	});

	await run({ cycleId: "screening-test-token-info-pass-through" });
	assert.equal(sawTokenInfo, true);
});

test("screening runner marks failed_write when approved deploy errors", async () => {
	const evaluations = [];
	const candidate = { pool: "pool-1", name: "Alpha-SOL", base: { mint: "mint-alpha", symbol: "ALPHA" }, quote: { mint: SOL_MINT, symbol: "SOL" }, deterministic_score: 91, fee_active_tvl_ratio: 0.5, fee_tvl_ratio: 0.5, organic_score: 88, bin_step: 80, price_change_pct: 2, active_tvl: 12000, volume_24h: 50000, volume_window: 50000, six_hour_volatility: 4 };
	let agentLoopCalls = 0;
	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [candidate], total_eligible: 1, total_screened: 1, blocked_summary: {}, occupied_pools: [], occupied_mints: [], candidate_inputs: [candidate] }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => ({ lp_strategy: "spot", name: "Spot" }),
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name) => {
			if (name === "choose_distribution_strategy") return { strategy: "spot", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: {} };
			if (name === "deploy_position") return { error: "tx failed" };
			return {};
		},
		inspectCandidate: async () => ({ smartWallets: { in_pool: [] }, holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100, blacklisted_addresses: [] }, narrative: { narrative: "Narrative passes." }, scoredLpers: { message: "none", candidates: [] }, okx: { advanced: { bundle_pct: 1, is_honeypot: false, creator: null }, availability: { advanced: "ok" }, clusters: [], price: null }, poolMemory: null, activeBin: { binId: 1 }, availability: { holders: "ok", okx_advanced: "ok" } }),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({ score: { context_score: 91 }, hard_blocked: false, hard_blocks: [], smart_wallet_count: 0, holder_metrics: null, okx: null, wallet_score_source: "not_loaded", wallet_score_age_minutes: null }),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => {
			agentLoopCalls += 1;
			return agentLoopCalls === 1
				? { content: JSON.stringify({ action: "deploy", selected_pool: "pool-1", summary: "Deploy it.", confidence: { score: 0.82, label: "high" }, evidence: [{ source: "ranking", summary: "top score", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["candidate becomes blocked", "signals go stale"] }) }
				: { content: JSON.stringify({ action: "hold", selected_pool: null, summary: "Shadow holds.", confidence: { score: 0.6, label: "medium" }, evidence: [{ source: "shadow", summary: "hold", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["market context changes"] }) };
		},
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

	await run({ cycleId: "screening-test-failed-write" });
	assert.equal(evaluations[0].status, "failed_write");
});

test("screening runner resolves autonomous preset bins into deploy args when no active strategy is set", async () => {
	let deployArgs = null;
	const candidate = {
		pool: "pool-quality-1",
		name: "Quality-SOL",
		base: { mint: "mint-quality", symbol: "QUALITY" },
		quote: { mint: SOL_MINT, symbol: "SOL" },
		deterministic_score: 93,
		fee_active_tvl_ratio: 0.05,
		fee_tvl_ratio: 0.05,
		organic_score: 84,
		holders: 2200,
		bin_step: 80,
		price_change_pct: 3,
		active_tvl: 18000,
		volume_24h: 52000,
		volume_window: 52000,
		six_hour_volatility: 4,
	};

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [candidate], total_eligible: 1, total_screened: 1, blocked_summary: {}, occupied_pools: [], occupied_mints: [], candidate_inputs: [candidate] }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name, args) => {
			if (name === "choose_distribution_strategy") return { strategy: "spot", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: { bins_below: 12, bins_above: 12 } };
			if (name === "deploy_position") {
				deployArgs = args;
				return { success: true };
			}
			return {};
		},
		inspectCandidate: async () => ({
			smartWallets: { in_pool: [{ name: "wallet-1" }] },
			holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100, blacklisted_addresses: [] },
			narrative: { narrative: "Narrative passes." },
			scoredLpers: { candidates: [{ metrics: { win_rate_pct: 82 } }] },
			okx: { advanced: { bundle_pct: 1, is_honeypot: false, creator: null }, availability: { advanced: "ok" }, clusters: [], price: null },
			poolMemory: null,
			activeBin: { binId: 1 },
			availability: { holders: "ok", okx_advanced: "ok" },
		}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({ score: { context_score: 93 }, hard_blocked: false, hard_blocks: [], smart_wallet_count: 1, holder_metrics: null, okx: null, wallet_score_source: "loaded", wallet_score_age_minutes: 5 }),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: JSON.stringify({ action: "deploy", selected_pool: "pool-quality-1", summary: "Deploy the quality spot finalist.", confidence: { score: 0.85, label: "high" }, evidence: [{ source: "ranking", summary: "quality finalist", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["candidate becomes blocked"] }) }),
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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
		setScreeningLastTriggered: () => {},
		setScreeningLastRun: () => {},
	});

	await run({ cycleId: "screening-test-autonomous-preset" });
	assert.equal(deployArgs.strategy, "spot");
	assert.equal(deployArgs.bins_below, 24);
	assert.equal(deployArgs.bins_above, 24);
});


test("screening runner backfills around wrong-side autonomous single-sided SOL candidates", async () => {
	const evaluations = [];
	let deployArgs = null;
	const blockedCandidate = {
		pool: "pool-sol-base-1",
		name: "SOL-BASE",
		base: { mint: SOL_MINT, symbol: "SOL" },
		quote: { mint: "mint-meme", symbol: "MEME" },
		deterministic_score: 92,
		fee_active_tvl_ratio: 0.05,
		fee_tvl_ratio: 0.05,
		organic_score: 84,
		holders: 2200,
		bin_step: 80,
		price_change_pct: 3,
		active_tvl: 18000,
		volume_24h: 52000,
		volume_window: 52000,
		six_hour_volatility: 4,
	};
	const compatibleCandidate = {
		pool: "pool-sol-quote-1",
		name: "SOL-QUOTE",
		base: { mint: "mint-meme", symbol: "MEME" },
		quote: { mint: SOL_MINT, symbol: "SOL" },
		deterministic_score: 91,
		fee_active_tvl_ratio: 0.05,
		fee_tvl_ratio: 0.05,
		organic_score: 84,
		holders: 2200,
		bin_step: 80,
		price_change_pct: 3,
		active_tvl: 18000,
		volume_24h: 52000,
		volume_window: 52000,
		six_hour_volatility: 4,
	};

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" }, tokens: { SOL: SOL_MINT } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [blockedCandidate, compatibleCandidate], total_eligible: 2, total_screened: 2, blocked_summary: {}, occupied_pools: [], occupied_mints: [], candidate_inputs: [blockedCandidate, compatibleCandidate] }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name, args) => {
			if (name === "choose_distribution_strategy") return { strategy: "spot", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: { bins_below: 12, bins_above: 12 } };
			if (name === "deploy_position") {
				deployArgs = args;
				return { success: true };
			}
			return {};
		},
		inspectCandidate: async () => ({
			smartWallets: { in_pool: [{ name: "wallet-1" }] },
			holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100, blacklisted_addresses: [] },
			narrative: { narrative: "Narrative passes." },
			scoredLpers: { candidates: [{ metrics: { win_rate_pct: 82 } }] },
			okx: { advanced: { bundle_pct: 1, is_honeypot: false, creator: null }, availability: { advanced: "ok" }, clusters: [], price: null },
			poolMemory: null,
			activeBin: { binId: 1 },
			availability: { holders: "ok", okx_advanced: "ok" },
		}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: (pool) => ({ score: { context_score: pool.deterministic_score }, hard_blocked: false, hard_blocks: [], smart_wallet_count: 1, holder_metrics: null, okx: null, wallet_score_source: "loaded", wallet_score_age_minutes: 5 }),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: JSON.stringify({ action: "deploy", selected_pool: "pool-sol-quote-1", summary: "Deploy compatible orientation only.", confidence: { score: 0.8, label: "high" }, evidence: [{ source: "risk", summary: "wrong-side candidate blocked", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["pool orientation changes"] }) }),
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

	await run({ cycleId: "screening-test-sol-orientation-backfill" });
	assert.equal(deployArgs.pool_address, "pool-sol-quote-1");
	assert.equal(evaluations[0].status, "completed");
	assert.equal(evaluations[0].candidates[0].deploy_orientation_status, "wrong_side");
	assert.equal(evaluations[0].candidates[0].deploy_sol_side, "token_x");
	assert.ok(evaluations[0].candidates[0].hard_blocks.includes("single_sided_sol_requires_token_y_sol"));
	assert.equal(evaluations[0].candidates[1].deploy_orientation_status, "compatible");
});

test("screening runner backfills around wrong-side active-strategy single-sided SOL candidates", async () => {
	let deployArgs = null;
	const evaluations = [];
	const activeStrategy = {
		id: "active-spot-sol",
		name: "Active Spot SOL",
		lp_strategy: "spot",
		entry: { single_side: "sol" },
		range: { bins_below: 24, bins_above: 24 },
	};
	const blockedCandidate = {
		pool: "pool-active-sol-base-1",
		name: "Active-SOL-BASE",
		base: { mint: SOL_MINT, symbol: "SOL" },
		quote: { mint: "mint-active", symbol: "ACTIVE" },
		deterministic_score: 95,
		fee_active_tvl_ratio: 0.05,
		fee_tvl_ratio: 0.05,
		organic_score: 84,
		holders: 2200,
		bin_step: 80,
		price_change_pct: 3,
		active_tvl: 18000,
		volume_24h: 52000,
		volume_window: 52000,
		six_hour_volatility: 4,
	};
	const compatibleCandidate = {
		pool: "pool-active-sol-quote-1",
		name: "Active-SOL-QUOTE",
		base: { mint: "mint-active", symbol: "ACTIVE" },
		quote: { mint: SOL_MINT, symbol: "SOL" },
		deterministic_score: 94,
		fee_active_tvl_ratio: 0.05,
		fee_tvl_ratio: 0.05,
		organic_score: 84,
		holders: 2200,
		bin_step: 80,
		price_change_pct: 3,
		active_tvl: 18000,
		volume_24h: 52000,
		volume_window: 52000,
		six_hour_volatility: 4,
	};

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" }, tokens: { SOL: SOL_MINT } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [blockedCandidate, compatibleCandidate], total_eligible: 2, total_screened: 2, blocked_summary: {}, occupied_pools: [], occupied_mints: [], candidate_inputs: [blockedCandidate, compatibleCandidate] }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => activeStrategy,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name, args) => {
			if (name === "choose_distribution_strategy") return { strategy: "spot", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: { bins_below: 12, bins_above: 12 } };
			if (name === "deploy_position") {
				deployArgs = args;
				return { success: true };
			}
			return {};
		},
		inspectCandidate: async () => ({
			smartWallets: { in_pool: [{ name: "wallet-1" }] },
			holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100, blacklisted_addresses: [] },
			narrative: { narrative: "Narrative passes." },
			scoredLpers: { candidates: [{ metrics: { win_rate_pct: 82 } }] },
			okx: { advanced: { bundle_pct: 1, is_honeypot: false, creator: null }, availability: { advanced: "ok" }, clusters: [], price: null },
			poolMemory: null,
			activeBin: { binId: 1 },
			availability: { holders: "ok", okx_advanced: "ok" },
		}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: (pool) => ({ score: { context_score: pool.deterministic_score }, hard_blocked: false, hard_blocks: [], smart_wallet_count: 1, holder_metrics: null, okx: null, wallet_score_source: "loaded", wallet_score_age_minutes: 5 }),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: JSON.stringify({ action: "deploy", selected_pool: "pool-active-sol-quote-1", summary: "Deploy the compatible active-strategy finalist.", confidence: { score: 0.8, label: "high" }, evidence: [{ source: "risk", summary: "wrong-side active candidate blocked", supports_action: true, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["pool orientation changes"] }) }),
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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

	await run({ cycleId: "screening-test-active-strategy-sol-orientation-backfill" });
	assert.equal(deployArgs.pool_address, "pool-active-sol-quote-1");
	assert.equal(evaluations[0].status, "completed");
	assert.equal(evaluations[0].candidates[0].deploy_orientation_status, "wrong_side");
	assert.ok(evaluations[0].candidates[0].hard_blocks.includes("single_sided_sol_requires_token_y_sol"));
	assert.equal(evaluations[0].candidates[1].deploy_orientation_status, "compatible");
});

test("screening runner blocks autonomous spot presets using resolved strategy-specific negative memory", async () => {
	let deployCalled = false;
	const negativeMemoryCalls = [];
	const candidate = {
		pool: "pool-quality-spot-blocked",
		name: "Blocked-Spot-SOL",
		base: { mint: "mint-quality", symbol: "QUALITY" },
		quote: { mint: SOL_MINT, symbol: "SOL" },
		deterministic_score: 94,
		fee_active_tvl_ratio: 0.05,
		fee_tvl_ratio: 0.05,
		organic_score: 84,
		holders: 2200,
		bin_step: 80,
		price_change_pct: 3,
		active_tvl: 18000,
		volume_24h: 52000,
		volume_window: 52000,
		six_hour_volatility: 4,
	};

	const run = createScreeningCycleRunner({
		log: () => {},
		config: { risk: { maxPositions: 3 }, management: { deployAmountSol: 0.5, gasReserve: 0.2 }, screening: {}, llm: { screeningModel: "test-model" } },
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getWalletBalances: async () => ({ sol: 2 }),
		discoverPools: async () => ({ pools: [] }),
		getTopCandidates: async () => ({ candidates: [candidate], total_eligible: 1, total_screened: 1, blocked_summary: {}, occupied_pools: [], occupied_mints: [], candidate_inputs: [candidate] }),
		classifyRuntimeFailure: () => ({ reason_code: "ERR", message: "err" }),
		validateStartupSnapshot: () => null,
		appendReplayEnvelope: () => {},
		writeEvidenceBundle: () => {},
		getActiveStrategy: () => null,
		computeDeployAmount: () => 0.5,
		asNumber: Number,
		deriveExpectedVolumeProfile: () => "balanced",
		executeTool: async (name) => {
			if (name === "choose_distribution_strategy") return { strategy: "spot", distribution_plan: {} };
			if (name === "calculate_dynamic_bin_tiers") return { range_plan: { bins_below: 12, bins_above: 12 } };
			if (name === "deploy_position") {
				deployCalled = true;
				return { success: true };
			}
			return {};
		},
		inspectCandidate: async () => ({
			smartWallets: { in_pool: [{ name: "wallet-1" }] },
			holders: { top_10_real_holders_pct: "10.00", bundlers_pct_in_top_100: "1.00", global_fees_sol: 100, blacklisted_addresses: [] },
			narrative: { narrative: "Narrative passes." },
			scoredLpers: { candidates: [{ metrics: { win_rate_pct: 82 } }] },
			okx: { advanced: { bundle_pct: 1, is_honeypot: false, creator: null }, availability: { advanced: "ok" }, clusters: [], price: null },
			poolMemory: null,
			activeBin: { binId: 1 },
			availability: { holders: "ok", okx_advanced: "ok" },
		}),
		deriveTrendBias: () => "neutral",
		evaluateCandidateIntel: () => ({ score: { context_score: 94 }, hard_blocked: false, hard_blocks: [], smart_wallet_count: 1, holder_metrics: null, okx: null, wallet_score_source: "loaded", wallet_score_age_minutes: 5 }),
		formatFinalistInspectionBlock: () => "",
		buildCandidateContext: () => "",
		roundMetric: (value) => value,
		agentLoop: async () => ({ content: JSON.stringify({ action: "hold", selected_pool: null, summary: "Hold blocked finalist.", confidence: { score: 0.7, label: "medium" }, evidence: [{ source: "risk", summary: "blocked by strategy-specific memory", supports_action: false, freshness: "fresh" }], freshness: { status: "fresh", oldest_signal_minutes: 2 }, contradictions: [], invalidation_conditions: ["cooldown expires"] }) }),
		evaluatePortfolioGuard: () => ({ blocked: false }),
		evaluateScreeningCycleAdmission: () => ({ allowed: true, status: "ready", summary: {} }),
		getPerformanceSummary: () => null,
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
		classifyRuntimeRegime: () => ({ proposed_regime: "neutral", confidence: 1, reason: "manual" }),
		applyRegimeHysteresis: ({ classification }) => classification,
		resolveRegimePackContext: () => ({ regime: "neutral", reason: "manual", confidence: 1, pack: { deploy: { regime_multiplier: 1 } }, effectiveScreeningConfig: {} }),
		listCounterfactualRegimes: () => [],
		getRegimePack: () => ({ deploy: { regime_multiplier: 1 } }),
		getPerformanceSizingMultiplier: () => 1,
		getRiskSizingMultiplier: () => 1,
		getNegativeRegimeCooldown: () => ({ active: false }),
		getNegativeRegimeMemory: ({ strategy }) => {
			negativeMemoryCalls.push(strategy);
			return strategy === "spot"
				? { active: true, key: "neutral|spot", cooldown_until: new Date(Date.now() + 60_000).toISOString(), remaining_ms: 60_000, hits: 2, sample_quality: "confirmed", cumulative_negative_pnl_abs: 12 }
				: { active: false };
		},
		appendCounterfactualReview: () => {},
		listActionJournalWorkflowsByCycle: () => [],
		recordCycleEvaluation: () => {},
		refreshRuntimeHealth: () => {},
		telegramEnabled: () => false,
		sendMessage: async () => {},
		setScreeningBusy: () => {},
		setScreeningLastTriggered: () => {},
		setScreeningLastRun: () => {},
	});

	await run({ cycleId: "screening-test-spot-cooldown" });
	assert.equal(deployCalled, false);
	assert.ok(negativeMemoryCalls.includes("spot"));
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
		getPerformanceHistory: () => ({ positions: [] }),
		getMemoryContext: () => null,
		getMemoryVersionStatus: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
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
