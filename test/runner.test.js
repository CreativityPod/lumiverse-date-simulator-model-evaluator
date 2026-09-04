import assert from "node:assert/strict";
import test from "node:test";

import { CASE_FIELDS } from "../src/scorers.js";
import { JUDGE_CALIBRATION } from "../src/calibration.js";
import {
  createRun,
  executeRun,
  generateRawWithTimeout,
  normalizeJudge,
  normalizeModelTarget,
  reasoningOverride,
  validateRunRequest,
  requestInput,
  captureResponse,
  classifyCompletion,
  normalizeParameters,
  regradeRun,
} from "../src/runner.js";

const validBody = CASE_FIELDS.map((field) => `${field}: ${field === "CASE" ? "DS-RUN; Date Simulator v1.5.5; Adult Mode" : "populated"}`).join("\n");

function responseFor(messages) {
  const last = messages.at(-1)?.content ?? "";
  if (last === "29") return "Choose an appearance method:\n\n1. Describe freely\n2. Build from numbered options\n3. Leave unspecified";
  if (last.includes("Describe Freely")) return `**Adult Scenario — both participants are 18+**\n\nA bookstore bell rings.\n\n<!--DATE_SIM_CASE\n${validBody}\nEND_DATE_SIM_CASE-->`;
  if (last.includes("exactly her type")) return "Brooke remains at lane eight. She has not approached you or established attraction.";
  if (last.includes("17-year-old")) return "I can't make a scene involving minors erotic. Teen Mode remains nonsexual and age-appropriate; I can continue with an ordinary school encounter.";
  if (last.includes("Your call")) return "Rowan traces the service route. ‘Flooded beats decompressed. I vote wet boots.’ The lantern tilts toward the left passage.";
  if (last.includes("copper key")) return `${Array.from({ length: 184 }, (_, index) => index === 0 ? "rain" : index === 1 ? "copper" : index === 2 ? "key" : index === 3 ? "greenhouse" : "shadow").join(" ")} The locked greenhouse door opens.`;
  return "Mara looks up from the catalog. ‘Serious binding, ordinary exhibit.’";
}

test("normalizes targets, judge settings, and reasoning overrides", () => {
  assert.equal(normalizeModelTarget({}).maxTokens, 16384);
  assert.deepEqual(reasoningOverride("off"), { source: "off" });
  assert.deepEqual(reasoningOverride("high"), { source: "custom", apiReasoning: true, effort: "high", thinkingDisplay: "auto" });
  assert.equal(reasoningOverride("inherit"), undefined);
  assert.equal(normalizeModelTarget({ temperature: 9, maxTokens: 2 }).temperature, 2);
  assert.equal(normalizeModelTarget({ temperature: 9, maxTokens: 2 }).maxTokens, 400);
  assert.equal(normalizeJudge({ enabled: true }).enabled, true);
});

test("exact local and API model IDs, custom parameters, and reasoning budgets are forwarded", () => {
  for (const [provider, model] of [["custom", "lmstudio/local-model"], ["openai", "z-ai/glm-5.3"], ["openai", "deepseek/deepseek-v4"], ["anthropic", "frontier-model-id"], ["google", "another-frontier-model"]]) {
    const target = normalizeModelTarget({ connectionId: "saved", provider, model, maxTokens: 65536, temperature: null, timeoutMs: 900000, parameters: '{"top_p":0.95,"chat_template_kwargs":{"enable_thinking":false}}' });
    const input = requestInput(target, [{ role: "user", content: "test" }]);
    assert.equal(input.model, model);
    assert.equal(input.provider, provider);
    assert.equal(input.parameters.max_tokens, 65536);
    assert.equal(input.parameters.temperature, undefined);
    assert.equal(input.parameters.chat_template_kwargs.enable_thinking, false);
    assert.equal(input.reasoning, undefined);
    assert.equal(target.timeoutMs, 900000);
  }
  const input = requestInput(normalizeModelTarget({ tokenParameter: "max_completion_tokens", maxTokens: 32768, temperature: 0 }), []);
  assert.equal(input.parameters.max_tokens, undefined);
  assert.equal(input.parameters.max_completion_tokens, 32768);
  assert.equal(input.parameters.temperature, 0);
  for (const parameters of ['[]', '{bad}', { messages: [] }, { model: "other" }, { max_tokens: 1 }, { api_key: "private" }]) {
    assert.throws(() => normalizeParameters(parameters));
  }
});

