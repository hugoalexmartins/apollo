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

function isInvalidMemoryContext(memoryContext) {
	return typeof memoryContext === "string" && memoryContext.startsWith("[INVALID MEMORY STATE]");
}

function buildSettledThesis(result, {
	parser,
	fallback,
}) {
	if (result.status === "fulfilled") {
		return parser(result.value?.content || "");
	}
	return fallback(result.reason);
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
	strategy = null,
	getMemoryContextRuntime = getMemoryContext,
	getMemoryVersionStatusRuntime = getMemoryVersionStatus,
	stateSnapshot = null,
}) {
	const versions = getMemoryVersionStatusRuntime();
	const prompt = buildScreeningPrompt({ strategyBlock, regimeContext, deployAmount, candidateContext, finalists });
	const activeMemoryContext = getMemoryContextRuntime("SCREENER", { mode: "active" });
	const shadowMemoryContext = getMemoryContextRuntime("SCREENER", { mode: "shadow" });
	const [activeResponse, shadowResponse] = await Promise.allSettled([
		isInvalidMemoryContext(activeMemoryContext)
			? Promise.reject(new Error(activeMemoryContext))
			: agentLoop(prompt, 1, [], "SCREENER", config.llm.screeningModel, 2048, buildReadOnlyOptions(activeMemoryContext, stateSnapshot)),
		isInvalidMemoryContext(shadowMemoryContext)
			? Promise.reject(new Error(shadowMemoryContext))
			: agentLoop(prompt, 1, [], "SCREENER", config.llm.screeningModel, 2048, buildReadOnlyOptions(shadowMemoryContext, stateSnapshot)),
	]);

	const activeContext = {
		cycle_id,
		cycle_type: "screening",
		decision_mode: "model",
		regime_label: regimeContext.regime,
		deploy_amount: deployAmount,
		finalists,
		strategy,
		memory_version: versions.active_version,
		shadow_memory_version: versions.shadow_version,
	};
	const shadowContext = {
		cycle_id,
		cycle_type: "screening",
		decision_mode: "shadow",
		regime_label: regimeContext.regime,
		deploy_amount: deployAmount,
		finalists,
		strategy,
		memory_version: versions.shadow_version,
		shadow_memory_version: versions.shadow_version,
	};
	const activeThesis = buildSettledThesis(activeResponse, {
		parser: (content) => parseScreeningThesis(content, activeContext),
		fallback: (error) => buildFallbackThesis({
			cycle_id,
			cycle_type: "screening",
			decision_mode: "model",
			agent_role: "SCREENER",
			memory_version: versions.active_version,
			shadow_memory_version: versions.shadow_version,
			reason: `screening thesis unavailable: ${error?.message || String(error)}`,
		}),
	});
	const shadowThesis = buildSettledThesis(shadowResponse, {
		parser: (content) => parseScreeningThesis(content, shadowContext),
		fallback: (error) => buildFallbackThesis({
			cycle_id,
			cycle_type: "screening",
			decision_mode: "shadow",
			agent_role: "SCREENER",
			memory_version: versions.shadow_version,
			shadow_memory_version: versions.shadow_version,
			reason: `shadow thesis unavailable: ${error?.message || String(error)}`,
		}),
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
			available: shadowResponse.status === "fulfilled",
			thesis: shadowThesis,
			assessment: evaluateDecisionThesis(shadowThesis),
			summary: summarizeDecisionThesis(shadowThesis),
		},
		comparison: {
			...compareShadowDecision(activeThesis, shadowThesis),
			shadow_available: shadowResponse.status === "fulfilled",
		},
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
	const activeMemoryContext = getMemoryContextRuntime("MANAGER", { mode: "active" });
	const shadowMemoryContext = getMemoryContextRuntime("MANAGER", { mode: "shadow" });
	const [activeResponse, shadowResponse] = await Promise.allSettled([
		isInvalidMemoryContext(activeMemoryContext)
			? Promise.reject(new Error(activeMemoryContext))
			: agentLoop(prompt, 1, [], "MANAGER", config.llm.managementModel, 2048, buildReadOnlyOptions(activeMemoryContext, stateSnapshot)),
		isInvalidMemoryContext(shadowMemoryContext)
			? Promise.reject(new Error(shadowMemoryContext))
			: agentLoop(prompt, 1, [], "MANAGER", config.llm.managementModel, 2048, buildReadOnlyOptions(shadowMemoryContext, stateSnapshot)),
	]);

	const activeContext = {
		cycle_id,
		position,
		decision_mode: "model",
		memory_version: versions.active_version,
		shadow_memory_version: versions.shadow_version,
	};
	const shadowContext = {
		cycle_id,
		position,
		decision_mode: "shadow",
		memory_version: versions.shadow_version,
		shadow_memory_version: versions.shadow_version,
	};
	const activeThesis = buildSettledThesis(activeResponse, {
		parser: (content) => parseManagementThesis(content, activeContext),
		fallback: (error) => buildFallbackThesis({
			cycle_id,
			cycle_type: "management",
			decision_mode: "model",
			agent_role: "MANAGER",
			target_id: position?.position || null,
			memory_version: versions.active_version,
			shadow_memory_version: versions.shadow_version,
			reason: `management thesis unavailable: ${error?.message || String(error)}`,
		}),
	});
	const shadowThesis = buildSettledThesis(shadowResponse, {
		parser: (content) => parseManagementThesis(content, shadowContext),
		fallback: (error) => buildFallbackThesis({
			cycle_id,
			cycle_type: "management",
			decision_mode: "shadow",
			agent_role: "MANAGER",
			target_id: position?.position || null,
			memory_version: versions.shadow_version,
			shadow_memory_version: versions.shadow_version,
			reason: `shadow thesis unavailable: ${error?.message || String(error)}`,
		}),
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
			available: shadowResponse.status === "fulfilled",
			thesis: shadowThesis,
			assessment: evaluateDecisionThesis(shadowThesis),
			summary: summarizeDecisionThesis(shadowThesis),
		},
		comparison: {
			...compareShadowDecision(activeThesis, shadowThesis),
			shadow_available: shadowResponse.status === "fulfilled",
		},
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
