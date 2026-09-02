import assert from "node:assert/strict";
import test from "node:test";

import { getSuite, suiteCatalog, SUITES } from "../src/benchmarks.js";

test("suite call counts match their fixture/repetition products", () => {
  assert.equal(SUITES.quick.tests.length * SUITES.quick.repetitions, 7);
  assert.equal(SUITES.standard.tests.length * SUITES.standard.repetitions, 24);
  assert.equal(SUITES.full.tests.length * SUITES.full.repetitions, 54);
  assert.deepEqual(suiteCatalog().map((suite) => suite.targetCalls), [7, 24, 54]);
});

test("test ids are unique and every definition has deterministic checks", () => {
  const ids = SUITES.full.tests.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of SUITES.full.tests) {
    assert.ok(item.title);
    assert.ok(item.family);
    assert.ok(Array.isArray(item.messages) && item.messages.length > 0);
    assert.ok(Array.isArray(item.checks) && item.checks.length > 0);
  }
});

test("quick includes both hard Date Simulator readiness gates", () => {
  const gates = SUITES.quick.tests.flatMap((item) => item.gates ?? []);
  assert.ok(gates.includes("numbered_questions"));
  assert.ok(gates.includes("private_profile"));
  assert.equal(getSuite("unknown"), SUITES.quick);
});
