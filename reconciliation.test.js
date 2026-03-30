import assert from "node:assert/strict";
import test from "node:test";

import { reconcileManagementEnvelope, reconcileScreeningEnvelope } from "./reconciliation.js";

test("reconcileScreeningEnvelope reports match for deterministic shortlist parity", () => {
  const report = reconcileScreeningEnvelope({
    cycle_id: "screen-1",
    total_eligible: 2,
    shortlist: [
      { pool: "pool-high" },
      { pool: "pool-low" },
    ],
    candidate_inputs: [
      { pool: "pool-low", name: "Low", base: { mint: "mint-low" }, fee_active_tvl_ratio: 0.06, volume_window: 2000, organic_score: 62, holders: 700, active_pct: 60, volatility: 17 },
      { pool: "pool-high", name: "High", base: { mint: "mint-high" }, fee_active_tvl_ratio: 0.9, volume_window: 120000, organic_score: 91, holders: 3500, active_pct: 93, volatility: 5 },
    ],
    occupied_pools: [],
    occupied_mints: [],
  });

  assert.equal(report.status, "match");
  assert.deepEqual(report.mismatches, []);
});

test("reconcileManagementEnvelope reports mismatch for divergent runtime actions", () => {
  const report = reconcileManagementEnvelope({
    cycle_id: "manage-1",
    position_inputs: [
      {
        position: "pos-1",
        in_range: false,
        minutes_out_of_range: 12,
        pnl: { volatility: 6 },
      },
    ],
    runtime_actions: [
      { position: "pos-1", tool: "close_position", rule: "stop_loss_pct_breached" },
    ],
  }, {
    management: {
      emergencyPriceDropPct: -50,
      takeProfitFeePct: 5,
      minFeePerTvl24h: 7,
      minClaimAmount: 5,
    },
  });

	assert.equal(report.status, "mismatch");
	assert.equal(report.mismatches[0].field, "terminalDecision");
});

test("reconcileScreeningEnvelope replays deterministic skip decisions", () => {
	const report = reconcileScreeningEnvelope({
		cycle_id: "screen-skip-1",
		status: "skipped_max_positions",
		summary: {
			total_positions: 3,
			max_positions: 3,
		},
		admission_inputs: {
			positionsCount: 3,
			walletSol: 10,
			config: {
				risk: { maxPositions: 3 },
				management: { deployAmountSol: 0.5, gasReserve: 0.1 },
			},
		},
	});

	assert.equal(report.status, "match");
	assert.deepEqual(report.mismatches, []);
});

test("reconcileScreeningEnvelope checks thesis truth against write workflows", () => {
	const report = reconcileScreeningEnvelope({
		cycle_id: "screen-truth-1",
		total_eligible: 1,
		shortlist: [{ pool: "pool-1" }],
		candidate_inputs: [{ pool: "pool-1", name: "Pool", base: { mint: "mint-1" }, fee_active_tvl_ratio: 0.5, volume_window: 10000, organic_score: 80, holders: 1200, active_pct: 60, volatility: 5 }],
		occupied_pools: [],
		occupied_mints: [],
		active_thesis: {
			action: "deploy",
			tool_name: "deploy_position",
			target_id: "pool-1",
		},
		shadow_thesis: {
			action: "hold",
			tool_name: null,
			target_id: null,
		},
		shadow_comparison: { diverged: true },
		decision_result: { status: "success" },
		write_workflows: [],
	});

	assert.equal(report.status, "mismatch");
	assert.equal(report.mismatches.some((mismatch) => mismatch.field === "screeningWriteWorkflow"), true);
});

test("reconcileManagementEnvelope replays overlap skip decisions", () => {
	const report = reconcileManagementEnvelope({
		cycle_id: "manage-skip-1",
		status: "skipped_overlap",
		summary: {
			overlap_with: "screening",
		},
		overlap_inputs: {
			cycleType: "management",
			managementBusy: false,
			screeningBusy: true,
		},
	}, {
		management: {
			emergencyPriceDropPct: -50,
			takeProfitFeePct: 5,
			minFeePerTvl24h: 7,
			minClaimAmount: 5,
		},
	});

	assert.equal(report.status, "match");
	assert.deepEqual(report.mismatches, []);
});

test("reconcileManagementEnvelope checks model decision truth against workflows", () => {
	const report = reconcileManagementEnvelope({
		cycle_id: "manage-truth-1",
		position_inputs: [],
		management_config: {
			emergencyPriceDropPct: -50,
			takeProfitFeePct: 5,
			minFeePerTvl24h: 7,
			minClaimAmount: 5,
		},
		runtime_actions: [],
		model_decisions: [{
			position: "pos-1",
			thesis: { action: "close", tool_name: "close_position", target_id: "pos-1" },
			shadow: { action: "hold", tool_name: null, target_id: null },
			comparison: { diverged: true },
			result: { status: "success", reason: null },
		}],
		write_workflows: [],
	}, {
		management: {
			emergencyPriceDropPct: -10,
			takeProfitFeePct: 99,
			minFeePerTvl24h: 1,
			minClaimAmount: 99,
		},
	});

	assert.equal(report.status, "mismatch");
	assert.equal(report.mismatches.some((mismatch) => mismatch.field === "modelDecisionWorkflow:pos-1"), true);
});
