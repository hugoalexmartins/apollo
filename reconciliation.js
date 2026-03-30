import { replayManagementEnvelope, replayScreeningEnvelope } from "./cycle-replay.js";

function buildReport(runId, mismatches) {
  return {
    runId,
    status: mismatches.length === 0 ? "match" : "mismatch",
    mismatches,
  };
}

function pushMismatchIfDifferent(mismatches, field, expected, actual) {
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		mismatches.push({ field, expected, actual });
	}
}

function summarizeWorkflowTools(writeWorkflows = []) {
	return (Array.isArray(writeWorkflows) ? writeWorkflows : []).map((workflow) => workflow.tool).filter(Boolean);
}

function validateScreeningTruth(envelope, mismatches) {
	const active = envelope?.active_thesis || null;
	const shadow = envelope?.shadow_thesis || null;
	const comparison = envelope?.shadow_comparison || null;
	const decisionResult = envelope?.decision_result || null;
	const shortlistPools = (envelope?.shortlist || []).map((item) => item.pool);
	const workflowTools = summarizeWorkflowTools(envelope?.write_workflows);

	if (active?.target_id && !shortlistPools.includes(active.target_id)) {
		mismatches.push({ field: "activeThesisTarget", expected: shortlistPools, actual: active.target_id });
	}
	if (decisionResult?.status === "success" && active?.tool_name && !workflowTools.includes(active.tool_name)) {
		mismatches.push({ field: "screeningWriteWorkflow", expected: active.tool_name, actual: workflowTools });
	}
	if (comparison && active && shadow) {
		const actualDiverged = (active.tool_name || active.action || null) !== (shadow.tool_name || shadow.action || null)
			|| (active.target_id || null) !== (shadow.target_id || null);
		pushMismatchIfDifferent(mismatches, "shadowComparison", comparison.diverged ?? null, actualDiverged);
	}
}

function validateManagementTruth(envelope, mismatches) {
	const workflowTools = summarizeWorkflowTools(envelope?.write_workflows);
	for (const action of envelope?.runtime_actions || []) {
		if (action?.result?.status === "success" && action?.tool && !workflowTools.includes(action.tool)) {
			mismatches.push({ field: `runtimeActionWorkflow:${action.position}`, expected: action.tool, actual: workflowTools });
		}
	}
	for (const decision of envelope?.model_decisions || []) {
		if (decision?.result?.status === "success" && decision?.thesis?.tool_name && !workflowTools.includes(decision.thesis.tool_name)) {
			mismatches.push({ field: `modelDecisionWorkflow:${decision.position}`, expected: decision.thesis.tool_name, actual: workflowTools });
		}
		if (decision?.comparison && decision?.thesis && decision?.shadow) {
			const actualDiverged = (decision.thesis.tool_name || decision.thesis.action || null) !== (decision.shadow.tool_name || decision.shadow.action || null)
				|| (decision.thesis.target_id || null) !== (decision.shadow.target_id || null);
			pushMismatchIfDifferent(mismatches, `modelDecisionShadow:${decision.position}`, decision.comparison.diverged ?? null, actualDiverged);
		}
	}
}

export function reconcileScreeningEnvelope(envelope) {
  const replayed = replayScreeningEnvelope(envelope);
  const mismatches = [];

	if (envelope.status) {
		pushMismatchIfDifferent(mismatches, "status", envelope.status, replayed.status || null);
		pushMismatchIfDifferent(mismatches, "summary", envelope.summary || null, replayed.summary || null);
		return buildReport(envelope.cycle_id || null, mismatches);
	}

  const expectedOrder = (envelope.shortlist || []).map((item) => item.pool);
  const actualOrder = (replayed.shortlist || []).map((item) => item.pool);

	pushMismatchIfDifferent(mismatches, "candidateOrder", expectedOrder, actualOrder);

	pushMismatchIfDifferent(mismatches, "terminalDecision", envelope.total_eligible ?? null, replayed.total_eligible);
	validateScreeningTruth(envelope, mismatches);

	if ((envelope.reason_code || null) !== null) {
		mismatches.push({ field: "degradedReason", expected: envelope.reason_code, actual: null });
  }

  return buildReport(envelope.cycle_id || null, mismatches);
}

export function reconcileManagementEnvelope(envelope, config) {
  const replayed = replayManagementEnvelope(envelope, config);
  const expectedActions = (envelope.runtime_actions || []).map((item) => ({
    position: item.position,
    tool: item.tool,
    rule: item.rule,
  }));
  const actualActions = replayed.actions.map((item) => ({
    position: item.position,
    tool: item.tool,
    rule: item.rule,
  }));
  const mismatches = [];

	if (envelope.status) {
		pushMismatchIfDifferent(mismatches, "status", envelope.status, replayed.status || null);
		pushMismatchIfDifferent(mismatches, "summary", envelope.summary || null, replayed.summary || null);
		return buildReport(envelope.cycle_id || null, mismatches);
	}

	pushMismatchIfDifferent(mismatches, "terminalDecision", expectedActions, actualActions);
	validateManagementTruth(envelope, mismatches);

	if ((envelope.reason_code || null) !== null) {
    mismatches.push({ field: "degradedReason", expected: envelope.reason_code, actual: null });
  }

  return buildReport(envelope.cycle_id || null, mismatches);
}
