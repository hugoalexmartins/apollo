import { computeDeployAmount } from "./config.js";
import { getOverlappingCycleType } from "./cycle-overlap.js";
import { evaluateScreeningCycleAdmission, SCREENING_ADMISSION_STATUSES } from "./runtime-policy.js";
import { rankCandidateSnapshots } from "./tools/screening.js";
import { planManagementRuntimeAction } from "./runtime-policy.js";

function replayScreeningSkipEnvelope(envelope) {
	if (Object.values(SCREENING_ADMISSION_STATUSES).includes(envelope?.status)) {
		const replayed = evaluateScreeningCycleAdmission(envelope.admission_inputs || {});
		return {
			cycle_id: envelope?.cycle_id || null,
			status: replayed.status,
			summary: replayed.summary,
		};
	}

	if (envelope?.status === "skipped_sizing_floor") {
		const sizingInputs = envelope?.sizing_inputs || {};
		const deployAmount = computeDeployAmount(sizingInputs.wallet_sol || 0, {
			regimeMultiplier: sizingInputs.regime_multiplier,
			performanceMultiplier: sizingInputs.performance_multiplier,
			riskMultiplier: sizingInputs.risk_multiplier,
			skipBelowFloor: true,
			floorOverride: sizingInputs.deploy_floor_sol,
			reserveOverride: sizingInputs.reserve_sol,
		});
		return {
			cycle_id: envelope?.cycle_id || null,
			status: deployAmount <= 0 ? "skipped_sizing_floor" : "ready",
			summary: {
				regime: sizingInputs.regime ?? envelope?.summary?.regime ?? null,
				reason_code: "adaptive_sizing_floor",
				wallet_sol: sizingInputs.wallet_sol ?? null,
				reserve_sol: sizingInputs.reserve_sol ?? null,
				deploy_floor_sol: sizingInputs.deploy_floor_sol ?? null,
			},
		};
	}

	if (envelope?.status === "skipped_no_candidates") {
		const ranked = rankCandidateSnapshots(envelope?.candidate_inputs || [], {
			occupiedPools: new Set(envelope?.occupied_pools || []),
			occupiedMints: new Set(envelope?.occupied_mints || []),
			limit: envelope?.shortlist_limit || (envelope?.candidate_inputs || []).length,
			screeningConfig: envelope?.screening_config,
		});
		return {
			cycle_id: envelope?.cycle_id || null,
			status: ranked.candidates.length === 0 ? "skipped_no_candidates" : "completed",
			summary: {
				total_screened: envelope?.total_screened ?? (envelope?.candidate_inputs || []).length,
				total_eligible: ranked.total_eligible,
				blocked_summary: ranked.blocked_summary,
			},
		};
	}

	if (envelope?.status === "skipped_overlap") {
		const overlapWith = getOverlappingCycleType(envelope?.overlap_inputs || {});
		return {
			cycle_id: envelope?.cycle_id || null,
			status: overlapWith ? "skipped_overlap" : "ready",
			summary: {
				overlap_with: overlapWith,
			},
		};
	}

	return null;
}

export function replayScreeningEnvelope(envelope) {
	const skipped = replayScreeningSkipEnvelope(envelope);
	if (skipped) return skipped;

	const candidateInputs = envelope?.candidate_inputs || [];
	const occupiedPools = new Set(envelope?.occupied_pools || []);
  const occupiedMints = new Set(envelope?.occupied_mints || []);
  const limit = envelope?.shortlist?.length || candidateInputs.length;

  const ranked = rankCandidateSnapshots(candidateInputs, {
    occupiedPools,
    occupiedMints,
    limit,
		screeningConfig: envelope?.screening_config,
  });

  return {
    cycle_id: envelope?.cycle_id || null,
    shortlist: ranked.candidates.map((pool) => ({
      pool: pool.pool,
      name: pool.name,
      ranking_score: pool.deterministic_score,
    })),
    blocked_summary: ranked.blocked_summary,
    total_eligible: ranked.total_eligible,
  };
}

export function replayManagementEnvelope(envelope, config) {
	if (envelope?.status === "skipped_overlap") {
		const overlapWith = getOverlappingCycleType(envelope?.overlap_inputs || {});
		return {
			cycle_id: envelope?.cycle_id || null,
			status: overlapWith ? "skipped_overlap" : "ready",
			summary: {
				overlap_with: overlapWith,
			},
			actions: [],
		};
	}

	const positions = envelope?.position_inputs || [];
	const effectiveConfig = {
		management: envelope?.management_config || config.management,
	};

  return {
    cycle_id: envelope?.cycle_id || null,
    actions: positions
      .map((position) => {
        const planned = planManagementRuntimeAction(position, effectiveConfig);
        if (!planned) return null;
        return {
          position: position.position,
          tool: planned.toolName,
          rule: planned.rule,
          reason: planned.reason,
        };
      })
      .filter(Boolean),
  };
}
