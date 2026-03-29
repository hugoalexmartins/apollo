import {
	buildRuntimeManagementThesis,
	buildThesisGateMeta,
	compareShadowDecision,
	evaluateDecisionThesis,
	finalizeManagementThesis,
	finalizeScreeningThesis,
	parseDecisionThesisContent,
	summarizeDecisionThesis,
} from "./decision-thesis.js";
import { runDecisionCritic } from "./decision-critic.js";
import { getMemoryContext, getMemoryVersionStatus } from "./memory.js";

function buildReadOnlyOptions(memoryContextOverride, stateSnapshot = null) {
	return {
		disableTools: true,
		lessonsOverride: null,
		memoryContextOverride,
		stateSnapshot,
		systemPromptSuffix: [
			"TOOLS ARE DISABLED FOR THIS TURN.",
			"Return only JSON.",
			"Do not ask follow-up questions.",
			"If evidence is weak, stale, or contradictory, choose hold.",
		].join(" "),
	};
}

function buildScreeningPrompt({
	strategyBlock,
	regimeContext,
	deployAmount,
	candidateContext,
	finalists,
}) {
	const finalistList = finalists.map((candidate) => `- ${candidate.name} (${candidate.pool})`).join("\n") || "- none";
	return [
		"SCREENING THESIS ONLY - READ ONLY",
		strategyBlock,
		`Regime: ${regimeContext.regime} (${regimeContext.reason})`,
		`Deploy amount if approved: ${deployAmount} SOL`,
		"You are not allowed to call tools or take action.",
		"Allowed finalist pools:",
		finalistList,
		candidateContext,
		"Return EXACT JSON with this shape:",
		JSON.stringify({
			action: "deploy or hold",
			selected_pool: "pool address or null",
			summary: "one sentence",
			confidence: { score: 0.72, label: "medium" },
			evidence: [
				{ source: "ranking", summary: "why", supports_action: true, freshness: "fresh" },
			],
			freshness: { status: "fresh", oldest_signal_minutes: 5 },
			contradictions: ["or empty"],
			invalidation_conditions: ["what would make this invalid"],
		}),
		"Rules:",
		"- action must be deploy or hold",
		"- selected_pool must be one of the allowed finalists when action=deploy",
		"- if uncertain, use hold",
	].join("\n\n");
}

function buildManagementPrompt(position) {
	return [
		"MANAGEMENT THESIS ONLY - READ ONLY",
		"You are not allowed to call tools or take action.",
		"Evaluate exactly one position and return only JSON.",
		position,
		"Return EXACT JSON with this shape:",
		JSON.stringify({
			action: "close or hold",
			position: "position address",
			summary: "one sentence",
			confidence: { score: 0.72, label: "medium" },
			evidence: [
				{ source: "instruction", summary: "why", supports_action: true, freshness: "fresh" },
			],
			freshness: { status: "fresh", oldest_signal_minutes: 5 },
			contradictions: ["or empty"],
			invalidation_conditions: ["what would make this invalid"],
		}),
		"Rules:",
		"- action must be close or hold",
		"- position must match the supplied position address",
		"- if uncertainty remains, use hold",
	].join("\n\n");
}

function buildFallbackThesis({
	cycle_id,
	cycle_type,
	decision_mode,
	agent_role,
	target_id = null,
	memory_version = null,
	shadow_memory_version = null,
	reason,
}) {
	return {
		thesis_id: `${cycle_id}:hold:${decision_mode}:${target_id || "unknown"}`,
		cycle_id,
		cycle_type,
		decision_mode,
		agent_role,
		action: "hold",
		tool_name: null,
		args: null,
		target_id,
		summary: reason,
		evidence: [{ source: "thesis_engine", summary: reason, supports_action: false, freshness: "unknown" }],
		freshness: { status: "stale", oldest_signal_minutes: null, age_ms: null, stale: true, max_age_ms: 600000 },
		contradictions: [reason],
		confidence: { score: 0, label: "low" },
		invalidation_conditions: ["thesis generation failed"],
		memory_version,
		shadow_memory_version,
		created_at: new Date().toISOString(),
	};
}

function parseScreeningThesis(content, context) {
	const parsed = parseDecisionThesisContent(content, {
		...context,
		agent_role: "SCREENER",
	});
	if (!parsed.ok) {
		return buildFallbackThesis({
			cycle_id: context.cycle_id,
			cycle_type: "screening",
			decision_mode: context.decision_mode,
			agent_role: "SCREENER",
			memory_version: context.memory_version,
			shadow_memory_version: context.shadow_memory_version,
			reason: `screening thesis parse failed: ${parsed.error}`,
		});
	}
	return finalizeScreeningThesis(parsed.value, context);
}

function parseManagementThesis(content, context) {
	const parsed = parseDecisionThesisContent(content, {
		...context,
		agent_role: "MANAGER",
	});
	if (!parsed.ok) {
		return buildFallbackThesis({
			cycle_id: context.cycle_id,
			cycle_type: "management",
			decision_mode: context.decision_mode,
			agent_role: "MANAGER",
			target_id: context.position?.position || null,
			memory_version: context.memory_version,
			shadow_memory_version: context.shadow_memory_version,
			reason: `management thesis parse failed: ${parsed.error}`,
		});
	}
	return finalizeManagementThesis(parsed.value, context);
}

