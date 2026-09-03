import assert from "node:assert/strict";
import test from "node:test";
import { setup, overviewReport, evidenceReport } from "../src/frontend.js";

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.classList = { toggle() {} }; }
  get firstChild() { return this.children[0]; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  removeChild(node) { this.children = this.children.filter((item) => item !== node); }
  remove() { this.parent?.removeChild(this); }
  insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  click() { this.listeners.click?.(); }
}
const flatten = (node) => [node, ...node.children.flatMap(flatten)];

function fakeDocument(context) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (tag) => new FakeNode(tag) } });
  context.after(() => original ? Object.defineProperty(globalThis, "document", original) : delete globalThis.document);
}

test("settings UI restores and launches local/API targets with independently configured judge", (context) => {
  fakeDocument(context);
  const root = new FakeNode("div");
  const sent = [];
  let receive;
  const ctx = {
    deferReady() {}, ready() {}, sendToBackend: (payload) => sent.push(payload),
    onBackendMessage: (callback) => { receive = callback; return () => {}; },
    dom: { addStyle: () => () => {}, cleanup() {} },
    ui: { registerDrawerTab: () => ({ root, onActivate: () => () => {}, destroy() {} }) },
  };
  const cleanup = setup(ctx);
  receive({
    type: "evaluator_bootstrap", connections: [
      { id: "api", name: "API", provider: "openai", model: "default" },
      { id: "local", name: "Local", provider: "custom", model: "local-default" },
    ], history: [], suites: [{ id: "quick", name: "Quick", targetCalls: 7 }],
    config: {
      target: { connectionId: "api", model: "glm-exact-id", temperature: null, maxTokens: 32768, timeoutMs: 600000, parameters: { top_p: 0.9 }, tokenParameter: "max_completion_tokens", reasoning: "high" },
      judge: { enabled: true, connectionId: "local", model: "qwen-exact-id", temperature: 0.6, maxTokens: 16384, timeoutMs: 900000, reasoning: "inherit", parameters: { chat_template_kwargs: { enable_thinking: false } }, calibrate: false },
    },
  });
  flatten(root).find((node) => node.textContent === "Run now").click();
  const request = sent.find((item) => item.type === "evaluator_run_queue");
  assert.equal(request.queue[0].model, "glm-exact-id");
  assert.equal(request.queue[0].temperature, null);
  assert.equal(request.queue[0].timeoutMs, 600000);
  assert.equal(request.queue[0].tokenParameter, "max_completion_tokens");
  assert.equal(request.judge.model, "qwen-exact-id");
  assert.equal(request.judge.provider, "custom");
  assert.equal(request.judge.maxTokens, 16384);
  assert.equal(request.judge.temperature, 0.6);
  assert.equal(request.judge.timeoutMs, 900000);
  assert.equal(request.judge.calibrate, false);
  assert.equal(JSON.parse(request.judge.parameters).chat_template_kwargs.enable_thinking, false);
  assert.equal(request.timeoutMs, undefined);
  receive({ type: "evaluator_error", message: "Simulated server rejection" });
  const parameters = flatten(root).filter((node) => node.tag === "textarea");
  parameters[0].value = "not JSON";
  const before = sent.filter((item) => item.type === "evaluator_run_queue").length;
  flatten(root).find((node) => node.textContent === "Run now").click();
  assert.equal(sent.filter((item) => item.type === "evaluator_run_queue").length, before);
  assert.ok(flatten(root).some((node) => node.textContent?.startsWith("Invalid generation settings")));
  cleanup();
});

test("new reports show absent quality as unassessed and expose response/judge diagnostics", (context) => {
  fakeDocument(context);
  const run = {
    schemaVersion: 2, suite: { targetCalls: 1 }, aggregate: { families: { roleplay: { objectiveScore: 100, subjectiveScore: null } } },
    results: [{ resultId: "r", testId: "RP", title: "Roleplay", family: "roleplay", runtime: { status: "incomplete" }, completion: { status: "truncated", detail: "Output budget exhausted" }, response: { content: "partial", reasoning: "analysis", finishReason: "length" }, criteria: [{ id: "role", label: "Role", instruction: "Perform the requested scene" }] }],
  };
  const overview = flatten(overviewReport(run));
  assert.ok(overview.filter((node) => node.className === "dme-score-number").every((node) => node.textContent === "—"));
  const evidence = flatten(evidenceReport(run, "roleplay"));
  assert.ok(evidence.some((node) => node.textContent === "Output budget exhausted"));
  assert.ok(evidence.some((node) => node.textContent?.includes('"reasoning": "analysis"')));
  assert.ok(evidence.some((node) => node.textContent?.includes("Not assessed")));
});
