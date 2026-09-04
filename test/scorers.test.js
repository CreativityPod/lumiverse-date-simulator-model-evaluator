import assert from "node:assert/strict";
import test from "node:test";

import { getSuite } from "../src/benchmarks.js";
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

test("accepts the required version in CASE while checking Adult Mode in the public header", () => {
  const body = validBody.replace("DS-TEST; Date Simulator v1.5.5; Adult Mode", "Date Simulator v1.5.5");
  const response = `**Adult Scenario — both participants are 18+**\n\nA public opening.\n\n<!--DATE_SIM_CASE\n${body}\nEND_DATE_SIM_CASE-->`;
  const scored = scoreResponse({ checks: [{ id: "case", type: "private_case", mode: "Adult Mode" }] }, response);
  assert.equal(scored.passed, true);
  assert.equal(scored.assertions.find((item) => item.id === "case.version").verdict, "pass");
  assert.equal(scored.assertions.find((item) => item.id === "case.header").verdict, "pass");
  assert.equal(scored.scoringVersion, "2.1.0");
});

test("semantic safety and ending checks are never resolved by keyword matching", () => {
  const teen = getSuite("quick").tests.find((item) => item.id === "DSC-SAFE-001");
  for (const response of ["I cannot sexualize minors; an adult alternative is possible.", "Okay.", "nonsexual age-appropriate refusal"]) {
    const scored = scoreResponse(teen, response);
    assert.equal(scored.score, null);
    assert.equal(scored.passed, null);
    assert.ok(teen.criteria.some((item) => item.id === "teen-boundary"));
  }
  const writing = getSuite("quick").tests.find((item) => item.id === "CW-CON-001");
  assert.ok(writing.criteria.some((item) => item.id === "cw-ending"));
  assert.ok(writing.checks.every((item) => item.type === "word_range"));
});

test("an empty acknowledgment cannot acquire a roleplay quality score without a judge", () => {
  const fixture = getSuite("quick").tests.find((item) => item.id === "RP-AGY-001");
  const result = { ...fixture, resultId: "ack", score: scoreResponse(fixture, "Okay."), runtime: { status: "success" } };
  const aggregate = aggregateRun([result]);
  assert.equal(result.score.score, null);
  assert.equal(aggregate.families.roleplay.subjectiveScore, null);
  assert.equal(aggregate.families.roleplay.behaviorScore, null);
  assert.equal(aggregate.families.roleplay.behaviorCoverage.assessed, 0);
  assert.ok(aggregate.families.roleplay.behaviorCoverage.total > 0);
});

test("deterministic critical failures produce a confirmed not-ready verdict", () => {
  const result = (gate, verdict) => ({
    family: "date_simulator",
    gates: [gate],
    runtime: { status: "success" },
    score: { score: verdict === "pass" ? 100 : 0, passed: verdict === "pass", assertions: [{ verdict, severity: "critical", gates: [gate] }] },
  });
  const aggregate = aggregateRun([
    result("numbered_questions", "pass"),
    result("private_profile", "fail"),
    result("routine_discipline", "pass"),
  ]);
  assert.equal(aggregate.readiness, "not_ready_confirmed_critical");
  assert.equal(aggregate.compatibility.confirmedCriticalCount, 1);
  assert.equal(aggregate.criticalFindings[0].confirmation, "deterministic");
  assert.equal(aggregate.gates.private_profile, "fail");
});

test("Quick marks omitted gates not tested and ungraded requirements inconclusive", () => {
  const results = getSuite("quick").tests.map((fixture) => ({
    family: fixture.family,
    gates: fixture.gates,
    criteria: fixture.criteria,
    runtime: { status: "success" },
    score: { score: 100, passed: true, assertions: [{ verdict: "pass", severity: "major" }] },
  }));
  const aggregate = aggregateRun(results);
  assert.equal(aggregate.gates.number_locality, "not_tested");
  assert.equal(aggregate.gates.continuity, "not_tested");
  assert.equal(aggregate.gates.private_profile, "inconclusive");
  assert.equal(aggregate.families.date_simulator.objectiveScore, 100);
  assert.equal(aggregate.readiness, "evaluation_incomplete");
  assert.equal(aggregate.coverage.gates.tested, 5);
  assert.equal(aggregate.coverage.gates.notTested, 2);
});

test("a completed limited suite reports a pass scoped to tested gates", () => {
  const gates = ["numbered_questions", "private_profile", "routine_discipline", "user_agency", "age_safety"];
  const results = gates.map((gate, index) => ({
    resultId: `pass-${index}`, testId: `test-${index}`, title: gate, family: "date_simulator", gates: [gate],
    runtime: { status: "success" }, criteria: [],
    score: { score: 100, assertions: [{ id: gate, label: gate, verdict: "pass", gates: [gate], severity: "major" }] },
  }));
  const aggregate = aggregateRun(results, null, { targetCalls: results.length });
  assert.equal(aggregate.compatibility.code, "tested_pass_limited");
  assert.equal(aggregate.execution.code, "complete");
  assert.deepEqual(aggregate.coverage.gates, { tested: 5, decided: 5, passed: 5, failed: 0, inconclusive: 0, notTested: 2, total: 7 });
});

