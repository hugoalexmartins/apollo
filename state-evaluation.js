const MAX_RECENT_CYCLES = 25;
const MAX_RECENT_TOOL_OUTCOMES = 40;

function emptyEvaluation() {
	return {
		recentCycles: [],
		recentToolOutcomes: [],
		counters: {
			management_cycles: 0,
			screening_cycles: 0,
			health_checks: 0,
			candidates_scored: 0,
			candidates_blocked: 0,
			runtime_actions_handled: 0,
			runtime_actions_attempted: 0,
			tool_blocks: 0,
			tool_errors: 0,
			write_successes: 0,
			theses_generated: 0,
			theses_blocked: 0,
			critic_approved: 0,
			critic_abstained: 0,
			critic_manual_reviews: 0,
			shadow_evaluations: 0,
			shadow_divergences: 0,
			shadow_matches: 0,
		},
	};
}

function incrementCounter(state, key, amount = 1) {
	const evaluation = ensureEvaluationState(state);
	evaluation.counters[key] = (evaluation.counters[key] || 0) + amount;
}

function summarizeCycleRecord(record) {
	return {
		ts: record.ts,
		cycle_type: record.cycle_type,
		status: record.status,
		summary: record.summary,
	};
}

export function ensureEvaluationState(state) {
	if (!state.evaluation || typeof state.evaluation !== "object") {
		state.evaluation = emptyEvaluation();
	}

	state.evaluation.recentCycles = Array.isArray(state.evaluation.recentCycles)
		? state.evaluation.recentCycles
		: [];
	state.evaluation.recentToolOutcomes = Array.isArray(state.evaluation.recentToolOutcomes)
		? state.evaluation.recentToolOutcomes
		: [];
	state.evaluation.counters = {
		...emptyEvaluation().counters,
		...(state.evaluation.counters || {}),
	};

	return state.evaluation;
}

export function recordCycleEvaluationInState(state, {
	cycle_id = null,
	cycle_type,
	status = "completed",
	summary = {},
	candidates = [],
	positions = [],
}) {
	if (!cycle_type) return;

	const evaluation = ensureEvaluationState(state);
	const record = {
		ts: new Date().toISOString(),
		cycle_id,
		cycle_type,
		status,
		summary,
		candidates: Array.isArray(candidates) ? candidates.slice(0, 8) : [],
		positions: Array.isArray(positions) ? positions.slice(0, 8) : [],
	};

	evaluation.recentCycles.push(record);
	if (evaluation.recentCycles.length > MAX_RECENT_CYCLES) {
		evaluation.recentCycles = evaluation.recentCycles.slice(-MAX_RECENT_CYCLES);
	}

	if (cycle_type === "management") incrementCounter(state, "management_cycles");
	if (cycle_type === "screening") incrementCounter(state, "screening_cycles");
	if (cycle_type === "health") incrementCounter(state, "health_checks");
	if (summary.candidates_scored) incrementCounter(state, "candidates_scored", Number(summary.candidates_scored) || 0);
	if (summary.candidates_blocked) incrementCounter(state, "candidates_blocked", Number(summary.candidates_blocked) || 0);
	if (summary.runtime_actions_handled) incrementCounter(state, "runtime_actions_handled", Number(summary.runtime_actions_handled) || 0);
	if (summary.runtime_actions_attempted) incrementCounter(state, "runtime_actions_attempted", Number(summary.runtime_actions_attempted) || 0);
	if (summary.theses_generated) incrementCounter(state, "theses_generated", Number(summary.theses_generated) || 0);
	if (summary.theses_blocked) incrementCounter(state, "theses_blocked", Number(summary.theses_blocked) || 0);
	if (summary.critic_approved) incrementCounter(state, "critic_approved", Number(summary.critic_approved) || 0);
	if (summary.critic_abstained) incrementCounter(state, "critic_abstained", Number(summary.critic_abstained) || 0);
	if (summary.critic_manual_reviews) incrementCounter(state, "critic_manual_reviews", Number(summary.critic_manual_reviews) || 0);
	if (summary.shadow_evaluations) incrementCounter(state, "shadow_evaluations", Number(summary.shadow_evaluations) || 0);
	if (summary.shadow_divergences) incrementCounter(state, "shadow_divergences", Number(summary.shadow_divergences) || 0);
	if (summary.shadow_matches) incrementCounter(state, "shadow_matches", Number(summary.shadow_matches) || 0);
}

export function recordToolOutcomeInState(state, { tool, outcome, reason = null, metadata = null }) {
	if (!tool || !outcome) return;

	const evaluation = ensureEvaluationState(state);
	const entry = {
		ts: new Date().toISOString(),
		tool,
		outcome,
		reason,
		cycle_id: metadata?.cycle_id || null,
		action_id: metadata?.action_id || null,
		metadata,
	};

	evaluation.recentToolOutcomes.push(entry);
	if (evaluation.recentToolOutcomes.length > MAX_RECENT_TOOL_OUTCOMES) {
		evaluation.recentToolOutcomes = evaluation.recentToolOutcomes.slice(-MAX_RECENT_TOOL_OUTCOMES);
	}

	if (outcome === "blocked") incrementCounter(state, "tool_blocks");
	if (outcome === "error") incrementCounter(state, "tool_errors");
	if (outcome === "success") incrementCounter(state, "write_successes");
}

export function getEvaluationSummaryFromState(state, limit = 5) {
	const evaluation = ensureEvaluationState(state);
	return {
		counters: evaluation.counters,
		recent_cycles: evaluation.recentCycles.slice(-limit).map(summarizeCycleRecord),
		recent_tool_outcomes: evaluation.recentToolOutcomes.slice(-limit),
	};
}
