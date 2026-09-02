import assert from "node:assert/strict";
import test from "node:test";

import { DATE_SIMULATOR_SNAPSHOT } from "../src/generated/date-simulator-v1.5.5.js";
import {
  cardSystemPrompt,
  compileBenchmark,
  resolveCardMacros,
  resolveInactiveBlocks,
  snapshotMetadata,
} from "../src/compiler.js";

test("bundles the approved canonical Date Simulator v1.5.5 source", () => {
  assert.equal(DATE_SIMULATOR_SNAPSHOT.source.characterVersion, "1.5.5");
  assert.equal(
    DATE_SIMULATOR_SNAPSHOT.source.sha256,
    "ec859dc21fc2af4bc662c5f3e5de07b72fbf2194e44b4e9324d8a868327c2634",
  );
  assert.match(DATE_SIMULATOR_SNAPSHOT.firstMessage, /1\. \*\*Surprise Me\*\*/);
  assert.equal(snapshotMetadata().fingerprint.length, 64);
});

test("resolves inactive-only blocks for setup and removes them for active cases", () => {
  const source = "before {{unless::{{eq::{{getchatvar::date_simulator.phase}}::active}}}}setup only {{user}}{{/unless}} after";
  assert.equal(resolveInactiveBlocks(source, false), "before setup only {{user}} after");
  assert.equal(resolveInactiveBlocks(source, true), "before  after");
});

test("compiles setup and active card variants without unresolved control macros", () => {
  const setup = cardSystemPrompt({ active: false });
  assert.match(setup, /STARTUP ROUTER/);
  assert.match(setup, /PROMPT PHASE: setup/);
  assert.doesNotMatch(setup, /\{\{(?:getchatvar|unless|eq)/);

  const active = cardSystemPrompt({ active: true, savedCase: "CASE: test" });
  assert.doesNotMatch(active, /STARTUP ROUTER/);
  assert.match(active, /PROMPT PHASE: active/);
  assert.match(active, /CASE: test/);
  assert.doesNotMatch(active, /\{\{(?:getchatvar|unless|eq)/);
});

test("macro replacement affects declared card macros", () => {
  assert.equal(resolveCardMacros("{{char}} addresses {{user}}."), "Date Simulator addresses Benchmark User.");
});

test("each compiled benchmark receives an isolated message array", () => {
  const definition = {
    promptKind: "date_simulator",
    phase: "setup",
    includeGreeting: true,
    messages: [{ role: "user", content: "3" }],
  };
  const first = compileBenchmark(definition);
  const second = compileBenchmark(definition);
  first[2].content = "mutated";
  assert.equal(second[2].content, "3");
  assert.equal(definition.messages[0].content, "3");
});
