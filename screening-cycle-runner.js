import { runScreeningDecisionEngine } from "./autonomy-engine.js";
import { finalizeCycleRun } from "./cycle-harness.js";
import { buildOpenPositionPnlInputs } from "./runtime-helpers.js";
import {
	resolveAutonomousStrategyPreset,
	resolveDeploySemantics,
} from "./strategy-library.js";
import { resolveSingleSidedSolPoolOrientation } from "./tools/dlmm-position-context.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

function classifyScreeningDecisionStatus(decisionResult) {
	if (decisionResult?.manual_review) return "manual_review";
	if (decisionResult?.error || decisionResult?.success === false)
		return "failed_write";
	if (decisionResult?.blocked) return "held";
	if (decisionResult?.success) return "completed";
	return "held";
}

function asFiniteNumber(value, fallback = null) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveDeployPlan({
	activeStrategy,
	pool,
	distributionPlan,
	tierPlan,
	scoredLpers,
}) {
	const plannerBinsBelow = asFiniteNumber(
		tierPlan?.range_plan?.bins_below,
		null,
	);
	const plannerBinsAbove = asFiniteNumber(
		tierPlan?.range_plan?.bins_above,
		null,
	);
	if (activeStrategy) {
		const semantics = resolveDeploySemantics({
			strategy: activeStrategy.lp_strategy || "bid_ask",
			bins_below: asFiniteNumber(activeStrategy.range?.bins_below, plannerBinsBelow),
			bins_above: asFiniteNumber(activeStrategy.range?.bins_above, plannerBinsAbove),
			amount_x: 0,
			amount_y: 1,
			single_side: activeStrategy.entry?.single_side,
		});
		return {
			preset_id: activeStrategy.id || null,
			preset_name: activeStrategy.name || "Active Strategy",
			strategy: activeStrategy.lp_strategy || "bid_ask",
			bins_below: asFiniteNumber(
				activeStrategy.range?.bins_below,
				plannerBinsBelow,
			),
			bins_above: asFiniteNumber(
				activeStrategy.range?.bins_above,
				plannerBinsAbove,
			),
			source: "active_strategy_override",
			activation_summary: "using manually active strategy override",
			...semantics,
		};
	}

	const preset = resolveAutonomousStrategyPreset({
		pool,
		distributionPlan,
		scoredLpers,
	});
	const presetBinsBelow = asFiniteNumber(preset.range?.bins_below, 0) ?? 0;
	const presetBinsAbove = asFiniteNumber(preset.range?.bins_above, 0) ?? 0;
	return {
		preset_id: preset.id,
		preset_name: preset.name,
		strategy: preset.lp_strategy,
		bins_below:
			preset.lp_strategy === "spot"
				? Math.max(plannerBinsBelow ?? 0, presetBinsBelow)
				: presetBinsBelow,
		bins_above:
			preset.lp_strategy === "spot"
				? Math.max(plannerBinsAbove ?? 0, presetBinsAbove)
				: presetBinsAbove,
		source: "autonomous_preset",
		activation_summary:
			preset.activation_summary || preset.entry?.condition || preset.best_for,
		...resolveDeploySemantics({
			strategy: preset.lp_strategy,
			bins_below:
				preset.lp_strategy === "spot"
					? Math.max(plannerBinsBelow ?? 0, presetBinsBelow)
					: presetBinsBelow,
			bins_above:
				preset.lp_strategy === "spot"
					? Math.max(plannerBinsAbove ?? 0, presetBinsAbove)
					: presetBinsAbove,
			amount_x: 0,
			amount_y: 1,
			single_side: preset.entry?.single_side,
		}),
	};
}

function buildPlanningPoolData(pool, asNumber) {
	return {
		six_hour_volatility: asNumber(pool.six_hour_volatility ?? pool.volatility, 0),
		volatility: asNumber(pool.six_hour_volatility ?? pool.volatility, 0),
		fee_tvl_ratio: asNumber(pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio, 0),
		organic_score: asNumber(pool.organic_score, 0),
		bin_step: asNumber(pool.bin_step, 0),
		price_change_pct: asNumber(pool.price_change_pct, 0),
		active_tvl: asNumber(pool.active_tvl, 0),
		volume_24h: asNumber(pool.volume_24h ?? pool.volume_window, 0),
	};
}

