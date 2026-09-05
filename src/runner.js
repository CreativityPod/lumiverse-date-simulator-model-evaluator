import { cardSystemPrompt, compileBenchmark, snapshotMetadata } from "./compiler.js";
import { getSuite } from "./benchmarks.js";
import { aggregateRun, scoreResponse } from "./scorers.js";
import { BENCHMARK_VERSION, JUDGE_RUBRIC_VERSION } from "./rubrics.js";
import { judgeMessages, parseJudgeJson, validateJudgeResult } from "./judging.js";
import { CALIBRATION_VERSION, JUDGE_CALIBRATION, calibrationResult } from "./calibration.js";

const RUN_SCHEMA_VERSION = 3;
const JUDGE_BATCH_SIZE = 6;

function appliesToTurn(item, turn) {
  return !Array.isArray(item?.turns) || item.turns.includes(turn);
}

function itemsForTurn(items, turn) {
  return (items ?? []).filter((item) => appliesToTurn(item, turn));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const RESERVED_PARAMETERS = new Set([
  "model", "messages", "prompt", "system", "instructions", "input", "tools", "tool_choice", "stream", "n", "user", "userId",
  "provider", "connection_id", "api_key", "apiKey", "headers", "base_url", "baseURL", "url", "endpoint", "signal",
  "max_tokens", "max_completion_tokens", "max_output_tokens", "temperature", "__proto__", "constructor", "prototype",
]);

export function normalizeParameters(value) {
  if (value == null || value === "") return {};
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error("Additional generation parameters must be valid JSON."); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Additional generation parameters must be a JSON object.");
  for (const key of Object.keys(parsed)) {
    if (RESERVED_PARAMETERS.has(key) || /(?:api.?key|authorization|password|secret|token$)/i.test(key)) {
      throw new Error(`Generation parameter "${key}" is reserved. Use the dedicated controls; credentials belong in the connection.`);
    }
  }
  return JSON.parse(JSON.stringify(parsed));
}

export function normalizeModelTarget(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    connectionId: String(source.connectionId ?? "").trim(),
    connectionName: String(source.connectionName ?? "").trim(),
    provider: String(source.provider ?? "").trim(),
    model: String(source.model ?? "").trim(),
    suite: ["quick", "standard", "full"].includes(source.suite) ? source.suite : "quick",
    temperature: source.temperature == null || source.temperature === "" ? null : boundedNumber(source.temperature, 0.8, 0, 2),
    maxTokens: Math.round(boundedNumber(source.maxTokens, 16_384, 400, 262_144)),
    tokenParameter: source.tokenParameter === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens",
    timeoutMs: Math.round(boundedNumber(source.timeoutMs, 300_000, 10_000, 1_800_000)),
    parameters: normalizeParameters(source.parameters),
    reasoning: ["inherit", "off", "auto", "minimal", "low", "medium", "high", "xhigh", "max"].includes(source.reasoning) ? source.reasoning : "inherit",
    evaluationMode: source.evaluationMode === "fixed_budget" ? "fixed_budget" : "capability",
    label: String(source.label ?? "").trim(),
  };
}

export function normalizeJudge(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...normalizeModelTarget({ ...source, parameters: source.enabled === true ? source.parameters : {}, maxTokens: source.maxTokens ?? 8192 }),
    enabled: source.enabled === true,
    official: source.official !== false,
    calibrate: source.calibrate !== false,
  };
}

export function reasoningOverride(value) {
  if (value === "inherit") return undefined;
  if (value === "off") return { source: "off" };
  return { source: "custom", apiReasoning: true, effort: value, thinkingDisplay: "auto" };
}

export function validateRunRequest(target, judge) {
  const errors = [];
  if (!target.connectionId) errors.push("Choose a target connection.");
  if (!target.provider) errors.push("The selected connection has no provider.");
  if (!target.model) errors.push("Choose or enter a target model ID.");
  if (judge.enabled) {
    if (!judge.connectionId || !judge.provider || !judge.model) errors.push("Complete the judge connection and model selection.");
    const same = target.model.toLowerCase() === judge.model.toLowerCase();
    if (same && judge.official) errors.push("Independent scoring requires a different judge model, including across connections.");
  }
  return errors;
}

