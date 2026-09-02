import { suiteCatalog } from "./benchmarks.js";
import { snapshotMetadata } from "./compiler.js";
import {
  createRun,
  executeRun,
  normalizeJudge,
  normalizeModelTarget,
  summarizeRun,
  validateRunRequest,
} from "./runner.js";

const activeQueues = new Map();
const frontendUsers = new Set();
const MAX_HISTORY = 60;

function userKey(userId) {
  return typeof userId === "string" && userId ? userId : "__default__";
}

function send(payload, userId) {
  try { spindle.sendToFrontend(payload, userId); } catch { /* Frontend may be closed. */ }
}

function safeRunId(value) {
  const id = String(value ?? "");
  return /^[a-zA-Z0-9_-]{6,100}$/.test(id) ? id : "";
}

function runPath(id) {
  return `runs/${safeRunId(id)}.json`;
}

async function loadHistory() {
  const value = await spindle.storage.getJson("index.json", { fallback: { schemaVersion: 1, runs: [] } });
  return {
    schemaVersion: 1,
    runs: Array.isArray(value?.runs) ? value.runs.slice(0, MAX_HISTORY) : [],
  };
}

async function persistRun(run) {
  await spindle.storage.setJson(runPath(run.id), run, { indent: 2 });
  const index = await loadHistory();
  const summary = summarizeRun(run);
  index.runs = [summary, ...index.runs.filter((item) => item?.id !== run.id)].slice(0, MAX_HISTORY);
  await spindle.storage.setJson("index.json", index, { indent: 2 });
}

async function loadRun(id) {
  const safeId = safeRunId(id);
  if (!safeId) return null;
  return spindle.storage.getJson(runPath(safeId), { fallback: null });
}

function sanitizeConnection(connection) {
  return {
    id: String(connection?.id ?? ""),
    name: String(connection?.name ?? connection?.id ?? "Unnamed connection"),
    provider: String(connection?.provider ?? ""),
    model: String(connection?.model ?? ""),
    isDefault: connection?.is_default === true,
    preset: typeof connection?.preset === "string" ? connection.preset : "",
  };
}

async function listConnections(userId) {
  if (!spindle.permissions.has("generation")) {
    return { connections: [], permissionGranted: false, error: "Generation permission is not granted." };
  }
  try {
    const listed = await spindle.connections.list(userId);
    return {
      connections: (Array.isArray(listed) ? listed : []).map(sanitizeConnection).filter((item) => item.id && item.provider),
      permissionGranted: true,
      error: "",
    };
  } catch (error) {
    return { connections: [], permissionGranted: true, error: String(error?.message ?? error) };
  }
}

async function resolveConnectionTarget(value, userId) {
  const target = normalizeModelTarget(value);
  if (!target.connectionId) return target;
  let connection = null;
  try { connection = await spindle.connections.get(target.connectionId, userId); } catch { /* validated below */ }
  if (!connection) return target;
  return {
    ...target,
    connectionName: String(connection.name ?? target.connectionName ?? target.connectionId),
    provider: String(connection.provider ?? target.provider),
    model: target.model || String(connection.model ?? ""),
  };
}

async function resolveJudge(value, userId) {
  const judge = normalizeJudge(value);
  if (!judge.enabled || !judge.connectionId) return judge;
  let connection = null;
  try { connection = await spindle.connections.get(judge.connectionId, userId); } catch { /* validated below */ }
  if (!connection) return judge;
  return {
    ...judge,
    connectionName: String(connection.name ?? judge.connectionName ?? judge.connectionId),
    provider: String(connection.provider ?? judge.provider),
    model: judge.model || String(connection.model ?? ""),
  };
}

async function bootstrap(userId) {
  const [connectionResult, history, savedConfig] = await Promise.all([
    listConnections(userId),
    loadHistory(),
    spindle.storage.getJson("config.json", { fallback: null }),
  ]);
  send({
    type: "evaluator_bootstrap",
    ...connectionResult,
    history: history.runs,
    config: savedConfig,
    suites: suiteCatalog(),
    snapshot: snapshotMetadata(),
    running: activeQueues.has(userKey(userId)),
  }, userId);
}

