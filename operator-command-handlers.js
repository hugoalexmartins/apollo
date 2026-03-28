export async function handleOperatorCommandText({
  text,
  source,
	config,
	getRecoveryWorkflowReport,
	getAutonomousWriteSuppression,
	setAutonomousWriteSuppression,
	acknowledgeRecoveryResume,
  armGeneralWriteTools,
  disarmGeneralWriteTools,
  getOperatorControlSnapshot,
  refreshRuntimeHealth,
} = {}) {
  if (!text) return { handled: false, message: null };

  if (text.startsWith("/arm")) {
    const [, minutesRaw, ...reasonParts] = text.split(/\s+/);
    const minutes = Math.max(1, Number(minutesRaw) || 10);
    const reason = reasonParts.join(" ") || `${source} operator arm`;
    const armStatus = armGeneralWriteTools({ minutes, reason });
    const snapshot = getOperatorControlSnapshot?.() || { general_write_arm: armStatus };
    refreshRuntimeHealth();
    return {
      handled: true,
      message: `GENERAL write tools armed for ${minutes} minute(s)${snapshot.general_write_arm?.armed_until ? ` until ${snapshot.general_write_arm.armed_until}` : ""}.`,
    };
  }

  if (text.startsWith("/disarm")) {
    const armStatus = disarmGeneralWriteTools({ reason: `${source} operator disarm` });
    const snapshot = getOperatorControlSnapshot?.() || { general_write_arm: armStatus };
    refreshRuntimeHealth();
    return {
      handled: true,
      message: `GENERAL write tools ${snapshot.general_write_arm?.armed ? "still armed" : "disarmed"}.`,
    };
  }

  if (text.startsWith("/resume ")) {
    const reason = text.slice(8).trim();
    const report = getRecoveryWorkflowReport({ limit: 10 });
    if (report.status === "journal_invalid") {
      return {
        handled: true,
        message: "Cannot resume while the action journal is invalid. Fix journal corruption first.",
      };
    }
    const suppression = getAutonomousWriteSuppression();
    const resumableWorkflowBlock = suppression.suppressed
      && suppression.code === "UNRESOLVED_WORKFLOW"
      && Boolean(suppression.incident_key);
    if (!resumableWorkflowBlock) {
      return {
        handled: true,
        message: "Cannot persist resume override unless autonomous writes are currently suppressed for an unresolved-workflow manual-review block.",
      };
    }
    setAutonomousWriteSuppression({ suppressed: false });
    const override = acknowledgeRecoveryResume({
      reason,
      report_status: report.status,
      cleared_guard_pause: false,
      incident_key: suppression.incident_key,
      source,
      override_minutes: config.protections.recoveryResumeOverrideMinutes,
    });
    const snapshot = getOperatorControlSnapshot?.() || { recovery_resume_override: override };
    refreshRuntimeHealth();
    return {
      handled: true,
      message: `Autonomous write suppression cleared. Previous suppression: ${suppression.reason || "none"}. Portfolio guard pause unchanged. Persisted resume override until ${snapshot.recovery_resume_override?.override_until || "n/a"}.`,
    };
  }

  return { handled: false, message: null };
}