function runId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `eval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function abortError(reason) {
  if (reason?.name === "AbortError") return reason;
  const message = typeof reason?.message === "string" ? reason.message : "Evaluation stopped";
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function timeoutError(timeoutMs) {
  const error = new Error(`Generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
  error.name = "TimeoutError";
  return error;
}

/**
 * Settle locally on stop or timeout even when an upstream provider ignores its
 * AbortSignal. The signal is still aborted so Lumiverse can cancel cooperative
 * providers and release their network request.
 */
export function generateRawWithTimeout(spindleApi, input, options = {}) {
  const parentSignal = options.signal;
  const timeoutMs = boundedNumber(options.timeoutMs, 300_000, 1, 1_800_000);
  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onParentAbort = () => {
      const error = abortError(parentSignal?.reason);
      if (!controller.signal.aborted) controller.abort(error);
      settle(reject, error);
    };

    if (parentSignal?.aborted) {
      onParentAbort();
      return;
    }
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    timer = setTimeout(() => {
      const error = timeoutError(timeoutMs);
      if (!controller.signal.aborted) controller.abort(error);
      settle(reject, error);
    }, timeoutMs);

    let request;
    try {
      request = spindleApi.generate.raw({ ...input, signal: controller.signal });
    } catch (error) {
      settle(reject, error);
      return;
    }
    Promise.resolve(request).then(
      (response) => settle(resolve, response),
      (error) => settle(reject, parentSignal?.aborted ? abortError(parentSignal.reason) : error),
    );
  });
}

function responseContent(response) {
  if (typeof response?.content === "string") return response.content;
  if (Array.isArray(response?.content)) {
    return response.content.map((part) => typeof part === "string" ? part : part?.text ?? "").join("");
  }
  return "";
}

export function requestInput(target, messages, signal, userId) {
  const input = {
    provider: target.provider,
    model: target.model,
    connection_id: target.connectionId,
    messages: messages.map((message) => JSON.parse(JSON.stringify(message))),
    parameters: {
      ...target.parameters,
      [target.tokenParameter ?? "max_tokens"]: target.maxTokens,
      ...(target.temperature == null ? {} : { temperature: target.temperature }),
    },
    reasoning: reasoningOverride(target.reasoning),
    signal,
  };
  if (!input.reasoning) delete input.reasoning;
  if (!input.signal) delete input.signal;
  if (userId) input.userId = userId;
  return input;
}

function runSummary(run) {
  return {
    id: run.id,
    schemaVersion: run.schemaVersion,
    mode: run.mode,
    sourceRunId: run.sourceRunId,
    reusedTargetCalls: run.reusedTargetCalls,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    target: run.target,
    suite: run.suite,
    snapshot: run.snapshot,
    aggregate: run.aggregate,
    judge: run.judge ? Object.fromEntries(Object.entries(run.judge).filter(([key]) => !["items", "attempts", "errors", "calibration"].includes(key))) : null,
    durationMs: run.durationMs,
    usage: run.usage,
  };
}

export function createRun(targetValue, judgeValue) {
  const target = normalizeModelTarget(targetValue);
  const judge = normalizeJudge(judgeValue);
  const suite = getSuite(target.suite);
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    id: runId(),
    status: "queued",
    startedAt: "",
    completedAt: "",
    target,
    suite: {
      id: suite.id,
      name: suite.name,
      repetitions: suite.repetitions,
      targetCalls: suite.estimatedTargetCalls,
      benchmarkVersion: BENCHMARK_VERSION,
      uniqueFixtures: suite.tests.length,
      coverage: {
        targetCalls: suite.estimatedTargetCalls,
        families: Object.fromEntries(["date_simulator", "roleplay", "writing"].map((family) => {
          const tests = suite.tests.filter((test) => test.family === family);
          const count = (kind) => tests.reduce((sum, test) => sum + Array.from({ length: 1 + test.followUps.length }, (_, index) => index + 1)
            .reduce((turnTotal, turn) => turnTotal + itemsForTurn(test.criteria, turn)
              .filter((criterion) => (criterion.kind === "quality") === (kind === "quality")).length, 0) * suite.repetitions, 0);
          return [family, { behavior: count("behavior"), quality: count("quality") }];
        })),
      },
    },
    snapshot: snapshotMetadata(),
    judge: judge.enabled ? { ...judge, status: "pending", rubricVersion: JUDGE_RUBRIC_VERSION, items: [], attempts: [], errors: [], warnings: [] } : null,
    prompts: {},
    results: [],
    aggregate: null,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    errors: [],
  };
}

