import assert from "node:assert/strict";
import test from "node:test";

import { getTelegramFreeformAgentRole } from "./interactive-interface.js";

test("telegram free-form deploy language stays in GENERAL role", () => {
	assert.equal(getTelegramFreeformAgentRole("deploy into pool"), "GENERAL");
	assert.equal(getTelegramFreeformAgentRole("open position on best pool"), "GENERAL");
	assert.equal(getTelegramFreeformAgentRole("add liquidity"), "GENERAL");
	assert.equal(getTelegramFreeformAgentRole("close this position"), "GENERAL");
});
