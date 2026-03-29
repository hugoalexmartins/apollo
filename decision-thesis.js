import { jsonrepair } from "jsonrepair";

const DEFAULT_MAX_SIGNAL_AGE_MS = 10 * 60 * 1000;
const DEFAULT_MIN_CONFIDENCE = 0.55;

function asString(value, fallback = null) {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim();
	return normalized ? normalized : fallback;
}

function asFiniteNumber(value, fallback = null) {
	const num = Number(value);
	return Number.isFinite(num) ? num : fallback;
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function dedupeStrings(values = []) {
	return [...new Set(asArray(values).map((value) => asString(value, null)).filter(Boolean))];
}

function normalizeEvidenceRow(row) {
	if (!row || typeof row !== "object") return null;
	const summary = asString(row.summary || row.detail || row.reason, null);
	if (!summary) return null;
	return {
		source: asString(row.source, "unknown"),
		summary,
		supports_action: row.supports_action !== false,
		freshness: ["fresh", "stale", "unknown", "mixed"].includes(row.freshness)
			? row.freshness
			: "unknown",
	};
}

function normalizeConfidence(raw = {}) {
	const score = Math.max(0, Math.min(1, asFiniteNumber(raw.score, null) ?? asFiniteNumber(raw.confidence, null) ?? 0));
	const label = asString(raw.label, null) || (score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low");
	return {
		score: Number(score.toFixed(2)),
		label,
	};
}

function normalizeFreshness(raw = {}, maxAgeMs = DEFAULT_MAX_SIGNAL_AGE_MS) {
	const oldestSignalMinutes = asFiniteNumber(raw.oldest_signal_minutes, null);
	const ageMs = oldestSignalMinutes != null ? Math.max(0, Math.round(oldestSignalMinutes * 60_000)) : null;
	const stale = raw.status === "stale"
		|| (ageMs != null && ageMs > maxAgeMs)
		|| asArray(raw.sources).some((row) => row?.freshness === "stale");
	return {
		status: stale ? "stale" : raw.status === "mixed" ? "mixed" : "fresh",
		oldest_signal_minutes: oldestSignalMinutes,
		age_ms: ageMs,
		stale,
		max_age_ms: maxAgeMs,
	};
}

function extractJsonCandidate(content = "") {
	const trimmed = String(content || "").trim();
	if (!trimmed) return null;
	const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fencedMatch?.[1]) return fencedMatch[1].trim();
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		return trimmed.slice(firstBrace, lastBrace + 1);
	}
	return trimmed;
}

function parseRawThesis(content) {
	const candidate = extractJsonCandidate(content);
	if (!candidate) {
		return { ok: false, error: "empty_content" };
	}
	try {
		return {
			ok: true,
			value: JSON.parse(jsonrepair(candidate)),
		};
	} catch (error) {
		return {
			ok: false,
			error: error.message,
			raw: candidate,
		};
	}
	}

function buildThesisId({ cycleId, toolName, targetId, mode }) {
	return [cycleId || "decision", toolName || "hold", mode || "analysis", targetId || "unknown"]
		.map((part) => String(part).replace(/[^a-zA-Z0-9:_-]/g, "-"))
		.join(":");
}

export function parseDecisionThesisContent(content, context = {}) {
	const parsed = parseRawThesis(content);
	if (!parsed.ok) {
		return {
			ok: false,
			error: parsed.error,
			raw: content,
		};
	}

	const raw = parsed.value && typeof parsed.value === "object" ? parsed.value : {};
	const evidence = asArray(raw.evidence).map(normalizeEvidenceRow).filter(Boolean);
	const contradictions = dedupeStrings(raw.contradictions);
	const invalidationConditions = dedupeStrings(raw.invalidation_conditions);
	const summary = asString(raw.summary || raw.rationale || raw.reason, null);
	const action = asString(raw.action, "hold")?.toLowerCase();
	const targetId = asString(raw.selected_pool || raw.pool_address || raw.position || raw.position_address, null);

	return {
		ok: true,
		value: {
			thesis_id: buildThesisId({
				cycleId: context.cycle_id,
				toolName: action,
				targetId,
				mode: context.decision_mode,
			}),
			cycle_id: context.cycle_id || null,
			cycle_type: context.cycle_type || null,
			decision_mode: context.decision_mode || "model",
			agent_role: context.agent_role || null,
			action,
			target_id: targetId,
			summary,
			evidence,
			freshness: normalizeFreshness(raw.freshness || {}, context.max_signal_age_ms),
			contradictions,
			confidence: normalizeConfidence(raw.confidence || {}),
			invalidation_conditions: invalidationConditions,
			memory_version: context.memory_version || null,
			shadow_memory_version: context.shadow_memory_version || null,
			regime_label: context.regime_label || null,
			created_at: new Date().toISOString(),
			raw,
		},
	};
}