function addUsage(total, usage) {
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0;
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0;
  total.inputTokens += input;
  total.outputTokens += output;
  total.totalTokens += Number(usage?.total_tokens ?? input + output) || 0;
}

export function captureResponse(response) {
  const rawContent = responseContent(response);
  let content = rawContent;
  let reasoning = typeof response?.reasoning === "string" ? response.reasoning : "";
  const opening = content.match(/^\s*<(think|thinking|reasoning)>/i);
  if (opening) {
    const close = new RegExp(`</${opening[1]}>`, "i").exec(content);
    reasoning ||= content.slice(opening[0].length, close ? close.index : undefined).trim();
    content = close ? content.slice(close.index + close[0].length).trim() : "";
  }
  return {
    content, rawContent, reasoning,
    finishReason: response?.finish_reason ?? response?.finishReason ?? "",
    usage: response?.usage ?? null,
    toolCalls: response?.tool_calls ?? response?.toolCalls ?? null,
    refusal: response?.refusal ?? null,
    nativeReasoning: JSON.parse(JSON.stringify({
      reasoning_content: response?.reasoning || response?.reasoning_content || undefined,
      thinking_blocks: response?.thinking_blocks,
      reasoning_details: response?.reasoning_details,
      thought_signature: response?.thought_signature,
    })),
  };
}

export function classifyCompletion(response) {
  const finish = String(response.finishReason).toLowerCase();
  if (["length", "max_tokens", "max_output_tokens", "max_completion_tokens", "token_limit"].includes(finish)) {
    return { status: "truncated", detail: "Output budget exhausted; reasoning may have consumed the available tokens. Increase the budget or adjust reasoning settings." };
  }
  if (["content_filter", "safety", "blocked", "recitation"].includes(finish)) return { status: "blocked", detail: "Provider reported a filtered or blocked completion." };
  if (["tool_calls", "function_call", "tool_use"].includes(finish) || response.toolCalls?.length) return { status: "tool_calls", detail: "Provider requested a tool instead of a final benchmark response." };
  if (!response.content.trim()) return { status: "empty", detail: response.reasoning ? "Reasoning was returned without a final response." : "Provider returned no final text." };
  if (finish && !["stop", "end_turn", "stop_sequence", "eos", "eos_token", "finished", "complete", "completed"].includes(finish)) return { status: "unknown", detail: `Unrecognized finish reason: ${response.finishReason}. Review before scoring.` };
  return { status: "complete", detail: finish ? "Final response completed." : "Final text returned; provider did not expose a finish reason." };
}

async function checkJudgeCalibration(spindleApi, run, userId, signal, hooks) {
  if (!run.judge.calibrate) return true;
  const calibration = { version: CALIBRATION_VERSION, status: "running", passed: 0, total: JUDGE_CALIBRATION.length, attempts: [] };
  run.judge.calibration = calibration;
  for (const [index, anchor] of JUDGE_CALIBRATION.entries()) {
    if (signal?.aborted) throw abortError(signal.reason);
    const result = calibrationResult(anchor);
    const messages = judgeMessages(result, anchor.prompt);
    const input = requestInput(run.judge, messages, undefined, userId);
    const attempt = { id: anchor.id, expected: anchor.expected, messages, parameters: input.parameters, reasoning: input.reasoning ?? "inherit" };
    calibration.attempts.push(attempt);
    const started = Date.now();
    hooks.progress?.({ phase: "judge", current: index + 1, total: calibration.total, label: `Judge sanity check ${index + 1}/${calibration.total}`, timeoutMs: run.judge.timeoutMs, requestStartedAt: started });
    try {
      const response = await generateRawWithTimeout(spindleApi, input, { signal, timeoutMs: run.judge.timeoutMs });
      addUsage(run.usage, response?.usage);
      attempt.response = captureResponse(response);
      attempt.completion = classifyCompletion(attempt.response);
      if (attempt.completion.status !== "complete") throw new Error(attempt.completion.detail);
      attempt.judgment = validateJudgeResult(parseJudgeJson(attempt.response.content), result, anchor.prompt);
      const graded = attempt.judgment.criteria[0];
      attempt.agrees = anchor.kind === "quality"
        ? anchor.expectedRatings.includes(graded.rating)
        : graded.verdict === anchor.expected;
      if (attempt.agrees) calibration.passed += 1;
    } catch (error) {
      attempt.error = String(error?.message ?? error);
      if (signal?.aborted) { calibration.status = "interrupted"; run.judge.status = "interrupted"; throw error; }
    } finally {
      hooks.requestComplete?.();
      attempt.latencyMs = Date.now() - started;
      await hooks.persist?.(run);
    }
  }
  calibration.status = calibration.passed === calibration.total ? "passed" : "failed";
  return calibration.status === "passed";
}

