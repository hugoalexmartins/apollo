function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function buildRecentLossCluster(history = []) {
	const recent = asArray(history).slice(-5);
	const stopLosses = recent.filter((row) => /stop loss|emergency/i.test(String(row?.close_reason || ""))).length;
	const realizedLosses = recent.filter((row) => Number(row?.pnl_pct) < 0).length;
	return {
		active: stopLosses >= 2 || realizedLosses >= 3,
		stop_loss_count: stopLosses,
		realized_loss_count: realizedLosses,
		sample_size: recent.length,
	};
}

function detectSourceDisagreement(thesis = {}) {
	const evidence = asArray(thesis.evidence);
	const positive = evidence.filter((row) => row?.supports_action !== false).length;
	const negative = evidence.filter((row) => row?.supports_action === false).length;
	return negative > 0 && positive > 0;
}

function detectMemoryConflict(thesis = {}) {
	return asArray(thesis.evidence).some((row) => {
		if (row?.source !== "memory") return false;
		const summary = String(row.summary || "").toLowerCase();
		return /avoid|failed|unprofitable|loss|cooldown|do not/i.test(summary);
	});
}

function defaultAbstentionStatus(toolName = null) {
	return toolName === "deploy_position" ? "hold" : "manual_review";
}

export function runDecisionCritic({
	thesis,
	assessment,
	context = {},
} = {}) {
	const reasons = [];
	const killSignals = {
		regime_conflict: false,
		stale_signals: false,
		recent_loss_cluster: false,
		source_disagreement: false,
		memory_conflict: false,
	};

	if (!assessment?.pass) {
		reasons.push(...asArray(assessment?.reasons));
	}

	if (context.regime_label && thesis?.regime_label && context.regime_label !== thesis.regime_label) {
		killSignals.regime_conflict = true;
		reasons.push("regime_conflict");
	}

	const staleSensitiveTools = new Set(["deploy_position", "close_position", "claim_fees", "auto_compound_fees"]);
	if (thesis?.freshness?.stale && staleSensitiveTools.has(thesis?.tool_name)) {
		killSignals.stale_signals = true;
		reasons.push("stale_signals");
	}

	if (detectSourceDisagreement(thesis)) {
		killSignals.source_disagreement = true;
		reasons.push("source_disagreement");
	}

	if (detectMemoryConflict(thesis)) {
		killSignals.memory_conflict = true;
		reasons.push("memory_conflict");
	}

	const lossCluster = buildRecentLossCluster(context.recent_performance || []);
	if (thesis?.tool_name === "deploy_position" && lossCluster.active) {
		killSignals.recent_loss_cluster = true;
		reasons.push("recent_realized_loss_cluster");
	}

	const uniqueReasons = [...new Set(reasons.filter(Boolean))];
	const blocked = uniqueReasons.length > 0;
	const severe = killSignals.stale_signals
		|| killSignals.source_disagreement
		|| killSignals.memory_conflict
		|| (thesis?.tool_name === "deploy_position" && killSignals.recent_loss_cluster)
		|| killSignals.regime_conflict;

	return {
		pass: !blocked,
		status: blocked ? defaultAbstentionStatus(thesis?.tool_name) : "approved",
		reason_code: blocked
			? severe
				? "CRITIC_ABORT"
				: "CRITIC_ABSTAIN"
			: null,
		reasons: uniqueReasons,
		kill_signals: killSignals,
		recent_loss_cluster: lossCluster,
		critic_version: "v1",
		reviewed_at: new Date().toISOString(),
	};
}
