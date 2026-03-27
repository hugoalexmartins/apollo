import assert from "node:assert/strict";
import test from "node:test";

import { runManagementRuntimeActions } from "./management-runtime.js";

const config = {
  management: {
    emergencyPriceDropPct: -50,
    takeProfitFeePct: 5,
    minFeePerTvl24h: 7,
    minClaimAmount: 5,
  },
};

test("runManagementRuntimeActions only executes deterministic runtime actions", async () => {
  const calls = [];
  const results = await runManagementRuntimeActions([
    {
      position: "pos-1",
      pair: "Alpha-SOL",
      in_range: false,
      minutes_out_of_range: 10,
      pnl: { volatility: 6 },
    },
    {
      position: "pos-2",
      pair: "Beta-SOL",
      in_range: true,
      instruction: "wait for 8%",
      pnl: { pnl_pct: 1.5, fee_per_tvl_24h: 12, unclaimed_fee_usd: 1 },
      unclaimed_fees_usd: 1,
    },
  ], {
    cycleId: "management-1",
    config,
    executeTool: async (name, args, meta) => {
      calls.push({ name, args, meta });
      return { success: true, tool: name };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "rebalance_on_exit");
  assert.equal(calls[0].meta.cycle_id, "management-1");
  assert.equal(results.length, 1);
  assert.equal(results[0].toolName, "rebalance_on_exit");
});

test("runManagementRuntimeActions suppresses stale-pnl exits but keeps out-of-range rebalance", async () => {
  const calls = [];
  const results = await runManagementRuntimeActions([
    {
      position: "pos-stale-exit",
      pair: "Alpha-SOL",
      in_range: true,
      exitAlert: "STOP_LOSS: stale feed should not trigger close",
      pnl: { stale: true, pnl_pct: -18 },
    },
    {
      position: "pos-stale-oor",
      pair: "Beta-SOL",
      in_range: false,
      minutes_out_of_range: 9,
      pnl: { stale: true, volatility: 6 },
    },
  ], {
    cycleId: "management-stale",
    config,
    executeTool: async (name, args, meta) => {
      calls.push({ name, args, meta });
      return { success: true, tool: name };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "rebalance_on_exit");
  assert.equal(calls[0].args.position_address, "pos-stale-oor");
  assert.equal(results.length, 1);
  assert.equal(results[0].position, "pos-stale-oor");
});

test("runManagementRuntimeActions closes parsed instruction thresholds without escalating to the model", async () => {
  const calls = [];
  const results = await runManagementRuntimeActions([
    {
      position: "pos-inst-close",
      pair: "Gamma-SOL",
      in_range: true,
      instruction: "hold until pnl >= 5%",
      pnl: { pnl_pct: 5.8 },
    },
    {
      position: "pos-inst-hold",
      pair: "Delta-SOL",
      in_range: true,
      instruction: "hold until pnl >= 5%",
      pnl: { pnl_pct: 2.1 },
    },
  ], {
    cycleId: "management-instruction",
    config,
    executeTool: async (name, args, meta) => {
      calls.push({ name, args, meta });
      return { success: true, tool: name };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "close_position");
  assert.equal(calls[0].args.position_address, "pos-inst-close");
  assert.equal(results.length, 1);
  assert.equal(results[0].position, "pos-inst-close");
});
