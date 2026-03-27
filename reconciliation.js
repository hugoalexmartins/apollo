import { replayManagementEnvelope, replayScreeningEnvelope } from "./cycle-replay.js";

function buildReport(runId, mismatches) {
  return {
    runId,
    status: mismatches.length === 0 ? "match" : "mismatch",
    mismatches,
  };
}

export function reconcileScreeningEnvelope(envelope) {
  const replayed = replayScreeningEnvelope(envelope);
  const expectedOrder = (envelope.shortlist || []).map((item) => item.pool);
  const actualOrder = replayed.shortlist.map((item) => item.pool);
  const mismatches = [];

  if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder)) {
    mismatches.push({ field: "candidateOrder", expected: expectedOrder, actual: actualOrder });
  }

  if ((envelope.total_eligible ?? null) !== replayed.total_eligible) {
    mismatches.push({ field: "terminalDecision", expected: envelope.total_eligible ?? null, actual: replayed.total_eligible });
  }

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

  if (JSON.stringify(expectedActions) !== JSON.stringify(actualActions)) {
    mismatches.push({ field: "terminalDecision", expected: expectedActions, actual: actualActions });
  }

  if ((envelope.reason_code || null) !== null) {
    mismatches.push({ field: "degradedReason", expected: envelope.reason_code, actual: null });
  }

  return buildReport(envelope.cycle_id || null, mismatches);
}
