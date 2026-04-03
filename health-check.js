const SCHEDULED_HEALTH_CHECK_GOAL = `
HEALTH CHECK

        Summarize the current portfolio health, total fees earned, and performance of all open positions. Recommend any high-level adjustments if needed.
      `;

const SCHEDULED_HEALTH_CHECK_SUFFIX = [
	"TOOLS ARE DISABLED FOR THIS TURN.",
	"Return only a concise plain-text health summary.",
	"Do not ask follow-up questions.",
	"Do not attempt to execute actions in this run.",
].join(" ");

export function getScheduledHealthCheckGoal() {
	return SCHEDULED_HEALTH_CHECK_GOAL;
}

export function getScheduledHealthCheckAgentOptions() {
	return {
		disableTools: true,
		lessonsOverride: null,
		memoryContextOverride: null,
		systemPromptSuffix: SCHEDULED_HEALTH_CHECK_SUFFIX,
	};
}
