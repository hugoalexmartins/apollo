# Runtime Hardening Plan

Date: `2026-03-27`
Status: implemented and mapped to current repo surfaces

## Goal

Close the serious-capital control-plane gaps without turning Zenith into a broad event platform. The runtime-hardening layer stays narrow: durable write intent tracking, restart-safe recovery, provider-failure fail-closed behavior, deterministic reconciliation, and operator-visible proof surfaces.

## File Map

| Area | Current files | Role |
|---|---|---|
| Durable action ledger | `action-journal.js`, `action-journal.test.js` | Append-only JSONL workflow ledger with fold/read helpers and lifecycle validation |
| Write lifecycle tracking | `tools/executor.js`, `executor-lifecycle-journal.test.js` | Journals write `intent` and terminal `completed` / `manual_review` states at the executor boundary |
| Rebalance handoff | `tools/dlmm.js`, `dlmm-settlement.test.js` | Records `close_observed_pending_redeploy` after close succeeds and before redeploy reconciliation continues |
| Restart recovery | `boot-recovery.js`, `boot-recovery.test.js`, `index.js` | Observes boot state, resolves workflows conservatively, blocks writes on ambiguity or journal corruption, and exposes `/recovery` reporting |
| Recovery-aware local state | `state.js`, `state.test.js` | Prevents stale provider or invalid journal state from silently auto-closing tracked positions |
| Fail-closed startup and provider classification | `startup-snapshot.js`, `startup-snapshot.test.js`, `degraded-mode.js`, `degraded-mode.test.js` | Rejects stale/error-shaped startup inputs with explicit reason codes |
| Deterministic screening and management seams | `tools/screening.js`, `tools/screening.test.js`, `runtime-policy.js`, `runtime-policy.test.js`, `management-runtime.js`, `management-runtime.test.js` | Provider-free seams for screening, stale-PnL handling, and runtime action execution |
| Elite ops guards and heartbeat | `portfolio-guards.js`, `runtime-health.js`, `replay-review.js`, `operator-controls.js` | Portfolio pauses, machine-readable health, replay-backed review, and operator runbook control surfaces |
| Replay and reconciliation | `cycle-trace.js`, `cycle-trace.test.js`, `cycle-replay.js`, `cycle-replay.test.js`, `reconciliation.js`, `reconciliation.test.js` | Writes replay envelopes and checks deterministic parity after the fact |
| Drill harnesses | `test/test-executor-boundary.js`, `test/test-operator-drill.js`, `test/test-chaos-drill.js`, `test/test-dry-run-startup.js` | Operator-grade/provider-free proof around restart, fail-closed startup, and deterministic runtime handling |

## Scope Boundaries

- No auto-write-on-boot recovery. Restart resolution is observation-first and parks ambiguity as `manual_review`.
- No second hidden control plane. The journal and reconciliation layer support recovery and proof only.
- No broad analytics/event-system refactor. The hardening layer stays close to the existing runtime entrypoints.

## Verification Surface

- Deterministic hardening gate: `npm run test:hardening`
- Manual external screening smoke: `npm run test:screen`
- Optional dry-run agent smoke: `npm run test:agent`

## Exit Criteria

- Durable write workflows survive restart boundaries without duplicate autonomous writes.
- Startup and screening fail closed on stale or unavailable provider inputs.
- Operator can inspect unresolved workflows through `/recovery` and committed drill artifacts.
- Replay and reconciliation helpers stay bounded and deterministic.