function mergeEvidence(existing = [], additions = []) {
	return [...existing, ...additions.map(normalizeEvidenceRow).filter(Boolean)];
}

export function finalizeScreeningThesis(rawThesis, {
	cycle_id,
	cycle_type = "screening",
	decision_mode = "model",
	regime_label = null,
	deploy_amount,
	finalists = [],
	memory_version = null,
	shadow_memory_version = null,
	max_signal_age_ms = DEFAULT_MAX_SIGNAL_AGE_MS,
	strategy = null,
} = {}) {
	const thesis = {
		...rawThesis,
		cycle_id,
		cycle_type,
		decision_mode,
		agent_role: "SCREENER",
		memory_version,
		shadow_memory_version,
		regime_label,
		freshness: normalizeFreshness(rawThesis?.freshness || {}, max_signal_age_ms),
		confidence: normalizeConfidence(rawThesis?.confidence || {}),
		contradictions: dedupeStrings(rawThesis?.contradictions),
		invalidation_conditions: dedupeStrings(rawThesis?.invalidation_conditions),
		evidence: asArray(rawThesis?.evidence).map(normalizeEvidenceRow).filter(Boolean),
	};

	const selectedPool = finalists.find((candidate) => candidate.pool === thesis.target_id) || null;
	if (thesis.action === "deploy") {
		if (!selectedPool) {
			thesis.contradictions.push("selected_pool_not_in_finalists");
		} else if (selectedPool.hard_blocked) {
			thesis.contradictions.push("selected_pool_hard_blocked");
		}
		thesis.tool_name = "deploy_position";
		thesis.args = selectedPool
			? {
				pool_address: selectedPool.pool,
				pool_name: selectedPool.name,
				amount_y: deploy_amount,
				strategy: ["bid_ask", "spot"].includes(strategy) ? strategy : undefined,
			}
			: null;
		thesis.target_id = selectedPool?.pool || thesis.target_id || null;
		thesis.evidence = mergeEvidence(thesis.evidence, selectedPool ? [
			{
				source: "ranking",
				summary: `${selectedPool.name} deterministic_score=${selectedPool.deterministic_score}`,
				supports_action: true,
				freshness: "fresh",
			},
			{
				source: "regime",
				summary: `regime=${regime_label || "unknown"} deploy_amount=${deploy_amount}`,
				supports_action: true,
				freshness: "fresh",
			},
		] : []);
	} else {
		thesis.action = "hold";
		thesis.tool_name = null;
		thesis.args = null;
	}

	thesis.thesis_id = buildThesisId({
		cycleId: cycle_id,
		toolName: thesis.tool_name || thesis.action,
		targetId: thesis.target_id || "screening",
		mode: decision_mode,
	});
	return thesis;
}

