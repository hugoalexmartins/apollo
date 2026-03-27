import { planManagementRuntimeAction } from "./runtime-policy.js";

export async function runManagementRuntimeActions(positionData, { cycleId, config, executeTool }) {
  const runtimeActions = [];

  for (const position of positionData) {
    const plannedAction = planManagementRuntimeAction(position, config);
    if (!plannedAction) continue;

    const actionId = `${cycleId}:${plannedAction.toolName}:${runtimeActions.length + 1}`;
    const result = await executeTool(plannedAction.toolName, plannedAction.args, {
      cycle_id: cycleId,
      action_id: actionId,
    });

    runtimeActions.push({
      position: position.position,
      pair: position.pair,
      toolName: plannedAction.toolName,
      reason: plannedAction.reason,
      rule: plannedAction.rule,
      actionId,
      result,
    });
  }

  return runtimeActions;
}
