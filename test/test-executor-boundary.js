import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { config } from "../config.js";
import { armGeneralWriteTools, disarmGeneralWriteTools } from "../operator-controls.js";
import { updateRuntimeHealth } from "../runtime-health.js";
import {
  executeTool,
  resetExecutorTestOverrides,
  runSafetyChecks,
  setExecutorTestOverrides,
} from "../tools/executor.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

function buildApprovedMeta(cycleId, actionId) {
	return {
		cycle_id: cycleId,
		action_id: actionId,
		decision_gate: {
			required: true,
			approved: true,
			status: "approved",
			reason_code: null,
			thesis_id: `${actionId}:thesis`,
			critic_version: "v1",
			memory_version: "policy-v1",
			shadow_memory_version: "policy-shadow-v1",
		},
		thesis_id: `${actionId}:thesis`,
		decision_mode: "model",
		critic_status: "approved",
		memory_version: "policy-v1",
		shadow_memory_version: "policy-shadow-v1",
	};
}

async function main() {
	config.risk.maxDeployAmount = 50;
	config.risk.maxPositions = 3;

	setExecutorTestOverrides({
		getMyPositions: async () => ({
			total_positions: 1,
			positions: [{ position: "pos-1", pool: "pool-1", base_mint: "mint-a" }],
		}),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-b", token_x_mint: "mint-b", token_y_mint: SOL_MINT, bin_step: 100 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
  let result = await runSafetyChecks("deploy_position", {
    pool_address: "pool-1",
    amount_y: 0.5,
    base_mint: "mint-b",
    bin_step: 100,
  }, { cycle_id: "screening-test" });
  assert.equal(result.pass, false);
  assert.match(result.reason, /already have an open position in pool/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({
			total_positions: 1,
			positions: [{ position: "pos-1", pool: "pool-1", base_mint: "mint-a" }],
		}),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-a", token_x_mint: "mint-a", token_y_mint: SOL_MINT, bin_step: 100 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
  result = await runSafetyChecks("deploy_position", {
    pool_address: "pool-2",
    amount_y: 0.5,
    base_mint: "mint-a",
    bin_step: 100,
  }, { cycle_id: "screening-test" });
  assert.equal(result.pass, false);
  assert.match(result.reason, /already holding base token/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-c", token_x_mint: "mint-c", token_y_mint: SOL_MINT, bin_step: 100 }),
		getWalletBalances: async () => ({ sol: 0.55 }),
	});
	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-3",
		amount_y: 0.5,
		base_mint: "mint-c",
		bin_step: 100,
	}, { cycle_id: "screening-test" });
	assert.equal(result.pass, false);
	assert.match(result.reason, /insufficient sol/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-meta", token_x_mint: "mint-meta", token_y_mint: SOL_MINT, bin_step: 101 }),
		getWalletBalances: async () => ({ sol: 10, tokens: [{ mint: "mint-meta", balance: 20 }] }),
	});
	const deployArgs = {
		pool_address: "pool-meta",
		amount_y: 0.5,
	};
	result = await runSafetyChecks("deploy_position", deployArgs, { cycle_id: "screening-test" });
	assert.equal(result.pass, true);
	assert.equal(deployArgs.base_mint, "mint-meta");
	assert.equal(deployArgs.bin_step, 101);
	assert.equal(deployArgs.token_y_mint, SOL_MINT);

	const tokenOnlyArgs = {
		pool_address: "pool-meta-token-only",
		amount_x: 15,
	};
	result = await runSafetyChecks("deploy_position", tokenOnlyArgs, { cycle_id: "screening-test" });
	assert.equal(result.pass, true);
	assert.equal(tokenOnlyArgs.base_mint, "mint-meta");
	assert.equal(tokenOnlyArgs.risk_mint, "mint-meta");

	const dualSidedArgs = {
		pool_address: "pool-meta-dual",
		amount_x: 10,
		amount_y: 0.4,
	};
	result = await runSafetyChecks("deploy_position", dualSidedArgs, { cycle_id: "screening-test" });
	assert.equal(result.pass, true);

	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-meta-invalid",
		amount_x: "oops",
		amount_y: 0.4,
	}, { cycle_id: "screening-test" });
	assert.equal(result.pass, false);
	assert.match(result.reason, /invalid deploy amount input/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-low", risk_mint: "mint-low", token_x_mint: "mint-low", token_y_mint: SOL_MINT, bin_step: 101 }),
		getWalletBalances: async () => ({ sol: 10, tokens: [{ mint: "mint-low", balance: 2 }] }),
	});
	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-low-token",
		amount_x: 5,
	}, { cycle_id: "screening-test" });
	assert.equal(result.pass, false);
	assert.match(result.reason, /insufficient base token/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-wrong", risk_mint: "mint-wrong", token_x_mint: SOL_MINT, token_y_mint: "mint-wrong", bin_step: 101 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-wrong-side",
		amount_y: 0.5,
	}, { cycle_id: "screening-test" });
	assert.equal(result.pass, false);
	assert.match(result.reason, /token_y\/quote side/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-unknown", token_x_mint: "mint-unknown", token_y_mint: null, bin_step: 101 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-unknown-side",
		amount_y: 0.5,
	}, { cycle_id: "screening-test" });
	assert.equal(result.pass, false);
	assert.match(result.reason, /token order is unavailable/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-runtime", token_x_mint: "mint-runtime", token_y_mint: SOL_MINT, bin_step: 111 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
	let normalizedToolCalls = 0;
	setExecutorTestOverrides({
		tools: {
			get_wallet_balance: async () => {
				normalizedToolCalls += 1;
				return { wallet: "ok" };
			},
		},
	});
	result = await executeTool("get_wallet_balance<|channel|>commentary", {});
	assert.equal(result.wallet, "ok");
	assert.equal(normalizedToolCalls, 1);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-runtime", token_x_mint: "mint-runtime", token_y_mint: SOL_MINT, bin_step: 111 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
	const spoofedArgs = {
		pool_address: "pool-meta-override",
		amount_y: 0.5,
		base_mint: "mint-spoofed",
		bin_step: 999,
	};
	result = await runSafetyChecks("deploy_position", spoofedArgs, { cycle_id: "screening-test" });
	assert.equal(result.pass, true);
	assert.equal(spoofedArgs.base_mint, "mint-runtime");
	assert.equal(spoofedArgs.bin_step, 111);

  setExecutorTestOverrides({
    getMyPositions: async () => ({ total_positions: 0, positions: [] }),
  });
  result = await runSafetyChecks("close_position", {
    position_address: "missing-position",
  }, { cycle_id: "management-test" });
  assert.equal(result.pass, false);
  assert.match(result.reason, /not currently open/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ error: "positions unavailable" }),
	});
	result = await runSafetyChecks("close_position", {
		position_address: "missing-position",
	}, { cycle_id: "management-test" });
	assert.equal(result.pass, false);
	assert.match(result.reason, /unable to verify open positions/i);

	let updateConfigCalled = false;
	setExecutorTestOverrides({
		tools: {
			update_config: async () => {
				updateConfigCalled = true;
				return { success: true };
			},
		},
	});
	result = await executeTool("update_config", {
		changes: { minOrganic: 75 },
		reason: "test",
	});
	assert.equal(result.blocked, true);
	assert.equal(updateConfigCalled, false);
	setExecutorTestOverrides({ tools: { update_config: null } });

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-update-config-invalid-test-"));
	const originalUserConfigPath = process.env.ZENITH_USER_CONFIG_PATH;
	try {
		process.env.ZENITH_USER_CONFIG_PATH = path.join(tempDir, "user-config.json");
		fs.writeFileSync(process.env.ZENITH_USER_CONFIG_PATH, "{bad json");
		result = await executeTool("update_config", {
			changes: { minOrganic: 77 },
			reason: "test invalid config",
		}, buildApprovedMeta("config-test", "config-test:update_config:1"));
		assert.equal(result.success, false);
		assert.equal(result.reason_code, "USER_CONFIG_INVALID");
	} finally {
		if (originalUserConfigPath) process.env.ZENITH_USER_CONFIG_PATH = originalUserConfigPath;
		else delete process.env.ZENITH_USER_CONFIG_PATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}

	result = await executeTool("remember_fact", {
		nugget: "facts",
		key: "test-memory",
		value: "should not persist",
	}, { cycle_id: "screening-test" });
	assert.equal(result.blocked, true);
	assert.match(result.reason, /autonomous memory mutation is disabled/i);

	result = await executeTool("add_pool_note", {
		pool_address: "pool-1",
		note: "should not persist",
	}, { cycle_id: "screening-test" });
	assert.equal(result.blocked, true);
	assert.match(result.reason, /autonomous note mutation is disabled/i);

  let receivedArgs = null;
	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-d", token_x_mint: "mint-d", token_y_mint: SOL_MINT, bin_step: 100 }),
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
		initial_value_usd: 1,
	}, buildApprovedMeta("screening-test", "screening-test:deploy_position:1"));
  assert.equal(result.success, true);
  assert.ok(receivedArgs);
  assert.equal(receivedArgs.initial_value_usd, 60);

  const outcomes = [];
	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-e", token_x_mint: "mint-e", token_y_mint: SOL_MINT, bin_step: 100 }),
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

	armGeneralWriteTools({
		minutes: 5,
		reason: "test scope",
		scope: {
			allowed_tools: ["deploy_position"],
			pool_address: "pool-preflight",
			max_amount_sol: 0.5,
			one_shot: true,
		},
	});
	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-preflight", token_x_mint: "mint-preflight", token_y_mint: SOL_MINT, bin_step: 100 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
	updateRuntimeHealth({ preflight: null });
	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-preflight",
		amount_y: 0.5,
	}, {});
	assert.equal(result.pass, false);
	assert.match(result.reason, /run \/preflight first/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ error: "positions unavailable", positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-preflight", token_x_mint: "mint-preflight", token_y_mint: SOL_MINT, bin_step: 100 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-preflight",
		amount_y: 0.5,
	}, { cycle_id: "screening-test" });
	assert.equal(result.pass, false);
	assert.match(result.reason, /unable to verify open positions/i);

	disarmGeneralWriteTools({ reason: "reset scope for manual preflight test" });
	armGeneralWriteTools({
		minutes: 5,
		reason: "test scope reset",
		scope: {
			allowed_tools: ["deploy_position"],
			pool_address: "pool-preflight",
			max_amount_sol: 0.5,
			one_shot: true,
		},
	});
	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 0, positions: [] }),
		getPoolGovernanceMetadata: async () => ({ base_mint: "mint-preflight", token_x_mint: "mint-preflight", token_y_mint: SOL_MINT, bin_step: 100 }),
		getWalletBalances: async () => ({ sol: 10 }),
	});
	updateRuntimeHealth({
		preflight: {
			pass: true,
			valid_until: new Date(Date.now() + 5 * 60_000).toISOString(),
			action: {
				tool_name: "deploy_position",
				pool_address: "pool-preflight",
				amount_sol: 0.5,
			},
		},
	});
	result = await runSafetyChecks("deploy_position", {
		pool_address: "pool-preflight",
		amount_y: 0.5,
	}, {});
	assert.equal(result.pass, true);

	result = await runSafetyChecks("close_position", {
		position_address: "pos-1",
	}, {});
	assert.equal(result.pass, false);
	assert.match(result.reason, /does not include tool close_position/i);

	setExecutorTestOverrides({
		getMyPositions: async () => ({ total_positions: 1, positions: [{ position: "pos-guard", pool: "pool-guard", base_mint: "mint-guard" }] }),
	});
	result = await runSafetyChecks("rebalance_on_exit", {
		position_address: "pos-guard",
	}, { cycle_id: "management-test" });
	assert.equal(result.pass, true);

	disarmGeneralWriteTools({ reason: "test cleanup" });

  resetExecutorTestOverrides();
  console.log("executor boundary checks passed");
  process.exit(0);
}

main().catch((error) => {
  resetExecutorTestOverrides();
  console.error(error);
  process.exit(1);
});
