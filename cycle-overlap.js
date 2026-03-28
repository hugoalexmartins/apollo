export function getOverlappingCycleType({
  cycleType,
  managementBusy = false,
  screeningBusy = false,
} = {}) {
  if (cycleType === "management") {
    if (managementBusy) return "management";
    if (screeningBusy) return "screening";
    return null;
  }

  if (cycleType === "screening") {
    if (screeningBusy) return "screening";
    if (managementBusy) return "management";
    return null;
  }

  return null;
}

export function shouldTriggerFollowOnScreening({
  positionsCount = 0,
  screeningBusy = false,
  screeningLastTriggered = 0,
  nowMs = Date.now(),
  screeningCooldownMs = 0,
} = {}) {
  if (positionsCount > 0) return false;
  if (screeningBusy) return false;
  return nowMs - screeningLastTriggered > screeningCooldownMs;
}