async function gradeResult(spindleApi, run, result, userId, signal, hooks, index, total) {
  const collected = new Map();
  const initialBatches = [];
  for (const kind of ["behavior", "quality"]) {
    const criteria = result.criteria.filter((criterion) => (criterion.kind === "quality" ? "quality" : "behavior") === kind);
    for (let offset = 0; offset < criteria.length; offset += JUDGE_BATCH_SIZE) initialBatches.push(criteria.slice(offset, offset + JUDGE_BATCH_SIZE));
  }
  const batches = [...initialBatches];
  const initialBatchCount = initialBatches.length;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    if (signal?.aborted) throw abortError(signal.reason);
    const requested = { ...result, criteria: batches[batchIndex] };
    const messages = judgeMessages(requested, run.prompts[result.promptRef]);
    const input = requestInput(run.judge, messages, undefined, userId);
    const retry = batchIndex >= initialBatchCount;
    const attempt = { resultId: result.resultId, retry, criterionIds: requested.criteria.map((item) => item.id), messages, parameters: input.parameters, reasoning: input.reasoning ?? "inherit", status: "pending" };
    const started = Date.now();
    hooks.progress?.({ phase: "judge", current: index + 1, total, label: `${retry ? "Retry missing grades" : "Contextual grading"}: ${result.title}`, timeoutMs: run.judge.timeoutMs, requestStartedAt: started });
    run.judge.attempts.push(attempt);
    try {
      const raw = await generateRawWithTimeout(spindleApi, input, { signal, timeoutMs: run.judge.timeoutMs });
      addUsage(run.usage, raw?.usage);
      attempt.response = captureResponse(raw);
      attempt.completion = classifyCompletion(attempt.response);
      // A token limit may leave several complete JSON criterion objects. Retain
      // those judgments and request only the missing ones with a smaller output.
      if (!["complete", "truncated"].includes(attempt.completion.status)) throw new Error(attempt.completion.detail);
      const item = validateJudgeResult(parseJudgeJson(attempt.response.content), requested, run.prompts[result.promptRef]);
      for (const criterion of item.criteria) collected.set(criterion.id, criterion);
      attempt.issues = item.issues;
      attempt.missingCriteria = item.missingCriteria;
      attempt.status = item.missingCriteria.length ? "partial" : "accepted";
    } catch (error) {
      attempt.status = signal?.aborted ? "interrupted" : "rejected";
      attempt.error = String(error?.message ?? error);
      if (signal?.aborted) { run.judge.status = "interrupted"; throw error; }
    } finally {
      hooks.requestComplete?.();
      attempt.latencyMs = Date.now() - started;
      if (collected.size) {
        const item = validateJudgeResult({ criteria: [...collected.values()] }, result, run.prompts[result.promptRef]);
        run.judge.items = [...run.judge.items.filter((entry) => entry.id !== result.resultId), item];
      }
      run.aggregate = aggregateRun(run.results, run.judge, run.suite.coverage);
      await hooks.persist?.(run);
    }
    if (batchIndex < initialBatchCount && attempt.response && ["complete", "truncated"].includes(attempt.completion?.status)) {
      const missing = requested.criteria.filter((criterion) => !collected.has(criterion.id));
      // At most one retry per missing criterion; do not discard successful grades.
      for (let offset = 0; offset < missing.length; offset += JUDGE_BATCH_SIZE) batches.push(missing.slice(offset, offset + JUDGE_BATCH_SIZE));
    }
  }
  const missing = result.criteria.filter((criterion) => !collected.has(criterion.id));
  if (missing.length) {
    const lastError = run.judge.attempts.filter((attempt) => attempt.resultId === result.resultId).findLast((attempt) => attempt.error)?.error;
    run.judge.errors.push(`${result.resultId}: ${collected.size}/${result.criteria.length} criteria graded.${lastError ? ` ${lastError}` : ""}`);
  }
}

