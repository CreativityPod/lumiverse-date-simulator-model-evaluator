import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { CASE_FIELDS } from "../src/scorers.js";

const validBody = CASE_FIELDS.map((field) => `${field}: ${field === "CASE" ? "DS-HOST; Date Simulator v1.5.5; Adult Mode" : "populated"}`).join("\n");

function responseFor(messages) {
  const last = messages.at(-1)?.content ?? "";
  if (last === "29") return "1. Describe freely\n2. Build from numbered options\n3. Leave unspecified";
  if (last.includes("Describe Freely")) return `**Adult Scenario — both participants are 18+**\n\nThe bookstore door opens.\n\n<!--DATE_SIM_CASE\n${validBody}\nEND_DATE_SIM_CASE-->`;
  if (last.includes("exactly her type")) return "Brooke remains at her lane and has not approached you.";
  if (last.includes("17-year-old")) return "I cannot make minors erotic. Teen Mode is nonsexual and age-appropriate.";
  if (last.includes("Your call")) return "Rowan studies the map. ‘Flooded route. Less chance of vacuum.’";
  if (last.includes("copper key")) return `${Array.from({ length: 184 }, (_, index) => ["rain", "copper", "key", "greenhouse"][index] ?? "shadow").join(" ")} The greenhouse door opens.`;
  return "Mara looks up. ‘The catalog is more serious than the exhibit.’";
}

