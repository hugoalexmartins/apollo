export const FAIL_CLOSED_REASONS = Object.freeze({
  INPUT_UNAVAILABLE: "INPUT_UNAVAILABLE",
  POLICY_INVALID: "POLICY_INVALID",
  STATE_INVALID: "STATE_INVALID",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

export function buildFailClosedResult(reason_code, message, metadata = {}) {
  return {
    status: "fail_closed",
    reason_code,
    message,
    metadata,
  };
}

export function isFailClosedResult(value) {
  return Boolean(value && value.status === "fail_closed" && value.reason_code);
}

export function isProviderPayloadStale(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.stale === true || payload.is_stale === true || payload.status === "stale") return true;

  const observedAtMs = Number.isFinite(Number(payload.observed_at_ms ?? payload.as_of_ms))
    ? Number(payload.observed_at_ms ?? payload.as_of_ms)
    : Number.isFinite(Date.parse(payload.observed_at ?? payload.as_of ?? ""))
      ? Date.parse(payload.observed_at ?? payload.as_of)
      : null;
  const maxAgeMs = Number(payload.max_age_ms ?? payload.allowed_age_ms ?? payload.ttl_ms);

  if (observedAtMs == null || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return false;
  }

  return nowMs - observedAtMs > maxAgeMs;
}

export function isInputUnavailableError(error) {
  const text = `${error?.name || ""} ${error?.message || String(error || "")}`.toLowerCase();
  return /(timeout|timed out|abort|aborted|fetch failed|network|econnreset|enotfound|connection reset|rpc unavailable|rpc timeout|upstream unavailable|503|429)/.test(text);
}

export function validateStartupSnapshot({ wallet, positions, candidates, nowMs = Date.now() }) {
  if (!wallet || wallet.error) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, wallet?.error || "wallet balances unavailable");
  }
  if (isProviderPayloadStale(wallet, nowMs)) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, "wallet balances stale");
  }
  if (!positions || positions.error) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, positions?.error || "positions unavailable");
  }
  if (isProviderPayloadStale(positions, nowMs)) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, "positions stale");
  }
  if (!Array.isArray(positions.positions)) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.STATE_INVALID, "positions payload missing positions array");
  }
  if (!candidates || candidates.error) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, candidates?.error || "candidates unavailable");
  }
  if (isProviderPayloadStale(candidates, nowMs)) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, "candidates stale");
  }
  if (!Array.isArray(candidates.candidates)) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.STATE_INVALID, "candidate payload missing candidates array");
  }
  return null;
}

export function classifyRuntimeFailure(error, { invalidPolicy = false, invalidState = false } = {}) {
  if (invalidPolicy) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.POLICY_INVALID, error?.message || String(error));
  }
  if (invalidState) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.STATE_INVALID, error?.message || String(error));
  }
  if (isInputUnavailableError(error)) {
    return buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, error?.message || String(error));
  }
  return buildFailClosedResult(FAIL_CLOSED_REASONS.INTERNAL_ERROR, error?.message || String(error));
}
