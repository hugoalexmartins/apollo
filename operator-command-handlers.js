export async function handleOperatorCommandText({
  text,
  source,
  config,
  getRecoveryWorkflowReport,
  getAutonomousWriteSuppression,
  clearPortfolioGuardPause,
  setAutonomousWriteSuppression,
  acknowledgeRecoveryResume,
  armGeneralWriteTools,
  disarmGeneralWriteTools,
  refreshRuntimeHealth,
} = {}) {
  if (!text) return { handled: false, message: null };

  if (text.startsWith("/arm")) {
    const [, minutesRaw, ...reasonParts] = text.split(/\s+/);
    const minutes = Math.max(1, Number(minutesRaw) || 10);
    const reason = reasonParts.join(" ") || `${source} operator arm`;
    const armStatus = armGeneralWriteTools({ minutes, reason });
    refreshRuntimeHealth();
    return {
      handled: true,
      message: `GENERAL write tools armed for ${minutes} minute(s)${armStatus.armed_until ? ` until ${armStatus.armed_until}` : ""}.`,
    };
  }

  if (text.startsWith("/disarm")) {
    disarmGeneralWriteTools({ reason: `${source} operator disarm` });
    refreshRuntimeHealth();
    return {
      handled: true,
      message: "GENERAL write tools disarmed.",
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
    const clearedGuard = clearPortfolioGuardPause({ reason });
    setAutonomousWriteSuppression({ suppressed: false });
    const override = acknowledgeRecoveryResume({
      reason,
      report_status: report.status,
      cleared_guard_pause: clearedGuard.cleared,
      source,
      override_minutes: config.protections.recoveryResumeOverrideMinutes,
    });
    refreshRuntimeHealth();
    return {
      handled: true,
      message: `Autonomous write suppression cleared. Previous suppression: ${suppression.reason || "none"}. Guard pause cleared: ${clearedGuard.cleared ? "yes" : "no"}. Persisted resume override until ${override.override_until || "n/a"}.`,
    };
  }

  return { handled: false, message: null };
}