export function finalizeManagementThesis(rawThesis, {
	cycle_id,
	cycle_type = "management",
	decision_mode = "model",
	position,
	memory_version = null,
	shadow_memory_version = null,
	max_signal_age_ms = DEFAULT_MAX_SIGNAL_AGE_MS,
} = {}) {
	const thesis = {
		...rawThesis,
		cycle_id,
		cycle_type,
		decision_mode,
		agent_role: decision_mode === "runtime" ? "RUNTIME" : "MANAGER",
		memory_version,
		shadow_memory_version,
		freshness: normalizeFreshness(rawThesis?.freshness || {}, max_signal_age_ms),
		confidence: normalizeConfidence(rawThesis?.confidence || {}),
		contradictions: dedupeStrings(rawThesis?.contradictions),
		invalidation_conditions: dedupeStrings(rawThesis?.invalidation_conditions),
		evidence: asArray(rawThesis?.evidence).map(normalizeEvidenceRow).filter(Boolean),
		target_id: position?.position || rawThesis?.target_id || null,
		regime_label: position?.regime_label || rawThesis?.regime_label || null,
	};

	if (!position?.position || thesis.target_id !== position.position) {
		thesis.contradictions.push("position_mismatch");
	}

	if (thesis.action === "close") {
		thesis.tool_name = "close_position";
		thesis.args = {
			position_address: position?.position,
			reason: asString(rawThesis?.summary || rawThesis?.reason, position?.instruction || position?.exitAlert || "model thesis close"),
		};
	} else if (thesis.action === "rebalance") {
		thesis.tool_name = "rebalance_on_exit";
		thesis.args = {
			position_address: position?.position,
			execute: true,
		};
	} else if (thesis.action === "claim") {
		thesis.tool_name = "claim_fees";
		thesis.args = {
			position_address: position?.position,
		};
	} else if (thesis.action === "compound") {
		thesis.tool_name = "auto_compound_fees";
		thesis.args = {
			position_address: position?.position,
			execute_reinvest: false,
		};
	} else {
		thesis.action = "hold";
		thesis.tool_name = null;
		thesis.args = null;
	}

	thesis.thesis_id = buildThesisId({
		cycleId: cycle_id,
		toolName: thesis.tool_name || thesis.action,
		targetId: thesis.target_id || "position",
		mode: decision_mode,
	});
	return thesis;
}

export function buildRuntimeManagementThesis({
	cycle_id,
	position,
	plannedAction,
	memory_version = null,
	shadow_memory_version = null,
	nowMs = Date.now(),
} = {}) {
	const observedAtMs = asFiniteNumber(position?.pnl?.observed_at_ms, null);
	const ageMs = observedAtMs != null ? Math.max(0, nowMs - observedAtMs) : null;
	const pnlStale = position?.pnl?.stale === true || position?.pnl?.status === "stale";
	const action = plannedAction?.toolName === "close_position"
		? "close"
		: plannedAction?.toolName === "rebalance_on_exit"
			? "rebalance"
			: plannedAction?.toolName === "claim_fees"
				? "claim"
				: plannedAction?.toolName === "auto_compound_fees"
				? "compound"
					: "hold";
	const stale = pnlStale && plannedAction?.toolName !== "rebalance_on_exit";

	return finalizeManagementThesis({
		action,
		summary: plannedAction?.reason || plannedAction?.rule || "runtime policy action",
			evidence: [
			{
				source: "runtime_policy",
				summary: plannedAction?.rule || plannedAction?.reason || plannedAction?.toolName || "runtime",
				supports_action: true,
				freshness: stale ? "stale" : "fresh",
			},
			{
				source: "position_state",
				summary: `position=${position?.position || "unknown"} in_range=${position?.in_range} exit_alert=${position?.exitAlert || "none"}`,
				supports_action: true,
				freshness: stale ? "stale" : "fresh",
			},
			position?.memoryRecall
				? {
					source: "memory",
					summary: position.memoryRecall,
					supports_action: true,
					freshness: "unknown",
				}
				: null,
		].filter(Boolean),
		freshness: {
			status: stale ? "stale" : "fresh",
			oldest_signal_minutes: ageMs != null ? Math.round(ageMs / 60_000) : null,
		},
		confidence: {
			score: stale ? 0.4 : plannedAction?.toolName === "rebalance_on_exit" ? 0.78 : 0.9,
			label: stale ? "low" : plannedAction?.toolName === "rebalance_on_exit" ? "medium" : "high",
		},
		contradictions: [],
		invalidation_conditions: [
			"signal freshness becomes stale before execution",
			"target position no longer matches the observed state",
		],
	}, {
		cycle_id,
		decision_mode: "runtime",
		position,
		memory_version,
		shadow_memory_version,
	});
}

