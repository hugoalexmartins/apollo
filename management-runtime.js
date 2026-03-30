import { runRuntimeDecisionEngine } from "./autonomy-engine.js";
import { planManagementRuntimeAction } from "./runtime-policy.js";
import {
	markSlowManagementReview,
	shouldRunSlowManagementReview,
} from "./management-review-window.js";

function didHandleRuntimeAction(result) {
	return Boolean(
		result
		&& !result.blocked
		&& !result.error
		&& !result.skipped
		&& result.success !== false,
	);
}

export async function runManagementRuntimeActions(positionData, { cycleId, config, executeTool, recentPerformance = [], getMemoryVersionStatus = undefined, nowMs = Date.now() }) {
  const runtimeActions = [];
	const handledPositions = new Set();
	const slowReviewDue = shouldRunSlowManagementReview({
		nowMs,
		intervalMs: (config.management.slowReviewIntervalMin || 15) * 60_000,
	});

	for (const position of positionData) {
		const plannedAction = planManagementRuntimeAction(position, config, null, { phase: "fast" });
    if (!plannedAction) continue;
		const decision = runRuntimeDecisionEngine({
			cycle_id: cycleId,
			position,
			plannedAction,
			recentPerformance,
			getMemoryVersionStatusRuntime: getMemoryVersionStatus,
		});

    const actionId = `${cycleId}:${plannedAction.toolName}:${runtimeActions.length + 1}`;
		const result = decision.active.critic.pass
			? await executeTool(plannedAction.toolName, plannedAction.args, {
				cycle_id: cycleId,
				cycle_type: "management",
				action_id: actionId,
				...decision.active.execution_meta,
			})
			: {
				blocked: true,
				reason: decision.active.critic.reasons.join(", ") || decision.active.critic.reason_code || "critic_abstained",
				manual_review: decision.active.critic.status === "manual_review",
			};

		runtimeActions.push({
			position: position.position,
      pair: position.pair,
      toolName: plannedAction.toolName,
      reason: plannedAction.reason,
      rule: plannedAction.rule,
			actionId,
			thesis: decision.active.summary,
			critic: decision.active.critic,
			result,
		});
		if (didHandleRuntimeAction(result)) handledPositions.add(position.position);
  }

	if (slowReviewDue) {
		for (const position of positionData) {
			if (handledPositions.has(position.position)) continue;
			const plannedAction = planManagementRuntimeAction(position, config, null, { phase: "slow" });
			if (!plannedAction) continue;
			const decision = runRuntimeDecisionEngine({
				cycle_id: cycleId,
				position,
				plannedAction,
				recentPerformance,
				getMemoryVersionStatusRuntime: getMemoryVersionStatus,
			});

			const actionId = `${cycleId}:${plannedAction.toolName}:${runtimeActions.length + 1}`;
			const result = decision.active.critic.pass
				? await executeTool(plannedAction.toolName, plannedAction.args, {
					cycle_id: cycleId,
					cycle_type: "management",
					action_id: actionId,
					...decision.active.execution_meta,
				})
				: {
					blocked: true,
					reason: decision.active.critic.reasons.join(", ") || decision.active.critic.reason_code || "critic_abstained",
					manual_review: decision.active.critic.status === "manual_review",
				};

			runtimeActions.push({
				position: position.position,
				pair: position.pair,
				toolName: plannedAction.toolName,
				reason: plannedAction.reason,
				rule: plannedAction.rule,
				actionId,
				thesis: decision.active.summary,
				critic: decision.active.critic,
				result,
			});
			if (didHandleRuntimeAction(result)) handledPositions.add(position.position);
		}
		markSlowManagementReview({ nowMs });
	}

  return runtimeActions;
}
