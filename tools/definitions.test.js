import assert from "node:assert/strict";
import test from "node:test";

import { formatMutableConfigKeyHelp } from "../config-registry.js";
import { tools } from "./definitions.js";

test("update_config tool description is generated from the shared config registry", () => {
	const updateConfigTool = tools.find((entry) => entry.function?.name === "update_config");
	assert.ok(updateConfigTool);
	const help = formatMutableConfigKeyHelp();
	assert.match(updateConfigTool.function.description, new RegExp(help.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(updateConfigTool.function.description, /maxBundlePct/);
	assert.match(updateConfigTool.function.description, /minTokenAgeHours/);
	assert.match(updateConfigTool.function.description, /healthCheckIntervalMin/);
	assert.match(updateConfigTool.function.description, /strategy/);
});
