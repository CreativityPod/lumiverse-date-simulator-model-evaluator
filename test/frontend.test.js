import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATOR_ICON_SVG,
  formatDuration,
  gatePresentation,
  overviewReport,
  readinessPresentation,
  scoreBand,
  scoreDistribution,
  comparisonKey,
  resultVerdict,
} from "../src/frontend.js";

test("uses a reusable chart icon", () => {
  assert.match(EVALUATOR_ICON_SVG, /M4 19V9/);
  assert.match(EVALUATOR_ICON_SVG, /M22 19V3/);
});

test("comparisons include scorer, rubric, provider parameters and independent judge settings", () => {
  const base = { schemaVersion: 2, suite: { id: "quick", benchmarkVersion: "2.0.0" }, snapshot: { fingerprint: "abc" }, aggregate: { scoringVersion: "2.0.0" }, target: { parameters: { top_p: 0.9, top_k: 20 } }, judge: { enabled: true, model: "judge", maxTokens: 8192 } };
  const reordered = structuredClone(base);
  reordered.target.parameters = { top_k: 20, top_p: 0.9 };
  assert.equal(comparisonKey(base), comparisonKey(reordered));
  for (const mutate of [
    (run) => { run.schemaVersion = 1; },
    (run) => { run.aggregate.scoringVersion = "old"; },
    (run) => { run.judge.maxTokens = 2400; },
    (run) => { run.target.parameters.top_p = 0.5; },
    (run) => { run.judge.reasoning = "high"; },
  ]) {
    const changed = structuredClone(base); mutate(changed);
    assert.notEqual(comparisonKey(base), comparisonKey(changed));
  }
});

test("report badges cannot turn absent semantic evidence into pass or failure", () => {
  const result = { resultId: "one", runtime: { status: "success" }, score: { passed: true, assertions: [{ verdict: "pass" }] }, criteria: [{ id: "behavior" }] };
  assert.equal(resultVerdict(result, { schemaVersion: 2 }), "inconclusive");
  assert.equal(resultVerdict(result, { schemaVersion: 2, judge: { items: [{ id: "one", criteria: [{ id: "behavior", verdict: "uncertain" }] }] } }), "inconclusive");
  assert.equal(resultVerdict(result, { schemaVersion: 2, judge: { items: [{ id: "one", criteria: [{ id: "behavior", verdict: "fail" }] }] } }), "fail");
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

test("completed legacy reports show unrun gates as Not tested without modifying stored scores", () => {
  const run = { status: "complete", aggregate: { gates: { continuity: "inconclusive" } }, results: [] };
  assert.equal(gatePresentation(run, "continuity").verdict, "not_tested");
  assert.equal(run.aggregate.gates.continuity, "inconclusive");
  assert.equal(gatePresentation({ ...run, status: "interrupted" }, "continuity").verdict, "inconclusive");
  assert.equal(gatePresentation({ aggregate: run.aggregate }, "continuity").verdict, "inconclusive");
});

test("gate labels preserve attempted errors and decisive verdicts", () => {
  const run = {
    status: "complete",
    aggregate: { gates: { continuity: "inconclusive", private_profile: "fail", number_locality: "not_tested" } },
    results: [{ gates: ["continuity"], runtime: { status: "error" } }],
  };
  assert.equal(gatePresentation(run, "continuity").verdict, "inconclusive");
  assert.equal(gatePresentation(run, "private_profile").verdict, "fail");
  assert.equal(gatePresentation(run, "number_locality").verdict, "not_tested");
});

const scoredResult = (score, index = 0) => ({
  resultId: `fixture-${index}.r1`, testId: `fixture-${index}`, family: "date_simulator", repetition: 1,
  runtime: { status: "success" }, score: { score },
});

test("groups four overlapping 100s and one zero while preserving a mean of 80", () => {
  const run = { results: [100, 0, 100, 100, 100].map(scoredResult) };
  const before = structuredClone(run);
  const distribution = scoreDistribution(run, "date_simulator");
  assert.equal(distribution.count, 5);
  assert.equal(distribution.mean, 80);
  assert.equal(distribution.median, 100);
  assert.equal(distribution.minimum, 0);
  assert.equal(distribution.maximum, 100);
  assert.deepEqual(distribution.groups.map(({ score, count }) => ({ score, count })), [{ score: 0, count: 1 }, { score: 100, count: 4 }]);
  assert.deepEqual(run, before);
});

test("distribution excludes errors and unscored responses, and counts repeated attempts separately", () => {
  const run = { results: [scoredResult(50), { ...scoredResult(100), repetition: 2 }, scoredResult(null),
    { ...scoredResult(0), runtime: { status: "error" } }, { ...scoredResult(0), family: "writing" }] };
  const data = scoreDistribution(run, "date_simulator");
  assert.equal(data.count, 2);
  assert.equal(data.mean, 75);
  assert.equal(data.median, 75);
  const empty = scoreDistribution({ results: [] }, "date_simulator");
  assert.equal(empty.count, 0);
  assert.equal(empty.mean, null);
  assert.equal(empty.median, null);
  assert.equal(empty.minimum, null);
});

test("overview renders counted markers, a separate mean marker, and Not tested labels", (context) => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attributes = {}; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); return node; }
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (tag) => new Node(tag) } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  });
  const root = overviewReport({ status: "complete", aggregate: { gates: { continuity: "inconclusive" } }, results: [0, 100, 100, 100, 100].map(scoredResult) });
  const flatten = (node) => [node, ...node.children.flatMap(flatten)];
  const nodes = flatten(root);
  const markers = nodes.filter((node) => node.className === "dme-score-count");
  assert.deepEqual(markers.map((node) => [node.style.left, node.textContent]), [["0%", "1"], ["100%", "4"]]);
  assert.equal(nodes.find((node) => node.className === "dme-score-mean").style.left, "80%");
  assert.ok(nodes.some((node) => node.textContent === "4 results at 100"));
  assert.ok(nodes.some((node) => node.textContent === "– Not tested"));
  assert.ok(nodes.some((node) => node.textContent === "Mechanical score distribution across completed tests"));
});
