# Autonomous Workflow Diagram

Date: `2026-03-30`
Status: current runtime flow

## Goal

Explain how Zenith currently moves from startup to screening, management, gated writes, recovery, and operator review without hand-wavy agent mythology.

## Primary Flow

```mermaid
flowchart TD
    A[Process starts] --> B[Boot recovery\nboot-recovery.js]
    B --> C{Writes suppressed?}
    C -->|Yes| D[Recovery/manual review state\noperator can inspect /recovery]
    C -->|No| E[Autonomous cycles enabled]

    E --> F[Screening cycle\nscreening-cycle-runner.js]
    E --> G[Management cycle\nmanagement-cycle-runner.js]

    F --> F1[Startup precheck]
    F1 --> F2{Precheck/admission OK?}
    F2 -->|No| F3[Record failed_precheck or skipped state\nreplay + evaluation + evidence]
    F2 -->|Yes| F4[Discover pools + classify regime + size deploy]
    F4 --> F5{Discovery/sizing valid?}
    F5 -->|No| F6[Record failed_candidates or skipped_sizing_floor]
    F5 -->|Yes| F7[Deterministic ranking\ntools/screening.js]
    F7 --> F8[Bounded shortlist enrichment\nscreening-intel.js]
    F8 --> F9[Pick up to 2 non-blocked finalists]
    F9 --> F10[Active thesis + shadow thesis\nautonomy-engine.js]
    F10 --> F11[Thesis assessment + critic]
    F11 --> F12{Approved write?}
    F12 -->|No| F13[Hold or manual_review\nrecord replay + evaluation]
    F12 -->|Yes| H[Executor boundary\ntools/executor.js]

    G --> G1[Startup precheck + wallet/position snapshot]
    G1 --> G2{Precheck OK?}
    G2 -->|No| G3[Record failed_precheck\nreplay + evaluation + evidence]
    G2 -->|Yes| G4{Open positions?}
    G4 -->|No| G5[Record empty_positions\noptionally trigger follow-on screening]
    G4 -->|Yes| G6[Deterministic runtime actions first\nmanagement-runtime.js]
    G6 --> G7{Anything unresolved or model-routed left?}
    G7 -->|No| G8[Record runtime-only / runtime-determined result]
    G7 -->|Yes| G9[Per-position active thesis + shadow thesis]
    G9 --> G10[Thesis assessment + critic]
    G10 --> G11{Approved write?}
    G11 -->|No| G12[Hold or manual_review\nrecord replay + evaluation]
    G11 -->|Yes| H

    H --> H1[Suppression check]
    H1 --> H2[Decision-gate enforcement]
    H2 --> H3[Safety checks]
    H3 --> H4{Write succeeds?}
    H4 -->|No| H5[Journal manual_review\nrecord tool outcome]
    H4 -->|Yes| H6[Journal completed\npost-success side effects]

    H5 --> I[Replay / evaluation / operator review surfaces]
    H6 --> I
    D --> I
    F3 --> I
    F6 --> I
    F13 --> I
    G3 --> I
    G5 --> I
    G8 --> I
    G12 --> I
```

## Write Boundary

```mermaid
flowchart TD
    A[Cycle wants deploy / close / claim / rebalance] --> B[Append action journal intent]
    B --> C{Autonomous writes suppressed?}
    C -->|Yes| D[Block write\nmanual_review]
    C -->|No| E{Decision gate approved?}
    E -->|No| D
    E -->|Yes| F{Executor safety checks pass?}
    F -->|No| D
    F -->|Yes| G[Execute tool adapter]
    G --> H{Observed success?}
    H -->|No| D
    H -->|Yes| I[Journal completed]
    I --> J[Post-success side effects\nclose auto-swap / claim auto-swap / notifications]
```

## Workflow Stages

- **Boot and recovery** — `boot-recovery.js` folds the action journal, observes open positions, and suppresses autonomous writes if prior workflows are ambiguous or the journal is corrupt.
- **Screening** — `screening-cycle-runner.js` fails closed on startup/admission/provider issues, ranks pools deterministically, enriches only the bounded shortlist, backfills around hard-blocked candidates, then runs active plus best-effort shadow theses before any write can happen.
- **Management** — `management-cycle-runner.js` loads current positions, lets `management-runtime.js` resolve obvious stop-loss / take-profit / rebalance / fee actions first, then sends only unresolved positions through the thesis + critic path.
- **Assessment and critic** — `decision-thesis.js` rejects weak, stale, or contradictory theses, and `decision-critic.js` adds kill-pass logic for conflict, stale signals, deploy loss clusters, and memory vetoes.
- **Executor boundary** — `tools/executor.js` is the real blast wall: it requires an approved decision gate, performs safety checks, journals `intent -> completed/manual_review`, and only then allows side effects.

## Screening Intelligence Gates

- Deterministic rank happens before model reasoning in `tools/screening.js`.
- Shortlist enrichment in `screening-intel.js` adds holder intel, address blacklist checks, creator/deployer denylist checks, bounded public OKX market intel, LP-wallet scoring, and narrative context.
- Finalists hard-block on signals like blacklisted holder/funding addresses, blocked creators, honeypot tags, excessive OKX bundle concentration, and unavailable critical holder / OKX advanced intel.
- If an enriched top candidate hard-blocks, Zenith backfills the finalist window from the shortlist before thesis generation instead of letting one blocked candidate poison the whole window.

## Management Runtime Split

- Deterministic runtime actions run first so the model does not waste turns on obvious work.
- Runtime actions still flow through the runtime thesis + critic path before hitting the executor boundary.
- Blocked or errored runtime actions are allowed to escalate into model-managed review instead of being silently treated as handled.
- Management status now distinguishes real outcomes like `runtime_only`, `held`, `manual_review`, and `failed_write` instead of over-reporting success.

## Recovery, Replay, and Review

- `action-journal.js` keeps append-only write workflow state for restart safety and operator review.
- `cycle-trace.js` writes replay envelopes for screening and management cycles.
- `cycle-replay.js` and `replay-review.js` re-run deterministic logic over recorded envelopes so operators can compare what happened against what the runtime should have done.
- `state-evaluation.js` and `state.js` persist recent cycle summaries, tool outcomes, and counters for screening, management, theses, critic decisions, shadow divergence, and write outcomes.
- `/evaluation`, `/review`, `/recovery`, `/journal`, `/replay`, and `/reconcile` expose those surfaces without requiring raw file inspection.

## Failure and Review Paths

- Startup/provider failures fail closed before the model is invoked.
- Screening discovery/provider issues now report `failed_candidates` instead of masquerading as an empty market.
- Approved-write execution failures report `failed_write` instead of looking like successful autonomous progress.
- Shadow inference is observational only: if it fails, active decisions still continue, but review quality drops for that cycle.
- `claim_fees` and `close_position` now both rely on bounded settlement observation rather than trusting immediate post-transaction balance reads.

## Source Map

- `boot-recovery.js`
- `action-journal.js`
- `screening-cycle-runner.js`
- `management-cycle-runner.js`
- `management-runtime.js`
- `autonomy-engine.js`
- `decision-thesis.js`
- `decision-critic.js`
- `screening-intel.js`
- `tools/screening.js`
- `tools/executor.js`
- `cycle-trace.js`
- `cycle-replay.js`
- `replay-review.js`
- `state-evaluation.js`