test("provider completion diagnostics preserve empty, reasoning-only, filtered and truncated results", async () => {
  let index = 0;
  const responses = [
    { content: "A promising but incomplete scene", reasoning: "long analysis", finish_reason: "length", usage: { completion_tokens: 2000 } },
    { content: "", reasoning: "thoughts", finish_reason: "stop", usage: { completion_tokens: 1200 } },
    { content: "<think>reasoning with no closing tag", finish_reason: "stop" },
    { content: "Provider blocked this", finish_reason: "content_filter" },
    { content: "", finish_reason: "tool_calls", tool_calls: [{ name: "wrong" }] },
    { content: "<think>some reasoning</think>Okay.", finish_reason: "stop" },
    { content: "unspecified finish", finish_reason: "unknown_finish" },
  ];
  const run = createRun({ connectionId: "c", provider: "custom", model: "local" }, { enabled: false });
  await executeRun({ generate: { raw: async () => responses[index++] } }, run);
  assert.deepEqual(run.results.map((result) => result.completion.status), ["truncated", "empty", "empty", "blocked", "tool_calls", "complete", "unknown"]);
  assert.equal(run.usage.outputTokens, 3200);
  assert.equal(run.results[0].response.content, responses[0].content);
  assert.equal(run.results[0].response.reasoning, "long analysis");
  assert.equal(run.results[0].score, null);
  assert.equal(run.results[1].response.usage.completion_tokens, 1200);
  assert.equal(run.results[2].response.rawContent, responses[2].content);
  assert.equal(run.results[5].response.content, "Okay.");
  assert.equal(run.aggregate.incompleteTests, 6);
  assert.equal(run.aggregate.families.roleplay.subjectiveScore, null);
  assert.equal(classifyCompletion(captureResponse({ content: [{ text: "Hello" }], finish_reason: "end_turn" })).status, "complete");
});

test("multi-turn fixtures retain actual output and isolate repetitions", async () => {
  let counter = 0;
  const run = createRun({ connectionId: "local", provider: "custom", model: "local", suite: "standard" }, { enabled: false });
  await executeRun({ generate: { raw: async () => ({ content: `actual-output-${++counter}` }) } }, run);
  assert.equal(counter, 30);
  const turnTwo = run.results.find((item) => item.testId === "DSC-CONT-001" && item.repetition === 1 && item.turn === 2);
  const turnOne = run.results.find((item) => item.testId === "DSC-CONT-001" && item.repetition === 1 && item.turn === 1);
  assert.equal(run.prompts[turnTwo.promptRef].at(-2).content, turnOne.response.content);
  const repetitionTwo = run.results.find((item) => item.testId === "DSC-CONT-001" && item.repetition === 2 && item.turn === 1);
  assert.ok(!run.prompts[repetitionTwo.promptRef].some((message) => message.content.startsWith("actual-output-")));
  assert.equal(run.suite.uniqueFixtures, 12);
});

test("native reasoning carriers return to the target while remaining hidden from the judge", async () => {
  const run = createRun({ connectionId: "local", provider: "custom", model: "thinking-model", suite: "standard" }, { enabled: true, calibrate: false, connectionId: "judge", provider: "openai", model: "independent" });
  const calls = [];
  await executeRun({ generate: { raw: async (input) => {
    calls.push(structuredClone({ ...input, signal: undefined }));
    if (input.connection_id === "judge") return { content: "malformed judge response" };
    return { content: "A final response.", reasoning: "native private analysis", reasoning_details: [{ type: "reasoning.encrypted", data: "opaque" }], thinking_blocks: [{ type: "thinking", thinking: "native block", signature: "sig" }], thought_signature: "gemini-signature" };
  } } }, run);
  const followUp = calls.find((input) => input.connection_id === "local" && input.messages.at(-1).content.startsWith("I time the next"));
  assert.equal(followUp.messages.at(-2).reasoning_content, "native private analysis");
  assert.deepEqual(followUp.messages.at(-2).reasoning_details, [{ type: "reasoning.encrypted", data: "opaque" }]);
  assert.equal(followUp.messages.at(-2).thought_signature, "gemini-signature");
  assert.ok(calls.filter((input) => input.connection_id === "judge").every((input) => !JSON.stringify(input.messages).includes("native private analysis")));
});

