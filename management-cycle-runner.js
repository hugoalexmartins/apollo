import { finalizeCycleRun } from "./cycle-harness.js";
import { runManagementDecisionEngine } from "./autonomy-engine.js";

function buildManagementPnlSnapshot(position = {}) {
  const observedAtMs = Number.isFinite(Number(position.observed_at_ms ?? position.as_of_ms))
    ? Number(position.observed_at_ms ?? position.as_of_ms)
    : Number.isFinite(Date.parse(position.observed_at ?? position.as_of ?? ""))
      ? Date.parse(position.observed_at ?? position.as_of)
      : null;

  if (position.pnl_missing || position.status === "missing") {
    return {
      error: position.pnl_error || "Position not found in pre-loaded PnL snapshot",
      stale: true,
      status: "stale",
      observed_at_ms: observedAtMs,
      max_age_ms: position.max_age_ms ?? 60_000,
    };
  }

  const stale = position.stale === true || position.status === "stale" || observedAtMs == null;
  const unclaimedFeeUsd = Number(position.unclaimed_fees_usd ?? 0);
  const collectedFeesUsd = Number(position.collected_fees_usd ?? 0);

  return {
    pnl_pct: position.pnl_pct ?? null,
    pnl_usd: position.pnl_usd ?? null,
    current_value_usd: position.total_value_usd ?? null,
    unclaimed_fee_usd: Number.isFinite(unclaimedFeeUsd) ? unclaimedFeeUsd : null,
    all_time_fees_usd: (Number.isFinite(collectedFeesUsd) ? collectedFeesUsd : 0) + (Number.isFinite(unclaimedFeeUsd) ? unclaimedFeeUsd : 0),
    fee_active_tvl_ratio: position.fee_tvl_ratio ?? null,
    fee_per_tvl_24h: position.fee_tvl_ratio ?? null,
    in_range: position.in_range ?? null,
    lower_bin: position.lower_bin ?? null,
    upper_bin: position.upper_bin ?? null,
    active_bin: position.active_bin ?? null,
    age_minutes: position.age_minutes ?? null,
    observed_at_ms: observedAtMs,
    max_age_ms: position.max_age_ms ?? 60_000,
    stale,
    status: stale ? "stale" : (position.status || "ok"),
  };
}