test("built backend boots and completes a headless queue without chat APIs", async () => {
  const source = await readFile(new URL("../dist/backend.js", import.meta.url), "utf8");
  const storage = new Map();
  const messages = [];
  const rawCalls = [];
  let frontendHandler;
  let resolveQueue;
  const queueComplete = new Promise((resolve) => { resolveQueue = resolve; });
  const connection = { id: "conn-1", name: "Mock connection", provider: "openai", model: "default-model", is_default: true };
  const spindle = {
    permissions: { has: (permission) => ["generation", "ui_panels"].includes(permission), onChanged: () => () => {} },
    connections: { list: async () => [connection], get: async (id) => id === connection.id ? connection : null },
    storage: {
      async getJson(path, { fallback }) { return storage.has(path) ? structuredClone(storage.get(path)) : fallback; },
      async setJson(path, value) { storage.set(path, structuredClone(value)); },
      async delete(path) { storage.delete(path); },
      async list(prefix) {
        return [...storage.keys()].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
      },
    },
    generate: {
      async raw(input) {
        rawCalls.push(input);
        if (input.model === "judge-model") {
          const candidate = JSON.parse(input.messages.at(-1).content);
          return { content: JSON.stringify({ criteria: candidate.criteria.map((criterion) => criterion.kind === "quality"
            ? { id: criterion.id, rating: 3, reason: "A mock quality grade." }
            : { id: criterion.id, verdict: "pass", reason: "A mock behavior grade." }) }), finish_reason: "stop", usage: { total_tokens: 10 } };
        }
        return { content: responseFor(input.messages), finish_reason: "stop", usage: { total_tokens: 10 } };
      },
    },
    onFrontendMessage(handler) { frontendHandler = handler; },
    sendToFrontend(payload) {
      messages.push(payload);
      if (payload.type === "evaluator_queue_complete") resolveQueue(payload);
    },
    log: { info() {}, error() {} },
  };

  vm.runInNewContext(source, {
    spindle,
    crypto: globalThis.crypto,
    AbortController,
    AbortSignal,
    DOMException,
    clearTimeout,
    setTimeout,
    structuredClone,
  });
  assert.equal(typeof frontendHandler, "function");

  await frontendHandler({ type: "evaluator_bootstrap_request" }, "user-1");
  const bootstrap = messages.find((payload) => payload.type === "evaluator_bootstrap");
  assert.equal(bootstrap.connections[0].id, "conn-1");
  assert.deepEqual(Array.from(bootstrap.suites, (suite) => suite.targetCalls), [7, 30, 69]);
  await frontendHandler({ type: "evaluator_get_run", id: "missing-run" }, "user-1");
  assert.ok(messages.some((payload) => payload.type === "evaluator_run_detail_error" && payload.id === "missing-run"));

  await frontendHandler({
    type: "evaluator_run_queue",
    queue: [{ connectionId: "conn-1", model: "override-model", suite: "quick", reasoning: "off" }],
    judge: { enabled: false },
  }, "user-1");
  const completed = await queueComplete;
  assert.equal(completed.runs.length, 1);
  assert.equal(completed.runs[0].status, "complete");
  assert.equal(rawCalls.length, 7);
  assert.ok(rawCalls.every((call) => call.connection_id === "conn-1" && call.model === "override-model"));
  assert.ok([...storage.keys()].some((path) => path.startsWith("runs/")));
  assert.ok(messages.some((payload) => payload.type === "evaluator_run_complete"));
  const progressEvents = messages.filter((payload) => payload.type === "evaluator_progress");
  assert.equal(progressEvents.length, 7);
  assert.ok(progressEvents.every((payload) => Number.isFinite(payload.requestStartedAt) && payload.serverNow >= payload.requestStartedAt));
  assert.equal(messages.filter((payload) => payload.type === "evaluator_request_complete").length, 7);

  const completedRunId = completed.runs[0].id;
  const originalReport = structuredClone(storage.get(`runs/${completedRunId}.json`));
  const regradeComplete = new Promise((resolve) => { resolveQueue = resolve; });
  await frontendHandler({ type: "evaluator_regrade_run", id: completedRunId, judge: { connectionId: "conn-1", model: "judge-model", calibrate: false } }, "user-1");
  const regraded = await regradeComplete;
  assert.equal(regraded.runs.length, 1);
  assert.equal(regraded.runs[0].mode, "regrade");
  assert.equal(regraded.runs[0].sourceRunId, completedRunId);
  assert.equal(regraded.runs[0].aggregate.families.roleplay.subjectiveScore, 75);
  assert.equal(regraded.runs[0].aggregate.families.writing.subjectiveScore, 75);
  assert.equal(rawCalls.filter((call) => call.model === "override-model").length, 7);
  assert.equal(rawCalls.filter((call) => call.model === "judge-model").length, 7);
  assert.deepEqual(storage.get(`runs/${completedRunId}.json`), originalReport);
  await frontendHandler({ type: "evaluator_delete_run", id: regraded.runs[0].id }, "user-1");
  await frontendHandler({ type: "evaluator_delete_run", id: completedRunId }, "user-1");
  assert.equal(storage.has(`runs/${completedRunId}.json`), false);
  assert.equal(storage.get("index.json").runs.length, 0);
  const deleted = messages.find((payload) => payload.type === "evaluator_run_deleted" && payload.id === completedRunId);
  assert.equal(deleted.id, completedRunId);
  assert.equal(deleted.deleted, true);

  storage.set("config.json", { preserved: true });
  storage.set("runs/orphan-1.json", { id: "orphan-1" });
  storage.set("runs/orphan-2.json", { id: "orphan-2" });
  storage.set("runs/keep-notes.txt", "not a report");
  storage.set("index.json", { schemaVersion: 1, runs: [{ id: "orphan-1" }] });
  await frontendHandler({ type: "evaluator_clear_reports" }, "user-1");
  assert.equal(storage.has("runs/orphan-1.json"), false);
  assert.equal(storage.has("runs/orphan-2.json"), false);
  assert.equal(storage.has("runs/keep-notes.txt"), true);
  assert.deepEqual(storage.get("config.json"), { preserved: true });
  assert.equal(storage.get("index.json").runs.length, 0);
  const cleared = messages.find((payload) => payload.type === "evaluator_reports_cleared");
  assert.equal(cleared.deletedCount, 2);
});
