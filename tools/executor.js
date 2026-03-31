import { execSync, spawn } from "node:child_process";

import { appendActionLifecycle } from "../action-journal.js";
import { config } from "../config.js";
import {
	addLesson,
	clearAllLessons,
	clearPerformance,
	getPerformanceHistory,
	listLessons,
	pinLesson,
	removeLessonsByKeyword,
	unpinLesson,
} from "../lessons.js";
import { log, logAction } from "../logger.js";
import { recallMemory, rememberFact } from "../memory.js";
import {
	consumeOneShotGeneralWriteApproval,
	evaluateGeneralWriteApproval,
} from "../operator-controls.js";
import {
	addPoolNote,
	getPoolDeployCooldown,
	getPoolMemory,
} from "../pool-memory.js";
import { evaluatePortfolioGuard } from "../portfolio-guards.js";
import { validateRecordedRiskOpeningPreflight } from "../preflight.js";
import { getRuntimeHealth } from "../runtime-health.js";
import {
	buildOpenPositionPnlInputs,
	estimateInitialValueUsd,
} from "../runtime-helpers.js";
import { evaluateDeployAdmission } from "../runtime-policy.js";
import {
	addSmartWallet,
	checkSmartWalletsOnPool,
	listSmartWallets,
	removeSmartWallet,
} from "../smart-wallets.js";
import {
	getTrackedPositions,
	recordToolOutcome,
	setPositionInstruction,
} from "../state.js";
import {
	addStrategy,
	getStrategy,
	listStrategies,
	removeStrategy,
	setActiveStrategy,
} from "../strategy-library.js";
import { notifyClose, notifyDeploy, notifySwap } from "../telegram.js";
import {
	addToBlacklist,
	listBlacklist,
	removeFromBlacklist,
} from "../token-blacklist.js";
import {
	autoCompoundFees,
	calculateDynamicBinTiers,
	chooseDistributionStrategy,
	claimFees,
	closePosition,
	deployPosition,
	getActiveBin,
	getMyPositions,
	getPoolGovernanceMetadata,
	getPositionPnl,
	getWalletPositions,
	rebalanceOnExit,
	searchPools,
} from "./dlmm.js";
import {
	appendWriteLifecycleEntry,
	attachWriteDecisionContext,
	recordWriteToolOutcome,
} from "./executor-lifecycle.js";
import { runSafetyChecksWithDeps } from "./executor-safety.js";
import { handleSuccessfulToolSideEffects } from "./executor-side-effects.js";
import { discoverPools, getPoolDetail, getTopCandidates } from "./screening.js";
import { getPoolInfo, scoreTopLPers, studyTopLPers } from "./study.js";
import { getTokenHolders, getTokenInfo, getTokenNarrative } from "./token.js";
import { runUpdateConfig } from "./update-config.js";
import { getWalletBalances, swapToken } from "./wallet.js";

const executorTestOverrides = {
	getMyPositions: null,
	getWalletBalances: null,
	getPoolGovernanceMetadata: null,
	recordToolOutcome: null,
	tools: {},
};

export function setExecutorTestOverrides(overrides = {}) {
	if (Object.hasOwn(overrides, "getMyPositions"))
		executorTestOverrides.getMyPositions = overrides.getMyPositions;
	if (Object.hasOwn(overrides, "getWalletBalances"))
		executorTestOverrides.getWalletBalances = overrides.getWalletBalances;
	if (Object.hasOwn(overrides, "getPoolGovernanceMetadata"))
		executorTestOverrides.getPoolGovernanceMetadata =
			overrides.getPoolGovernanceMetadata;
	if (Object.hasOwn(overrides, "recordToolOutcome"))
		executorTestOverrides.recordToolOutcome = overrides.recordToolOutcome;
	if (overrides.tools)
		executorTestOverrides.tools = {
			...executorTestOverrides.tools,
			...overrides.tools,
		};
}

