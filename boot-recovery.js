import { appendActionLifecycle, foldActionJournal, readActionJournal } from "./action-journal.js";
import { log } from "./logger.js";

const WRITE_TOOLS = new Set([
  "deploy_position",
  "rebalance_on_exit",
  "auto_compound_fees",
  "claim_fees",
  "close_position",
  "swap_token",
]);

function toOpenPositionSet(openPositionsPayload) {
  const positions = Array.isArray(openPositionsPayload?.positions)
    ? openPositionsPayload.positions
    : [];
  return new Set(positions.map((position) => position.position).filter(Boolean));
}

function toOpenPositions(openPositionsPayload) {
  return Array.isArray(openPositionsPayload?.positions)
    ? openPositionsPayload.positions.filter(Boolean)
    : [];
}

function toTrackedOpenSet(trackedPositionsPayload) {
  const trackedPositions = Array.isArray(trackedPositionsPayload)
    ? trackedPositionsPayload
    : [];
  return new Set(
    trackedPositions
      .filter((position) => position && !position.closed)
      .map((position) => position.position)
      .filter(Boolean)
  );
}

function toTrackedOpenPositions(trackedPositionsPayload) {
  const trackedPositions = Array.isArray(trackedPositionsPayload)
    ? trackedPositionsPayload
    : [];
  return trackedPositions.filter((position) => position && !position.closed);
}

function resolveWorkflowByObservation(workflow, observed) {
  if (workflow.tool === "deploy_position") {
    const hasOpenInTargetPool = Boolean(
      workflow.pool_address
      && observed.openPools.has(workflow.pool_address)
    );
    return hasOpenInTargetPool
      ? { lifecycle: "completed", reason: "open_position_observed_in_target_pool" }
      : { lifecycle: "manual_review", reason: "deploy_intent_not_observed_in_target_pool" };
  }

  if (workflow.tool === "close_position") {
    const stillOpen = Boolean(
      workflow.position_address
      && observed.openPositions.has(workflow.position_address)
    );
    return stillOpen
      ? { lifecycle: "manual_review", reason: "target_position_still_open_after_close_intent" }
      : { lifecycle: "completed", reason: "target_position_not_open_observed" };
  }

  if (workflow.tool === "rebalance_on_exit") {
    const oldPositionClosed = !workflow.position_address
      || !observed.openPositions.has(workflow.position_address);
    const replacementObserved = Boolean(
      workflow.pool_address
      && observed.openPoolPositions
      .get(workflow.pool_address)
      ?.some((positionAddress) => positionAddress !== workflow.position_address)
    );

    if (oldPositionClosed && replacementObserved) {
      return { lifecycle: "completed", reason: "rebalance_replacement_position_observed" };
    }

    return { lifecycle: "manual_review", reason: "rebalance_outcome_not_fully_observable" };
  }

  return { lifecycle: "manual_review", reason: "write_intent_not_resolvable_from_boot_observations" };
}

function mapRecoveryWorkflow(workflow) {
  const latestHistory = Array.isArray(workflow?.history) && workflow.history.length > 0
    ? workflow.history[workflow.history.length - 1]
    : null;

  return {
    workflow_id: workflow.workflow_id,
    tool: workflow.tool,
    lifecycle: workflow.lifecycle,
    position_address: workflow.position_address,
    pool_address: workflow.pool_address,
    last_ts: workflow.last_ts || latestHistory?.ts || null,
    reason: latestHistory?.reason || null,
    history_length: Array.isArray(workflow?.history) ? workflow.history.length : 0,
  };
}

function formatRecoveryWorkflowTarget(workflow) {
  const parts = [workflow?.position_address, workflow?.pool_address].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "unknown_target";
}

function formatJournalParseError(error) {
  return `line ${error.line}: ${error.error}`;
}

export function getRecoveryWorkflowReport({ limit = 10 } = {}) {
  const journal = readActionJournal();
  const folded = foldActionJournal(journal.entries);

  const manualReviewWorkflows = folded.filter((workflow) => workflow.lifecycle === "manual_review");
  const unresolvedWorkflows = folded.filter((workflow) => {
    if (!WRITE_TOOLS.has(workflow.tool)) return false;
    return workflow.lifecycle === "intent" || workflow.lifecycle === "close_observed_pending_redeploy";
  });

  return {
    status: journal.parse_errors.length > 0
      ? "journal_invalid"
      : manualReviewWorkflows.length > 0
      ? "manual_review_required"
      : unresolvedWorkflows.length > 0
        ? "unresolved_pending"
        : "clear",
    journal_parse_errors: journal.parse_errors,
    total_manual_review_workflows: manualReviewWorkflows.length,
    total_unresolved_workflows: unresolvedWorkflows.length,
    manual_review_workflows: manualReviewWorkflows.slice(0, limit).map(mapRecoveryWorkflow),
    unresolved_workflows: unresolvedWorkflows.slice(0, limit).map(mapRecoveryWorkflow),
  };
}

