import assert from "node:assert/strict";
import test from "node:test";

import { getOverlappingCycleType, shouldTriggerFollowOnScreening } from "./cycle-overlap.js";

test("getOverlappingCycleType blocks management when screening is busy", () => {
  assert.equal(
    getOverlappingCycleType({ cycleType: "management", managementBusy: false, screeningBusy: true }),
    "screening",
  );
});

test("getOverlappingCycleType blocks screening when management is busy", () => {
  assert.equal(
    getOverlappingCycleType({ cycleType: "screening", managementBusy: true, screeningBusy: false }),
    "management",
  );
});

test("getOverlappingCycleType returns null when no overlap", () => {
  assert.equal(
    getOverlappingCycleType({ cycleType: "management", managementBusy: false, screeningBusy: false }),
    null,
  );
  assert.equal(
    getOverlappingCycleType({ cycleType: "screening", managementBusy: false, screeningBusy: false }),
    null,
  );
});

test("shouldTriggerFollowOnScreening only schedules empty-book screening after management finishes", () => {
  assert.equal(
    shouldTriggerFollowOnScreening({
      positionsCount: 0,
      screeningBusy: false,
      screeningLastTriggered: Date.now() - (6 * 60 * 1000),
      screeningCooldownMs: 5 * 60 * 1000,
    }),
    true,
  );
  assert.equal(
    shouldTriggerFollowOnScreening({
      positionsCount: 1,
      screeningBusy: false,
      screeningLastTriggered: 0,
      screeningCooldownMs: 5 * 60 * 1000,
    }),
    false,
  );
  assert.equal(
    shouldTriggerFollowOnScreening({
      positionsCount: 0,
      screeningBusy: true,
      screeningLastTriggered: 0,
      screeningCooldownMs: 5 * 60 * 1000,
    }),
    false,
  );
});
