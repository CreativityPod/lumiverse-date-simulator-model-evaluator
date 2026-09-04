import assert from "node:assert/strict";
import test from "node:test";

import { getSuite, suiteCatalog, SUITES } from "../src/benchmarks.js";

test("suite call counts include actual follow-up generations", () => {
  assert.equal(SUITES.quick.tests.length * SUITES.quick.repetitions, 7);
  assert.equal(SUITES.standard.tests.length * SUITES.standard.repetitions, 24);
  assert.equal(SUITES.full.tests.length * SUITES.full.repetitions, 60);
  for (const suite of Object.values(SUITES)) {
    assert.equal(suite.estimatedTargetCalls, suite.tests.reduce((sum, fixture) => sum + 1 + fixture.followUps.length, 0) * suite.repetitions);
  }
  assert.deepEqual(suiteCatalog().map((suite) => suite.targetCalls), [7, 32, 78]);
});

test("multi-turn criteria and deterministic checks declare their applicable turns", () => {
  const reset = SUITES.full.tests.find((item) => item.id === "DSC-CMD-001");
  assert.deepEqual(reset.criteria.find((item) => item.id === "reset-routing").turns, [1]);
  assert.deepEqual(reset.criteria.find((item) => item.id === "reset-isolation").turns, [2]);
  assert.deepEqual(reset.checks.find((item) => item.id === "reset-menu").turns, [1]);
  assert.deepEqual(reset.checks.find((item) => item.id === "reset-private-profile").turns, [2]);
  const continuity = SUITES.full.tests.find((item) => item.id === "DSC-CONT-001");
  assert.deepEqual(continuity.criteria.find((item) => item.id === "physical-continuity-look").turns, [1, 3]);
});

test("test ids are unique and every definition has explicit criteria and only mechanical checks", () => {
  const ids = SUITES.full.tests.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of SUITES.full.tests) {
    assert.ok(item.title);
    assert.ok(item.family);
    assert.ok(Array.isArray(item.messages) && item.messages.length > 0);
    assert.ok(Array.isArray(item.checks));
    assert.ok(item.checks.every((check) => ["numbered_menu", "private_case", "word_range", "required_markers", "forbidden_markers"].includes(check.type)));
    assert.ok(item.criteria.length > 0);
    assert.equal(new Set(item.criteria.map((criterion) => criterion.id)).size, item.criteria.length);
    assert.ok(item.criteria.every((criterion) => typeof criterion.instruction === "string" && criterion.instruction.length > 20));
  }
});

test("quick includes both hard Date Simulator readiness gates", () => {
  const gates = SUITES.quick.tests.flatMap((item) => item.gates ?? []);
  assert.ok(gates.includes("numbered_questions"));
  assert.ok(gates.includes("private_profile"));
  assert.equal(getSuite("unknown"), SUITES.quick);
});
