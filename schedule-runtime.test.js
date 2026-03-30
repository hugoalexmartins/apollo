import assert from "node:assert/strict";
import test from "node:test";

import { buildIntervalCron } from "./schedule-runtime.js";

test("buildIntervalCron supports minute, hourly, and daily intervals used by Zenith", () => {
	assert.equal(buildIntervalCron(1), "*/1 * * * *");
	assert.equal(buildIntervalCron(15), "*/15 * * * *");
	assert.equal(buildIntervalCron(60), "0 * * * *");
	assert.equal(buildIntervalCron(120), "0 */2 * * *");
	assert.equal(buildIntervalCron(1440), "0 0 * * *");
	assert.throws(() => buildIntervalCron(90), /Unsupported schedule interval/i);
});
