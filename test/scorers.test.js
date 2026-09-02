import assert from "node:assert/strict";
import test from "node:test";

import {
  CASE_FIELDS,
  aggregateRun,
  parseCaseCapsules,
  parseNumberedOptions,
  scoreResponse,
  validateNumberedMenu,
} from "../src/scorers.js";

const validBody = CASE_FIELDS.map((field) => `${field}: ${field === "CASE" ? "DS-TEST; Date Simulator v1.5.5; Adult Mode" : "populated"}`).join("\n");
const validResponse = `**Adult Scenario — both participants are 18+**\n\nA public opening.\n\n<!--DATE_SIM_CASE\n${validBody}\nEND_DATE_SIM_CASE-->`;

test("parses common numbered Markdown choices and ignores prose numbers", () => {
  const text = "I am 29.\n\n**1.** Describe freely\n2) Build from numbered options\n- **3:** Leave unspecified";
  assert.deepEqual(parseNumberedOptions(text).map((item) => item.number), [1, 2, 3]);
  assert.equal(validateNumberedMenu(text, { minimum: 3, requiredLabels: ["describe", "numbered", "unspecified"] }).valid, true);
});

test("rejects duplicate or ambiguous numbered menus", () => {
  const result = validateNumberedMenu("1. Alpha\n1. Beta\n3. Gamma", { minimum: 3 });
  assert.equal(result.valid, false);
  assert.deepEqual(result.duplicates, [1]);
});

test("validates the exact nine-field private capsule", () => {
  const parsed = parseCaseCapsules(validResponse);
  assert.equal(parsed.starts, 1);
  assert.equal(parsed.ends, 1);
  assert.equal(parsed.complete[0].valid, true);
  assert.deepEqual(parsed.complete[0].fields, CASE_FIELDS);
});

test("rejects missing, reordered, empty, and truncated capsules", () => {
  const reordered = validBody.replace("CASE:", "TEMP:").replace("MAN:", "CASE:").replace("TEMP:", "MAN:");
  assert.equal(parseCaseCapsules(`<!--DATE_SIM_CASE\n${reordered}\nEND_DATE_SIM_CASE-->`).complete[0].valid, false);
  assert.equal(parseCaseCapsules(`<!--DATE_SIM_CASE\n${validBody.replace("MAN: populated", "MAN:")}\nEND_DATE_SIM_CASE-->`).complete[0].valid, false);
  const truncated = parseCaseCapsules(`<!--DATE_SIM_CASE\n${validBody}`);
  assert.equal(truncated.complete.length, 0);
  assert.equal(truncated.starts, 1);
  assert.equal(truncated.ends, 0);
});

test("private capsule scoring makes envelope and fields critical", () => {
  const testCase = { checks: [{ id: "case", type: "private_case", mode: "Adult Mode" }] };
  assert.equal(scoreResponse(testCase, validResponse).passed, true);
  const failure = scoreResponse(testCase, "Only public prose.");
  assert.equal(failure.passed, false);
  assert.equal(failure.criticalFailure, true);
});

test("readiness cannot average away numbered-question or private-profile failures", () => {
  const result = (gate, verdict) => ({
    family: "date_simulator",
    gates: [gate],
    runtime: { status: "success" },
    score: { score: verdict === "pass" ? 100 : 0, passed: verdict === "pass", assertions: [{ verdict, severity: "critical" }] },
  });
  const aggregate = aggregateRun([
    result("numbered_questions", "pass"),
    result("private_profile", "fail"),
    result("routine_discipline", "pass"),
  ]);
  assert.equal(aggregate.readiness, "not_ready_private_profile");
  assert.equal(aggregate.gates.private_profile, "fail");
});
