import assert from "node:assert/strict";
import test from "node:test";

import { runManagementDecisionEngine, runScreeningDecisionEngine } from "./autonomy-engine.js";

test("runScreeningDecisionEngine keeps active decision when shadow thesis fails", async () => {
	let calls = 0;
	const result = await runScreeningDecisionEngine({
		agentLoop: async () => {
			calls += 1;
			if (calls === 1) {
				return {
					content: JSON.stringify({
						action: "deploy",
						selected_pool: "pool-1",
						summary: "Deploy the top finalist.",
						confidence: { score: 0.82, label: "high" },
						evidence: [{ source: "ranking", summary: "top deterministic score", supports_action: true, freshness: "fresh" }],
						freshness: { status: "fresh", oldest_signal_minutes: 2 },
						contradictions: [],
						invalidation_conditions: ["candidate becomes blocked", "signals go stale"],
					}),
				};
			}
			throw new Error("shadow model timeout");
		},
		cycle_id: "screening-shadow-fail",
		config: { llm: { screeningModel: "test-model" } },
		strategyBlock: "ACTIVE STRATEGY: demo",
		regimeContext: { regime: "neutral", reason: "manual" },
		deployAmount: 0.5,
		candidateContext: "candidate context",
		finalists: [{ pool: "pool-1", name: "Alpha-SOL", deterministic_score: 91, hard_blocked: false }],
		strategy: "spot",
		recentPerformance: [],
		getMemoryContextRuntime: () => null,
		getMemoryVersionStatusRuntime: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
	});

	assert.equal(result.active.critic.pass, true);
	assert.equal(result.active.thesis.args.strategy, "spot");
	assert.equal(result.shadow.available, false);
	assert.equal(result.comparison.shadow_available, false);
});

test("runManagementDecisionEngine keeps active decision when shadow thesis fails", async () => {
	let calls = 0;
	const result = await runManagementDecisionEngine({
		agentLoop: async () => {
			calls += 1;
			if (calls === 1) {
				return {
					content: JSON.stringify({
						action: "close",
						position: "pos-1",
						summary: "Close the position.",
						confidence: { score: 0.88, label: "high" },
						evidence: [
							{ source: "instruction", summary: "threshold reached", supports_action: true, freshness: "fresh" },
							{ source: "position_state", summary: "position is in range and eligible for close", supports_action: true, freshness: "fresh" },
						],
						freshness: { status: "fresh", oldest_signal_minutes: 1 },
						contradictions: [],
						invalidation_conditions: ["position no longer open", "signal turns stale"],
					}),
				};
			}
			throw new Error("shadow model timeout");
		},
		cycle_id: "management-shadow-fail",
		config: { llm: { managementModel: "test-model" } },
		positionBlock: "POSITION block",
		position: { position: "pos-1", pair: "Alpha-SOL" },
		recentPerformance: [],
		getMemoryContextRuntime: () => null,
		getMemoryVersionStatusRuntime: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
	});

	assert.equal(result.active.critic.pass, true);
	assert.equal(result.active.thesis.tool_name, "close_position");
	assert.equal(result.shadow.available, false);
	assert.equal(result.comparison.shadow_available, false);
});

test("runScreeningDecisionEngine fails closed when active memory context is invalid", async () => {
	const result = await runScreeningDecisionEngine({
		agentLoop: async () => {
			throw new Error("should not call model when active memory is invalid");
		},
		cycle_id: "screening-invalid-memory",
		config: { llm: { screeningModel: "test-model" } },
		strategyBlock: "ACTIVE STRATEGY: demo",
		regimeContext: { regime: "neutral", reason: "manual" },
		deployAmount: 0.5,
		candidateContext: "candidate context",
		finalists: [{ pool: "pool-1", name: "Alpha-SOL", deterministic_score: 91, hard_blocked: false }],
		strategy: "spot",
		recentPerformance: [],
		getMemoryContextRuntime: (_role, options) => options?.mode === "active" ? "[INVALID MEMORY STATE] strategies.json: bad json" : null,
		getMemoryVersionStatusRuntime: () => ({ active_version: "policy-v1", shadow_version: "policy-shadow-v1" }),
	});

	assert.equal(result.active.critic.pass, false);
	assert.equal(result.active.thesis.action, "hold");
	assert.match(result.active.thesis.summary, /invalid memory state/i);
});