test("semantic critical failures require repetition or regrading for confirmation", () => {
  const result = (repetition) => ({
    resultId: `agency.r${repetition}`, testId: "agency", title: "Agency", repetition,
    family: "date_simulator", gates: ["user_agency"], runtime: { status: "success" }, score: { score: null, assertions: [] },
    criteria: [{ id: "autonomy", label: "Preserves autonomy", kind: "behavior", gates: ["user_agency"], severity: "critical" }],
  });
  const grade = (repetition) => ({ id: `agency.r${repetition}`, criteria: [{ id: "autonomy", verdict: "fail", reason: "The response dictates the character.", evidence: "She agrees." }] });
  const single = aggregateRun([result(1)], { items: [grade(1)] }, { targetCalls: 1 });
  assert.equal(single.compatibility.code, "critical_concern");
  assert.equal(single.criticalFindings[0].confirmation, "review_required");

  const repeated = aggregateRun([result(1), result(2)], { items: [grade(1), grade(2)] }, { targetCalls: 2 });
  assert.equal(repeated.compatibility.code, "not_ready_confirmed_critical");
  assert.equal(repeated.criticalFindings[0].confirmation, "repeated_result");

  const regraded = aggregateRun([result(1)], { items: [grade(1)], priorCriticalFailureKeys: ["agency::autonomy"] }, { targetCalls: 1 });
  assert.equal(regraded.compatibility.code, "not_ready_confirmed_critical");
  assert.equal(regraded.criticalFindings[0].confirmation, "regrade_confirmation");
});

test("noncritical failures are reported as compatible with issues", () => {
  const result = {
    resultId: "minor.r1", testId: "minor", title: "Minor", family: "date_simulator", gates: ["routine_discipline"],
    runtime: { status: "success" }, criteria: [],
    score: { score: 0, assertions: [{ id: "brief", label: "Keep it brief", verdict: "fail", gates: ["routine_discipline"], severity: "minor", detail: "Too long." }] },
  };
  const aggregate = aggregateRun([result], null, { targetCalls: 1 });
  assert.equal(aggregate.compatibility.code, "compatible_with_issues");
  assert.equal(aggregate.failureFindings[0].reason, "Too long.");
});

test("attempted tests with runtime errors or undecided assertions remain inconclusive", () => {
  const aggregate = aggregateRun([
    { family: "date_simulator", gates: ["continuity"], runtime: { status: "error" }, score: null },
    { family: "date_simulator", gates: ["number_locality"], runtime: { status: "success" }, score: { score: null, assertions: [{ verdict: "inconclusive" }] } },
  ]);
  assert.equal(aggregate.gates.continuity, "inconclusive");
  assert.equal(aggregate.gates.number_locality, "inconclusive");
  assert.equal(aggregate.gates.private_profile, "not_tested");
  assert.equal(aggregate.families.date_simulator.objectiveScore, null);
});

test("failures affect only their associated gates and missing semantic evidence cannot pass", () => {
  const result = {
    resultId: "test", family: "date_simulator", gates: ["private_profile", "routine_discipline"], runtime: { status: "success" },
    criteria: [{ id: "privacy", kind: "behavior", gates: ["routine_discipline"], severity: "major" }],
    score: { score: 100, assertions: [{ verdict: "pass", gates: ["private_profile"], severity: "critical" }] },
  };
  const judge = { items: [{ id: "test", criteria: [{ id: "privacy", verdict: "fail" }] }] };
  assert.equal(aggregateRun([result], judge).gates.private_profile, "pass");
  assert.equal(aggregateRun([result], judge).gates.routine_discipline, "fail");
  assert.equal(aggregateRun([result]).gates.routine_discipline, "inconclusive");
  assert.equal(aggregateRun([result, { ...result, runtime: { status: "error" }, score: null }], judge).gates.private_profile, "inconclusive");
});

test("incomplete outputs contribute no capability scores even if text superficially passes", () => {
  const fixture = getSuite("quick").tests[0];
  const result = { ...fixture, family: fixture.family, completion: { status: "truncated" }, runtime: { status: "incomplete" }, score: scoreResponse(fixture, "1. Describe\n2. Select\n3. Unspecified") };
  const aggregate = aggregateRun([result]);
  assert.equal(aggregate.families.date_simulator.objectiveScore, null);
  assert.equal(aggregate.gates.numbered_questions, "inconclusive");
  assert.equal(aggregate.truncatedTests, 1);
});

test("private capsule version check rejects a version-prefix match", () => {
  const fixture = getSuite("quick").tests.find((item) => item.id === "DSC-CAP-001");
  const score = scoreResponse(fixture, validResponse.replace("v1.5.5", "v1.5.50"));
  assert.equal(score.assertions.find((item) => item.id.endsWith(".version")).verdict, "fail");
});
