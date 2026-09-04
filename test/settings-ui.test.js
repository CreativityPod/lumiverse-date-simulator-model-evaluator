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
  const nodes = flatten(root);
  const targetDetails = nodes.find((node) => node.textContent === "Target model").parent.parent;
  const inside = (node, ancestor) => { for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true; return false; };
  assert.equal(targetDetails.tag, "details");
  assert.notEqual(targetDetails.open, true);
  const refresh = nodes.find((node) => node.textContent === "Refresh");
  const addModel = nodes.find((node) => node.textContent === "Add model");
  assert.equal(inside(refresh, targetDetails), true);
  assert.equal(inside(addModel, targetDetails), true);
  assert.equal(refresh.parent, addModel.parent);
  assert.deepEqual(addModel.parent.children, [addModel, refresh]);
  assert.equal(inside(nodes.find((node) => node.textContent === "Run now"), targetDetails), false);
  nodes.find((node) => node.textContent === "Run now").click();
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
  assert.ok(overview.filter((node) => node.className === "dme-score-number").every((node) => node.textContent === "Not graded"));
  const evidence = flatten(evidenceReport(run, "roleplay"));
  assert.ok(evidence.some((node) => node.textContent === "Output budget exhausted"));
  assert.ok(evidence.some((node) => node.textContent?.includes('"reasoning": "analysis"')));
  assert.ok(evidence.some((node) => node.textContent?.includes("Not assessed")));
});

test("Date Simulator headline keeps its protocol score when semantic grading is unavailable", (context) => {
  fakeDocument(context);
  const run = {
    schemaVersion: 2, suite: { targetCalls: 7 },
    aggregate: { families: { date_simulator: { objectiveScore: 88, behaviorScore: null }, roleplay: { subjectiveScore: null }, writing: { subjectiveScore: null } } },
    judge: { enabled: true, status: "calibration_failed", errors: ["Old calibration gate stopped grading"] },
    results: [],
  };
  const nodes = flatten(overviewReport(run));
  assert.deepEqual(nodes.filter((node) => node.className === "dme-score-number").map((node) => node.textContent), ["88", "Not graded", "Not graded"]);
  assert.ok(nodes.some((node) => node.textContent?.includes("previous evaluator stopped all grading")));
  assert.ok(nodes.some((node) => node.textContent === "Protocol checks"));
});

test("run countdown follows request deadlines and cleans up across completion, Stop, errors and teardown", (context) => {
  fakeDocument(context);
  let now = 1000000;
  let nextTimer = 0;
  const intervals = new Map();
  context.mock.method(Date, "now", () => now);
  context.mock.method(globalThis, "setInterval", (callback) => { intervals.set(++nextTimer, callback); return nextTimer; });
  context.mock.method(globalThis, "clearInterval", (id) => intervals.delete(id));
  const tick = (milliseconds) => { now += milliseconds; for (const callback of [...intervals.values()]) callback(); };
  const root = new FakeNode("div");
  let receive;
  let styles;
  const cleanup = setup({
    deferReady() {}, ready() {}, sendToBackend() {},
    onBackendMessage: (callback) => { receive = callback; return () => {}; },
    dom: { addStyle: (css) => { styles = css; return () => {}; }, cleanup() {} },
    ui: { registerDrawerTab: () => ({ root, onActivate: () => () => {}, destroy() {} }) },
  });
  const spinner = flatten(root).find((node) => node.className === "dme-spinner");
  const countdown = flatten(root).find((node) => node.className === "dme-countdown");
  const progress = { type: "evaluator_progress", model: "target", phase: "target", current: 1, total: 7, totalModels: 1, label: "Test", timeoutMs: 300000, requestStartedAt: 2000000, serverNow: 2000000 };
  assert.equal(spinner.hidden, true);
  assert.equal(countdown.hidden, true);
  assert.match(styles, /prefers-reduced-motion:reduce.*dme-spinner\{animation:none\}/);
  receive({ type: "evaluator_queue_started", totalModels: 1 });
  receive(progress);
  assert.equal(spinner.hidden, false);
  assert.equal(countdown.textContent, "5m 0s remaining · 5m 0s request limit");
  assert.equal(countdown.attributes["aria-live"], "off");
  tick(1000);
  assert.equal(countdown.textContent, "4m 59s remaining · 5m 0s request limit");
  tick(61000); // Simulate delayed callbacks in a background tab.
  assert.equal(countdown.textContent, "3m 58s remaining · 5m 0s request limit");

  receive({ ...progress, phase: "judge", timeoutMs: 600000, serverNow: 2010000 });
  assert.equal(intervals.size, 1);
  assert.equal(countdown.textContent, "9m 50s remaining · 10m 0s request limit");
  receive({ type: "evaluator_request_complete" });
  assert.equal(intervals.size, 0);
  assert.equal(countdown.hidden, true);

  receive({ type: "evaluator_bootstrap", running: true, progress: { ...progress, serverNow: 2060000 } });
  assert.equal(countdown.textContent, "4m 0s remaining · 5m 0s request limit");
  tick(300000);
  assert.equal(countdown.textContent, "Request limit reached · waiting for timeout result…");
  assert.equal(intervals.size, 0);
  assert.equal(spinner.hidden, false);

  receive(progress);
  flatten(root).find((node) => node.textContent === "Stop").click();
  assert.equal(intervals.size, 0);
  assert.equal(countdown.hidden, true);
  receive(progress); // A queued progress event must not restart a stopped timer.
  assert.equal(intervals.size, 0);
  receive({ type: "evaluator_queue_complete", stopped: true });
  assert.equal(spinner.hidden, true);

  receive({ type: "evaluator_queue_started", totalModels: 1 });
  receive(progress);
  receive({ type: "evaluator_error", message: "Connection failed" });
  assert.equal(intervals.size, 0);
  assert.equal(spinner.hidden, true);
  receive({ type: "evaluator_queue_started", totalModels: 1 });
  receive(progress);
  cleanup();
  assert.equal(intervals.size, 0);
});