export async function runScreeningDecisionEngine({
	agentLoop,
	cycle_id,
	config,
	strategyBlock,
	regimeContext,
	deployAmount,
	candidateContext,
	finalists,
	recentPerformance = [],
	getMemoryContextRuntime = getMemoryContext,
	getMemoryVersionStatusRuntime = getMemoryVersionStatus,
	stateSnapshot = null,
}) {
	const versions = getMemoryVersionStatusRuntime();
	const prompt = buildScreeningPrompt({ strategyBlock, regimeContext, deployAmount, candidateContext, finalists });
	const [activeResponse, shadowResponse] = await Promise.all([
		agentLoop(prompt, 1, [], "SCREENER", config.llm.screeningModel, 2048, buildReadOnlyOptions(getMemoryContextRuntime("SCREENER", { mode: "active" }), stateSnapshot)),
		agentLoop(prompt, 1, [], "SCREENER", config.llm.screeningModel, 2048, buildReadOnlyOptions(getMemoryContextRuntime("SCREENER", { mode: "shadow" }), stateSnapshot)),
	]);

	const activeThesis = parseScreeningThesis(activeResponse.content, {
		cycle_id,
		cycle_type: "screening",
		decision_mode: "model",
		regime_label: regimeContext.regime,
		deploy_amount: deployAmount,
		finalists,
		memory_version: versions.active_version,
		shadow_memory_version: versions.shadow_version,
	});
	const shadowThesis = parseScreeningThesis(shadowResponse.content, {
		cycle_id,
		cycle_type: "screening",
		decision_mode: "shadow",
		regime_label: regimeContext.regime,
		deploy_amount: deployAmount,
		finalists,
		memory_version: versions.shadow_version,
		shadow_memory_version: versions.shadow_version,
	});

	const assessment = evaluateDecisionThesis(activeThesis);
	const critic = runDecisionCritic({
		thesis: activeThesis,
		assessment,
		context: {
			regime_label: regimeContext.regime,
			recent_performance: recentPerformance,
		},
	});

	return {
		versions,
		active: {
			thesis: activeThesis,
			assessment,
			critic,
			execution_meta: buildThesisGateMeta(activeThesis, assessment, critic),
			summary: summarizeDecisionThesis(activeThesis, assessment, critic),
		},
		shadow: {
			thesis: shadowThesis,
			assessment: evaluateDecisionThesis(shadowThesis),
			summary: summarizeDecisionThesis(shadowThesis),
		},
		comparison: compareShadowDecision(activeThesis, shadowThesis),
	};
}

export async function runManagementDecisionEngine({
	agentLoop,
	cycle_id,
	config,
	positionBlock,
	position,
	recentPerformance = [],
	getMemoryContextRuntime = getMemoryContext,
	getMemoryVersionStatusRuntime = getMemoryVersionStatus,
	stateSnapshot = null,
}) {
	const versions = getMemoryVersionStatusRuntime();
	const prompt = buildManagementPrompt(positionBlock);
	const [activeResponse, shadowResponse] = await Promise.all([
		agentLoop(prompt, 1, [], "MANAGER", config.llm.managementModel, 2048, buildReadOnlyOptions(getMemoryContextRuntime("MANAGER", { mode: "active" }), stateSnapshot)),
		agentLoop(prompt, 1, [], "MANAGER", config.llm.managementModel, 2048, buildReadOnlyOptions(getMemoryContextRuntime("MANAGER", { mode: "shadow" }), stateSnapshot)),
	]);

	const activeThesis = parseManagementThesis(activeResponse.content, {
		cycle_id,
		position,
		decision_mode: "model",
		memory_version: versions.active_version,
		shadow_memory_version: versions.shadow_version,
	});
	const shadowThesis = parseManagementThesis(shadowResponse.content, {
		cycle_id,
		position,
		decision_mode: "shadow",
		memory_version: versions.shadow_version,
		shadow_memory_version: versions.shadow_version,
	});

	const assessment = evaluateDecisionThesis(activeThesis);
	const critic = runDecisionCritic({
		thesis: activeThesis,
		assessment,
		context: {
			recent_performance: recentPerformance,
		},
	});

	return {
		versions,
		active: {
			thesis: activeThesis,
			assessment,
			critic,
			execution_meta: buildThesisGateMeta(activeThesis, assessment, critic),
			summary: summarizeDecisionThesis(activeThesis, assessment, critic),
		},
		shadow: {
			thesis: shadowThesis,
			assessment: evaluateDecisionThesis(shadowThesis),
			summary: summarizeDecisionThesis(shadowThesis),
		},
		comparison: compareShadowDecision(activeThesis, shadowThesis),
	};
}

export function runRuntimeDecisionEngine({
	cycle_id,
	position,
	plannedAction,
	recentPerformance = [],
	getMemoryVersionStatusRuntime = getMemoryVersionStatus,
}) {
	const versions = getMemoryVersionStatusRuntime();
	const thesis = buildRuntimeManagementThesis({
		cycle_id,
		position,
		plannedAction,
		memory_version: versions.active_version,
		shadow_memory_version: versions.shadow_version,
	});
	const assessment = evaluateDecisionThesis(thesis);
	const critic = runDecisionCritic({
		thesis,
		assessment,
		context: {
			recent_performance: recentPerformance,
		},
	});
	return {
		versions,
		active: {
			thesis,
			assessment,
			critic,
			execution_meta: buildThesisGateMeta(thesis, assessment, critic),
			summary: summarizeDecisionThesis(thesis, assessment, critic),
		},
		shadow: null,
		comparison: null,
	};
}
