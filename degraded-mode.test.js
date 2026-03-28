import assert from "node:assert/strict";
import test from "node:test";

import { buildFailClosedResult, classifyRuntimeFailure, FAIL_CLOSED_REASONS, isFailClosedResult, isInputUnavailableError, validateStartupSnapshot } from "./degraded-mode.js";

test("validateStartupSnapshot fails closed for unavailable inputs", () => {
  const walletFailure = validateStartupSnapshot({ wallet: { error: "rpc down" }, positions: { positions: [] }, candidates: { candidates: [] } });
  assert.equal(walletFailure.reason_code, FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE);

  const shapeFailure = validateStartupSnapshot({ wallet: { sol: 1 }, positions: {}, candidates: { candidates: [] } });
  assert.equal(shapeFailure.reason_code, FAIL_CLOSED_REASONS.STATE_INVALID);
});

test("classifyRuntimeFailure returns explicit fail-closed reasons", () => {
  assert.equal(classifyRuntimeFailure(new Error("bad config"), { invalidPolicy: true }).reason_code, FAIL_CLOSED_REASONS.POLICY_INVALID);
  assert.equal(classifyRuntimeFailure(new Error("bad state"), { invalidState: true }).reason_code, FAIL_CLOSED_REASONS.STATE_INVALID);
  assert.equal(classifyRuntimeFailure(new Error("rpc timeout while fetching positions")).reason_code, FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE);
  assert.equal(classifyRuntimeFailure(new Error("boom")).reason_code, FAIL_CLOSED_REASONS.INTERNAL_ERROR);
});

test("isInputUnavailableError detects timeout and network-style failures", () => {
  assert.equal(isInputUnavailableError(new Error("RPC timeout while fetching positions")), true);
  assert.equal(isInputUnavailableError(new Error("fetch failed: upstream unavailable")), true);
  assert.equal(isInputUnavailableError(new Error("bad config")), false);
});

test("buildFailClosedResult produces a stable contract", () => {
  const result = buildFailClosedResult(FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE, "wallet missing", { phase: "startup" });
  assert.equal(isFailClosedResult(result), true);
  assert.equal(result.status, "fail_closed");
  assert.equal(result.reason_code, FAIL_CLOSED_REASONS.INPUT_UNAVAILABLE);
});