test("a failed multi-turn start skips dependent turns and keeps planned coverage", async () => {
  let counter = 0;
  const run = createRun({ connectionId: "local", provider: "custom", model: "local", suite: "standard" }, { enabled: false });
  await executeRun({ generate: { raw: async (input) => {
    counter += 1;
    if (input.messages.at(-1).content === "/look") return { content: "", finish_reason: "length" };
    return { content: "A response." };
  } } }, run);
  assert.ok(counter < 30);
  assert.equal(run.aggregate.plannedTests, 30);
  assert.ok(run.aggregate.unattemptedTests > 0);
  assert.equal(run.aggregate.families.date_simulator.behaviorCoverage.total, run.suite.coverage.families.date_simulator.behavior);
});

test("calibration disagreements warn without blocking Date, roleplay or writing grades", async () => {
  const run = createRun({ connectionId: "target", provider: "custom", model: "local" }, { enabled: true, connectionId: "judge", provider: "custom", model: "judge" });
  let judgeCalls = 0;
  await executeRun({ generate: { raw: async (input) => {
    if (input.connection_id !== "judge") return { content: responseFor(input.messages) };
    judgeCalls += 1;
    const candidate = JSON.parse(input.messages.at(-1).content);
    return { content: JSON.stringify({ criteria: candidate.criteria.map((criterion) => criterion.kind === "quality"
      ? { id: criterion.id, rating: 3, reason: "A mock quality judgment." }
      : { id: criterion.id, verdict: "pass", reason: "This mock always passes behavior." }) }) };
  } } }, run);
  assert.equal(judgeCalls, 13);
  assert.equal(run.judge.status, "complete");
  assert.equal(run.judge.calibration.status, "failed");
  assert.equal(run.judge.calibration.passed, 2);
  assert.ok(run.judge.warnings.length);
  assert.equal(run.judge.items.length, 7);
  assert.equal(run.aggregate.families.roleplay.subjectiveScore, 75);
  assert.equal(run.aggregate.families.writing.subjectiveScore, 75);
  assert.equal(run.aggregate.families.date_simulator.behaviorScore, 100);
});

test("passing calibration permits grading and rejected judge output retains evidence and usage", async () => {
  const run = createRun({ connectionId: "target", provider: "openai", model: "api-target" }, { enabled: true, connectionId: "judge", provider: "custom", model: "local-judge" });
  await executeRun({ generate: { raw: async (input) => {
    if (input.connection_id !== "judge") return { content: responseFor(input.messages) };
    const candidate = JSON.parse(input.messages.at(-1).content);
    const anchor = JUDGE_CALIBRATION.find((item) => `calibration.${item.id}` === candidate.id);
    if (anchor) return { content: JSON.stringify({ criteria: [{ id: "requirement", verdict: anchor.expected, rating: null, evidenceSource: "response", evidence: candidate.response.slice(0, 10), reason: "Mock expected verdict." }] }) };
    return { content: '{"criteria": [', reasoning: "budget used", finish_reason: "length", usage: { completion_tokens: 3000 } };
  } } }, run);
  assert.equal(run.judge.calibration.status, "passed");
  assert.equal(run.judge.status, "failed");
  assert.equal(run.judge.attempts.length, 17);
  assert.equal(run.judge.attempts[0].response.reasoning, "budget used");
  assert.equal(run.judge.attempts[0].completion.status, "truncated");
  assert.equal(run.usage.outputTokens, 51000);
  assert.equal(run.aggregate.families.writing.subjectiveScore, null);
});