export function formatRecoveryWorkflowReport(report, suppression = { suppressed: false, reason: null }) {
  const lines = ["", "Recovery report:", ""];
  lines.push(`  writes_suppressed: ${suppression.suppressed ? "yes" : "no"}${suppression.reason ? ` / ${suppression.reason}` : ""}`);
  lines.push(`  report_status: ${report.status}`);
  lines.push(`  manual_review_workflows: ${report.total_manual_review_workflows}`);
  lines.push(`  unresolved_pending_workflows: ${report.total_unresolved_workflows}`);

  if (report.journal_parse_errors.length > 0) {
    lines.push(`  journal_parse_errors: ${report.journal_parse_errors.length}`);
    for (const parseError of report.journal_parse_errors.slice(0, 3)) {
      lines.push(`    - ${formatJournalParseError(parseError)}`);
    }
  }

  if (report.manual_review_workflows.length > 0) {
    lines.push("", "  Manual review workflows:");
    for (const workflow of report.manual_review_workflows) {
      lines.push(`    - ${workflow.workflow_id}: ${workflow.tool} / ${formatRecoveryWorkflowTarget(workflow)}${workflow.reason ? ` / ${workflow.reason}` : ""}`);
    }
  }

  if (report.unresolved_workflows.length > 0) {
    lines.push("", "  Unresolved pending workflows:");
    for (const workflow of report.unresolved_workflows) {
      lines.push(`    - ${workflow.workflow_id}: ${workflow.tool} / ${formatRecoveryWorkflowTarget(workflow)}${workflow.reason ? ` / ${workflow.reason}` : ""}`);
    }
  }

  if (report.manual_review_workflows.length === 0 && report.unresolved_workflows.length === 0) {
    lines.push("", "  No unresolved or manual_review workflows recorded.");
  }

  lines.push("");
  return lines.join("\n");
}

export function summarizeRecoveryBlock(summary = {}) {
  if (summary?.reason_code === "JOURNAL_INVALID") {
    return {
      headline: "action journal is invalid",
      detail: `parse errors: ${summary.journal_parse_errors?.length || 0}`,
    };
  }

  return {
    headline: "unresolved workflow(s) were parked as manual_review",
    detail: `workflows: ${summary.parked_manual_review_workflows?.join(", ") || "unknown"}`,
  };
}

export async function runBootRecovery({
  observeOpenPositions,
  observeTrackedPositions,
} = {}) {
  const journal = readActionJournal();
  const folded = foldActionJournal(journal.entries);
  const openPositions = await observeOpenPositions();

  let trackedPositions = [];
  let trackedStateInvalid = null;
  try {
    trackedPositions = await observeTrackedPositions();
  } catch (error) {
    trackedStateInvalid = error.message;
    log("recovery_warn", `Tracked state unavailable during boot recovery: ${error.message}`);
  }

  const openPositionSet = toOpenPositionSet(openPositions);
  const openPositionList = toOpenPositions(openPositions);
  const trackedOpenSet = toTrackedOpenSet(trackedPositions);
  const trackedOpenList = toTrackedOpenPositions(trackedPositions);

  const openPools = new Set();
  const openPoolPositions = new Map();
  for (const position of [...openPositionList, ...trackedOpenList]) {
    const poolAddress = position?.pool || null;
    const positionAddress = position?.position || null;
    if (!poolAddress) continue;
    openPools.add(poolAddress);
    if (!openPoolPositions.has(poolAddress)) {
      openPoolPositions.set(poolAddress, []);
    }
    if (positionAddress) {
      openPoolPositions.get(poolAddress).push(positionAddress);
    }
  }

  const observedOpenPositions = new Set([...openPositionSet, ...trackedOpenSet]);

  const unresolvedWriteWorkflows = folded.filter((workflow) => {
    if (!WRITE_TOOLS.has(workflow.tool)) return false;
    if (workflow.lifecycle === "completed" || workflow.lifecycle === "manual_review") return false;
    return workflow.lifecycle === "intent" || workflow.lifecycle === "close_observed_pending_redeploy";
  });

  const completedOnBoot = [];
  const parkedManualReview = [];
  for (const workflow of unresolvedWriteWorkflows) {
    const resolution = resolveWorkflowByObservation(workflow, {
      openPositions: observedOpenPositions,
      openPools,
      openPoolPositions,
    });

    appendActionLifecycle({
      workflow_id: workflow.workflow_id,
      lifecycle: resolution.lifecycle,
      tool: workflow.tool,
      cycle_id: workflow.cycle_id,
      action_id: workflow.action_id,
      position_address: workflow.position_address,
      pool_address: workflow.pool_address,
      reason: resolution.reason,
    });

    if (resolution.lifecycle === "completed") {
      completedOnBoot.push(workflow.workflow_id);
    } else {
      parkedManualReview.push(workflow.workflow_id);
    }
  }

  const parseErrorBlocked = journal.parse_errors.length > 0;
  const suppressAutonomousWrites = parkedManualReview.length > 0;
  const summary = {
    status: parseErrorBlocked
      ? "journal_invalid"
      : suppressAutonomousWrites
        ? "manual_review_required"
        : "clear",
    suppress_autonomous_writes: parseErrorBlocked || suppressAutonomousWrites,
    reason_code: parseErrorBlocked
      ? "JOURNAL_INVALID"
      : suppressAutonomousWrites
        ? "UNRESOLVED_WORKFLOW"
        : null,
    unresolved_write_workflows: unresolvedWriteWorkflows.map((workflow) => ({
      workflow_id: workflow.workflow_id,
      tool: workflow.tool,
      lifecycle: workflow.lifecycle,
      position_address: workflow.position_address,
      pool_address: workflow.pool_address,
    })),
    completed_on_boot_workflows: completedOnBoot,
    parked_manual_review_workflows: parkedManualReview,
    journal_parse_errors: journal.parse_errors,
    observed: {
      open_positions_count: openPositionSet.size,
      tracked_open_positions_count: trackedOpenSet.size,
      tracked_state_invalid: trackedStateInvalid,
    },
  };

  log(
    "recovery",
    parseErrorBlocked
      ? `Boot recovery blocked autonomous writes because action journal has ${journal.parse_errors.length} parse error(s)`
      : suppressAutonomousWrites
      ? `Boot recovery parked ${parkedManualReview.length} workflow(s) for manual review; autonomous writes suppressed`
      : `Boot recovery resolved ${completedOnBoot.length} workflow(s) and found no manual-review blockers`
  );
  return summary;
}
