import assert from "node:assert/strict";
import test from "node:test";

test("general role is read-only unless dangerous tools are explicitly allowed", async () => {
	process.env.OPENROUTER_API_KEY ||= "test-openrouter-key";
	const { getToolsForRole, limitToolCallsPerTurn } = await import("./agent.js");
	const generalSafe = getToolsForRole("GENERAL").map((tool) => tool.function.name);
	assert.equal(generalSafe.includes("get_top_candidates"), true);
	assert.equal(generalSafe.includes("deploy_position"), false);
	assert.equal(generalSafe.includes("close_position"), false);
	assert.equal(generalSafe.includes("update_config"), false);
	assert.equal(generalSafe.includes("add_lesson"), false);

	const generalArmed = getToolsForRole("GENERAL", { allowDangerousTools: true }).map((tool) => tool.function.name);
	assert.equal(generalArmed.includes("deploy_position"), true);
	assert.equal(generalArmed.includes("update_config"), true);
	assert.equal(generalArmed.includes("self_update"), false);

	const screenerTools = getToolsForRole("SCREENER").map((tool) => tool.function.name);
	const managerTools = getToolsForRole("MANAGER").map((tool) => tool.function.name);
	assert.equal(screenerTools.includes("update_config"), false);
	assert.equal(managerTools.includes("update_config"), false);

	const limited = limitToolCallsPerTurn([
		{ id: "call-1", function: { name: "get_top_candidates", arguments: "{}" } },
		{ id: "call-2", function: { name: "deploy_position", arguments: "{}" } },
	]);
	assert.equal(limited.length, 1);
	assert.equal(limited[0].id, "call-1");
});