function evaluateResolvedStrategyProtection({
	pool,
	regimeLabel,
	strategy,
	getNegativeRegimeMemory,
	getNegativeRegimeCooldown,
}) {
	const globalCooldown = getNegativeRegimeMemory({
		regime_label: regimeLabel,
		strategy,
	});
	if (globalCooldown.invalid_state) {
		return {
			blocked: true,
			invalid_state: true,
			reason: "negative_regime_memory_invalid_state",
			details: {
				error: globalCooldown.error,
			},
		};
	}
	if (globalCooldown.active) {
		return {
			blocked: true,
			reason: "negative_regime_memory_cooldown",
			details: {
				key: globalCooldown.key,
				cooldown_until: globalCooldown.cooldown_until,
				remaining_ms: globalCooldown.remaining_ms,
				hits: globalCooldown.hits,
				sample_quality: globalCooldown.sample_quality,
				cumulative_negative_pnl_abs:
					globalCooldown.cumulative_negative_pnl_abs,
			},
		};
	}

	const poolCooldown = getNegativeRegimeCooldown({
		pool_address: pool.pool,
		regime_label: regimeLabel,
		strategy,
	});
	if (poolCooldown.invalid_state) {
		return {
			blocked: true,
			invalid_state: true,
			reason: "negative_regime_cooldown_invalid_state",
			details: {
				error: poolCooldown.error,
			},
		};
	}
	if (poolCooldown.active) {
		return {
			blocked: true,
			reason: "negative_regime_cooldown",
			details: {
				key: poolCooldown.key,
				cooldown_until: poolCooldown.cooldown_until,
				remaining_ms: poolCooldown.remaining_ms,
				hits: poolCooldown.hits,
			},
		};
	}

	return null;
}

function evaluateSingleSidedSolOrientationGuard({
	pool,
	deployPlan,
	solMint,
}) {
	if (
		deployPlan?.deposit_sidedness !== "single_sided"
		|| deployPlan?.deposit_asset !== "sol"
	) {
		return {
			applies: false,
			blocked: false,
			reason: null,
			orientation: null,
		};
	}

	const orientation = resolveSingleSidedSolPoolOrientation({
		token_x_mint: pool?.base?.mint || null,
		token_y_mint: pool?.quote?.mint || null,
		solMint,
	});
	const reasonByStatus = {
		wrong_side: "single_sided_sol_requires_token_y_sol",
		unknown: "single_sided_sol_orientation_unknown",
		not_sol_pool: "single_sided_sol_pool_not_sol_quoted",
		ambiguous: "single_sided_sol_orientation_ambiguous",
	};
	return {
		applies: true,
		blocked: !orientation.compatible,
		reason: orientation.compatible ? null : reasonByStatus[orientation.status],
		orientation,
	};
}

async function inspectDeployCandidate({
	pool,
	activeStrategy,
	asNumber,
	executeTool,
	inspectCandidate,
	deriveExpectedVolumeProfile,
	deriveTrendBias,
}) {
	const planningPoolData = buildPlanningPoolData(pool, asNumber);
	const expectedVolumeProfile = deriveExpectedVolumeProfile(pool);
	const [inspection, distributionPlan, tierPlan] = await Promise.all([
		inspectCandidate(pool, executeTool),
		executeTool("choose_distribution_strategy", {
			pool_data: planningPoolData,
			expected_volume_profile: expectedVolumeProfile,
		}),
		executeTool("calculate_dynamic_bin_tiers", {
			six_hour_volatility: planningPoolData.six_hour_volatility,
			trend_bias: deriveTrendBias(pool, null),
		}),
	]);

	const scoredLpers = inspection.scoredLpers || {
		message: "wallet score unavailable",
		candidates: [],
	};
	const deployPlan = resolveDeployPlan({
		activeStrategy,
		pool,
		distributionPlan,
		tierPlan,
		scoredLpers,
	});

	return {
		inspection,
		distributionPlan,
		tierPlan,
		scoredLpers,
		deployPlan,
	};
}

