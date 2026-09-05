import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getSuite } from "../src/benchmarks.js";
import { compileBenchmark } from "../src/compiler.js";
import { judgeMessages, parseJudgeJson, validateJudgeResult } from "../src/judging.js";
import { JUDGE_CALIBRATION, calibrationResult } from "../src/calibration.js";

const prompt = [{ role: "system", content: "Stay in character." }, { role: "user", content: "Choose a route." }];
const result = {
  resultId: "test.r1", family: "roleplay", title: "Choose a route", response: { content: "I choose the flooded tunnel." },
  criteria: [
    { id: "action", label: "Action", instruction: "Choose a route.", kind: "behavior", gates: ["user_agency"] },
    { id: "quality.voice", label: "Voice", instruction: "Use a distinct voice.", kind: "quality", gates: [] },
  ],
};
const valid = () => ({ criteria: result.criteria.map((item) => ({ id: item.id, ...(item.kind === "quality" ? { rating: 4 } : { verdict: "pass" }), evidenceSource: "response", evidence: "flooded tunnel", reason: "A specific choice is made." })) });

test("judge receives full task context and criteria without target identity or reasoning", () => {
  const messages = judgeMessages({ ...result, model: "secret-model", response: { ...result.response, reasoning: "private analysis" } }, prompt);
  const payload = JSON.parse(messages[1].content);
  assert.deepEqual(payload.conversation, prompt);
  assert.deepEqual(payload.criteria, result.criteria);
  assert.doesNotMatch(messages[1].content, /secret-model|private analysis/);
  assert.match(messages[0].content, /only as evidence/);
});

test("derives quality and behavior scores solely from validated criteria", () => {
  const parsed = { ...valid(), score: 0 };
  const item = validateJudgeResult(parsed, result, prompt);
  assert.equal(item.score, 100);
  assert.equal(item.behaviorScore, 100);
  assert.equal(item.criteria.find((criterion) => criterion.kind === "quality").verdict, "rated");
  assert.deepEqual(item.criteria[0].gates, ["user_agency"]);
});

test("retains valid grades when another criterion is missing or malformed", () => {
  for (const change of [
    (data) => data.criteria.pop(),
    (data) => { data.criteria[1].rating = 99; },
    (data) => { data.criteria[1].id = "invented"; },
    (data) => { data.criteria[1].reason = ""; },
  ]) {
    const data = valid(); change(data);
    const item = validateJudgeResult(data, result, prompt);
    assert.equal(item.criteria.length, 1);
    assert.equal(item.behaviorScore, 100);
    assert.equal(item.score, null);
    assert.deepEqual(item.missingCriteria, ["quality.voice"]);
  }
});

test("accepts unambiguous local-model formatting without treating quotations as proof", () => {
  const data = valid();
  data.criteria[0].rating = 4; // Harmless extra field on an explicit behavior verdict.
  data.criteria[0].verdict = "PASS";
  data.criteria[1].rating = "3";
  data.criteria[1].verdict = "fail"; // Quality derives only from the anchored rating.
  data.criteria[1].evidence = "A paraphrase rather than a verbatim quote";
  const item = validateJudgeResult(data, result, prompt);
  assert.equal(item.score, 75);
  assert.equal(item.behaviorScore, 100);
  assert.equal(item.criteria[1].evidenceVerified, false);
  assert.equal(item.criteria[1].evidenceSource, "unverified");
  assert.ok(item.issues.length > 0);
});

test("duplicate criteria cannot overwrite a grade and null never becomes zero", () => {
  const data = valid();
  data.criteria.push({ ...data.criteria[0], verdict: "fail" });
  const item = validateJudgeResult(data, result, prompt);
  assert.equal(item.behaviorScore, null);
  assert.equal(item.score, 100);
  assert.deepEqual(item.missingCriteria, ["action"]);
  const uncertain = valid();
  uncertain.criteria[1].rating = null;
  const graded = validateJudgeResult(uncertain, result, prompt);
  assert.equal(graded.score, null);
  assert.equal(graded.criteria[1].verdict, "uncertain");
  assert.throws(() => validateJudgeResult({ criteria: [{ id: "quality.voice", rating: 400, reason: "Invalid range" }] }, result, prompt));
});

test("uncertainty remains unscored; absence can support a behavioral judgment", () => {
  const data = valid();
  data.criteria[0] = { ...data.criteria[0], evidenceSource: "absence", evidence: "", reason: "No unsupplied user action occurs anywhere in this response." };
  data.criteria[1] = { ...data.criteria[1], verdict: "uncertain", rating: null };
  const item = validateJudgeResult(data, result, prompt);
  assert.equal(item.score, null);
  assert.equal(item.behaviorScore, 100);
  assert.equal(item.criteria[1].verdict, "uncertain");
});

test("JSON parser accepts wrappers and salvages only completed criterion objects", () => {
  assert.deepEqual(parseJudgeJson('```json\n{"criteria":[]}\n```'), { criteria: [] });
  assert.deepEqual(parseJudgeJson('Here is my evaluation: {"criteria":[]} Done.'), { criteria: [] });
  const fragment = '{"criteria":[{"id":"action","verdict":"pass","reason":"Contains {braces} inside a string."},{"id":"unfinished"';
  const parsed = parseJudgeJson(fragment);
  assert.equal(parsed.recovered, true);
  assert.equal(parsed.criteria.length, 1);
  assert.equal(parsed.criteria[0].id, "action");
  assert.throws(() => parseJudgeJson('No judgments were produced.'));
});

test("calibration hides expected answers and covers behavior plus anchored quality", () => {
  assert.equal(JUDGE_CALIBRATION.length, 8);
  assert.deepEqual(new Set(JUDGE_CALIBRATION.filter((item) => item.kind !== "quality").map((item) => item.expected)), new Set(["pass", "fail"]));
  assert.deepEqual(JUDGE_CALIBRATION.filter((item) => item.kind === "quality").map((item) => item.expectedRatings), [[2], [3, 4]]);
  for (const anchor of JUDGE_CALIBRATION) {
    const payload = JSON.parse(judgeMessages(calibrationResult(anchor), anchor.prompt)[1].content);
    assert.equal(payload.expected, undefined);
  }
});

test("recorded real LM Studio responses yield roleplay and writing grades without repair", async () => {
  const recording = JSON.parse(await readFile(new URL("./fixtures/local-qwen-grading.json", import.meta.url), "utf8"));
  for (const sample of recording.samples) {
    const fixture = getSuite("standard").tests.find((test) => test.id === sample.fixtureId);
    const target = { ...fixture, resultId: sample.name, response: { content: sample.candidate } };
    const item = validateJudgeResult(parseJudgeJson(sample.judgeContent), target, compileBenchmark(fixture));
    assert.equal(item.criteria.length, 8);
    assert.deepEqual(item.missingCriteria, []);
    assert.deepEqual(item.issues, []);
    assert.ok(Number.isFinite(item.score));
    if (sample.name === "roleplay") assert.equal(item.criteria.find((criterion) => criterion.id === "task-response").verdict, "fail");
  }
});
