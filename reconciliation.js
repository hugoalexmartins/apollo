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

  if ((envelope.reason_code || null) !== null) {
    mismatches.push({ field: "degradedReason", expected: envelope.reason_code, actual: null });
  }

  return buildReport(envelope.cycle_id || null, mismatches);
}
