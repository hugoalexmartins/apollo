import assert from "node:assert/strict";

import {
  executeTool,
  resetExecutorTestOverrides,
  runSafetyChecks,
  setExecutorTestOverrides,
} from "../tools/executor.js";

async function main() {
  setExecutorTestOverrides({
    getMyPositions: async () => ({
      total_positions: 1,
      positions: [{ position: "pos-1", pool: "pool-1", base_mint: "mint-a" }],
    }),
    getWalletBalances: async () => ({ sol: 10 }),
  });
  let result = await runSafetyChecks("deploy_position", {
    pool_address: "pool-1",
    amount_y: 0.5,
    base_mint: "mint-b",
    bin_step: 100,
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /already have an open position in pool/i);

  setExecutorTestOverrides({
    getMyPositions: async () => ({
      total_positions: 1,
      positions: [{ position: "pos-1", pool: "pool-1", base_mint: "mint-a" }],
    }),
    getWalletBalances: async () => ({ sol: 10 }),
  });
  result = await runSafetyChecks("deploy_position", {
    pool_address: "pool-2",
    amount_y: 0.5,
    base_mint: "mint-a",
    bin_step: 100,
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /already holding base token/i);

  setExecutorTestOverrides({
    getMyPositions: async () => ({ total_positions: 0, positions: [] }),
    getWalletBalances: async () => ({ sol: 0.55 }),
  });
  result = await runSafetyChecks("deploy_position", {
    pool_address: "pool-3",
    amount_y: 0.5,
    base_mint: "mint-c",
    bin_step: 100,
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /insufficient sol/i);

  setExecutorTestOverrides({
    getMyPositions: async () => ({ total_positions: 0, positions: [] }),
  });
  result = await runSafetyChecks("close_position", {
    position_address: "missing-position",
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /not currently open/i);

  let receivedArgs = null;
  setExecutorTestOverrides({
    getMyPositions: async () => ({ total_positions: 0, positions: [] }),
    getWalletBalances: async () => ({ sol: 10, sol_price: 120, tokens: [] }),
    recordToolOutcome: () => {},
    tools: {
      deploy_position: async (args) => {
        receivedArgs = args;
        return { success: true, position: "pos-x", txs: ["tx-1"] };
      },
    },
  });
  result = await executeTool("deploy_position", {
    pool_address: "pool-4",
    amount_y: 0.5,
    base_mint: "mint-d",
    bin_step: 100,
  });
  assert.equal(result.success, true);
  assert.ok(receivedArgs);
  assert.equal(receivedArgs.initial_value_usd, 60);

  const outcomes = [];
  setExecutorTestOverrides({
    getMyPositions: async () => ({ total_positions: 0, positions: [] }),
    getWalletBalances: async () => ({ sol: 0.4 }),
    recordToolOutcome: (payload) => outcomes.push(payload),
  });
  result = await executeTool("deploy_position", {
    pool_address: "pool-5",
    amount_y: 0.5,
    base_mint: "mint-e",
    bin_step: 100,
  });
  assert.equal(result.blocked, true);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].tool, "deploy_position");
  assert.equal(outcomes[0].outcome, "blocked");

  resetExecutorTestOverrides();
  console.log("executor boundary checks passed");
  process.exit(0);
}

main().catch((error) => {
  resetExecutorTestOverrides();
  console.error(error);
  process.exit(1);
});
