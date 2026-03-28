import assert from "node:assert/strict";
import test from "node:test";

import { scoreTopLPers, studyTopLPers } from "./study.js";

test("scoreTopLPers returns bounded disabled payload when LPAgent is unavailable", async () => {
  const originalKey = process.env.LPAGENT_API_KEY;

  try {
    delete process.env.LPAGENT_API_KEY;
    const result = await scoreTopLPers({ pool_address: "pool-chaos", limit: 3 });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.source_status.lpagent.enabled, false);
    assert.equal(result.source_status.lpagent.status, "missing_api_key");
    assert.match(result.message, /disabled/i);
  } finally {
    if (originalKey == null) {
      delete process.env.LPAGENT_API_KEY;
    } else {
      process.env.LPAGENT_API_KEY = originalKey;
    }
  }
});

test("studyTopLPers returns bounded disabled payload when LPAgent is unavailable", async () => {
  const originalKey = process.env.LPAGENT_API_KEY;

  try {
    delete process.env.LPAGENT_API_KEY;
    const result = await studyTopLPers({ pool_address: "pool-chaos", limit: 2 });

    assert.equal(result.pool, "pool-chaos");
    assert.deepEqual(result.patterns, []);
    assert.deepEqual(result.lpers, []);
    assert.match(result.message, /disabled/i);
  } finally {
    if (originalKey == null) {
      delete process.env.LPAGENT_API_KEY;
    } else {
      process.env.LPAGENT_API_KEY = originalKey;
    }
  }
});