export function evaluateDecisionThesis(thesis, {
	min_confidence = DEFAULT_MIN_CONFIDENCE,
	max_signal_age_ms = DEFAULT_MAX_SIGNAL_AGE_MS,
} = {}) {
	const reasons = [];
	const evidenceCount = asArray(thesis?.evidence).length;
	const contradictions = dedupeStrings(thesis?.contradictions);
	const invalidationConditions = dedupeStrings(thesis?.invalidation_conditions);
	const confidenceScore = asFiniteNumber(thesis?.confidence?.score, 0) ?? 0;
	const requiredEvidence = thesis?.tool_name ? 2 : 1;
	const requireInvalidationConditions = Boolean(thesis?.tool_name);
	const stale = thesis?.freshness?.stale === true
		|| (asFiniteNumber(thesis?.freshness?.age_ms, null) != null && Number(thesis.freshness.age_ms) > max_signal_age_ms);
	const inconsistent = contradictions.length > 0;
	const weak = evidenceCount < requiredEvidence
		|| confidenceScore < min_confidence
		|| (requireInvalidationConditions && invalidationConditions.length === 0)
		|| !asString(thesis?.summary, null);

	if (evidenceCount < requiredEvidence) reasons.push("insufficient_evidence");
	if (confidenceScore < min_confidence) reasons.push("confidence_below_threshold");
	if (requireInvalidationConditions && invalidationConditions.length === 0) reasons.push("missing_invalidation_conditions");
	if (!asString(thesis?.summary, null)) reasons.push("missing_summary");
	if (stale) reasons.push("stale_signals");
	if (inconsistent) reasons.push("unresolved_contradictions");

	const reasonCode = stale
		? "THESIS_STALE"
		: inconsistent
			? "THESIS_INCONSISTENT"
			: weak
				? "THESIS_WEAK"
				: null;

	return {
		pass: !stale && !inconsistent && !weak,
		status: !stale && !inconsistent && !weak ? "approved" : thesis?.tool_name ? "manual_review" : "hold",
		reason_code: reasonCode,
		reasons,
		stale,
		weak,
		inconsistent,
		evidence_count: evidenceCount,
		confidence_score: confidenceScore,
	};
}

export function compareShadowDecision(activeThesis, shadowThesis) {
	const activeTool = activeThesis?.tool_name || activeThesis?.action || null;
	const shadowTool = shadowThesis?.tool_name || shadowThesis?.action || null;
	const activeTarget = activeThesis?.target_id || null;
	const shadowTarget = shadowThesis?.target_id || null;
	const diverged = activeTool !== shadowTool || activeTarget !== shadowTarget;
	return {
		active_tool: activeTool,
		shadow_tool: shadowTool,
		active_target: activeTarget,
		shadow_target: shadowTarget,
		diverged,
	};
}

export function summarizeDecisionThesis(thesis, assessment = null, critic = null) {
	if (!thesis) return null;
	return {
		thesis_id: thesis.thesis_id,
		action: thesis.action,
		tool_name: thesis.tool_name || null,
		target_id: thesis.target_id || null,
		confidence_score: thesis.confidence?.score ?? null,
		freshness_status: thesis.freshness?.status || null,
		assessment: assessment
			? {
				pass: assessment.pass,
				reason_code: assessment.reason_code,
			}
			: null,
		critic: critic
			? {
				pass: critic.pass,
				status: critic.status,
				reason_code: critic.reason_code,
			}
			: null,
		memory_version: thesis.memory_version || null,
		shadow_memory_version: thesis.shadow_memory_version || null,
	};
}

export function buildThesisGateMeta(thesis, assessment, critic) {
	return {
		decision_gate: {
			required: true,
			approved: Boolean(assessment?.pass && critic?.pass),
			status: critic?.status || assessment?.status || "manual_review",
			reason_code: critic?.reason_code || assessment?.reason_code || null,
			thesis_id: thesis?.thesis_id || null,
			critic_version: critic?.critic_version || null,
			memory_version: thesis?.memory_version || null,
			shadow_memory_version: thesis?.shadow_memory_version || null,
		},
		thesis_id: thesis?.thesis_id || null,
		decision_mode: thesis?.decision_mode || null,
		memory_version: thesis?.memory_version || null,
		shadow_memory_version: thesis?.shadow_memory_version || null,
		critic_status: critic?.status || null,
		critic_code: critic?.reason_code || null,
	};
}
