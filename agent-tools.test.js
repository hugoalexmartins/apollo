import assert from "node:assert/strict";
import test from "node:test";

test("general role is read-only unless dangerous tools are explicitly allowed", async () => {
  process.env.OPENROUTER_API_KEY ||= "test-openrouter-key";
  const { getToolsForRole } = await import("./agent.js");
  const generalSafe = getToolsForRole("GENERAL").map((tool) => tool.function.name);
  assert.equal(generalSafe.includes("get_top_candidates"), true);
  assert.equal(generalSafe.includes("deploy_position"), false);
  assert.equal(generalSafe.includes("close_position"), false);
  assert.equal(generalSafe.includes("update_config"), false);

  const generalArmed = getToolsForRole("GENERAL", { allowDangerousTools: true }).map((tool) => tool.function.name);
  assert.equal(generalArmed.includes("deploy_position"), true);
  assert.equal(generalArmed.includes("update_config"), true);
});