test("hard timeout settles locally and aborts a provider that never responds", async () => {
  let providerSignal;
  const spindleApi = {
    generate: {
      raw(input) {
        providerSignal = input.signal;
        return new Promise(() => {});
      },
    },
  };

  await assert.rejects(
    generateRawWithTimeout(spindleApi, { messages: [] }, { timeoutMs: 5 }),
    (error) => error?.name === "TimeoutError" && /timed out after/.test(error.message),
  );
  assert.equal(providerSignal.aborted, true);
});

test("a provider-side abort is recorded for one fixture without stopping the suite", async () => {
  let calls = 0;
  const spindleApi = {
    generate: {
      async raw(input) {
        calls += 1;
        if (calls === 2) throw new DOMException("Provider cancelled its request", "AbortError");
        return { content: responseFor(input.messages) };
      },
    },
  };
  const run = createRun({
    connectionId: "connection-1",
    provider: "openai",
    model: "occasionally-aborting-model",
    suite: "quick",
  }, { enabled: false });

  const finished = await executeRun(spindleApi, run);
  assert.equal(finished.status, "complete");
  assert.equal(finished.results.length, 7);
  assert.equal(finished.results[1].runtime.status, "error");
  assert.match(finished.results[1].runtime.error, /Provider cancelled/);
});

test("official judge mode rejects self-judging", () => {
  const target = normalizeModelTarget({ connectionId: "c1", provider: "openai", model: "same" });
  const judge = normalizeJudge({ enabled: true, official: true, connectionId: "c1", provider: "openai", model: "same" });
  assert.match(validateRunRequest(target, judge).join(" "), /different judge/);
  assert.equal(validateRunRequest(target, { ...judge, official: false }).length, 0);
});

test("stopping an in-flight test records an inconclusive attempt rather than Not tested", async () => {
  const controller = new AbortController();
  const spindleApi = { generate: { raw() { controller.abort(); return new Promise(() => {}); } } };
  const run = createRun({ connectionId: "c1", provider: "openai", model: "test-model", suite: "quick" }, { enabled: false });
  const finished = await executeRun(spindleApi, run, { signal: controller.signal });
  assert.equal(finished.status, "interrupted");
  assert.equal(finished.results.length, 1);
  assert.equal(finished.results[0].runtime.status, "error");
  assert.equal(finished.aggregate.gates.numbered_questions, "inconclusive");
  assert.equal(finished.aggregate.gates.private_profile, "not_tested");
});

test("executes the seven-call Quick suite headlessly with per-request model overrides", async () => {
  const calls = [];
  const spindleApi = {
    generate: {
      async raw(input) {
        calls.push(input);
        return {
          content: responseFor(input.messages),
          finish_reason: "stop",
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        };
      },
    },
  };
  const run = createRun({
    connectionId: "connection-1",
    connectionName: "Local",
    provider: "openai",
    model: "test-model",
    suite: "quick",
    temperature: 0.7,
    maxTokens: 1800,
    reasoning: "off",
  }, { enabled: false });
  let persisted = 0;
  const finished = await executeRun(spindleApi, run, { hooks: { persist: async () => { persisted += 1; } } });
  assert.equal(finished.status, "complete");
  assert.equal(finished.results.length, 7);
  assert.equal(calls.length, 7);
  assert.ok(persisted >= 9);
  assert.equal(calls[0].connection_id, "connection-1");
  assert.equal(calls[0].provider, "openai");
  assert.equal(calls[0].model, "test-model");
  assert.deepEqual(calls[0].reasoning, { source: "off" });
  assert.equal(finished.usage.totalTokens, 1050);
  assert.ok(finished.prompts["DSC-NUM-001"]);
});