async function startQueue(payload, userId) {
  const key = userKey(userId);
  if (activeQueues.has(key)) {
    send({ type: "evaluator_error", message: "An evaluation queue is already running." }, userId);
    return;
  }
  if (!spindle.permissions.has("generation")) {
    send({ type: "evaluator_error", message: "Grant generation permission before running benchmarks." }, userId);
    return;
  }
  const queueValues = Array.isArray(payload?.queue) ? payload.queue.slice(0, 20) : [];
  if (!queueValues.length) {
    send({ type: "evaluator_error", message: "Add at least one model to the queue." }, userId);
    return;
  }

  const controller = new AbortController();
  activeQueues.set(key, { controller, currentRunId: "" });
  const completed = [];
  send({ type: "evaluator_queue_started", totalModels: queueValues.length }, userId);

  try {
    for (const [queueIndex, value] of queueValues.entries()) {
      if (controller.signal.aborted) break;
      const target = await resolveConnectionTarget(value, userId);
      const judge = await resolveJudge(payload?.judge, userId);
      const validationErrors = validateRunRequest(target, judge);
      if (validationErrors.length) {
        send({
          type: "evaluator_model_rejected",
          queueIndex,
          target,
          message: validationErrors.join(" "),
        }, userId);
        continue;
      }

      const run = createRun(target, judge);
      activeQueues.get(key).currentRunId = run.id;
      await persistRun(run);
      send({
        type: "evaluator_run_started",
        queueIndex,
        totalModels: queueValues.length,
        run: summarizeRun(run),
      }, userId);

      const finished = await executeRun(spindle, run, {
        userId,
        signal: controller.signal,
        timeoutMs: Number(payload?.timeoutMs) || 180_000,
        hooks: {
          persist: persistRun,
          progress(progress) {
            send({
              type: "evaluator_progress",
              queueIndex,
              totalModels: queueValues.length,
              runId: run.id,
              model: run.target.model,
              ...progress,
            }, userId);
          },
          result(result) {
            send({
              type: "evaluator_result",
              runId: run.id,
              resultId: result.resultId,
              family: result.family,
              score: result.score?.score ?? null,
              status: result.runtime.status,
            }, userId);
          },
        },
      });
      completed.push(summarizeRun(finished));
      send({ type: "evaluator_run_complete", run: finished }, userId);
      if (controller.signal.aborted) break;
    }
  } catch (error) {
    spindle.log.error(`Model Evaluator queue failed: ${String(error?.stack ?? error)}`);
    send({ type: "evaluator_error", message: String(error?.message ?? error) }, userId);
  } finally {
    activeQueues.delete(key);
    send({
      type: "evaluator_queue_complete",
      stopped: controller.signal.aborted,
      runs: completed,
    }, userId);
  }
}

spindle.onFrontendMessage(async (payload, userId) => {
  frontendUsers.add(userKey(userId));
  const type = payload?.type;
  if (type === "evaluator_bootstrap_request" || type === "evaluator_refresh_connections") {
    await bootstrap(userId);
  } else if (type === "evaluator_save_config") {
    await spindle.storage.setJson("config.json", payload.config ?? {}, { indent: 2 });
    send({ type: "evaluator_config_saved" }, userId);
  } else if (type === "evaluator_run_queue") {
    void startQueue(payload, userId);
  } else if (type === "evaluator_stop") {
    const active = activeQueues.get(userKey(userId));
    if (active) active.controller.abort();
  } else if (type === "evaluator_get_run") {
    const run = await loadRun(payload.id);
    send(run
      ? { type: "evaluator_run_detail", run }
      : { type: "evaluator_error", message: "That stored run could not be found." }, userId);
  }
});

spindle.permissions.onChanged(({ permission }) => {
  if (permission !== "generation") return;
  for (const key of frontendUsers) {
    const userId = key === "__default__" ? undefined : key;
    void bootstrap(userId);
  }
});

spindle.log.info("Date Simulator Model Evaluator loaded in headless mode.");
