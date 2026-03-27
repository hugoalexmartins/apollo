import { rankCandidateSnapshots } from "./tools/screening.js";
import { planManagementRuntimeAction } from "./runtime-policy.js";

export function replayScreeningEnvelope(envelope) {
  const candidateInputs = envelope?.candidate_inputs || [];
  const occupiedPools = new Set(envelope?.occupied_pools || []);
  const occupiedMints = new Set(envelope?.occupied_mints || []);
  const limit = envelope?.shortlist?.length || candidateInputs.length;

  const ranked = rankCandidateSnapshots(candidateInputs, {
    occupiedPools,
    occupiedMints,
    limit,
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
  const positions = envelope?.position_inputs || [];

  return {
    cycle_id: envelope?.cycle_id || null,
    actions: positions
      .map((position) => {
        const planned = planManagementRuntimeAction(position, config);
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