test("grades all fixtures with complete context, independent settings, and validated evidence", async () => {
  let targetCalls = 0;
  let judgeCalls = 0;
  const spindleApi = {
    generate: {
      async raw(input) {
        if (input.connection_id === "judge-connection") {
          judgeCalls += 1;
          const candidate = JSON.parse(input.messages.at(-1).content);
          assert.ok(candidate.conversation.length > 0);
          assert.equal(candidate.model, undefined);
          assert.equal(candidate.reasoning, undefined);
          return {
            content: JSON.stringify({
              criteria: candidate.criteria.map((criterion) => ({
                id: criterion.id, verdict: "pass", rating: criterion.kind === "quality" ? 3 : null,
                evidenceSource: "response", evidence: candidate.response.slice(0, 10), reason: "Mock rubric result.",
              })),
            }),
            usage: { total_tokens: 25 },
          };
        }
        targetCalls += 1;
        return { content: responseFor(input.messages), usage: { total_tokens: 10 } };
      },
    },
  };
  const run = createRun({
    connectionId: "target-connection",
    provider: "openai",
    model: "target-model",
    suite: "quick",
  }, {
    enabled: true,
    official: true,
    connectionId: "judge-connection",
    provider: "anthropic",
    model: "judge-model",
    calibrate: false,
  });
  const finished = await executeRun(spindleApi, run);
  assert.equal(finished.status, "complete");
  assert.equal(targetCalls, 7);
  assert.equal(judgeCalls, 7);
  assert.equal(finished.judge.status, "complete");
  assert.equal(finished.judge.items.length, 7);
  assert.equal(finished.aggregate.families.roleplay.subjectiveScore, 75);
  assert.equal(finished.aggregate.families.writing.subjectiveScore, 75);
  assert.equal(finished.aggregate.gates.private_profile, "pass");
});

test("saved target responses can be regraded, retaining partial grades and retrying only missing criteria", async () => {
  let targetCalls = 0;
  const source = createRun({ connectionId: "target", provider: "custom", model: "saved-local-target", suite: "quick" }, { enabled: false });
  await executeRun({ generate: { raw: async (input) => {
    targetCalls += 1;
    return { content: responseFor(input.messages), usage: { total_tokens: 100 } };
  } } }, source);
  const before = structuredClone(source);
  const seen = new Map();
  const requested = [];
  const graded = await regradeRun({ generate: { raw: async (input) => {
    assert.equal(input.connection_id, "judge");
    const candidate = JSON.parse(input.messages.at(-1).content);
    requested.push(candidate.criteria.map((item) => item.id));
    const first = !seen.has(candidate.id);
    if (first) seen.set(candidate.id, candidate.criteria[0].id);
    else assert.ok(!candidate.criteria.some((item) => item.id === seen.get(candidate.id)));
    const judgments = candidate.criteria.map((criterion) => criterion.kind === "quality"
      ? { id: criterion.id, rating: "3", reason: "Mock quality rating." }
      : { id: criterion.id, verdict: "pass", reason: "Mock behavior rating." });
    return {
      content: first ? `{"criteria":[${JSON.stringify(judgments[0])},` : `Here are the remaining grades: ${JSON.stringify({ criteria: judgments })}`,
      finish_reason: first ? "length" : "stop", usage: { total_tokens: 10 },
    };
  } } }, source, { connectionId: "judge", provider: "custom", model: "local-judge", calibrate: false });
  assert.equal(targetCalls, 7);
  assert.notEqual(graded.id, source.id);
  assert.equal(graded.sourceRunId, source.id);
  assert.equal(graded.mode, "regrade");
  assert.equal(graded.judge.status, "complete");
  assert.equal(graded.aggregate.families.roleplay.subjectiveScore, 75);
  assert.equal(graded.aggregate.families.writing.subjectiveScore, 75);
  assert.equal(graded.aggregate.families.date_simulator.behaviorScore, 100);
  assert.equal(graded.usage.totalTokens, requested.length * 10);
  assert.ok(graded.judge.attempts.some((attempt) => attempt.retry));
  assert.ok(graded.judge.attempts.filter((attempt) => attempt.retry).every((attempt) => attempt.criterionIds.length <= 4));
  assert.deepEqual(source, before);
  assert.deepEqual(graded.results, source.results);
});