export function createManagementCycleRunner(deps) {
  return async function runManagementCycle({ cycleId, screeningCooldownMs } = {}) {
    const {
      log,
      config,
      getMyPositions,
      getWalletBalances,
      validateStartupSnapshot,
      classifyRuntimeFailure,
      appendReplayEnvelope,
      writeEvidenceBundle,
      enforceManagementIntervalFromPositions,
      recordPositionSnapshot,
      recallForPool,
      recallForManagement,
      isPnlSignalStale,
      updatePnlAndCheckExits,
      evaluatePortfolioGuard,
		runManagementRuntimeActions,
		listActionJournalWorkflowsByCycle,
		executeTool,
      didRuntimeHandleManagementAction,
      classifyManagementModelGate,
      summarizeRuntimeActionResult,
      roundMetric,
		agentLoop,
		getPerformanceHistory,
		getMemoryContext,
		getMemoryVersionStatus,
		shouldTriggerFollowOnScreening,
		runTriggeredScreening,
      recordCycleEvaluation,
      refreshRuntimeHealth,
      telegramEnabled,
      sendMessage,
      notifyOutOfRange,
      getManagementBusy,
      getScreeningBusy,
      getScreeningLastTriggered,
      setScreeningLastTriggered,
      setManagementBusy,
      setManagementLastRun,
    } = deps;

    if (getManagementBusy()) return;
    setManagementBusy(true);
    setManagementLastRun(Date.now());
    log("cron", `Starting management cycle [model: ${config.llm.managementModel}]`);

    let mgmtReport = null;
    let managementEvaluation = null;
    let positions = [];
    let walletSnapshot = null;
    let triggerFollowOnScreening = false;
    let positionData = [];
    let runtimeActions = [];

		const appendManagementReplayEnvelope = (inputs, actions) => {
			appendReplayEnvelope({
				cycle_id: cycleId,
				cycle_type: "management",
        position_inputs: inputs,
				runtime_actions: actions.map((action) => ({
					position: action.position,
					tool: action.toolName,
					rule: action.rule,
					reason: action.reason,
					action_id: action.actionId,
					thesis: action.thesis || null,
					critic: action.critic
						? {
							status: action.critic.status,
							reason_code: action.critic.reason_code,
						}
						: null,
				})),
				write_workflows: listActionJournalWorkflowsByCycle(cycleId),
			});
		};

    try {
      const [livePositionsResult, walletSnapshotResult] = await Promise.all([
        getMyPositions({ force: true }).catch((error) => ({ error: error.message })),
        getWalletBalances().catch((error) => ({ error: error.message })),
      ]);
      const livePositions = livePositionsResult;
      walletSnapshot = walletSnapshotResult;
      const startupFailure = validateStartupSnapshot({
          wallet: walletSnapshot,
          positions: livePositions,
          candidates: { candidates: [] },
        });
      if (startupFailure) {
        managementEvaluation = {
          cycle_id: cycleId,
          cycle_type: "management",
          status: "failed_precheck",
          summary: {
            reason_code: startupFailure.reason_code,
            error: startupFailure.message,
          },
          positions: [],
        };
        appendReplayEnvelope({
          cycle_id: cycleId,
          cycle_type: "management",
          reason_code: startupFailure.reason_code,
          error: startupFailure.message,
        });
        writeEvidenceBundle({
          cycle_id: cycleId,
          cycle_type: "management",
          status: "failed_precheck",
          reason_code: startupFailure.reason_code,
          error: startupFailure.message,
          written_at: new Date().toISOString(),
        });
        return;
      }

      positions = livePositions?.positions || [];
      const intervalAdjustment = enforceManagementIntervalFromPositions(positions);

      if (positions.length === 0) {
        log("cron", "No open positions - triggering screening cycle");
        managementEvaluation = {
          cycle_id: cycleId,
          cycle_type: "management",
          status: "empty_positions",
          summary: {
            positions_total: 0,
            pending_positions: 0,
            runtime_actions_handled: 0,
            runtime_actions_attempted: 0,
            enforced_management_interval_min: intervalAdjustment.interval,
            max_open_position_volatility: intervalAdjustment.maxVolatility,
          },
          positions: [],
        };
        appendManagementReplayEnvelope([], []);
        triggerFollowOnScreening = shouldTriggerFollowOnScreening({
          positionsCount: positions.length,
          screeningBusy: getScreeningBusy(),
          screeningLastTriggered: getScreeningLastTriggered(),
          screeningCooldownMs,
        });
        return;
      }

		positionData = await Promise.all(positions.map(async (p) => {
        recordPositionSnapshot(p.pool, p);
        const pnl = buildManagementPnlSnapshot(p);
        const recall = recallForPool(p.pool);
        const pnlStale = !pnl || pnl.error || isPnlSignalStale({ pnl });
        const enriched = {
          ...p,
          pnl_pct: pnlStale ? null : (pnl?.pnl_pct ?? p.pnl_pct),
          unclaimed_fees_usd: pnlStale ? null : (pnl?.unclaimed_fee_usd ?? p.unclaimed_fees_usd),
          fee_tvl_ratio: pnlStale ? null : (pnl?.fee_active_tvl_ratio ?? p.fee_tvl_ratio),
        };
        const memoryHits = recallForManagement(enriched);
        const memoryRecall = memoryHits.length
          ? memoryHits.map((hit) => `[${hit.source}] ${hit.key}: ${hit.answer}`).join(" | ")
          : null;
        const exitAlert = pnl?.pnl_pct != null
          ? updatePnlAndCheckExits(p.position, pnl.pnl_pct, config, { stale: pnlStale })
          : null;
        return { ...enriched, pnl: pnlStale ? { ...(pnl || {}), stale: true, status: "stale" } : pnl, recall, memoryRecall, exitAlert };
		}));
		const recentPerformance = getPerformanceHistory
			? (getPerformanceHistory({ hours: 72, limit: 12 })?.positions || [])
			: [];

		evaluatePortfolioGuard({
			portfolioSnapshot: walletSnapshot,
			openPositionPnls: positionData.map((position) => position.pnl).filter(Boolean),
		});

		runtimeActions = await runManagementRuntimeActions(positionData, {
			cycleId,
			config,
			executeTool,
			recentPerformance,
			getMemoryVersionStatus,
		});
      const handledRuntimeActions = runtimeActions.filter((action) => didRuntimeHandleManagementAction(action.result));
      const attemptedRuntimeActions = runtimeActions.filter((action) => !didRuntimeHandleManagementAction(action.result));
      const handledRuntimeActionMap = new Map(handledRuntimeActions.map((action) => [action.position, action]));
      const attemptedRuntimeActionMap = new Map(attemptedRuntimeActions.map((action) => [action.position, action]));
      const pendingPositionData = positionData.filter((p) => !handledRuntimeActionMap.has(p.position));
      const modelManagedPositions = pendingPositionData.filter((p) => classifyManagementModelGate(p).route === "model");
      const pendingExitAlerts = pendingPositionData.filter((p) => p.exitAlert).map((p) => `- ${p.pair}: ${p.exitAlert}`);

      const handledRuntimeActionBlock = handledRuntimeActions.length > 0
        ? handledRuntimeActions.map((action) => `- ${action.pair} (${action.position}): ${action.toolName} [${action.reason}] -> ${summarizeRuntimeActionResult(action.result)}`).join("\n")
        : "- none";
      const attemptedRuntimeActionBlock = attemptedRuntimeActions.length > 0
        ? attemptedRuntimeActions.map((action) => `- ${action.pair} (${action.position}): ${action.toolName} [${action.reason}] -> ${summarizeRuntimeActionResult(action.result)}`).join("\n")
        : "- none";

		const modelPositionBlocks = modelManagedPositions.map((p) => {
			const pnl = p.pnl;
			const runtimeAttempt = attemptedRuntimeActionMap.get(p.position);
			const lines = [
          `POSITION: ${p.pair} (${p.position})`,
          `  pool: ${p.pool}`,
          `  age: ${p.age_minutes ?? "?"}m | in_range: ${p.in_range} | oor_minutes: ${p.minutes_out_of_range ?? 0}`,
          pnl ? `  pnl_pct: ${pnl.pnl_pct}% | pnl_usd: $${pnl.pnl_usd} | unclaimed_fees: $${pnl.unclaimed_fee_usd} | claimed_fees: $${Math.max(0, (pnl.all_time_fees_usd || 0) - (pnl.unclaimed_fee_usd || 0)).toFixed(2)} | value: $${pnl.current_value_usd} | fee_per_tvl_24h: ${pnl.fee_per_tvl_24h ?? "?"}%` : "  pnl: fetch failed",
          pnl ? `  bins: lower=${pnl.lower_bin} upper=${pnl.upper_bin} active=${pnl.active_bin}` : null,
          p.instruction ? `  instruction: "${p.instruction}"` : null,
          p.exitAlert ? `  exit_alert: ${p.exitAlert}` : null,
          runtimeAttempt ? `  runtime_attempt_this_cycle: ${runtimeAttempt.toolName} -> ${summarizeRuntimeActionResult(runtimeAttempt.result)}` : null,
				p.recall ? `  pool_memory: ${p.recall}` : null,
				p.memoryRecall ? `  learned_memory: ${p.memoryRecall}` : null,
			].filter(Boolean);
			return {
				position: p,
				block: lines.join("\n"),
			};
		});
      if (pendingPositionData.length === 0) {
        mgmtReport = `RUNTIME ACTIONS ALREADY EXECUTED\n${handledRuntimeActionBlock}\n\nNo remaining positions required manager write decisions this cycle.`;
        managementEvaluation = {
          cycle_id: cycleId,
          cycle_type: "management",
          status: "runtime_only",
          summary: {
            positions_total: positions.length,
            pending_positions: 0,
            runtime_actions_handled: handledRuntimeActions.length,
            runtime_actions_attempted: attemptedRuntimeActions.length,
            enforced_management_interval_min: intervalAdjustment.interval,
            max_open_position_volatility: intervalAdjustment.maxVolatility,
          },
          positions: positionData.slice(0, 8).map((p) => ({
            pair: p.pair,
            position: p.position,
            in_range: p.in_range,
            out_of_range_direction: p.out_of_range_direction || null,
            unclaimed_fee_usd: roundMetric(p.pnl?.unclaimed_fee_usd ?? p.unclaimed_fees_usd),
            exit_alert: p.exitAlert || null,
          })),
        };
        appendManagementReplayEnvelope(positionData, runtimeActions);
        return;
      }

      if (modelManagedPositions.length === 0) {
        mgmtReport = `RUNTIME ACTIONS ALREADY EXECUTED\n${handledRuntimeActionBlock}\n\nRUNTIME WRITE ATTEMPTS NOT COMPLETED\n${attemptedRuntimeActionBlock}\n\nNo remaining positions required model evaluation this cycle.`;
        managementEvaluation = {
          cycle_id: cycleId,
          cycle_type: "management",
          status: "runtime_determined",
          summary: {
            positions_total: positions.length,
            pending_positions: pendingPositionData.length,
            model_positions: 0,
            runtime_actions_handled: handledRuntimeActions.length,
            runtime_actions_attempted: attemptedRuntimeActions.length,
            enforced_management_interval_min: intervalAdjustment.interval,
            max_open_position_volatility: intervalAdjustment.maxVolatility,
          },
          positions: pendingPositionData.slice(0, 8).map((p) => ({
            pair: p.pair,
            position: p.position,
            in_range: p.in_range,
            out_of_range_direction: p.out_of_range_direction || null,
            instruction: p.instruction || null,
            runtime_attempted: attemptedRuntimeActionMap.has(p.position),
          })),
        };
        appendManagementReplayEnvelope(positionData, runtimeActions);
        return;
      }

		const modelDecisions = [];
		let thesesGenerated = 0;
		let thesesBlocked = 0;
		let criticApproved = 0;
		let criticAbstained = 0;
		let criticManualReviews = 0;
		let shadowEvaluations = 0;
		let shadowDivergences = 0;
		let shadowMatches = 0;

		for (const [index, entry] of modelPositionBlocks.entries()) {
			const decision = await runManagementDecisionEngine({
				agentLoop,
				cycle_id: cycleId,
				config,
				positionBlock: `MANAGEMENT CYCLE - read only thesis for one position\n\n${entry.block}`,
				position: entry.position,
				recentPerformance,
				getMemoryContextRuntime: getMemoryContext,
				getMemoryVersionStatusRuntime: getMemoryVersionStatus,
				stateSnapshot: {
					portfolio: walletSnapshot,
					positions: livePositions,
				},
			});
			thesesGenerated += 1;
			shadowEvaluations += 1;
			if (decision.comparison?.diverged) shadowDivergences += 1;
			else shadowMatches += 1;

			let result = { skipped: true, reason: "hold" };
			if (decision.active.critic.pass && decision.active.thesis.tool_name) {
				criticApproved += 1;
				const actionId = `${cycleId}:${decision.active.thesis.tool_name}:${runtimeActions.length + index + 1}`;
				result = await executeTool(decision.active.thesis.tool_name, decision.active.thesis.args, {
					cycle_id: cycleId,
					cycle_type: "management",
					action_id: actionId,
					...decision.active.execution_meta,
				});
			} else if (!decision.active.critic.pass) {
				thesesBlocked += 1;
				if (decision.active.critic.status === "manual_review") criticManualReviews += 1;
				else criticAbstained += 1;
				result = {
					blocked: true,
					reason: decision.active.critic.reasons.join(", ") || decision.active.critic.reason_code || "critic_abstained",
					manual_review: decision.active.critic.status === "manual_review",
				};
			}

			modelDecisions.push({
				position: entry.position.position,
				pair: entry.position.pair,
				thesis: decision.active.summary,
				critic: decision.active.critic,
				shadow: decision.shadow.summary,
				comparison: decision.comparison,
				result,
			});
		}

		const decisionBlock = modelDecisions.length > 0
			? modelDecisions.map((decision) => `- ${decision.pair} (${decision.position}): ${decision.thesis?.action || "hold"}${decision.comparison?.diverged ? ` / shadow=${decision.comparison.shadow_tool || decision.shadow?.action || "hold"}` : ""} -> ${summarizeRuntimeActionResult(decision.result)}`).join("\n")
			: "- none";
		mgmtReport = runtimeActions.length > 0
			? `RUNTIME ACTIONS ALREADY EXECUTED\n${handledRuntimeActionBlock}\n\nRUNTIME WRITE ATTEMPTS NOT COMPLETED\n${attemptedRuntimeActionBlock}\n\nMODEL THESES\n${decisionBlock}`
			: `MODEL THESES\n${decisionBlock}`;
		managementEvaluation = {
			cycle_id: cycleId,
			cycle_type: "management",
        status: "completed",
        summary: {
          positions_total: positions.length,
          pending_positions: pendingPositionData.length,
          model_positions: modelManagedPositions.length,
				runtime_actions_handled: handledRuntimeActions.length,
				runtime_actions_attempted: attemptedRuntimeActions.length,
				exit_alerts: pendingExitAlerts.length,
				theses_generated: thesesGenerated,
				theses_blocked: thesesBlocked,
				critic_approved: criticApproved,
				critic_abstained: criticAbstained,
				critic_manual_reviews: criticManualReviews,
				shadow_evaluations: shadowEvaluations,
				shadow_divergences: shadowDivergences,
				shadow_matches: shadowMatches,
				enforced_management_interval_min: intervalAdjustment.interval,
				max_open_position_volatility: intervalAdjustment.maxVolatility,
			},
				positions: pendingPositionData.slice(0, 8).map((p) => {
					const modelDecision = modelDecisions.find((decision) => decision.position === p.position);
					return ({
					pair: p.pair,
					position: p.position,
				in_range: p.in_range,
				out_of_range_direction: p.out_of_range_direction || null,
				unclaimed_fee_usd: roundMetric(p.pnl?.unclaimed_fee_usd ?? p.unclaimed_fees_usd),
				exit_alert: p.exitAlert || null,
					memory_hits: p.memoryRecall ? 1 : 0,
					decision: modelDecision?.thesis?.action || null,
					critic_status: modelDecision?.critic?.status || null,
					shadow_diverged: modelDecision?.comparison?.diverged || false,
					});
				}),
			};
			appendReplayEnvelope({
				cycle_id: cycleId,
				cycle_type: "management",
				position_inputs: positionData,
				runtime_actions: runtimeActions.map((action) => ({
					position: action.position,
					tool: action.toolName,
					rule: action.rule,
					reason: action.reason,
					action_id: action.actionId,
					thesis: action.thesis || null,
					critic: action.critic
						? { status: action.critic.status, reason_code: action.critic.reason_code }
						: null,
				})),
				model_decisions: modelDecisions.map((decision) => ({
					position: decision.position,
					pair: decision.pair,
					thesis: decision.thesis,
					critic: decision.critic
						? { status: decision.critic.status, reason_code: decision.critic.reason_code }
						: null,
					shadow: decision.shadow || null,
					comparison: decision.comparison || null,
					result: summarizeRuntimeActionResult(decision.result),
				})),
				write_workflows: listActionJournalWorkflowsByCycle(cycleId),
			});
		} catch (error) {
      log("cron_error", `Management cycle failed: ${error.message}`);
      mgmtReport = `Management cycle failed: ${error.message}`;
      const failure = classifyRuntimeFailure(error);
      managementEvaluation = {
        cycle_id: cycleId,
        cycle_type: "management",
        status: "failed",
        summary: {
          positions_total: positions.length,
          reason_code: failure.reason_code,
          error: failure.message,
        },
        positions: [],
      };
      appendReplayEnvelope({
        cycle_id: cycleId,
        cycle_type: "management",
        reason_code: failure.reason_code,
        error: failure.message,
      });
      writeEvidenceBundle({
        cycle_id: cycleId,
        cycle_type: "management",
        status: "failed",
        reason_code: failure.reason_code,
        error: failure.message,
        written_at: new Date().toISOString(),
      });
    } finally {
      setManagementBusy(false);
      if (triggerFollowOnScreening) {
        setScreeningLastTriggered?.(Date.now());
        runTriggeredScreening().catch((e) => log("cron_error", `Triggered screening failed: ${e.message}`));
      }
			finalizeCycleRun({
				cycleType: "management",
				evaluation: managementEvaluation,
				recordCycleEvaluation,
				refreshRuntimeHealth,
				telegramEnabled,
				sendMessage,
				telegramPrefix: "🔄 Management Cycle",
				report: mgmtReport,
			});
		if (telegramEnabled()) {
			for (const p of positions) {
				if (!p.in_range && p.minutes_out_of_range >= config.management.outOfRangeWaitMinutes) {
					notifyOutOfRange({ pair: p.pair, minutesOOR: p.minutes_out_of_range }).catch(() => {});
          }
        }
      }
    }
  };
}