export function resetExecutorTestOverrides() {
	executorTestOverrides.getMyPositions = null;
	executorTestOverrides.getWalletBalances = null;
	executorTestOverrides.getPoolGovernanceMetadata = null;
	executorTestOverrides.recordToolOutcome = null;
	executorTestOverrides.tools = {};
}

function getMyPositionsRuntime(args = {}) {
	return executorTestOverrides.getMyPositions
		? executorTestOverrides.getMyPositions(args)
		: getMyPositions(args);
}

function getWalletBalancesRuntime(args = {}) {
	return executorTestOverrides.getWalletBalances
		? executorTestOverrides.getWalletBalances(args)
		: getWalletBalances(args);
}

function getPoolGovernanceMetadataRuntime(args = {}) {
	return executorTestOverrides.getPoolGovernanceMetadata
		? executorTestOverrides.getPoolGovernanceMetadata(args)
		: getPoolGovernanceMetadata(args);
}

function recordToolOutcomeRuntime(payload) {
	if (executorTestOverrides.recordToolOutcome) {
		executorTestOverrides.recordToolOutcome(payload);
		return;
	}
	recordToolOutcome(payload);
}

function getToolImplementation(name) {
	return executorTestOverrides.tools[name] || toolMap[name];
}

function normalizeToolName(name) {
	return typeof name === "string" ? name.replace(/<.*$/, "").trim() : "";
}

function buildManualReviewSuppressionReason(toolName, reason) {
	return `${toolName} requires manual review: ${reason || "unknown write-state divergence"}`;
}

// Registered by index.js so update_config can restart cron jobs when intervals change
let _cronRestarter = null;
export function registerCronRestarter(fn) {
	_cronRestarter = fn;
}

let _autonomousWriteSuppressed = false;
let _writeSuppressionReason = null;
let _writeSuppressionCode = null;
let _writeSuppressionIncidentKey = null;
let _writeSuppressionOverrideUntilMs = null;
let _writeSuppressionResumeReason = null;
let _writeSuppressionResumeCode = null;
let _writeSuppressionResumeIncidentKey = null;

export function setAutonomousWriteSuppression({
	suppressed,
	reason = null,
	code = null,
	incidentKey = null,
	overrideUntil = null,
	overrideUntilMs = null,
} = {}) {
	_autonomousWriteSuppressed = Boolean(suppressed);
	_writeSuppressionReason = _autonomousWriteSuppressed
		? reason || "manual review required"
		: null;
	_writeSuppressionCode = _autonomousWriteSuppressed ? code || null : null;
	_writeSuppressionIncidentKey = _autonomousWriteSuppressed
		? incidentKey || null
		: null;
	if (_autonomousWriteSuppressed) {
		_writeSuppressionOverrideUntilMs = null;
		_writeSuppressionResumeReason = null;
		_writeSuppressionResumeCode = null;
		_writeSuppressionResumeIncidentKey = null;
		return;
	}
	const hasExplicitOverrideUntilMs =
		overrideUntilMs != null && overrideUntilMs !== "";
	const parsedOverrideUntilMs = hasExplicitOverrideUntilMs && Number.isFinite(Number(overrideUntilMs))
		? Number(overrideUntilMs)
		: Number.isFinite(Date.parse(overrideUntil || ""))
			? Date.parse(overrideUntil)
			: null;
	_writeSuppressionOverrideUntilMs = parsedOverrideUntilMs;
	_writeSuppressionResumeReason = reason || null;
	_writeSuppressionResumeCode = code || null;
	_writeSuppressionResumeIncidentKey = incidentKey || null;
}

