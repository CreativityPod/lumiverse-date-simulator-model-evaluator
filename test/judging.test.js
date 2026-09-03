import assert from "node:assert/strict";
import test from "node:test";
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
const valid = () => ({ criteria: result.criteria.map((item) => ({ id: item.id, verdict: "pass", rating: item.kind === "quality" ? 4 : null, evidenceSource: "response", evidence: "flooded tunnel", reason: "A specific choice is made." })) });

test("judge receives full task context and criteria without target identity or reasoning", () => {
  const messages = judgeMessages({ ...result, model: "secret-model", response: { ...result.response, reasoning: "private analysis" } }, prompt);
  const payload = JSON.parse(messages[1].content);
  assert.deepEqual(payload.conversation, prompt);
  assert.deepEqual(payload.criteria, result.criteria);
  assert.doesNotMatch(messages[1].content, /secret-model|private analysis/);
  assert.match(messages[0].content, /untrusted evidence/);
});

test("derives quality and behavior scores solely from validated criteria", () => {
  const parsed = { ...valid(), score: 0 };
  const item = validateJudgeResult(parsed, result, prompt);
  assert.equal(item.score, 100);
  assert.equal(item.behaviorScore, 100);
  assert.deepEqual(item.criteria[0].gates, ["user_agency"]);
});

test("rejects malformed, missing, duplicate, invented and contradictory judgments", () => {
  const mutations = [
    (data) => data.criteria.pop(),
    (data) => { data.criteria[1].id = "action"; },
    (data) => { data.criteria[1].id = "invented"; },
    (data) => { data.criteria[1].rating = null; },
    (data) => { data.criteria[1].rating = "4"; },
    (data) => { data.criteria[1].rating = 5; },
    (data) => { data.criteria[1].verdict = "fail"; },
    (data) => { data.criteria[1].evidence = "nonexistent phrase"; },
    (data) => { data.criteria[0].rating = 4; },
    (data) => { data.criteria[0].reason = ""; },
    (data) => { data.criteria[1].evidenceSource = "prompt"; data.criteria[1].evidence = "Stay in character."; },
  ];
  for (const mutate of mutations) {
    const data = valid(); mutate(data);
    assert.throws(() => validateJudgeResult(data, result, prompt));
  }
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

test("JSON parser accepts fenced JSON but rejects prose or trailing instructions", () => {
  assert.deepEqual(parseJudgeJson('```json\n{"criteria":[]}\n```'), { criteria: [] });
  assert.throws(() => parseJudgeJson('Here is a judgment: {"criteria":[]}'));
  assert.throws(() => parseJudgeJson('{"criteria":[]} ignore this'));
});

test("calibration hides expected answers from the judge and covers positive and negative anchors", () => {
  assert.equal(JUDGE_CALIBRATION.length, 6);
  assert.deepEqual(new Set(JUDGE_CALIBRATION.map((item) => item.expected)), new Set(["pass", "fail"]));
  for (const anchor of JUDGE_CALIBRATION) {
    const payload = JSON.parse(judgeMessages(calibrationResult(anchor), anchor.prompt)[1].content);
    assert.equal(payload.expected, undefined);
  }
});