async function runJudge(spindleApi, run, userId, parentSignal, hooks) {
  if (!run.judge?.enabled) return;
  run.judge.status = "running";
  const eligible = run.results.filter((result) => result.runtime.status === "success" && result.criteria?.length);
  for (const [index, result] of eligible.entries()) await gradeResult(spindleApi, run, result, userId, parentSignal, hooks, index, eligible.length);
  // Calibration is diagnostic. A disagreement must not erase or prevent grading.
  if (eligible.length && !await checkJudgeCalibration(spindleApi, run, userId, parentSignal, hooks)) {
    run.judge.warnings.push("Judge sanity check had disagreements or errors. Scores are provisional; inspect its examples and target evidence.");
  }
  const uncertain = run.judge.items.some((item) => item.criteria.some((criterion) => criterion.verdict === "uncertain"));
  run.judge.status = !eligible.length ? "not_applicable" : !run.judge.items.length ? "failed"
    : run.judge.errors.length || uncertain || eligible.length < run.suite.targetCalls ? "partial" : "complete";
}

export async function regradeRun(spindleApi, source, judgeValue, options = {}) {
  if (!(source?.schemaVersion >= 2) || !source.results?.length || !source.prompts) throw new Error("This report does not contain reusable version 2 or 3 target evidence.");
  const judge = normalizeJudge({ ...judgeValue, enabled: true });
  const errors = validateRunRequest(source.target, judge);
  if (errors.length) throw new Error(errors.join(" "));
  if (!source.results.some((result) => result.runtime?.status === "success" && source.prompts[result.promptRef] && result.criteria?.length)) {
    throw new Error("No completed target responses are available to grade. Incomplete target output requires a new target run.");
  }
  const independentRegrade = Boolean(source.judge?.model && source.judge.model.toLowerCase() !== judge.model.toLowerCase());
  const priorCriticalFailureKeys = independentRegrade ? [...new Set(source.results.flatMap((result) => {
    const grades = source.judge?.items?.find((item) => item.id === result.resultId)?.criteria ?? [];
    return (result.criteria ?? []).filter((criterion) => criterion.severity === "critical"
      && grades.some((grade) => grade.id === criterion.id && grade.verdict === "fail"))
      .map((criterion) => `${result.testId}::${criterion.id}`);
  }))] : [];
  const run = {
    ...JSON.parse(JSON.stringify(source)), schemaVersion: RUN_SCHEMA_VERSION, id: runId(), sourceRunId: source.id, mode: "regrade",
    reusedTargetCalls: source.results.length, status: "running", startedAt: new Date().toISOString(), completedAt: "", durationMs: 0,
    judge: { ...judge, status: "pending", rubricVersion: JUDGE_RUBRIC_VERSION, priorCriticalFailureKeys,
      confirmationSource: independentRegrade ? { model: source.judge.model, rubricVersion: source.judge.rubricVersion } : null,
      items: [], attempts: [], errors: [], warnings: [] },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, errors: [],
  };
  const started = Date.now();
  await options.hooks?.persist?.(run);
  options.hooks?.started?.(run);
  try {
    await runJudge(spindleApi, run, options.userId, options.signal, options.hooks ?? {});
    run.status = "complete";
  } catch (error) {
    run.status = options.signal?.aborted ? "interrupted" : "failed";
    run.errors.push(String(error?.message ?? error));
  }
  run.durationMs = Date.now() - started;
  run.completedAt = new Date().toISOString();
  run.aggregate = aggregateRun(run.results, run.judge, run.suite.coverage);
  await options.hooks?.persist?.(run);
  return run;
}

