import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATOR_ICON_SVG,
  formatDuration,
  readinessPresentation,
  scoreBand,
} from "../src/frontend.js";

test("uses a reusable chart icon", () => {
  assert.match(EVALUATOR_ICON_SVG, /M4 19V9/);
  assert.match(EVALUATOR_ICON_SVG, /M22 19V3/);
});

test("presents hard readiness outcomes independently from prose scores", () => {
  assert.deepEqual(readinessPresentation({ readiness: "ready" }), {
    code: "ready",
    label: "Ready for Date Simulator",
    state: "pass",
  });
  assert.equal(readinessPresentation({ readiness: "not_ready_private_profile" }).state, "fail");
  assert.equal(readinessPresentation({ readiness: "not_ready_numbered_questions" }).label, "Not ready: numbered questions");
});

test("formats duration and score bands", () => {
  assert.equal(formatDuration(125000), "2m 5s");
  assert.equal(scoreBand(null).label, "Not scored");
  assert.equal(scoreBand(88).label, "Excellent");
  assert.equal(scoreBand(60).label, "Mixed");
  assert.equal(scoreBand(40).label, "Weak");
});
