import assert from "node:assert/strict";
import test from "node:test";

import {
	evaluateDecisionThesis,
	finalizeScreeningThesis,
	parseDecisionThesisContent,
} from "./decision-thesis.js";
import { runDecisionCritic } from "./decision-critic.js";

test("screening thesis finalizes finalist deploy decisions into executable args", () => {
	const parsed = parseDecisionThesisContent(JSON.stringify({
		action: "deploy",
		selected_pool: "pool-1",
		summary: "Deploy into the top finalist.",
		confidence: { score: 0.8, label: "high" },
		evidence: [
			{ source: "ranking", summary: "top deterministic score", supports_action: true, freshness: "fresh" },
		],
		freshness: { status: "fresh", oldest_signal_minutes: 3 },
		contradictions: [],
		invalidation_conditions: ["hard block appears", "signals go stale"],
	}), {
		cycle_id: "screening-1",
		decision_mode: "model",
		memory_version: "policy-v1",
		shadow_memory_version: "policy-shadow-v1",
	});
	assert.equal(parsed.ok, true);

	const thesis = finalizeScreeningThesis(parsed.value, {
		cycle_id: "screening-1",
		deploy_amount: 0.5,
		regime_label: "neutral",
		strategy: "spot",
		finalists: [{ pool: "pool-1", name: "Alpha-SOL", deterministic_score: 91, hard_blocked: false }],
		memory_version: "policy-v1",
		shadow_memory_version: "policy-shadow-v1",
	});
	const assessment = evaluateDecisionThesis(thesis);

	assert.equal(thesis.tool_name, "deploy_position");
	assert.equal(thesis.args.pool_address, "pool-1");
	assert.equal(thesis.args.amount_y, 0.5);
	assert.equal(thesis.args.strategy, "spot");
	assert.equal(assessment.pass, true);
});

test("screening thesis becomes inconsistent when selected pool is blocked or missing", () => {
	const blockedParsed = parseDecisionThesisContent(JSON.stringify({
		action: "deploy",
		selected_pool: "pool-1",
		summary: "Deploy into the blocked finalist.",
		confidence: { score: 0.8, label: "high" },
		evidence: [{ source: "ranking", summary: "top deterministic score", supports_action: true, freshness: "fresh" }],
		freshness: { status: "fresh", oldest_signal_minutes: 3 },
		contradictions: [],
		invalidation_conditions: ["hard block appears", "signals go stale"],
	}), {
		cycle_id: "screening-contradiction",
		decision_mode: "model",
	});
	const blockedThesis = finalizeScreeningThesis(blockedParsed.value, {
		cycle_id: "screening-contradiction",
		deploy_amount: 0.5,
		regime_label: "neutral",
		finalists: [{ pool: "pool-1", name: "Alpha-SOL", deterministic_score: 91, hard_blocked: true }],
	});
	const blockedAssessment = evaluateDecisionThesis(blockedThesis);
	assert.equal(blockedAssessment.pass, false);
	assert.ok(blockedThesis.contradictions.includes("selected_pool_hard_blocked"));

	const missingParsed = parseDecisionThesisContent(JSON.stringify({
		action: "deploy",
		selected_pool: "pool-missing",
		summary: "Deploy into a non-finalist.",
		confidence: { score: 0.8, label: "high" },
		evidence: [{ source: "ranking", summary: "top deterministic score", supports_action: true, freshness: "fresh" }],
		freshness: { status: "fresh", oldest_signal_minutes: 3 },
		contradictions: [],
		invalidation_conditions: ["signals go stale"],
	}), {
		cycle_id: "screening-missing",
		decision_mode: "model",
	});
	const missingThesis = finalizeScreeningThesis(missingParsed.value, {
		cycle_id: "screening-missing",
		deploy_amount: 0.5,
		regime_label: "neutral",
		finalists: [{ pool: "pool-1", name: "Alpha-SOL", deterministic_score: 91, hard_blocked: false }],
	});
	assert.ok(missingThesis.contradictions.includes("selected_pool_not_in_finalists"));
});

test("critic blocks deploy thesis during recent realized loss cluster", () => {
	const parsed = parseDecisionThesisContent(JSON.stringify({
		action: "deploy",
		selected_pool: "pool-1",
		summary: "Deploy into the top finalist.",
		confidence: { score: 0.8, label: "high" },
		evidence: [
			{ source: "ranking", summary: "top deterministic score", supports_action: true, freshness: "fresh" },
		],
		freshness: { status: "fresh", oldest_signal_minutes: 3 },
		contradictions: [],
		invalidation_conditions: ["hard block appears", "signals go stale"],
	}), {
		cycle_id: "screening-2",
		decision_mode: "model",
		memory_version: "policy-v1",
		shadow_memory_version: "policy-shadow-v1",
	});
	const thesis = finalizeScreeningThesis(parsed.value, {
		cycle_id: "screening-2",
		deploy_amount: 0.5,
		regime_label: "neutral",
		finalists: [{ pool: "pool-1", name: "Alpha-SOL", deterministic_score: 91, hard_blocked: false }],
		memory_version: "policy-v1",
		shadow_memory_version: "policy-shadow-v1",
	});
	const assessment = evaluateDecisionThesis(thesis);
	const critic = runDecisionCritic({
		thesis,
		assessment,
		context: {
			recent_performance: [
				{ pnl_pct: -4, close_reason: "stop loss" },
				{ pnl_pct: -6, close_reason: "emergency stop loss" },
				{ pnl_pct: -2, close_reason: "fee yield too low" },
			],
		},
	});

	assert.equal(critic.pass, false);
	assert.equal(critic.status, "hold");
	assert.equal(critic.kill_signals.recent_loss_cluster, true);
});
