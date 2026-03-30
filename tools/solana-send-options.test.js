import assert from "node:assert/strict";
import test from "node:test";

import { SAFE_SEND_OPTIONS, buildSafeSendOptions } from "./solana-send-options.js";

test("safe Solana send options keep preflight enabled by default", () => {
	assert.equal(SAFE_SEND_OPTIONS.skipPreflight, false);
	assert.equal(SAFE_SEND_OPTIONS.preflightCommitment, "confirmed");
	assert.equal(SAFE_SEND_OPTIONS.commitment, "confirmed");
	assert.equal(SAFE_SEND_OPTIONS.maxRetries, 2);

	const custom = buildSafeSendOptions({ maxRetries: 3 });
	assert.equal(custom.skipPreflight, false);
	assert.equal(custom.maxRetries, 3);
});