export function getAutonomousWriteSuppression() {
	if (
		!_autonomousWriteSuppressed &&
		Number.isFinite(_writeSuppressionOverrideUntilMs) &&
		Date.now() > _writeSuppressionOverrideUntilMs
	) {
		_autonomousWriteSuppressed = true;
		_writeSuppressionReason =
			_writeSuppressionResumeReason || "manual review required";
		_writeSuppressionCode = _writeSuppressionResumeCode || null;
		_writeSuppressionIncidentKey = _writeSuppressionResumeIncidentKey || null;
		_writeSuppressionOverrideUntilMs = null;
		_writeSuppressionResumeReason = null;
		_writeSuppressionResumeCode = null;
		_writeSuppressionResumeIncidentKey = null;
	}
	return {
		suppressed: _autonomousWriteSuppressed,
		reason: _writeSuppressionReason,
		code: _writeSuppressionCode,
		incident_key: _writeSuppressionIncidentKey,
		override_until: Number.isFinite(_writeSuppressionOverrideUntilMs)
			? new Date(_writeSuppressionOverrideUntilMs).toISOString()
			: null,
	};
}

// Map tool names to implementations
const toolMap = {
	discover_pools: discoverPools,
	get_top_candidates: getTopCandidates,
	get_pool_detail: getPoolDetail,
	get_position_pnl: getPositionPnl,
	get_active_bin: getActiveBin,
	choose_distribution_strategy: chooseDistributionStrategy,
	calculate_dynamic_bin_tiers: calculateDynamicBinTiers,
	deploy_position: deployPosition,
	rebalance_on_exit: rebalanceOnExit,
	auto_compound_fees: autoCompoundFees,
	get_my_positions: getMyPositions,
	get_wallet_positions: getWalletPositions,
	search_pools: searchPools,
	get_token_info: getTokenInfo,
	get_token_holders: getTokenHolders,
	get_token_narrative: getTokenNarrative,
	add_smart_wallet: addSmartWallet,
	remove_smart_wallet: removeSmartWallet,
	list_smart_wallets: listSmartWallets,
	check_smart_wallets_on_pool: checkSmartWalletsOnPool,
	claim_fees: claimFees,
	close_position: closePosition,
	get_wallet_balance: getWalletBalances,
	swap_token: swapToken,
	get_top_lpers: studyTopLPers,
	study_top_lpers: studyTopLPers,
	score_top_lpers: scoreTopLPers,
	get_pool_info: getPoolInfo,
	set_position_note: ({ position_address, instruction }) => {
		const ok = setPositionInstruction(position_address, instruction || null);
		if (!ok)
			return { error: `Position ${position_address} not found in state` };
		return {
			saved: true,
			position: position_address,
			instruction: instruction || null,
		};
	},
	self_update: async () => {
		try {
			const result = execSync("git pull", {
				cwd: process.cwd(),
				encoding: "utf8",
			}).trim();
			if (result.includes("Already up to date")) {
				return {
					success: true,
					updated: false,
					message: "Already up to date — no restart needed.",
				};
			}
			// Delay restart so this tool response (and Telegram message) gets sent first
			setTimeout(() => {
				const child = spawn(process.execPath, process.argv.slice(1), {
					detached: true,
					stdio: "inherit",
					cwd: process.cwd(),
				});
				child.unref();
				process.exit(0);
			}, 3000);
			return {
				success: true,
				updated: true,
				message: `Updated! Restarting in 3s...\n${result}`,
			};
		} catch (e) {
			return { success: false, error: e.message };
		}
	},
	get_performance_history: getPerformanceHistory,
	add_strategy: addStrategy,
	list_strategies: listStrategies,
	get_strategy: getStrategy,
	set_active_strategy: setActiveStrategy,
	remove_strategy: removeStrategy,
	get_pool_memory: getPoolMemory,
	add_pool_note: addPoolNote,
	add_to_blacklist: addToBlacklist,
	remove_from_blacklist: removeFromBlacklist,
	list_blacklist: listBlacklist,
	add_lesson: ({ rule, tags, pinned, role }) => {
		addLesson(rule, tags || [], { pinned: !!pinned, role: role || null });
		return { saved: true, rule, pinned: !!pinned, role: role || "all" };
	},
	remember_fact: ({ nugget, key, value }) => rememberFact(nugget, key, value),
	recall_memory: ({ query, nugget }) => recallMemory(query, nugget),
	pin_lesson: ({ id }) => pinLesson(id),
	unpin_lesson: ({ id }) => unpinLesson(id),
	list_lessons: ({ role, pinned, tag, limit } = {}) =>
		listLessons({ role, pinned, tag, limit }),
	clear_lessons: ({ mode, keyword }) => {
		if (mode === "all") {
			const n = clearAllLessons();
			log("lessons", `Cleared all ${n} lessons`);
			return { cleared: n, mode: "all" };
		}
		if (mode === "performance") {
			const n = clearPerformance();
			log("lessons", `Cleared ${n} performance records`);
			return { cleared: n, mode: "performance" };
		}
		if (mode === "keyword") {
			if (!keyword) return { error: "keyword required for mode=keyword" };
			const n = removeLessonsByKeyword(keyword);
			log("lessons", `Cleared ${n} lessons matching "${keyword}"`);
			return { cleared: n, mode: "keyword", keyword };
		}
		return { error: "invalid mode" };
	},
	update_config: ({ changes, reason = "" }) =>
		runUpdateConfig({
			changes,
			reason,
			cronRestarter: _cronRestarter,
		}),
};

