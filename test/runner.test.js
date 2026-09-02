import assert from "node:assert/strict";
import test from "node:test";

import { CASE_FIELDS } from "../src/scorers.js";
import {
  createRun,
  executeRun,
  normalizeJudge,
  normalizeModelTarget,
  reasoningOverride,
  validateRunRequest,
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
  assert.deepEqual(reasoningOverride("off"), { source: "off" });
  assert.deepEqual(reasoningOverride("high"), { source: "custom", apiReasoning: true, effort: "high", thinkingDisplay: "auto" });
  assert.equal(reasoningOverride("inherit"), undefined);
  assert.equal(normalizeModelTarget({ temperature: 9, maxTokens: 2 }).temperature, 2);
  assert.equal(normalizeModelTarget({ temperature: 9, maxTokens: 2 }).maxTokens, 400);
  assert.equal(normalizeJudge({ enabled: true }).enabled, true);
});

test("official judge mode rejects self-judging", () => {
  const target = normalizeModelTarget({ connectionId: "c1", provider: "openai", model: "same" });
  const judge = normalizeJudge({ enabled: true, official: true, connectionId: "c1", provider: "openai", model: "same" });
  assert.match(validateRunRequest(target, judge).join(" "), /different judge/);
  assert.equal(validateRunRequest(target, { ...judge, official: false }).length, 0);
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

test("batches independent roleplay and writing judge scores without changing deterministic gates", async () => {
  let targetCalls = 0;
  let judgeCalls = 0;
  const spindleApi = {
    generate: {
      async raw(input) {
        if (input.connection_id === "judge-connection") {
          judgeCalls += 1;
          const candidates = JSON.parse(input.messages.at(-1).content).candidates;
          return {
            content: JSON.stringify({
              items: candidates.map((candidate) => ({
                id: candidate.id,
                dimensions: Object.fromEntries(candidate.dimensions.map((dimension) => [dimension, 80])),
                score: 80,
                evidence: candidate.response.slice(0, 10),
                reason: "The response follows the brief with controlled voice and action.",
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
  });
  const finished = await executeRun(spindleApi, run);
  assert.equal(finished.status, "complete");
  assert.equal(targetCalls, 7);
  assert.equal(judgeCalls, 1);
  assert.equal(finished.judge.status, "complete");
  assert.equal(finished.judge.items.length, 2);
  assert.equal(finished.aggregate.families.roleplay.subjectiveScore, 80);
  assert.equal(finished.aggregate.families.writing.subjectiveScore, 80);
  assert.equal(finished.aggregate.gates.private_profile, "pass");
});
