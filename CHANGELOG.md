# Changelog

This file documents the major additions and behavior changes present in this fork of Meridian by fciaf420 and yunus-0x.

### Learning and adaptive behavior

- Added structured closed-position performance tracking in `lessons.js`.
- Added lesson derivation from winning and losing positions, with role-aware lesson injection into future prompts.
- Added adaptive threshold evolution that updates `user-config.json` after enough closed-position history accumulates.
- Added manual lesson management, pin/unpin flows, performance history reporting, and lesson clearing tools.

### Memory systems

- Added generic long-term fuzzy memory in `memory.js` for generalized strategies, patterns, lessons, and operator-saved facts.
- Added prompt-level reusable memory injection so previously recalled facts can influence later agent decisions.
- Added exact per-pool memory in `pool-memory.js` for deploy history, pool notes, recent snapshots, win rate, and recall by pool address.
- Added live position snapshot recording so management cycles can see recent per-pool drift and out-of-range trends.