// Tools that modify on-chain state (need extra safety checks)
const WRITE_TOOLS = new Set([
	"deploy_position",
	"rebalance_on_exit",
	"auto_compound_fees",
	"claim_fees",
	"close_position",
	"swap_token",
]);
const GENERAL_APPROVAL_REQUIRED_TOOLS = new Set([
	...WRITE_TOOLS,
	"update_config",
]);

function resolveDecisionGate(meta = {}, args = {}) {
	if (meta?.decision_gate && typeof meta.decision_gate === "object") {
		return meta.decision_gate;
	}
	if (
		args?.decision_context?.decision_gate &&
		typeof args.decision_context.decision_gate === "object"
	) {
		return args.decision_context.decision_gate;
	}
	return null;
}

/**
 * Execute a tool call with safety checks and logging.
 */
export async function executeTool(name, args, meta = {}) {
	const startTime = Date.now();
	const toolName = normalizeToolName(name);
	let normalizedArgs = args;
	let workflowId = null;

	function appendManualReviewTerminal(reason) {
		appendWriteLifecycleEntry({
			appendActionLifecycle,
			workflowId,
			lifecycle: "manual_review",
			name: toolName,
			args: normalizedArgs,
			meta,
			reason,
		});
		if (meta.cycle_id) {
			setAutonomousWriteSuppression({
				suppressed: true,
				reason: buildManualReviewSuppressionReason(toolName, reason),
				code: "WRITE_MANUAL_REVIEW",
				incidentKey: workflowId || meta.action_id || null,
			});
		}
	}

	// ─── Validate tool exists ─────────────────
	const fn = getToolImplementation(toolName);
	if (!fn) {
		const error = `Unknown tool: ${toolName}`;
		log("error", error);
		return { error };
	}

	if (toolName === "deploy_position" && normalizedArgs) {
		const wallet = await getWalletBalancesRuntime({}).catch(() => null);
		const solPrice = Number(wallet?.sol_price) || 0;
		const solLeg = Number(
			normalizedArgs.amount_y ?? normalizedArgs.amount_sol ?? 0,
		);
		const derivedInitialValueUsd =
			solPrice > 0 && solLeg > 0
				? estimateInitialValueUsd({ amountSol: solLeg, solPrice })
				: null;
		normalizedArgs = {
			...normalizedArgs,
			initial_value_usd: derivedInitialValueUsd,
		};
		if (derivedInitialValueUsd != null) {
			log(
				"executor",
				`Derived initial_value_usd=$${normalizedArgs.initial_value_usd} from runtime data for deploy_position`,
			);
		}
	}

	// ─── Pre-execution safety checks ──────────
	if (
		!meta.cycle_id &&
		GENERAL_APPROVAL_REQUIRED_TOOLS.has(toolName) &&
		!WRITE_TOOLS.has(toolName)
	) {
		const safetyCheck = await runSafetyChecks(toolName, normalizedArgs, meta);
		if (!safetyCheck.pass) {
			log("safety_block", `${toolName} blocked: ${safetyCheck.reason}`);
			return {
				blocked: true,
				reason: safetyCheck.reason,
			};
		}
	}

	if (meta.cycle_id && toolName === "remember_fact") {
		return {
			blocked: true,
			reason: "Autonomous memory mutation is disabled for cycle-driven roles.",
		};
	}
	if (
		meta.cycle_id &&
		(toolName === "set_position_note" || toolName === "add_pool_note")
	) {
		return {
			blocked: true,
			reason: "Autonomous note mutation is disabled for cycle-driven roles.",
		};
	}

	if (WRITE_TOOLS.has(toolName)) {
		const suppression = getAutonomousWriteSuppression();
		if (suppression.suppressed) {
			const reason =
				suppression.reason ||
				"manual review required before autonomous writes can resume";
			recordToolOutcomeRuntime({
				tool: toolName,
				outcome: "blocked",
				reason,
				metadata: {
					pool_address: normalizedArgs?.pool_address || null,
					position_address: normalizedArgs?.position_address || null,
					cycle_id: meta.cycle_id || null,
					action_id: meta.action_id || null,
					blocked_by_recovery: true,
				},
			});
			return {
				blocked: true,
				reason,
			};
		}

		workflowId =
			meta.action_id ||
			`${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		normalizedArgs = attachWriteDecisionContext(
			normalizedArgs,
			meta,
			workflowId,
		);
		appendWriteLifecycleEntry({
			appendActionLifecycle,
			workflowId,
			lifecycle: "intent",
			name: toolName,
			args: normalizedArgs,
			meta,
		});

		if (toolName === "rebalance_on_exit") {
			normalizedArgs = {
				...normalizedArgs,
				journal_workflow_id: workflowId,
			};
		}

		if (meta.cycle_id) {
			const decisionGate = resolveDecisionGate(meta, normalizedArgs);
			if (!decisionGate?.approved) {
				const reason = decisionGate?.reason_code
					? `decision gate blocked write: ${decisionGate.reason_code}`
					: "decision gate missing for cycle-driven write";
				appendManualReviewTerminal("write_intent_blocked_by_decision_gate");
				recordWriteToolOutcome({
					recordToolOutcome: recordToolOutcomeRuntime,
					tool: toolName,
					outcome: "blocked",
					reason,
					args: normalizedArgs,
					meta: {
						...meta,
						thesis_id: meta.thesis_id || decisionGate?.thesis_id || null,
						critic_status: meta.critic_status || decisionGate?.status || null,
						critic_code: meta.critic_code || decisionGate?.reason_code || null,
						memory_version:
							meta.memory_version || decisionGate?.memory_version || null,
						shadow_memory_version:
							meta.shadow_memory_version ||
							decisionGate?.shadow_memory_version ||
							null,
					},
				});
				return {
					blocked: true,
					reason,
					manual_review: true,
				};
			}
		}

		const safetyCheck = await runSafetyChecks(toolName, normalizedArgs, meta);
		if (!safetyCheck.pass) {
			log("safety_block", `${toolName} blocked: ${safetyCheck.reason}`);
			appendManualReviewTerminal("write_intent_blocked_by_safety_checks");
			recordWriteToolOutcome({
				recordToolOutcome: recordToolOutcomeRuntime,
				tool: toolName,
				outcome: "blocked",
				reason: safetyCheck.reason,
				args: normalizedArgs,
				meta,
			});
			return {
				blocked: true,
				reason: safetyCheck.reason,
			};
		}
	}

	// ─── Execute ──────────────────────────────
	try {
		const result = await fn(normalizedArgs);
		const duration = Date.now() - startTime;
		const success = result?.success !== false && !result?.error;

		logAction({
			tool: toolName,
			args: normalizedArgs,
			result: summarizeResult(result),
			duration_ms: duration,
			success,
			cycle_id: meta.cycle_id || null,
			action_id: meta.action_id || null,
		});

		if (success) {
			if (WRITE_TOOLS.has(toolName)) {
				appendWriteLifecycleEntry({
					appendActionLifecycle,
					workflowId,
					lifecycle: "completed",
					name: toolName,
					args: {
						...normalizedArgs,
						position_address:
							normalizedArgs?.position_address || result?.position || null,
						pool_address:
							normalizedArgs?.pool_address ||
							result?.pool ||
							result?.pool_address ||
							null,
					},
					meta,
				});
				recordWriteToolOutcome({
					recordToolOutcome: recordToolOutcomeRuntime,
					tool: toolName,
					outcome: "success",
					args: normalizedArgs,
					meta,
					result,
				});
			}
			await handleSuccessfulToolSideEffects({
				name: toolName,
				normalizedArgs,
				result,
				meta,
				workflowId,
				executeTool,
				notifySwap,
				notifyDeploy,
				notifyClose,
				log,
				config,
			});
			if (WRITE_TOOLS.has(toolName) && result?.manual_review_required) {
				appendManualReviewTerminal(
					result.manual_review_reason ||
						"write succeeded but local follow-up requires manual review",
				);
			}
			if (!meta.cycle_id && GENERAL_APPROVAL_REQUIRED_TOOLS.has(toolName)) {
				consumeOneShotGeneralWriteApproval({
					tool_name: toolName,
					pool_address: normalizedArgs?.pool_address || null,
					position_address:
						normalizedArgs?.position_address || result?.position || null,
					amount_sol:
						toolName === "deploy_position"
							? (normalizedArgs?.amount_y ?? normalizedArgs?.amount_sol ?? 0)
							: toolName === "swap_token" &&
									(normalizedArgs?.output_mint === "SOL" ||
										normalizedArgs?.input_mint === "SOL")
								? Number(normalizedArgs?.amount || 0)
								: null,
				});
			}
		}

		if (!success && WRITE_TOOLS.has(toolName)) {
			const reason = result?.error || "write_tool_reported_unsuccessful_result";
			appendManualReviewTerminal(reason);
			recordWriteToolOutcome({
				recordToolOutcome: recordToolOutcomeRuntime,
				tool: toolName,
				outcome: "error",
				reason,
				args: normalizedArgs,
				meta,
				result,
			});
		}

		return result;
	} catch (error) {
		const duration = Date.now() - startTime;

		if (WRITE_TOOLS.has(toolName)) {
			appendManualReviewTerminal(error.message || "write_tool_execution_error");
			recordWriteToolOutcome({
				recordToolOutcome: recordToolOutcomeRuntime,
				tool: toolName,
				outcome: "error",
				reason: error.message,
				args: normalizedArgs,
				meta,
			});
		}

		logAction({
			tool: toolName,
			args: normalizedArgs,
			error: error.message,
			duration_ms: duration,
			success: false,
			cycle_id: meta.cycle_id || null,
			action_id: meta.action_id || null,
		});

		// Return error to LLM so it can decide what to do
		return {
			error: error.message,
			tool: toolName,
		};
	}
}

/**
 * Run safety checks before executing write operations.
 */
export async function runSafetyChecks(name, args, meta = {}) {
	const toolName = normalizeToolName(name);
	return runSafetyChecksWithDeps(toolName, args, meta, {
		generalApprovalRequiredTools: GENERAL_APPROVAL_REQUIRED_TOOLS,
		evaluateGeneralWriteApproval,
		validateRecordedRiskOpeningPreflight,
		getRuntimeHealth,
		getWalletBalancesRuntime,
		getPoolGovernanceMetadataRuntime,
		getMyPositionsRuntime,
		evaluatePortfolioGuard,
		buildOpenPositionPnlInputs,
		getTrackedPositions,
		evaluateDeployAdmission,
		getPoolDeployCooldown,
		config,
	});
}

/**
 * Summarize a result for logging (truncate large responses).
 */
function summarizeResult(result) {
	const str = JSON.stringify(result);
	if (str.length > 1000) {
		return `${str.slice(0, 1000)}...(truncated)`;
	}
	return result;
}