export async function executeRun(spindleApi, run, options = {}) {
  const hooks = options.hooks ?? {};
  const signal = options.signal;
  const timeoutMs = Math.round(boundedNumber(options.timeoutMs, run.target.timeoutMs, 10_000, 1_800_000));
  const errors = validateRunRequest(run.target, run.judge ?? { enabled: false });
  if (errors.length) throw new Error(errors.join(" "));
  const suite = getSuite(run.suite.id);
  const started = Date.now();
  run.startedAt = new Date(started).toISOString();
  run.status = "running";
  await hooks.persist?.(run);
  let ordinal = 0;

  try {
    for (let repetition = 1; repetition <= suite.repetitions; repetition += 1) {
      for (const test of suite.tests) {
        if (signal?.aborted) throw new DOMException("Evaluation stopped", "AbortError");
        const messages = compileBenchmark(test);
        for (let turn = 1; turn <= 1 + (test.followUps?.length ?? 0); turn += 1) {
          if (signal?.aborted) throw abortError(signal.reason);
          ordinal += 1;
          if (turn > 1) {
            const turnContext = test.turnContexts?.[turn];
            if (turnContext && test.promptKind === "date_simulator") {
              messages[0] = { role: "system", content: cardSystemPrompt(turnContext) };
            }
            messages.push({ role: "user", content: test.followUps[turn - 2] });
          }
          const promptRef = turn === 1 ? test.id : `${test.id}.r${repetition}.t${turn}`;
          run.prompts[promptRef] = messages.map((message) => ({ ...message }));
          const input = requestInput(run.target, messages, undefined, options.userId);
          const criteria = itemsForTurn(test.criteria, turn);
          const checks = itemsForTurn(test.checks, turn);
          const gates = [...new Set([...criteria, ...checks].flatMap((item) => item.gates ?? []))];
          const result = {
            resultId: `${test.id}.r${repetition}${turn > 1 ? `.t${turn}` : ""}`, testId: test.id, title: test.title, turn,
            family: test.family, gates, repetition,
            criteria, judgeDimensions: criteria.filter((criterion) => criterion.kind === "quality").map((criterion) => criterion.id.replace(/^quality\./, "")),
            promptRef,
            request: { parameters: input.parameters, reasoning: input.reasoning ?? "inherit" },
            response: captureResponse(null), completion: { status: "error" }, score: null,
          };
          const requestStarted = Date.now();
          hooks.progress?.({
            phase: "target",
            current: ordinal,
            total: suite.estimatedTargetCalls,
            repetition,
            testId: test.id,
            label: `${test.title}${test.followUps?.length ? ` · turn ${turn}` : ""}`,
            timeoutMs,
            requestStartedAt: requestStarted,
          });
          try {
            const response = await generateRawWithTimeout(spindleApi, input, { signal, timeoutMs });
            result.response = captureResponse(response);
            addUsage(run.usage, response?.usage);
            result.completion = classifyCompletion(result.response);
            const complete = result.completion.status === "complete";
            result.runtime = { status: complete ? "success" : "incomplete", latencyMs: Date.now() - requestStarted };
            if (complete) result.score = scoreResponse({ ...test, checks }, result.response.content);
          } catch (error) {
            result.runtime = { status: "error", latencyMs: Date.now() - requestStarted, error: String(error?.message ?? error) };
            run.errors.push(`${test.id} repetition ${repetition}: ${result.runtime.error}`);
          } finally {
            hooks.requestComplete?.();
          }
          run.results.push(result);
          run.aggregate = aggregateRun(run.results, run.judge, run.suite.coverage);
          await hooks.persist?.(run);
          hooks.result?.(result, run);
          if (signal?.aborted) throw abortError(signal.reason);
          if (result.runtime.status !== "success") break;
          messages.push({ role: "assistant", content: result.response.content, ...result.response.nativeReasoning });
        }
      }
    }

    await runJudge(spindleApi, run, options.userId, signal, hooks);
    run.status = "complete";
  } catch (error) {
    if (signal?.aborted) {
      run.status = "interrupted";
      run.errors.push("Stopped by the user.");
    } else {
      run.status = "failed";
      run.errors.push(String(error?.message ?? error));
    }
  }

  run.completedAt = new Date().toISOString();
  run.durationMs = Date.now() - started;
  run.aggregate = aggregateRun(run.results, run.judge, run.suite.coverage);
  await hooks.persist?.(run);
  return run;
}

export function summarizeRun(run) {
  return runSummary(run);
}