export function createScreeningCycleRunner(deps) {
	return async function runScreeningCycle({ cycleId } = {}) {
		const {
			log,
			config,
			getMyPositions,
			getWalletBalances,
			discoverPools,
			getTopCandidates,
			classifyRuntimeFailure,
			validateStartupSnapshot,
			appendReplayEnvelope,
			writeEvidenceBundle,
			getActiveStrategy,
			computeDeployAmount,
			asNumber,
			deriveExpectedVolumeProfile,
			executeTool,
			inspectCandidate,
			deriveTrendBias,
			evaluateCandidateIntel,
			formatFinalistInspectionBlock,
			buildCandidateContext,
			roundMetric,
			agentLoop,
			evaluatePortfolioGuard,
			evaluateScreeningCycleAdmission,
			getPerformanceSummary,
			getPerformanceHistory,
			getMemoryContext,
			getMemoryVersionStatus,
			classifyRuntimeRegime,
			applyRegimeHysteresis,
			resolveRegimePackContext,
			listCounterfactualRegimes,
			getRegimePack,
			getPerformanceSizingMultiplier,
			getRiskSizingMultiplier,
			getNegativeRegimeCooldown,
			getNegativeRegimeMemory,
			appendCounterfactualReview,
			listActionJournalWorkflowsByCycle,
			recordCycleEvaluation,
			refreshRuntimeHealth,
			telegramEnabled,
			sendMessage,
			setScreeningBusy,
			setScreeningLastTriggered,
			setScreeningLastRun,
		} = deps;

		setScreeningBusy(true);

		const failScreeningPrecheck = (failure) => {
			log("cron_error", `Screening pre-check failed: ${failure.message}`);
			recordCycleEvaluation({
				cycle_id: cycleId,
				cycle_type: "screening",
				status: "failed_precheck",
				summary: { reason_code: failure.reason_code, error: failure.message },
				candidates: [],
			});
			appendReplayEnvelope({
				cycle_id: cycleId,
				cycle_type: "screening",
				reason_code: failure.reason_code,
				error: failure.message,
			});
			writeEvidenceBundle({
				cycle_id: cycleId,
				cycle_type: "screening",
				status: "failed_precheck",
				reason_code: failure.reason_code,
				error: failure.message,
				written_at: new Date().toISOString(),
			});
		};

		let prePositions;
		let preBalance;
		let screenReport = null;
		let screeningEvaluation = null;
		let screeningTopCandidates = null;
		let candidateEvaluations = [];

		try {
			[prePositions, preBalance] = await Promise.all([
				getMyPositions({ force: true }),
				getWalletBalances(),
			]);
			const precheckFailure = validateStartupSnapshot({
				wallet: preBalance,
				positions: prePositions,
				candidates: { candidates: [] },
			});
			if (precheckFailure) {
				failScreeningPrecheck(precheckFailure);
				return;
			}

			const portfolioGuard = evaluatePortfolioGuard({
				portfolioSnapshot: preBalance,
				openPositionPnls: buildOpenPositionPnlInputs(prePositions.positions),
			});
			const screeningAdmission = evaluateScreeningCycleAdmission({
				positionsCount: prePositions.total_positions,
				walletSol: preBalance.sol,
				config,
				portfolioGuard,
			});
			if (!screeningAdmission.allowed) {
				log("cron", screeningAdmission.log_message);
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: screeningAdmission.status,
					summary: screeningAdmission.summary,
					admission_inputs: {
						positionsCount: prePositions.total_positions,
						walletSol: preBalance.sol,
						config,
						portfolioGuard,
					},
					write_workflows: listActionJournalWorkflowsByCycle(cycleId),
				});
				recordCycleEvaluation({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: screeningAdmission.status,
					summary: screeningAdmission.summary,
					candidates: [],
				});
				if (screeningAdmission.status === "skipped_guard_pause") {
					refreshRuntimeHealth({
						cycles: {
							screening: {
								status: screeningAdmission.status,
								reason: screeningAdmission.reason,
								at: new Date().toISOString(),
							},
						},
					});
				}
				return;
			}

			setScreeningLastTriggered(Date.now());
			setScreeningLastRun(Date.now());
			log(
				"cron",
				`Starting screening cycle [model: ${config.llm.screeningModel}]`,
			);

			const currentBalance = preBalance;
			const performanceSummary = getPerformanceSummary?.() || null;
			let discoverySnapshot;
			try {
				discoverySnapshot = await discoverPools({
					page_size: 50,
					screeningConfig: config.screening,
				});
			} catch (error) {
				const failure = classifyRuntimeFailure(error);
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					summary: {
						reason_code: failure.reason_code,
						error: failure.message,
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					reason_code: failure.reason_code,
					error: failure.message,
				});
				writeEvidenceBundle({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					reason_code: failure.reason_code,
					error: failure.message,
					written_at: new Date().toISOString(),
				});
				screenReport = `Screening failed closed: [${failure.reason_code}] ${failure.message}`;
				return;
			}
			if (discoverySnapshot?.error) {
				const failure = classifyRuntimeFailure(
					new Error(discoverySnapshot.error),
				);
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					summary: {
						reason_code: failure.reason_code,
						error: failure.message,
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					reason_code: failure.reason_code,
					error: failure.message,
				});
				writeEvidenceBundle({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					reason_code: failure.reason_code,
					error: failure.message,
					written_at: new Date().toISOString(),
				});
				screenReport = `Screening failed closed: [${failure.reason_code}] ${failure.message}`;
				return;
			}
			const rawRegimeClassification = classifyRuntimeRegime({
				walletSol: currentBalance.sol,
				positionsCount: prePositions.total_positions,
				maxPositions: config.risk.maxPositions,
				deployFloor: config.management.deployAmountSol,
				gasReserve: config.management.gasReserve,
				performanceSummary,
				marketPools: discoverySnapshot?.pools || [],
			});
			const regimeClassification = applyRegimeHysteresis({
				classification: rawRegimeClassification,
			});
			if (regimeClassification?.invalid_state) {
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_precheck",
					summary: {
						reason_code: "REGIME_STATE_INVALID",
						error: regimeClassification.error,
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					reason_code: "REGIME_STATE_INVALID",
					error: regimeClassification.error,
				});
				writeEvidenceBundle({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_precheck",
					reason_code: "REGIME_STATE_INVALID",
					error: regimeClassification.error,
					written_at: new Date().toISOString(),
				});
				screenReport = `Screening failed closed: [REGIME_STATE_INVALID] ${regimeClassification.error}`;
				return;
			}
			const regimeContext = resolveRegimePackContext({
				baseScreeningConfig: config.screening,
				classification: regimeClassification,
			});
			if (regimeContext?.invalid_state) {
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_precheck",
					summary: {
						reason_code: "REGIME_STATE_INVALID",
						error: regimeContext.error,
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					reason_code: "REGIME_STATE_INVALID",
					error: regimeContext.error,
				});
				writeEvidenceBundle({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_precheck",
					reason_code: "REGIME_STATE_INVALID",
					error: regimeContext.error,
					written_at: new Date().toISOString(),
				});
				screenReport = `Screening failed closed: [REGIME_STATE_INVALID] ${regimeContext.error}`;
				return;
			}
			const performanceMultiplier =
				getPerformanceSizingMultiplier(performanceSummary);
			const riskMultiplier = getRiskSizingMultiplier({
				positionsCount: prePositions.total_positions,
				maxPositions: config.risk.maxPositions,
			});
			const deployAmount = computeDeployAmount(currentBalance.sol, {
				regimeMultiplier: regimeContext.pack.deploy.regime_multiplier,
				performanceMultiplier,
				riskMultiplier,
				skipBelowFloor: true,
			});
			const activeStrategy = getActiveStrategy();
			const strategyKey = activeStrategy?.lp_strategy || "bid_ask";

			if (deployAmount <= 0) {
				log(
					"cron",
					"Screening skipped - adaptive sizing returned 0 deploy amount",
				);
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "skipped_sizing_floor",
					summary: {
						regime: regimeContext.regime,
						reason_code: "adaptive_sizing_floor",
						wallet_sol: roundMetric(currentBalance.sol),
						reserve_sol: roundMetric(config.management.gasReserve),
						deploy_floor_sol: roundMetric(config.management.deployAmountSol),
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "skipped_sizing_floor",
					summary: screeningEvaluation.summary,
					sizing_inputs: {
						regime: regimeContext.regime,
						wallet_sol: currentBalance.sol,
						reserve_sol: config.management.gasReserve,
						deploy_floor_sol: config.management.deployAmountSol,
						regime_multiplier: regimeContext.pack.deploy.regime_multiplier,
						performance_multiplier: performanceMultiplier,
						risk_multiplier: riskMultiplier,
					},
					write_workflows: listActionJournalWorkflowsByCycle(cycleId),
				});
				return;
			}

			const strategyBlock = activeStrategy
				? `ACTIVE STRATEGY: ${activeStrategy.name} - LP: ${activeStrategy.lp_strategy} | execution shape: autonomous screening deploys are currently single-sided SOL unless explicit token amounts are added elsewhere | bins_above: ${activeStrategy.range?.bins_above ?? 0} (FIXED - never change) | best for: ${activeStrategy.best_for}`
				: [
					"AUTONOMOUS DEPLOY PRESETS: strategy and bins are resolved deterministically per finalist.",
					"quality_spot -> activate when top LP win rate >= 80%, organic >= 80, holders >= 1500, fee/TVL >= 0.05, price action is calm, and planner already prefers spot.",
						"yield_spot_wide -> activate when holders >= 1000, organic >= 78, fee/TVL >= 0.09, volatility <= 4, price action is calm, and planner already prefers spot.",
					"bid_ask_default -> activate otherwise, especially for hotter or less-proven pools.",
					"Any single-sided SOL deploy plan fails closed unless SOL is confirmed on token_y/quote side for that pool.",
				].join(" ");

			const buildStaticStrategyPolicy = (regimeLabel) => {
				if (!activeStrategy) return null;
				return (pool) => {
					const guard = evaluateResolvedStrategyProtection({
						pool,
						regimeLabel,
						strategy: strategyKey,
						getNegativeRegimeMemory,
						getNegativeRegimeCooldown,
					});
					if (!guard?.blocked) return null;
					return {
						blocked: true,
						reason: guard.reason,
						penalty_score: 100,
						details: guard.details,
					};
				};
			};

			screeningTopCandidates = await getTopCandidates({
				limit: 8,
				pools: discoverySnapshot?.pools,
				positionsSnapshot: prePositions,
				screeningConfig: regimeContext.effectiveScreeningConfig,
				evaluationContext: {
					extraHardBlockFn: buildStaticStrategyPolicy(regimeContext.regime),
				},
			}).catch((error) => ({ error: error.message }));
			const screeningFailure = validateStartupSnapshot({
				wallet: { sol: preBalance.sol },
				positions: prePositions,
				candidates: screeningTopCandidates,
			});
			if (screeningFailure) {
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					summary: {
						reason_code: screeningFailure.reason_code,
						error: screeningFailure.message,
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					reason_code: screeningFailure.reason_code,
					error: screeningFailure.message,
				});
				writeEvidenceBundle({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					reason_code: screeningFailure.reason_code,
					error: screeningFailure.message,
					written_at: new Date().toISOString(),
				});
				screenReport = `Screening failed closed: [${screeningFailure.reason_code}] ${screeningFailure.message}`;
				return;
			}

			const candidates =
				screeningTopCandidates?.candidates ||
				screeningTopCandidates?.pools ||
				[];
			const totalEligible =
				screeningTopCandidates?.total_eligible ?? candidates.length;
			const blockedSummary = screeningTopCandidates?.blocked_summary || {};
			const invalidNegativeRegimeState = [];
			if (blockedSummary.negative_regime_memory_invalid_state > 0) {
				invalidNegativeRegimeState.push("negative regime memory state invalid");
			}
			if (blockedSummary.negative_regime_cooldown_invalid_state > 0) {
				invalidNegativeRegimeState.push(
					"negative regime cooldown state invalid",
				);
			}
			if (invalidNegativeRegimeState.length > 0) {
				const failure = classifyRuntimeFailure(
					new Error(invalidNegativeRegimeState.join("; ")),
					{ invalidState: true },
				);
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					summary: {
						reason_code: failure.reason_code,
						error: failure.message,
						blocked_summary: blockedSummary,
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					reason_code: failure.reason_code,
					error: failure.message,
					blocked_summary: blockedSummary,
				});
				writeEvidenceBundle({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					reason_code: failure.reason_code,
					error: failure.message,
					blocked_summary: blockedSummary,
					written_at: new Date().toISOString(),
				});
				screenReport = `Screening failed closed: [${failure.reason_code}] ${failure.message}`;
				return;
			}
			const shortlist = candidates.slice(0, Math.min(5, candidates.length));

			if (shortlist.length === 0) {
				log(
					"cron",
					"Screening skipped - no eligible candidates after deterministic filters",
				);
				screenReport =
					"Screening skipped - no eligible candidates passed deterministic filters.";
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "skipped_no_candidates",
					summary: {
						total_screened: screeningTopCandidates?.total_screened ?? 0,
						total_eligible: totalEligible,
						blocked_summary: blockedSummary,
					},
					candidates: screeningTopCandidates?.candidate_evaluations || [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "skipped_no_candidates",
					summary: screeningEvaluation.summary,
					total_screened: screeningTopCandidates?.total_screened ?? 0,
					screening_config: regimeContext.effectiveScreeningConfig,
					candidate_evaluations: screeningTopCandidates?.candidate_evaluations || [],
					candidate_inputs: screeningTopCandidates?.candidate_inputs || [],
					occupied_pools: screeningTopCandidates?.occupied_pools || [],
					occupied_mints: screeningTopCandidates?.occupied_mints || [],
					shortlist_limit: Math.min(5, candidates.length),
					write_workflows: listActionJournalWorkflowsByCycle(cycleId),
				});
				return;
			}

			candidateEvaluations = shortlist.map((pool) => ({
				pool: pool.pool,
				name: pool.name,
				ranking_score: roundMetric(pool.deterministic_score),
				context_score: roundMetric(pool.deterministic_score),
				eligibility_reason: pool.eligibility_reason || "eligible",
				deterministic_hard_blocks: Array.isArray(pool.hard_blocks)
					? [...pool.hard_blocks]
					: [],
				hard_blocked: false,
				hard_blocks: [],
					deploy_strategy: null,
					deploy_bins_below: null,
					deploy_bins_above: null,
					deploy_preset_id: null,
					deploy_shape: null,
					deploy_orientation_status: null,
					deploy_sol_side: null,
					smart_wallet_count: 0,
				holder_metrics: null,
				okx: null,
				wallet_score_source: "finalist_preload",
				wallet_score_age_minutes: null,
			}));

			const finalistBlocks = [];
			const finalists = [];
			const inspectedCandidates = [];
			const resolvedGuardInvalidStates = [];
			for (const pool of shortlist) {
				const {
					inspection,
					distributionPlan,
					tierPlan,
					scoredLpers,
					deployPlan,
				} = await inspectDeployCandidate({
					pool,
					activeStrategy,
					asNumber,
					executeTool,
					inspectCandidate,
					deriveExpectedVolumeProfile,
					deriveTrendBias,
				});
				const candidateIntel = evaluateCandidateIntel(pool, {
					smartWallets: inspection.smartWallets,
					holders: inspection.holders,
					narrative: inspection.narrative,
					tokenInfo: inspection.tokenInfo,
					scoredLpers,
					okx: inspection.okx,
					availability: inspection.availability,
				});
				Object.assign(pool, {
					hard_blocked: candidateIntel.hard_blocked,
					hard_blocks: candidateIntel.hard_blocks,
					context_score: candidateIntel.score.context_score,
				});
				const resolvedStrategyGuard = activeStrategy
					? null
					: evaluateResolvedStrategyProtection({
						pool,
						regimeLabel: regimeContext.regime,
						strategy: deployPlan.strategy,
						getNegativeRegimeMemory,
						getNegativeRegimeCooldown,
					});
				const orientationGuard = evaluateSingleSidedSolOrientationGuard({
					pool,
					deployPlan,
					solMint: config.tokens?.SOL || SOL_MINT,
				});
				const deployGuardReasons = [
					resolvedStrategyGuard?.blocked ? resolvedStrategyGuard.reason : null,
					orientationGuard.blocked ? orientationGuard.reason : null,
				].filter(Boolean);
				if (deployGuardReasons.length > 0) {
					pool.hard_blocked = true;
					pool.hard_blocks = [...new Set([...(pool.hard_blocks || []), ...deployGuardReasons])];
					if (resolvedStrategyGuard?.invalid_state) {
						resolvedGuardInvalidStates.push(resolvedStrategyGuard.reason);
					}
				}
				inspectedCandidates.push(pool);
				if (!pool.hard_blocked && finalists.length < 2) {
					finalists.push(pool);
				}

				const evalEntry = candidateEvaluations.find(
					(entry) => entry.pool === pool.pool,
				);
				if (evalEntry) {
					evalEntry.context_score = candidateIntel.score.context_score;
					evalEntry.hard_blocked = candidateIntel.hard_blocked;
					evalEntry.hard_blocks = candidateIntel.hard_blocks;
					evalEntry.finalist_hard_blocks = [...candidateIntel.hard_blocks];
					evalEntry.smart_wallet_count = candidateIntel.smart_wallet_count;
					evalEntry.holder_metrics = candidateIntel.holder_metrics;
					evalEntry.okx = candidateIntel.okx;
					evalEntry.wallet_score_source = candidateIntel.wallet_score_source;
					evalEntry.wallet_score_age_minutes =
						candidateIntel.wallet_score_age_minutes;
				}

				Object.assign(pool, {
					deploy_strategy: deployPlan.strategy,
					deploy_bins_below: deployPlan.bins_below,
					deploy_bins_above: deployPlan.bins_above,
					deploy_preset_id: deployPlan.preset_id,
					deploy_preset_name: deployPlan.preset_name,
					deploy_activation_summary: deployPlan.activation_summary,
					deploy_plan_source: deployPlan.source,
					deploy_spot_subtype: deployPlan.spot_subtype,
					deploy_deposit_sidedness: deployPlan.deposit_sidedness,
					deploy_deposit_asset: deployPlan.deposit_asset,
					deploy_range_shape: deployPlan.range_shape,
					deploy_semantics_label: deployPlan.strategy_semantics_label,
					deploy_orientation_status:
						orientationGuard.orientation?.status || "not_applicable",
					deploy_sol_side: orientationGuard.orientation?.sol_side || null,
				});
				if (evalEntry && deployGuardReasons.length > 0) {
					evalEntry.hard_blocked = true;
					evalEntry.hard_blocks = [...new Set([...(evalEntry.hard_blocks || []), ...deployGuardReasons])];
				}
				if (evalEntry) {
					evalEntry.deploy_strategy = deployPlan.strategy;
					evalEntry.deploy_bins_below = deployPlan.bins_below;
					evalEntry.deploy_bins_above = deployPlan.bins_above;
					evalEntry.deploy_preset_id = deployPlan.preset_id;
					evalEntry.deploy_shape = deployPlan.strategy_semantics_label;
					evalEntry.deploy_orientation_status =
						orientationGuard.orientation?.status || "not_applicable";
					evalEntry.deploy_sol_side =
						orientationGuard.orientation?.sol_side || null;
				}

				finalistBlocks.push(`${formatFinalistInspectionBlock({
					pool,
					inspection,
					distributionPlan,
					tierPlan,
					candidateIntel,
				})}
  deploy_preset: ${deployPlan.preset_id || "none"} -> strategy=${deployPlan.strategy}, bins_below=${deployPlan.bins_below ?? "?"}, bins_above=${deployPlan.bins_above ?? "?"}
  deploy_shape: ${deployPlan.strategy_semantics_label}
  deploy_orientation: ${orientationGuard.orientation?.status || "not_applicable"}${orientationGuard.orientation?.sol_side ? ` (${orientationGuard.orientation.sol_side})` : ""}
  deploy_preset_reason: ${deployPlan.activation_summary || "not available"}`);
			}
			if (resolvedGuardInvalidStates.length > 0) {
				const failure = classifyRuntimeFailure(
					new Error([...new Set(resolvedGuardInvalidStates)].join("; ")),
					{ invalidState: true },
				);
				screeningEvaluation = {
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					summary: {
						reason_code: failure.reason_code,
						error: failure.message,
						blocked_summary: blockedSummary,
					},
					candidates: [],
				};
				appendReplayEnvelope({
					cycle_id: cycleId,
					cycle_type: "screening",
					reason_code: failure.reason_code,
					error: failure.message,
					blocked_summary: blockedSummary,
				});
				writeEvidenceBundle({
					cycle_id: cycleId,
					cycle_type: "screening",
					status: "failed_candidates",
					reason_code: failure.reason_code,
					error: failure.message,
					blocked_summary: blockedSummary,
					written_at: new Date().toISOString(),
				});
				screenReport = `Screening failed closed: [${failure.reason_code}] ${failure.message}`;
				return;
			}
			const scorePreloadLimit = inspectedCandidates.length;

			const candidateContext = buildCandidateContext({
				shortlist,
				finalists,
				inspectionRows: finalistBlocks,
			});

			const activeTop = finalists[0] || null;
			const alternates = [];
			for (const altRegime of listCounterfactualRegimes(regimeContext.regime)) {
				const altPack = getRegimePack(altRegime);
				const altDeployAmount = computeDeployAmount(currentBalance.sol, {
					regimeMultiplier: altPack.deploy.regime_multiplier,
					performanceMultiplier,
					riskMultiplier,
					skipBelowFloor: true,
				});
				const altCandidates = await getTopCandidates({
					limit: 3,
					pools: discoverySnapshot?.pools,
					positionsSnapshot: prePositions,
					screeningConfig: {
						...config.screening,
						...altPack.screening_overrides,
					},
					evaluationContext: {
						extraHardBlockFn: buildStaticStrategyPolicy(altRegime),
					},
				}).catch(() => ({ candidates: [] }));
				let altTop = null;
				for (const altCandidate of altCandidates?.candidates || []) {
					if (activeStrategy) {
						altTop = altCandidate;
						break;
					}
					try {
						const { deployPlan } = await inspectDeployCandidate({
							pool: altCandidate,
							activeStrategy,
							asNumber,
							executeTool,
							inspectCandidate,
							deriveExpectedVolumeProfile,
							deriveTrendBias,
						});
						const altGuard = evaluateResolvedStrategyProtection({
							pool: altCandidate,
							regimeLabel: altRegime,
							strategy: deployPlan.strategy,
							getNegativeRegimeMemory,
							getNegativeRegimeCooldown,
						});
						const altOrientationGuard = evaluateSingleSidedSolOrientationGuard({
							pool: altCandidate,
							deployPlan,
							solMint: config.tokens?.SOL || SOL_MINT,
						});
						if (!altGuard?.blocked && !altOrientationGuard.blocked) {
							altTop = altCandidate;
							break;
						}
					} catch (counterfactualStrategyError) {
						log(
							"screening",
							`Counterfactual candidate strategy resolution skipped: ${counterfactualStrategyError.message}`,
						);
					}
				}
				alternates.push({
					regime: altRegime,
					deploy_amount_sol: altDeployAmount,
					selected_pool: altTop?.pool || null,
					selected_score: altTop?.deterministic_score ?? null,
					diverged_from_active: Boolean(
						activeTop && altTop && activeTop.pool !== altTop.pool,
					),
				});
			}

			const recentPerformance = getPerformanceHistory
				? getPerformanceHistory({ hours: 72, limit: 12 })?.positions || []
				: [];
			const decision = await runScreeningDecisionEngine({
				agentLoop,
				cycle_id: cycleId,
				config,
				strategyBlock,
				regimeContext,
				deployAmount,
				candidateContext,
				finalists,
				strategy: strategyKey,
				recentPerformance,
				getMemoryContextRuntime: getMemoryContext,
				getMemoryVersionStatusRuntime: getMemoryVersionStatus,
				stateSnapshot: {
					portfolio: currentBalance,
					positions: prePositions,
				},
			});

			try {
				appendCounterfactualReview({
					cycle_id: cycleId,
					cycle_type: "screening",
					active_regime: regimeContext.regime,
					active_reason: regimeContext.reason,
					active_deploy_amount_sol: deployAmount,
					active_selected_pool: activeTop?.pool || null,
					active_selected_score: activeTop?.deterministic_score ?? null,
					active_decision: decision.active.summary,
					shadow_decision: {
						...decision.shadow.summary,
						comparison: decision.comparison,
					},
					alternates,
				});
			} catch (counterfactualError) {
				log(
					"screening",
					`Counterfactual review skipped: ${counterfactualError.message}`,
				);
			}

			let decisionResult = { skipped: true, reason: "hold" };
			if (decision.active.critic.pass && decision.active.thesis.tool_name) {
				decisionResult = await executeTool(
					decision.active.thesis.tool_name,
					decision.active.thesis.args,
					{
						cycle_id: cycleId,
						cycle_type: "screening",
						regime_label: regimeContext.regime,
						action_id: `${cycleId}:${decision.active.thesis.tool_name}:1`,
						...decision.active.execution_meta,
					},
				);
			} else if (!decision.active.critic.pass) {
				decisionResult = {
					blocked: true,
					reason:
						decision.active.critic.reasons.join(", ") ||
						decision.active.critic.reason_code ||
						"critic_abstained",
					manual_review: decision.active.critic.status === "manual_review",
				};
			}

			screenReport = [
				`THESIS: ${decision.active.thesis.action}${decision.active.thesis.target_id ? ` / ${decision.active.thesis.target_id}` : ""}`,
				`CONFIDENCE: ${decision.active.thesis.confidence?.score ?? 0}`,
				`CRITIC: ${decision.active.critic.status}${decision.active.critic.reason_code ? ` / ${decision.active.critic.reason_code}` : ""}`,
				`SHADOW: ${decision.shadow.thesis.action}${decision.comparison?.diverged ? ` / diverged_from_active` : " / matched_active"}`,
				`RESULT: ${decisionResult.blocked ? `blocked - ${decisionResult.reason}` : decisionResult.error ? `error - ${decisionResult.error}` : decisionResult.success ? "completed successfully" : decisionResult.reason || "hold"}`,
			].join("\n");
			screeningEvaluation = {
				cycle_id: cycleId,
				cycle_type: "screening",
				status: classifyScreeningDecisionStatus(decisionResult),
				summary: {
					total_screened:
						screeningTopCandidates?.total_screened ?? candidates.length,
					total_eligible: totalEligible,
					candidates_scored: candidateEvaluations.length,
					candidates_blocked: candidateEvaluations.filter(
						(candidate) => candidate.hard_blocked,
					).length,
					deploy_amount: deployAmount,
					regime: regimeContext.regime,
					regime_reason: regimeContext.reason,
					regime_confidence: regimeContext.confidence,
					regime_hysteresis_reason: regimeClassification.hysteresis_reason,
					proposed_regime: regimeClassification.proposed_regime,
					regime_multiplier: regimeContext.pack.deploy.regime_multiplier,
					performance_multiplier: performanceMultiplier,
					risk_multiplier: riskMultiplier,
					score_preload_limit: scorePreloadLimit,
					blocked_summary: blockedSummary,
					theses_generated: 1,
					theses_blocked: decision.active.critic.pass ? 0 : 1,
					critic_approved: decision.active.critic.pass ? 1 : 0,
					critic_abstained:
						!decision.active.critic.pass &&
						decision.active.critic.status !== "manual_review"
							? 1
							: 0,
					critic_manual_reviews:
						decision.active.critic.status === "manual_review" ? 1 : 0,
					shadow_evaluations: 1,
					shadow_divergences: decision.comparison?.diverged ? 1 : 0,
					shadow_matches: decision.comparison?.diverged ? 0 : 1,
					selected_strategy: decision.active.thesis.args?.strategy || null,
					selected_preset_id: decision.active.thesis.deploy_preset_id || null,
					selected_strategy_shape:
						decision.active.thesis.deploy_semantics_label || null,
				},
				candidates: candidateEvaluations,
			};
			appendReplayEnvelope({
				cycle_id: cycleId,
				cycle_type: "screening",
				occupied_pools: screeningTopCandidates?.occupied_pools || [],
				occupied_mints: screeningTopCandidates?.occupied_mints || [],
				candidate_evaluations: candidateEvaluations,
				candidate_inputs: screeningTopCandidates?.candidate_inputs || [],
				screening_config: regimeContext.effectiveScreeningConfig,
				shortlist: shortlist.map((pool) => ({
					pool: pool.pool,
					name: pool.name,
					ranking_score: pool.deterministic_score,
				})),
				total_eligible: totalEligible,
				active_thesis: decision.active.summary,
				shadow_thesis: decision.shadow.summary,
				shadow_comparison: decision.comparison,
				decision_result: decisionResult.blocked
					? { status: "blocked", reason: decisionResult.reason }
					: decisionResult.error
						? { status: "error", reason: decisionResult.error }
						: decisionResult.success
							? { status: "success" }
							: { status: "hold", reason: decisionResult.reason || null },
				write_workflows: listActionJournalWorkflowsByCycle(cycleId),
			});
		} catch (error) {
			log("cron_error", `Screening cycle failed: ${error.message}`);
			screenReport = `Screening cycle failed: ${error.message}`;
			const failure = classifyRuntimeFailure(error);
			screeningEvaluation = {
				cycle_id: cycleId,
				cycle_type: "screening",
				status: "failed",
				summary: {
					reason_code: failure.reason_code,
					error: failure.message,
					total_eligible: screeningTopCandidates?.total_eligible ?? 0,
				},
				candidates: [],
			};
			appendReplayEnvelope({
				cycle_id: cycleId,
				cycle_type: "screening",
				reason_code: failure.reason_code,
				error: failure.message,
			});
			writeEvidenceBundle({
				cycle_id: cycleId,
				cycle_type: "screening",
				status: "failed",
				reason_code: failure.reason_code,
				error: failure.message,
				written_at: new Date().toISOString(),
			});
		} finally {
			setScreeningBusy(false);
			finalizeCycleRun({
				cycleType: "screening",
				evaluation: screeningEvaluation,
				recordCycleEvaluation,
				refreshRuntimeHealth,
				telegramEnabled,
				sendMessage,
				telegramPrefix: "🔍 Screening Cycle",
				report: screenReport,
			});
		}
	};
}
