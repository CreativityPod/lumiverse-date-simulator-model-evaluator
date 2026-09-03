export const EVALUATOR_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V3"/><path d="M2 19h22"/></svg>';

const READINESS_LABELS = {
  ready: "Ready for Date Simulator",
  partially_compatible: "Partially compatible",
  not_ready_numbered_questions: "Not ready: numbered questions",
  not_ready_private_profile: "Not ready: private profile",
  not_ready_critical: "Not ready: critical failure",
};

const GATE_LABELS = {
  numbered_questions: "Numbered questions",
  number_locality: "Number-only locality",
  private_profile: "Private profile",
  routine_discipline: "Routine format",
  user_agency: "User agency",
  age_safety: "Adult/Teen safety",
  continuity: "Basic continuity",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className = "") {
  const node = element("button", `dme-button ${className}`.trim(), label);
  node.type = "button";
  return node;
}

function field(label, hint = "") {
  const wrapper = element("label", "dme-field");
  const title = element("span", "dme-label", label);
  const slot = element("div", "dme-control-slot");
  wrapper.append(title, slot);
  if (hint) wrapper.appendChild(element("span", "dme-hint", hint));
  return { wrapper, slot };
}

function select(options, value = "") {
  const node = element("select", "dme-input");
  for (const option of options) {
    const item = element("option", "", option.label);
    item.value = option.value;
    node.appendChild(item);
  }
  node.value = value;
  return node;
}

function input(type, value, attributes = {}) {
  const node = element("input", "dme-input");
  node.type = type;
  node.value = String(value ?? "");
  for (const [key, item] of Object.entries(attributes)) node.setAttribute(key, String(item));
  return node;
}

export function readinessPresentation(aggregate) {
  const readiness = aggregate?.readiness ?? "partially_compatible";
  return {
    code: readiness,
    label: READINESS_LABELS[readiness] ?? "Compatibility unknown",
    state: readiness === "ready" ? "pass" : readiness === "partially_compatible" ? "inconclusive" : "fail",
  };
}

export function scoreBand(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return { label: "Not scored", state: "inconclusive" };
  const score = Number(value);
  if (score >= 85) return { label: "Excellent", state: "pass" };
  if (score >= 70) return { label: "Strong", state: "pass" };
  if (score >= 55) return { label: "Mixed", state: "inconclusive" };
  return { label: "Weak", state: "fail" };
}

export function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function scoreValue(family, run) {
  if (run?.schemaVersion >= 2) return family?.subjectiveScore ?? null;
  return family?.subjectiveScore ?? family?.objectiveScore ?? null;
}

export function missingScoreReason(run, family) {
  const results = (run.results ?? []).filter((result) => result.family === family);
  const complete = results.filter((result) => result.runtime?.status === "success");
  if (!complete.length && results.length) return `No completed response to score. ${results[0].completion?.detail || results[0].runtime?.error || "Review the target response diagnostics."}`;
  if (family === "date_simulator") return "No completed protocol checks are available for this report.";
  if (!run.judge?.enabled) return "Enable a semantic judge, then grade these saved responses to get a quality score.";
  if (run.judge.status === "calibration_failed") return "The previous evaluator stopped all grading after a judge sanity-check failure. Grade these saved responses with the updated evaluator.";
  if (["pending", "running"].includes(run.judge.status)) return "Semantic grading is still in progress.";
  const truncated = run.judge.attempts?.some((attempt) => complete.some((result) => result.resultId === attempt.resultId) && attempt.completion?.status === "truncated");
  if (truncated) return `Judge output reached its ${run.judge.maxTokens ?? "configured"}-token limit before this score was complete. Increase the judge output allowance (for example, 8,192 tokens for a reasoning model), then grade saved responses.`;
  const error = run.judge.errors?.find((message) => complete.some((result) => message.startsWith(result.resultId))) ?? run.judge.errors?.[0];
  return error ? `Judge could not complete this score: ${error}` : "The judge returned no usable quality ratings. Grade saved responses to retry without rerunning the target model.";
}

export function comparisonKey(run) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  };
  const settings = (value = {}) => ({
    temperature: value.temperature, maxTokens: value.maxTokens, reasoning: value.reasoning,
    parameters: value.parameters, tokenParameter: value.tokenParameter, timeoutMs: value.timeoutMs,
    evaluationMode: value.evaluationMode,
  });
  return JSON.stringify(canonical({
    schema: run.schemaVersion ?? 1, snapshot: run.snapshot?.fingerprint, compiler: run.snapshot?.compilerVersion,
    suite: run.suite, scorer: run.aggregate?.scoringVersion, target: settings(run.target),
    judge: run.judge?.enabled ? {
      provider: run.judge.provider, connectionId: run.judge.connectionId, model: run.judge.model,
      official: run.judge.official, rubric: run.judge.rubricVersion, calibrate: run.judge.calibrate, settings: settings(run.judge),
    } : null,
  }));
}

export function resultVerdict(result, run) {
  if (result.runtime?.status !== "success") return "inconclusive";
  if (!(run?.schemaVersion >= 2)) return result.score?.passed == null ? "inconclusive" : result.score.passed ? "pass" : "fail";
  const judged = run.judge?.items?.find((item) => item.id === result.resultId)?.criteria ?? [];
  const expected = result.criteria ?? [];
  const findings = [...(result.score?.assertions ?? []), ...judged];
  if (findings.some((item) => item.verdict === "fail")) return "fail";
  if (judged.length !== expected.length || !findings.length || findings.some((item) => item.verdict !== "pass")) return "inconclusive";
  return "pass";
}

export function gatePresentation(run, gate) {
  let verdict = run.aggregate?.gates?.[gate] ?? "inconclusive";
  // Older reports used "inconclusive" both for missing tests and runtime errors.
  // Correct the display only when the stored evidence proves there was no test.
  if (verdict === "inconclusive" && run.status === "complete" && Array.isArray(run.results)
    && !run.results.some((result) => result.gates?.includes(gate))) {
    verdict = "not_tested";
  }
  return {
    verdict,
    detail: verdict === "not_tested"
      ? "No test result was recorded for this check; it was not run in this report."
      : verdict === "inconclusive"
        ? "No usable verdict is available. Inspect this check's results for runtime errors or unresolved assertions."
        : "",
  };
}

export function scoreDistribution(run, family) {
  const results = (run.results ?? [])
    .filter((result) => result.family === family && result.runtime?.status === "success" && Number.isFinite(result.score?.score))
    .sort((a, b) => a.score.score - b.score.score);
  const groups = [];
  for (const result of results) {
    const score = result.score.score;
    const last = groups.at(-1);
    if (last?.score === score) last.results.push(result);
    else groups.push({ score, results: [result] });
  }
  const values = results.map((result) => result.score.score);
  const middle = Math.floor(values.length / 2);
  return {
    count: values.length,
    mean: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    median: values.length ? (values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2)) : null,
    minimum: values[0] ?? null,
    maximum: values.at(-1) ?? null,
    groups: groups.map((group) => ({ ...group, count: group.results.length })),
  };
}

function createBar(label, value, note = "") {
  const row = element("div", "dme-bar-row");
  const head = element("div", "dme-bar-head");
  head.append(element("span", "", label), element("strong", "", value == null ? "—" : `${Math.round(value)}`));
  const track = element("div", "dme-bar-track");
  const fill = element("div", "dme-bar-fill");
  fill.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
  track.appendChild(fill);
  row.append(head, track);
  if (note) row.appendChild(element("div", "dme-hint", note));
  return row;
}

function scoreDistributionStrip(run, family, label) {
  const data = scoreDistribution(run, family);
  const row = element("div", "dme-distribution-row");
  const head = element("div", "dme-distribution-head");
  if (!data.count) {
    head.append(element("span", "", label), element("span", "dme-hint", "No completed, scored results"));
    row.appendChild(head);
    return row;
  }
  head.append(element("span", "", label), element("span", "dme-hint", `${data.count} result${data.count === 1 ? "" : "s"} · Mean ${data.mean} · Median ${data.median} · Range ${data.minimum}–${data.maximum}`));
  const strip = element("div", "dme-score-strip");
  const track = element("div", "dme-score-track");
  strip.appendChild(track);
  const lanes = [];
  const breakdown = element("div", "dme-score-breakdown");
  for (const group of data.groups) {
    // Stagger nearby score groups so count badges remain distinct on narrow modals.
    let lane = lanes.findIndex((lastScore) => group.score - lastScore >= 12);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = group.score;
    const description = `${group.count} result${group.count === 1 ? "" : "s"} at ${group.score}`;
    const dot = element("span", "dme-score-count", String(group.count));
    dot.style.left = `${group.score}%`;
    dot.style.top = `${lane * 28}px`;
    dot.tabIndex = 0;
    dot.title = `${description}\n${group.results.map((result) => `${result.testId || label}${result.repetition ? ` · repetition ${result.repetition}` : ""}${result.title ? ` · ${result.title}` : ""}`).join("\n")}`;
    dot.setAttribute("aria-label", dot.title);
    strip.appendChild(dot);
    const item = element("span", "dme-score-bucket", description);
    breakdown.appendChild(item);
  }
  strip.style.height = `${lanes.length * 28 + 24}px`;
  const mean = element("span", "dme-score-mean");
  mean.style.left = `${data.mean}%`;
  mean.title = `Mean objective score: ${data.mean}`;
  mean.setAttribute("aria-label", mean.title);
  strip.appendChild(mean);
  const axis = element("div", "dme-score-axis");
  for (const tick of [0, 50, 100]) axis.appendChild(element("span", "", String(tick)));
  row.append(head, strip, axis, breakdown);
  return row;
}

function verdictBadge(verdict, label = "") {
  const icons = { pass: "✓", fail: "!", inconclusive: "?", not_applicable: "–", not_tested: "–" };
  const names = { not_tested: "Not tested", not_applicable: "Not applicable" };
  return element("span", `dme-verdict dme-${verdict}`, `${icons[verdict] ?? "?"} ${label || names[verdict] || verdict}`);
}

function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function confirmAction(ctx, { title, message, confirmLabel, onConfirm }) {
  const modal = ctx.ui.showModal({ title, width: 460, maxHeight: 360, persistent: true });
  const body = element("div", "dme-confirm");
  body.appendChild(element("p", "", message));
  const actions = element("div", "dme-actions dme-confirm-actions");
  const cancel = button("Cancel");
  const confirm = button(confirmLabel, "dme-danger");
  cancel.addEventListener("click", () => modal.dismiss());
  confirm.addEventListener("click", () => {
    confirm.disabled = true;
    cancel.disabled = true;
    onConfirm();
    modal.dismiss();
  });
  actions.append(cancel, confirm);
  body.appendChild(actions);
  modal.root.appendChild(body);
}

function reportEnvironment(run) {
  const grid = element("dl", "dme-env-grid");
  const values = [
    ["Connection", run.target.connectionName || run.target.connectionId],
    ["Provider", run.target.provider],
    ["Model", run.target.model],
    ["Suite", `${run.suite.name} · ${run.suite.repetitions} repetition${run.suite.repetitions === 1 ? "" : "s"}`],
    ["Temperature", run.target.temperature == null ? "Provider default" : String(run.target.temperature)],
    ["Evaluation mode", run.target.evaluationMode || "Legacy"],
    ["Timeout", formatDuration(run.target.timeoutMs ?? 180000)],
    ["Output parameter", run.target.tokenParameter || "max_tokens"],
    ["Additional parameters", JSON.stringify(run.target.parameters ?? {})],
    ["Benchmark / scorer", `${run.suite.benchmarkVersion ?? "Legacy"} / ${run.aggregate?.scoringVersion ?? "Legacy"}`],
    ["Maximum output", `${run.target.maxTokens} tokens`],
    ["Reasoning", run.target.reasoning],
    ["Snapshot", run.snapshot.snapshotVersion],
    ["Snapshot fingerprint", run.snapshot.fingerprint],
    ["Source SHA-256", run.snapshot.sourceSha256],
    ["Judge", run.judge?.enabled ? `${run.judge.provider} / ${run.judge.model} · ${run.judge.status}` : "Deterministic only"],
    ["Judge settings", run.judge?.enabled ? JSON.stringify({ temperature: run.judge.temperature ?? "provider default", maxTokens: run.judge.maxTokens, timeoutMs: run.judge.timeoutMs, reasoning: run.judge.reasoning, parameters: run.judge.parameters }) : "Not assessed"],
    ["Judge sanity check", run.judge?.calibration ? `${run.judge.calibration.status} · ${run.judge.calibration.passed}/${run.judge.calibration.total}` : "Not run"],
    ["Judge independence", run.judge?.enabled ? run.judge.official ? "Different model ID enforced; aliases and shared model families require review" : "Exploratory; self-judging allowed" : "No semantic grading"],
    ["Evidence source", run.sourceRunId ? `Regraded saved run ${run.sourceRunId}; token usage below is for new judge calls only` : "Fresh target generation"],
    ["Duration", formatDuration(run.durationMs)],
    ["Tokens", `${run.usage?.inputTokens ?? 0} in · ${run.usage?.outputTokens ?? 0} out`],
  ];
  for (const [label, value] of values) {
    grid.append(element("dt", "", label), element("dd", "", value || "—"));
  }
  if (run.judge?.calibration || run.judge?.errors?.length) {
    const diagnostic = element("details", "dme-raw");
    diagnostic.append(element("summary", "", "Judge calibration and errors"), element("pre", "dme-raw-text", JSON.stringify({ calibration: run.judge.calibration, errors: run.judge.errors }, null, 2)));
    grid.append(element("dt", "", "Judge diagnostics"), diagnostic);
  }
  return grid;
}

export function overviewReport(run) {
  const root = element("div", "dme-report-view");
  const aggregate = run.aggregate ?? {};
  const readiness = readinessPresentation(aggregate);
  const hero = element("section", `dme-report-hero dme-report-${readiness.state}`);
  hero.append(
    verdictBadge(readiness.state, readiness.label),
    element("p", "", `Completed ${aggregate.completedTests ?? 0}/${run.suite?.targetCalls ?? aggregate.attemptedTests ?? 0} target calls · ${aggregate.incompleteTests ?? 0} incomplete (${aggregate.truncatedTests ?? 0} truncated, ${aggregate.emptyTests ?? 0} empty) · ${aggregate.runtimeErrors ?? 0} errors.`),
  );

  const scoreGrid = element("section", "dme-score-grid");
  for (const [family, label] of [["date_simulator", "Date Simulator"], ["roleplay", "Roleplay"], ["writing", "Creative writing"]]) {
    const data = aggregate.families?.[family] ?? {};
    const value = run.schemaVersion >= 2 && family === "date_simulator" ? data.objectiveScore : scoreValue(data, run);
    const band = scoreBand(value);
    const card = element("article", "dme-score-card");
    card.append(
      element("span", "dme-score-label", label),
      element("strong", "dme-score-number", value == null ? "Not graded" : `${value}`),
      element("span", `dme-score-band dme-${band.state}`, family === "date_simulator" && run.schemaVersion >= 2 ? "Protocol checks" : band.label),
      element("span", "dme-hint", run.schemaVersion >= 2
        ? family === "date_simulator" ? "Mechanical compliance; semantic behavior is shown separately below" : "Contextual quality rating (assessed criteria only)"
        : "Legacy score; includes keyword-based checks"),
      element("span", "dme-hint", run.schemaVersion >= 2
        ? `Behavior ${data.behaviorCoverage?.assessed ?? 0}/${data.behaviorCoverage?.total ?? 0} · Quality ${data.qualityCoverage?.assessed ?? 0}/${data.qualityCoverage?.total ?? 0} assessed` : "Not comparable to version 2 scoring"),
    );
    if (value == null) card.appendChild(element("p", "dme-hint", missingScoreReason(run, family)));
    if (family === "date_simulator" && run.schemaVersion >= 2) card.appendChild(element("span", "dme-hint", `Semantic behavior: ${data.behaviorScore == null ? "Not graded" : `${data.behaviorScore}/100`}`));
    if (run.judge?.calibration?.status === "failed") card.appendChild(element("span", "dme-hint", "Semantic grades are provisional: judge sanity check had disagreements/errors."));
    scoreGrid.appendChild(card);
  }

  const gates = element("section", "dme-report-section");
  gates.appendChild(element("h3", "", "Date Simulator readiness gates"));
  const gateGrid = element("div", "dme-gate-grid");
  for (const [key, label] of Object.entries(GATE_LABELS)) {
    const { verdict, detail } = gatePresentation(run, key);
    const row = element("div", "dme-gate");
    if (detail) row.title = detail;
    row.append(verdictBadge(verdict), element("span", "", label));
    gateGrid.appendChild(row);
  }
  gates.appendChild(gateGrid);
  gates.appendChild(element("p", "dme-hint", "Not tested: no test was run. Inconclusive: no usable verdict. A pass requires all associated criteria to pass. Incomplete or ungraded requirements cannot pass a gate."));

  const profiles = element("section", "dme-report-section");
  profiles.appendChild(element("h3", "", "Capability profile"));
  profiles.append(
    createBar("Date Simulator protocol", aggregate.families?.date_simulator?.objectiveScore, "Mechanical format checks on completed outputs"),
    createBar("Roleplay task compliance", aggregate.families?.roleplay?.behaviorScore, "Semantic requirements; separate from prose quality"),
    createBar("Writing task compliance", aggregate.families?.writing?.behaviorScore, "Semantic requirements; separate from prose quality"),
    createBar("Roleplay", scoreValue(aggregate.families?.roleplay, run), aggregate.families?.roleplay?.subjectiveScore != null ? "Independent rubric" : "Quality not assessed"),
    createBar("Creative writing", scoreValue(aggregate.families?.writing, run), aggregate.families?.writing?.subjectiveScore != null ? "Independent rubric" : "Quality not assessed"),
  );
  const distribution = element("section", "dme-report-section");
  distribution.appendChild(element("h3", "", "Mechanical score distribution across completed tests"));
  distribution.appendChild(element("p", "dme-hint", "These are protocol and length checks, not semantic quality. Each result is one completed test attempt, including repetitions. Numbered circles count results at each score; the diamond marks the mean (average). Median is the middle score; range is lowest–highest. This shows variation across tests, not repeat-run reliability."));
  distribution.append(
    scoreDistributionStrip(run, "date_simulator", "Date Simulator objective"),
    scoreDistributionStrip(run, "roleplay", "Roleplay objective"),
    scoreDistributionStrip(run, "writing", "Writing objective"),
  );
  root.append(hero, scoreGrid, gates, profiles, distribution);
  if (run.schemaVersion >= 2) {
    root.appendChild(element("p", "dme-hint", "LLM judgments are estimates, not human validation. Inspect evidence, compare paraphrases and failures, and calibrate your chosen judge on the supplied review corpus before relying on rankings. Inherited connection settings and server defaults can affect comparability."));
    for (const warning of run.judge?.warnings ?? []) root.appendChild(element("p", "dme-comparison-warning", warning));
    if (!run.judge?.enabled || run.judge.status !== "complete") root.appendChild(element("p", "dme-comparison-warning", `Semantic grading: ${run.judge?.status ?? "disabled"}. Unassessed criteria are excluded from percentages and remain visible in coverage.`));
  }
  return root;
}

export function evidenceReport(run, family) {
  const root = element("div", "dme-report-view");
  const results = (run.results ?? []).filter((result) => result.family === family);
  if (!results.length) {
    root.appendChild(element("p", "dme-empty", "No results are available for this section."));
    return root;
  }
  for (const result of results) {
    const details = element("details", "dme-result");
    const summary = element("summary", "dme-result-summary");
    const verdict = resultVerdict(result, run);
    summary.append(
      verdictBadge(verdict),
      element("span", "dme-result-title", `${result.testId} · ${result.title} · repetition ${result.repetition ?? 1}${result.turn ? ` · turn ${result.turn}` : ""}`),
      element("span", "dme-result-score", result.score?.score == null ? "—" : `${result.score.score}`),
    );
    const body = element("div", "dme-result-body");
    if (result.runtime?.status !== "success") {
      body.appendChild(element("p", "dme-error", result.runtime?.error || result.completion?.detail || "Provider/runtime error"));
    }
    for (const item of result.score?.assertions ?? []) {
      const finding = element("article", "dme-finding");
      const heading = element("div", "dme-finding-head");
      heading.append(verdictBadge(item.verdict), element("strong", "", item.label), element("span", "dme-severity", item.severity));
      finding.append(heading, element("p", "", item.detail || `${item.source} check`));
      if (item.evidence) finding.appendChild(element("pre", "dme-evidence", item.evidence));
      body.appendChild(finding);
    }
    const judgeItem = run.judge?.items?.find((item) => item.id === result.resultId);
    if (run.schemaVersion >= 2) {
      for (const criterion of result.criteria ?? []) {
        const item = judgeItem?.criteria?.find((entry) => entry.id === criterion.id);
        const finding = element("article", "dme-finding dme-judge-finding");
        const heading = element("div", "dme-finding-head");
        heading.append(verdictBadge(item?.verdict === "uncertain" ? "inconclusive" : item?.verdict ?? "inconclusive", item?.verdict ?? "Not assessed"), element("strong", "", criterion.label));
        finding.append(heading, element("p", "dme-hint", criterion.instruction));
        if (item) {
          finding.appendChild(element("p", "", `${item.rating == null ? "" : `${item.rating}/4 · `}${item.reason}`));
          finding.appendChild(element("pre", "dme-evidence", item.evidence ? `${item.evidenceSource === "unverified" ? "Unverified quote" : item.evidenceSource}: ${item.evidence}` : item.evidenceSource === "absence" ? "Absence assessed across response" : "Rationale-based judgment; no quote supplied"));
        }
        body.appendChild(finding);
      }
    } else if (judgeItem) {
      const judge = element("article", "dme-finding dme-judge-finding");
      judge.append(element("strong", "", `Legacy judge score ${judgeItem.score}`), element("p", "", judgeItem.reason), element("pre", "dme-evidence", judgeItem.evidence));
      body.appendChild(judge);
    }
    const responseDetails = element("details", "dme-raw");
    responseDetails.append(element("summary", "", "Raw target response"), element("pre", "dme-raw-text", result.response?.content || "No response captured."));
    body.appendChild(responseDetails);
    for (const [label, value] of [
      ["Reasoning, finish reason, usage and request parameters", { completion: result.completion, response: { ...result.response, content: undefined }, request: result.request }],
      ["Exact target conversation", run.prompts?.[result.promptRef]],
      ["Judge attempts and diagnostics", run.judge?.attempts?.filter((item) => item.resultId === result.resultId)],
    ]) {
      if (value == null) continue;
      const diagnostic = element("details", "dme-raw");
      diagnostic.append(element("summary", "", label), element("pre", "dme-raw-text", JSON.stringify(value, null, 2)));
      body.appendChild(diagnostic);
    }
    details.append(summary, body);
    root.appendChild(details);
  }
  return root;
}

function openRunReport(ctx, run, callbacks = {}) {
  const modal = ctx.ui.showModal({
    title: "Model Evaluator report",
    width: 980,
    maxHeight: 820,
    persistent: false,
  });
  const shell = element("div", "dme-report");
  const context = element("header", "dme-report-context");
  context.append(
    element("div", "dme-report-model", run.target.model),
    element("div", "dme-report-subtitle", `${run.target.connectionName || run.target.provider} · ${run.suite.name} · ${new Date(run.startedAt).toLocaleString()}`),
  );
  const reportActions = element("div", "dme-report-actions");
  const deleteReport = button("Delete this report", "dme-danger");
  deleteReport.addEventListener("click", () => {
    callbacks.requestDelete?.(run, () => modal.dismiss());
  });
  const gradeSaved = button(run.judge?.items?.length ? "Regrade saved responses" : "Grade saved responses", "dme-primary");
  gradeSaved.disabled = !(run.schemaVersion >= 2) || !(run.results ?? []).some((result) => result.runtime?.status === "success");
  gradeSaved.title = "Use the judge selected in Evaluator settings. Makes judge calls only; preserves the original report and target responses.";
  gradeSaved.addEventListener("click", () => callbacks.requestGrade?.(run, () => modal.dismiss()));
  const exportSummary = button("Export summary JSON");
  exportSummary.addEventListener("click", () => downloadJson(`model-evaluator-${run.id}-summary.json`, {
    id: run.id,
    schemaVersion: run.schemaVersion,
    status: run.status,
    target: run.target,
    suite: run.suite,
    snapshot: run.snapshot,
    aggregate: run.aggregate,
    judge: run.judge ? { ...run.judge, items: undefined, attempts: undefined, calibration: run.judge.calibration ? { ...run.judge.calibration, attempts: undefined } : undefined } : null,
    durationMs: run.durationMs,
    usage: run.usage,
  }));
  const exportFull = button("Export full evidence");
  exportFull.addEventListener("click", () => downloadJson(`model-evaluator-${run.id}-full.json`, run));
  reportActions.append(gradeSaved, deleteReport, exportSummary, exportFull);
  context.appendChild(reportActions);

  const tabs = element("div", "dme-report-tabs");
  tabs.setAttribute("role", "tablist");
  const body = element("div", "dme-report-body");
  const views = [
    ["overview", "Overview", () => overviewReport(run)],
    ["date", "Date Simulator", () => evidenceReport(run, "date_simulator")],
    ["roleplay", "Roleplay", () => evidenceReport(run, "roleplay")],
    ["writing", "Writing", () => evidenceReport(run, "writing")],
    ["environment", "Environment", () => reportEnvironment(run)],
  ];
  function activate(id) {
    for (const tabButton of tabs.children) {
      const active = tabButton.dataset.tab === id;
      tabButton.setAttribute("aria-selected", String(active));
      tabButton.classList.toggle("dme-active", active);
    }
    body.replaceChildren(views.find((view) => view[0] === id)[2]());
  }
  for (const [id, label] of views) {
    const tabButton = button(label, "dme-tab");
    tabButton.dataset.tab = id;
    tabButton.setAttribute("role", "tab");
    tabButton.addEventListener("click", () => activate(id));
    tabs.appendChild(tabButton);
  }
  shell.append(context, tabs, body);
  modal.root.appendChild(shell);
  activate("overview");
}

function openComparisonReport(ctx, runs) {
  const modal = ctx.ui.showModal({ title: "Model comparison", width: 980, maxHeight: 780, persistent: false });
  const root = element("div", "dme-report dme-comparison");
  const baseline = comparisonKey(runs[0] ?? {});
  const directlyComparable = runs.every((run) => comparisonKey(run) === baseline);
  root.appendChild(element(
    "p",
    directlyComparable ? "dme-report-subtitle" : "dme-comparison-warning",
    directlyComparable
      ? "Recorded settings match. Compare completion and grading coverage before ranking; inherited provider defaults may differ."
      : "Comparison contains different suites, parameters, snapshots, or judges. Rows are shown for inspection but are not directly rank-comparable.",
  ));
  const table = element("div", "dme-compare-table");
  const header = element("div", "dme-compare-row dme-compare-head");
  for (const label of ["Model", "Readiness", "Date protocol", "RP quality", "Writing quality", "Complete", "Time"]) header.appendChild(element("span", "", label));
  table.appendChild(header);
  for (const run of runs) {
    const row = element("div", "dme-compare-row");
    const readiness = readinessPresentation(run.aggregate);
    row.append(
      element("strong", "", run.target.model),
      verdictBadge(readiness.state, readiness.label),
      element("span", "", (run.schemaVersion >= 2 ? run.aggregate?.families?.date_simulator?.objectiveScore : null) ?? "—"),
      element("span", "", (run.schemaVersion >= 2 ? scoreValue(run.aggregate?.families?.roleplay, run) : null) ?? "—"),
      element("span", "", (run.schemaVersion >= 2 ? scoreValue(run.aggregate?.families?.writing, run) : null) ?? "—"),
      element("span", "", `${run.aggregate?.completedTests ?? 0}/${run.suite?.targetCalls ?? "?"}`),
      element("span", "", formatDuration(run.durationMs)),
    );
    table.appendChild(row);
    const coverage = Object.entries(run.aggregate?.families ?? {}).map(([name, data]) => `${name}: behavior ${data.behaviorCoverage?.assessed ?? "?"}/${data.behaviorCoverage?.total ?? "?"}, quality ${data.qualityCoverage?.assessed ?? "?"}/${data.qualityCoverage?.total ?? "?"}`).join(" · ");
    table.appendChild(element("p", "dme-hint", `${run.target.model} · ${run.schemaVersion >= 2 ? coverage : "Legacy keyword scoring; open original report for scores"}`));
  }
  root.appendChild(table);
  modal.root.appendChild(root);
}

function generationControls(grid, prefix, seconds) {
  const timeoutField = field(`${prefix} timeout (seconds)`, "Increase for slow local inference; Stop remains available.");
  const timeout = input("number", seconds, { min: 10, max: 1800, step: 1 });
  timeoutField.slot.appendChild(timeout);
  const tokenField = field(`${prefix} output parameter`, "Normally max_tokens; choose max_completion_tokens only if your OpenAI-compatible endpoint requires it.");
  const token = select([{ value: "max_tokens", label: "max_tokens (native adapters translate)" }, { value: "max_completion_tokens", label: "max_completion_tokens" }], "max_tokens");
  tokenField.slot.appendChild(token);
  const extraField = field(`${prefix} additional parameters (JSON)`, 'Provider-specific sampling or thinking settings, e.g. {"top_p":0.95} or {"chat_template_kwargs":{"enable_thinking":false}}. Support depends on the connection adapter/server.');
  const extra = element("textarea", "dme-input");
  extra.value = "{}";
  extra.setAttribute("rows", "3");
  extraField.slot.appendChild(extra);
  grid.append(timeoutField.wrapper, tokenField.wrapper, extraField.wrapper);
  return {
    nodes: [timeout, token, extra],
    value: () => ({ timeoutMs: Number(timeout.value) * 1000, tokenParameter: token.value, parameters: extra.value || "{}" }),
    restore(value) {
      timeout.value = (value.timeoutMs ?? 300000) / 1000;
      token.value = value.tokenParameter ?? "max_tokens";
      extra.value = typeof value.parameters === "string" ? value.parameters : JSON.stringify(value.parameters ?? {}, null, 2);
    },
  };
}

export function setup(ctx) {
  ctx.deferReady();
  const cleanups = [];
  const mounted = [];
  let connections = [];
  let queue = [];
  let history = [];
  let latestBatch = [];
  let running = false;
  let stopping = false;
  let targetModelHandle = null;
  let judgeModelHandle = null;
  let pendingReportId = "";
  let pendingDeleteId = "";
  let clearingReports = false;
  let countdownInterval = null;

  const removeStyle = ctx.dom.addStyle(`
    .dme-panel { display:flex; flex-direction:column; gap:14px; padding:14px; color:var(--lumiverse-text); }
    .dme-hero { padding:16px; border:1px solid color-mix(in srgb,var(--lumiverse-accent,#8c7cf0) 34%,var(--lumiverse-border)); border-radius:14px; background:linear-gradient(135deg,color-mix(in srgb,var(--lumiverse-accent,#8c7cf0) 16%,transparent),transparent); }
    .dme-hero h2,.dme-section h3,.dme-report-section h3 { margin:0 0 6px; }
    .dme-hero p,.dme-report-hero p { margin:0; color:var(--lumiverse-text-muted); }
    .dme-section { display:flex; flex-direction:column; gap:10px; padding:13px; border:1px solid var(--lumiverse-border); border-radius:12px; background:color-mix(in srgb,var(--lumiverse-bg) 92%,var(--lumiverse-text) 2%); }
    .dme-section-title { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .dme-title-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
    .dme-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .dme-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
    .dme-label { font-size:.84rem; font-weight:650; }
    .dme-hint { color:var(--lumiverse-text-muted); font-size:.76rem; line-height:1.35; overflow-wrap:anywhere; }
    .dme-input { box-sizing:border-box; width:100%; min-height:36px; padding:7px 9px; color:var(--lumiverse-text); background:var(--lumiverse-bg); border:1px solid var(--lumiverse-border); border-radius:8px; }
    .dme-control-slot { min-height:36px; min-width:0; }
    .dme-actions { display:flex; flex-wrap:wrap; gap:8px; }
    .dme-button { appearance:none; border:1px solid var(--lumiverse-border); border-radius:8px; padding:8px 11px; background:color-mix(in srgb,var(--lumiverse-bg) 88%,var(--lumiverse-text) 5%); color:var(--lumiverse-text); cursor:pointer; font-weight:600; }
    .dme-button:hover { border-color:var(--lumiverse-accent,#8c7cf0); }
    .dme-button:disabled { opacity:.5; cursor:not-allowed; }
    .dme-primary { color:white; background:var(--lumiverse-accent,#725fe5); border-color:transparent; }
    .dme-danger { color:var(--lumiverse-danger,#e57979); }
    .dme-inline-check { display:flex; gap:8px; align-items:flex-start; font-size:.86rem; }
    .dme-queue,.dme-history { display:flex; flex-direction:column; gap:8px; }
    .dme-queue-row,.dme-history-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; padding:10px; border:1px solid var(--lumiverse-border); border-radius:9px; }
    .dme-model-id { font-weight:650; overflow-wrap:anywhere; }
    .dme-row-meta { color:var(--lumiverse-text-muted); font-size:.76rem; }
    .dme-icon-button { padding:5px 8px; }
    .dme-status { min-height:46px; padding:10px; border-radius:9px; background:color-mix(in srgb,var(--lumiverse-accent,#8c7cf0) 10%,transparent); }
    .dme-status-heading { display:flex; align-items:flex-start; gap:8px; }
    .dme-spinner { flex:0 0 auto; width:14px; height:14px; margin-top:2px; border:2px solid color-mix(in srgb,var(--lumiverse-accent,#8c7cf0) 25%,transparent); border-top-color:var(--lumiverse-accent,#8c7cf0); border-radius:50%; animation:dme-spin .9s linear infinite; }
    .dme-spinner[hidden],.dme-countdown[hidden] { display:none; }
    .dme-countdown { margin-top:6px; font-size:.8rem; color:var(--lumiverse-text-muted); font-variant-numeric:tabular-nums; }
    @keyframes dme-spin { to { transform:rotate(360deg); } }
    .dme-progress { height:7px; overflow:hidden; border-radius:999px; background:color-mix(in srgb,var(--lumiverse-text) 10%,transparent); margin-top:8px; }
    .dme-progress-fill { height:100%; background:var(--lumiverse-accent,#8c7cf0); transition:width .2s ease; }
    .dme-error { color:var(--lumiverse-danger,#e57979); }
    .dme-empty { color:var(--lumiverse-text-muted); font-style:italic; }
    .dme-report { display:flex; flex-direction:column; min-height:0; color:var(--lumiverse-text); }
    .dme-report-context { padding:15px 16px 10px; border-bottom:1px solid var(--lumiverse-border); }
    .dme-report-model { font-size:1.2rem; font-weight:750; overflow-wrap:anywhere; }
    .dme-report-subtitle { color:var(--lumiverse-text-muted); font-size:.82rem; margin-top:3px; }
    .dme-report-actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
    .dme-confirm { display:flex; flex-direction:column; gap:14px; padding:16px; color:var(--lumiverse-text); }.dme-confirm p { margin:0; line-height:1.5; }.dme-confirm-actions { justify-content:flex-end; }
    .dme-report-tabs { display:flex; gap:4px; padding:8px 12px; overflow:auto; border-bottom:1px solid var(--lumiverse-border); }
    .dme-tab { white-space:nowrap; border-color:transparent; background:transparent; }
    .dme-tab.dme-active { color:var(--lumiverse-accent,#8c7cf0); border-color:var(--lumiverse-accent,#8c7cf0); }
    .dme-report-body { padding:14px 16px 22px; overflow:auto; }
    .dme-report-view { display:flex; flex-direction:column; gap:14px; }
    .dme-report-hero { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; padding:13px; border:1px solid var(--lumiverse-border); border-radius:10px; }
    .dme-report-fail { border-color:color-mix(in srgb,var(--lumiverse-danger,#e57979) 55%,var(--lumiverse-border)); }
    .dme-report-pass { border-color:color-mix(in srgb,var(--lumiverse-success,#70b987) 55%,var(--lumiverse-border)); }
    .dme-score-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    .dme-score-card { display:flex; flex-direction:column; gap:4px; padding:13px; border:1px solid var(--lumiverse-border); border-radius:10px; }
    .dme-score-label { font-size:.82rem; color:var(--lumiverse-text-muted); }
    .dme-score-number { font-size:1.8rem; line-height:1; }
    .dme-score-band { font-size:.8rem; font-weight:650; }
    .dme-report-section { padding:13px; border:1px solid var(--lumiverse-border); border-radius:10px; }
    .dme-gate-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .dme-gate { display:flex; align-items:center; gap:8px; }
    .dme-verdict { display:inline-flex; align-items:center; gap:3px; font-size:.77rem; font-weight:750; white-space:nowrap; }
    .dme-pass { color:var(--lumiverse-success,#70b987); }.dme-fail { color:var(--lumiverse-danger,#e57979); }.dme-inconclusive { color:var(--lumiverse-warning,#d5a85f); }
    .dme-not_tested,.dme-not_applicable { color:var(--lumiverse-text-muted); }
    .dme-bar-row { margin:9px 0; }.dme-bar-head { display:flex; justify-content:space-between; gap:10px; font-size:.83rem; text-transform:capitalize; }
    .dme-bar-track { height:9px; margin-top:4px; background:color-mix(in srgb,var(--lumiverse-text) 10%,transparent); border-radius:999px; overflow:hidden; }
    .dme-bar-fill { height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--lumiverse-accent,#725fe5),color-mix(in srgb,var(--lumiverse-accent,#725fe5) 55%,#5ac8a7)); }
    .dme-distribution-row { margin:18px 0; }.dme-distribution-row:last-child { margin-bottom:0; }
    .dme-distribution-head { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px 14px; font-size:.83rem; }
    .dme-score-strip { position:relative; margin:12px 16px 0; }
    .dme-score-track { position:absolute; inset:0 0 22px; border-radius:8px; background:linear-gradient(90deg,color-mix(in srgb,var(--lumiverse-danger,#e57979) 15%,transparent),color-mix(in srgb,var(--lumiverse-warning,#d5a85f) 15%,transparent),color-mix(in srgb,var(--lumiverse-success,#70b987) 15%,transparent)); }
    .dme-score-count { box-sizing:border-box; position:absolute; display:grid; place-items:center; min-width:24px; height:24px; padding:0 5px; border:2px solid var(--lumiverse-bg); border-radius:999px; background:var(--lumiverse-accent,#725fe5); color:white; font-size:.72rem; font-weight:750; transform:translateX(-50%); }
    .dme-score-count:focus-visible { outline:2px solid var(--lumiverse-text); outline-offset:2px; }
    .dme-score-mean { box-sizing:border-box; position:absolute; bottom:3px; width:10px; height:10px; background:var(--lumiverse-text); border:1px solid var(--lumiverse-bg); transform:translateX(-50%) rotate(45deg); }
    .dme-score-axis { display:flex; justify-content:space-between; margin:2px 12px 7px; font-size:.7rem; color:var(--lumiverse-text-muted); }
    .dme-score-breakdown { display:flex; flex-wrap:wrap; gap:5px; }.dme-score-bucket { padding:3px 7px; border:1px solid var(--lumiverse-border); border-radius:6px; color:var(--lumiverse-text-muted); font-size:.72rem; }
    .dme-result { border:1px solid var(--lumiverse-border); border-radius:10px; overflow:hidden; }
    .dme-result-summary { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:9px; align-items:center; padding:11px; cursor:pointer; }
    .dme-result-title { overflow-wrap:anywhere; }.dme-result-score { font-weight:750; }
    .dme-result-body { display:flex; flex-direction:column; gap:9px; padding:0 11px 12px; }
    .dme-finding { padding:10px; border-radius:8px; background:color-mix(in srgb,var(--lumiverse-text) 4%,transparent); }
    .dme-finding p { margin:6px 0; }.dme-finding-head { display:flex; flex-wrap:wrap; gap:7px; align-items:center; }.dme-severity { color:var(--lumiverse-text-muted); font-size:.72rem; text-transform:uppercase; }
    .dme-evidence,.dme-raw-text { white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; padding:9px; border-radius:7px; background:color-mix(in srgb,var(--lumiverse-bg) 88%,black 5%); font-size:.77rem; }
    .dme-judge-finding { border-left:3px solid var(--lumiverse-accent,#725fe5); }
    .dme-raw summary { cursor:pointer; color:var(--lumiverse-text-muted); }
    .dme-env-grid { display:grid; grid-template-columns:minmax(130px,.35fr) minmax(0,1fr); gap:8px 14px; margin:0; }.dme-env-grid dt { color:var(--lumiverse-text-muted); }.dme-env-grid dd { margin:0; overflow-wrap:anywhere; }
    .dme-compare-table { display:flex; flex-direction:column; border:1px solid var(--lumiverse-border); border-radius:10px; overflow:hidden; }.dme-compare-row { display:grid; grid-template-columns:minmax(150px,1.5fr) minmax(150px,1.4fr) repeat(3,.55fr) .7fr .4fr; gap:8px; align-items:center; padding:10px; border-bottom:1px solid var(--lumiverse-border); }.dme-compare-row:last-child { border-bottom:0; }.dme-compare-head { color:var(--lumiverse-text-muted); font-size:.75rem; font-weight:700; }
    .dme-comparison-warning { padding:10px; color:var(--lumiverse-warning,#d5a85f); border:1px solid currentColor; border-radius:8px; }
    @media(max-width:700px){.dme-grid,.dme-score-grid,.dme-gate-grid{grid-template-columns:1fr}.dme-compare-head{display:none}.dme-compare-row{grid-template-columns:1fr;gap:4px}.dme-report-body{padding:10px}.dme-env-grid{grid-template-columns:1fr}.dme-env-grid dt{margin-top:6px}}
    @media(prefers-reduced-motion:reduce){.dme-progress-fill{transition:none}.dme-spinner{animation:none}}
  `);
  cleanups.push(removeStyle);

  const tab = ctx.ui.registerDrawerTab({
    id: "model-evaluator",
    title: "Date Simulator Model Evaluator",
    shortName: "Evaluator",
    headerTitle: "Model Evaluator",
    description: "Run unattended Date Simulator, roleplay, and writing benchmarks",
    keywords: ["model", "benchmark", "date simulator", "roleplay", "writing"],
    iconSvg: EVALUATOR_ICON_SVG,
  });
  cleanups.push(() => tab.destroy());

  const panel = element("div", "dme-panel");
  const hero = element("section", "dme-hero");
  hero.append(element("h2", "", "Headless model benchmark"), element("p", "", "Select any saved connection and model. Runs stay outside chat and do not change Connect."));

  const targetSection = element("section", "dme-section");
  const targetTitle = element("div", "dme-section-title");
  targetTitle.append(element("h3", "", "Target model"));
  const refreshButton = button("Refresh");
  targetTitle.appendChild(refreshButton);
  const targetGrid = element("div", "dme-grid");
  const connectionField = field("Connection", "Supplies provider, URL, and stored credentials.");
  const modelField = field("Model", "Request-local override; the Connect tab is untouched.");
  const suiteField = field("Suite");
  const temperatureField = field("Temperature", "Leave blank to use the provider default; some reasoning models reject this parameter.");
  const maxTokensField = field("Maximum output tokens", "Reasoning may share this budget. Fit the prompt plus output within the model context window; Date Simulator setup prompts are large. Incomplete outputs remain unscored.");
  const reasoningField = field("Reasoning override");
  const targetConnection = select([], "");
  const suiteSelect = select([
    { value: "quick", label: "Quick · 7 calls" },
    { value: "standard", label: "Standard · 30 calls" },
    { value: "full", label: "Full · 69 calls" },
  ], "quick");
  const temperatureInput = input("number", "", { min: 0, max: 2, step: 0.1 });
  const maxTokensInput = input("number", 16384, { min: 400, max: 262144, step: 1 });
  const reasoningSelect = select([
    { value: "inherit", label: "Inherit connection" },
    { value: "off", label: "Off" },
    { value: "auto", label: "Auto effort" },
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
    { value: "max", label: "Maximum" },
  ], "inherit");
  connectionField.slot.appendChild(targetConnection);
  suiteField.slot.appendChild(suiteSelect);
  temperatureField.slot.appendChild(temperatureInput);
  maxTokensField.slot.appendChild(maxTokensInput);
  reasoningField.slot.appendChild(reasoningSelect);
  targetGrid.append(connectionField.wrapper, modelField.wrapper, suiteField.wrapper, temperatureField.wrapper, maxTokensField.wrapper, reasoningField.wrapper);
  const modeField = field("Comparison mode", "Capability: allow enough headroom. Fixed budget: use identical limits across targets. Neither mode retries automatically.");
  const modeSelect = select([{ value: "capability", label: "Capability" }, { value: "fixed_budget", label: "Fixed output budget" }], "capability");
  modeField.slot.appendChild(modeSelect);
  targetGrid.appendChild(modeField.wrapper);
  const targetAdvanced = generationControls(targetGrid, "Target", 300);
  const targetActions = element("div", "dme-actions");
  const runNowButton = button("Run now", "dme-primary");
  const addButton = button("Add model");
  targetActions.append(runNowButton, addButton);
  targetSection.append(targetTitle, targetGrid, targetActions);

  const judgeDetails = element("details", "dme-section");
  const judgeSummary = element("summary", "dme-section-title");
  judgeSummary.appendChild(element("strong", "", "Semantic judge · local or API"));
  judgeDetails.appendChild(judgeSummary);
  const judgeEnabledLabel = element("label", "dme-inline-check");
  const judgeEnabled = input("checkbox", "");
  judgeEnabled.checked = false;
  judgeEnabledLabel.append(judgeEnabled, element("span", "", "Grade contextual requirements for every test, plus roleplay and writing quality. Without a judge, semantic capability is not assessed. Grades each completed target response; missing or malformed grades get one retry in smaller batches."));
  const calibrationLabel = element("label", "dme-inline-check");
  const calibrationEnabled = input("checkbox", "");
  calibrationEnabled.checked = true;
  calibrationLabel.append(calibrationEnabled, element("span", "", "Check judge with six synthetic examples after grading. Adds six diagnostic calls after grading. Disagreements mark scores provisional; they never block grading."));
  const judgeGrid = element("div", "dme-grid");
  const judgeConnectionField = field("Judge connection");
  const judgeModelField = field("Judge model");
  const judgeConnection = select([], "");
  judgeConnectionField.slot.appendChild(judgeConnection);
  const officialLabel = element("label", "dme-inline-check");
  const officialJudge = input("checkbox", "");
  officialJudge.checked = true;
  officialLabel.append(officialJudge, element("span", "", "Independent mode: reject identical target/judge model IDs across connections. Check aliases and shared model families yourself."));
  judgeGrid.append(judgeConnectionField.wrapper, judgeModelField.wrapper);
  const judgeTemperatureField = field("Judge temperature", "Blank uses the provider default. Choose sampling settings appropriate for this model.");
  const judgeTemperature = input("number", "", { min: 0, max: 2, step: 0.1 });
  judgeTemperatureField.slot.appendChild(judgeTemperature);
  const judgeTokensField = field("Judge maximum output tokens", "Includes reasoning. Older saved limits such as 2,400 can run out before grades are returned; 8,192 is the current default.");
  const judgeTokens = input("number", 8192, { min: 400, max: 262144, step: 1 });
  judgeTokensField.slot.appendChild(judgeTokens);
  const judgeReasoningField = field("Judge reasoning");
  const judgeReasoning = select(["inherit", "off", "auto", "minimal", "low", "medium", "high", "xhigh", "max"].map((value) => ({ value, label: value })), "inherit");
  judgeReasoningField.slot.appendChild(judgeReasoning);
  judgeGrid.append(judgeTemperatureField.wrapper, judgeTokensField.wrapper, judgeReasoningField.wrapper);
  const judgeAdvanced = generationControls(judgeGrid, "Judge", 300);
  judgeDetails.append(judgeEnabledLabel, calibrationLabel, judgeGrid, officialLabel);

  const queueSection = element("section", "dme-section");
  const queueTitle = element("div", "dme-section-title");
  queueTitle.append(element("h3", "", "Comparison queue"));
  const queueCount = element("span", "dme-hint", "0 models");
  queueTitle.appendChild(queueCount);
  const queueList = element("div", "dme-queue");
  const queueActions = element("div", "dme-actions");
  const runSelectedButton = button("Run selected", "dme-primary");
  const clearButton = button("Clear");
  queueActions.append(runSelectedButton, clearButton);
  queueSection.append(queueTitle, queueList, queueActions);

  const runSection = element("section", "dme-section");
  const runTitle = element("h3", "", "Run status");
  const runStatus = element("div", "dme-status");
  const statusHeading = element("div", "dme-status-heading");
  const spinner = element("span", "dme-spinner");
  spinner.hidden = true;
  spinner.setAttribute("aria-hidden", "true");
  const statusText = element("div", "", "Idle. Choose a model or build a comparison queue.");
  statusText.setAttribute("role", "status");
  statusHeading.append(spinner, statusText);
  const countdown = element("div", "dme-countdown");
  countdown.hidden = true;
  // Do not announce a changing second count over the screen reader's status text.
  countdown.setAttribute("aria-live", "off");
  const progress = element("div", "dme-progress");
  const progressFill = element("div", "dme-progress-fill");
  progressFill.style.width = "0%";
  progress.appendChild(progressFill);
  runStatus.append(statusHeading, countdown, progress);
  const stopButton = button("Stop", "dme-danger");
  stopButton.disabled = true;
  runSection.append(runTitle, runStatus, stopButton);

  const historySection = element("section", "dme-section");
  const historyTitle = element("div", "dme-section-title");
  historyTitle.append(element("h3", "", "Recent reports"));
  const historyActions = element("div", "dme-title-actions");
  const compareButton = button("Compare last batch");
  compareButton.disabled = true;
  const clearReportsButton = button("Clear all reports", "dme-danger");
  clearReportsButton.disabled = true;
  historyActions.append(compareButton, clearReportsButton);
  historyTitle.appendChild(historyActions);
  const historyList = element("div", "dme-history");
  historySection.append(historyTitle, historyList);

  panel.append(hero, targetSection, judgeDetails, queueSection, runSection, historySection);
  tab.root.appendChild(panel);

  function selectedConnection(selectNode) {
    return connections.find((connection) => connection.id === selectNode.value) ?? null;
  }

  function mountModel(slot, connection, currentValue, onChange, existing) {
    try { existing?.destroy(); } catch { /* best effort */ }
    slot.replaceChildren();
    if (typeof ctx.components?.mountModelCombobox === "function" && connection?.id) {
      const handle = ctx.components.mountModelCombobox(slot, {
        value: currentValue || connection.model || "",
        connection: { kind: "llm", id: connection.id },
        appearance: "standard",
        placeholder: "Choose or type a model ID",
        emptyMessage: "No model catalog; type a model ID",
        browseHint: "Models from this saved connection",
        onChange,
      });
      mounted.push(handle);
      return handle;
    }
    const fallback = input("text", currentValue || connection?.model || "", { placeholder: "Model ID" });
    fallback.addEventListener("input", () => onChange(fallback.value));
    slot.appendChild(fallback);
    return {
      getValue: () => fallback.value,
      update: ({ value }) => { if (value !== undefined) fallback.value = value; },
      destroy: () => fallback.remove(),
    };
  }

  function remountTargetModel(value = "") {
    targetModelHandle = mountModel(modelField.slot, selectedConnection(targetConnection), value, () => saveConfig(), targetModelHandle);
  }

  function remountJudgeModel(value = "") {
    judgeModelHandle = mountModel(judgeModelField.slot, selectedConnection(judgeConnection), value, () => saveConfig(), judgeModelHandle);
  }

  function modelValue(handle) {
    return String(handle?.getValue?.() ?? "").trim();
  }

  function currentTarget() {
    const connection = selectedConnection(targetConnection);
    return {
      connectionId: connection?.id ?? "",
      connectionName: connection?.name ?? "",
      provider: connection?.provider ?? "",
      model: modelValue(targetModelHandle),
      suite: suiteSelect.value,
      temperature: temperatureInput.value === "" ? null : Number(temperatureInput.value),
      maxTokens: Number(maxTokensInput.value),
      reasoning: reasoningSelect.value,
      evaluationMode: modeSelect.value,
      ...targetAdvanced.value(),
    };
  }

  function currentJudge() {
    const connection = selectedConnection(judgeConnection);
    return {
      enabled: judgeEnabled.checked,
      official: officialJudge.checked,
      calibrate: calibrationEnabled.checked,
      connectionId: connection?.id ?? "",
      connectionName: connection?.name ?? "",
      provider: connection?.provider ?? "",
      model: modelValue(judgeModelHandle),
      reasoning: judgeReasoning.value,
      temperature: judgeTemperature.value === "" ? null : Number(judgeTemperature.value),
      maxTokens: Number(judgeTokens.value),
      ...judgeAdvanced.value(),
    };
  }

  function saveConfig() {
    ctx.sendToBackend({
      type: "evaluator_save_config",
      config: { target: currentTarget(), judge: currentJudge(), queue },
    });
  }

  function renderConnections(savedConfig = null) {
    const targetPrevious = savedConfig?.target?.connectionId || targetConnection.value;
    const judgePrevious = savedConfig?.judge?.connectionId || judgeConnection.value;
    const options = connections.map((connection) => ({
      value: connection.id,
      label: `${connection.name}${connection.isDefault ? " · default" : ""} (${connection.provider})`,
    }));
    for (const node of [targetConnection, judgeConnection]) node.replaceChildren();
    if (!options.length) {
      for (const node of [targetConnection, judgeConnection]) {
        const option = element("option", "", "No connection profiles available");
        option.value = "";
        node.appendChild(option);
      }
    } else {
      for (const node of [targetConnection, judgeConnection]) {
        for (const option of options) {
          const item = element("option", "", option.label);
          item.value = option.value;
          node.appendChild(item);
        }
      }
    }
    const fallbackId = connections.find((item) => item.isDefault)?.id ?? connections[0]?.id ?? "";
    targetConnection.value = connections.some((item) => item.id === targetPrevious) ? targetPrevious : fallbackId;
    judgeConnection.value = connections.some((item) => item.id === judgePrevious) ? judgePrevious : fallbackId;
    remountTargetModel(savedConfig?.target?.model || selectedConnection(targetConnection)?.model || "");
    remountJudgeModel(savedConfig?.judge?.model || selectedConnection(judgeConnection)?.model || "");
  }

  function renderQueue() {
    queueList.replaceChildren();
    queueCount.textContent = `${queue.length} model${queue.length === 1 ? "" : "s"}`;
    runSelectedButton.disabled = running || queue.length === 0;
    clearButton.disabled = running || queue.length === 0;
    if (!queue.length) queueList.appendChild(element("div", "dme-empty", "No queued models. “Run now” does not require a queue."));
    queue.forEach((item, index) => {
      const row = element("div", "dme-queue-row");
      const copy = element("div", "");
      copy.append(element("div", "dme-model-id", item.model), element("div", "dme-row-meta", `${item.connectionName} · ${item.suite} · T ${item.temperature} · ${item.reasoning}`));
      const remove = button("Remove", "dme-icon-button");
      remove.disabled = running;
      remove.addEventListener("click", () => {
        queue.splice(index, 1);
        renderQueue();
        saveConfig();
      });
      row.append(copy, remove);
      queueList.appendChild(row);
    });
  }

  function renderHistory() {
    historyList.replaceChildren();
    compareButton.disabled = running || latestBatch.length < 2;
    clearReportsButton.disabled = running || clearingReports || history.length === 0;
    if (!history.length) historyList.appendChild(element("div", "dme-empty", "Completed reports will appear here."));
    for (const run of history.slice(0, 20)) {
      const row = element("div", "dme-history-row");
      const copy = element("div", "");
      const readiness = readinessPresentation(run.aggregate);
      copy.append(
        element("div", "dme-model-id", run.target?.model || "Unknown model"),
        element("div", "dme-row-meta", `${READINESS_LABELS[run.aggregate?.readiness] ?? run.status} · ${run.suite?.name ?? run.suite?.id} · ${run.startedAt ? new Date(run.startedAt).toLocaleString() : "queued"}`),
      );
      const open = button("Open report", "dme-icon-button");
      open.disabled = running || pendingDeleteId === run.id;
      open.addEventListener("click", () => {
        pendingReportId = run.id;
        open.disabled = true;
        open.textContent = "Loading…";
        ctx.sendToBackend({ type: "evaluator_get_run", id: run.id });
      });
      row.append(copy, open);
      historyList.appendChild(row);
    }
  }

  function setRunning(value) {
    running = value;
    spinner.hidden = !value;
    if (!value) { stopping = false; stopCountdown(); }
    runNowButton.disabled = value;
    addButton.disabled = value;
    stopButton.disabled = !value || stopping;
    renderQueue();
    renderHistory();
  }

  function setStatus(text, percent = null, error = false) {
    statusText.textContent = text;
    statusText.className = error ? "dme-error" : "";
    if (percent != null) progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function stopCountdown() {
    if (countdownInterval !== null) clearInterval(countdownInterval);
    countdownInterval = null;
    countdown.hidden = true;
    countdown.textContent = "";
  }

  function startCountdown(payload) {
    stopCountdown();
    const timeoutMs = Number(payload.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    const startedAt = Number.isFinite(payload.requestStartedAt) ? payload.requestStartedAt : Date.now();
    // Use server-relative elapsed time when available, even if the browser's clock differs.
    const serverNow = Number.isFinite(payload.serverNow) ? payload.serverNow : Date.now();
    const elapsedMs = Math.max(0, serverNow - startedAt);
    const deadline = Date.now() + Math.max(0, timeoutMs - elapsedMs);
    const update = () => {
      // Derive from the deadline, so background-tab throttling does not slow time.
      const remainingMs = Math.min(timeoutMs, Math.max(0, deadline - Date.now()));
      countdown.textContent = remainingMs > 0
        ? `${formatDuration(Math.ceil(remainingMs / 1000) * 1000)} remaining · ${formatDuration(timeoutMs)} request limit`
        : "Request limit reached · waiting for timeout result…";
      if (remainingMs === 0 && countdownInterval !== null) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    };
    countdown.hidden = false;
    update();
    if (Date.now() < deadline) countdownInterval = setInterval(update, 1000);
  }

  function showProgress(payload) {
    if (stopping) return;
    const local = payload.total ? payload.current / payload.total : 0;
    const overall = ((payload.queueIndex ?? 0) + local) / Math.max(1, payload.totalModels ?? 1);
    setStatus(`${payload.model} · ${payload.phase === "judge" ? "Judge" : `Test ${payload.current}/${payload.total}`} · ${payload.label}`, overall * 100);
    startCountdown(payload);
  }

  function launch(items) {
    const valid = items.filter((item) => item.connectionId && item.model);
    if (!valid.length) {
      setStatus("Choose a saved connection and enter a model ID first.", 0, true);
      return;
    }
    try {
      for (const item of [...valid, ...(judgeEnabled.checked ? [currentJudge()] : [])]) {
        const parsed = typeof item.parameters === "string" ? JSON.parse(item.parameters || "{}") : item.parameters ?? {};
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Parameters must be a JSON object.");
        if (!Number.isFinite(Number(item.maxTokens)) || Number(item.maxTokens) < 400) throw new Error("Maximum output must be at least 400 tokens.");
      }
    } catch (error) { setStatus(`Invalid generation settings: ${error.message}`, 0, true); return; }
    latestBatch = [];
    compareButton.disabled = true;
    setRunning(true);
    setStatus("Starting unattended benchmark queue…", 0);
    ctx.sendToBackend({ type: "evaluator_run_queue", queue: valid, judge: currentJudge() });
  }

  function requestGrade(run, afterStart = () => {}) {
    if (running) return;
    const judge = { ...currentJudge(), enabled: true };
    if (!judge.connectionId || !judge.model) {
      setStatus("Select a judge connection and model in Evaluator settings, then grade the saved responses.", 0, true);
      return;
    }
    latestBatch = [];
    setRunning(true);
    setStatus("Grading saved responses with the selected judge. No target calls will be made.", 0);
    ctx.sendToBackend({ type: "evaluator_regrade_run", id: run.id, judge });
    afterStart();
  }

  function requestDelete(run, afterConfirm = () => {}) {
    if (running || !run?.id) return;
    const model = run.target?.model || "this model";
    confirmAction(ctx, {
      title: "Delete report?",
      message: `Delete the selected ${model} report and all of its stored prompts, responses, scores, and evidence? This cannot be undone.`,
      confirmLabel: "Delete this report",
      onConfirm() {
        pendingDeleteId = run.id;
        renderHistory();
        setStatus(`Deleting the selected ${model} report…`);
        ctx.sendToBackend({ type: "evaluator_delete_run", id: run.id });
        afterConfirm();
      },
    });
  }

  function requestClearReports() {
    if (running || clearingReports || history.length === 0) return;
    const count = history.length;
    confirmAction(ctx, {
      title: "Clear all reports?",
      message: `Delete all ${count} indexed report${count === 1 ? "" : "s"} and every stored report file? Evaluator connection, model, judge, and queue settings will be preserved. This cannot be undone.`,
      confirmLabel: "Clear all reports",
      onConfirm() {
        clearingReports = true;
        renderHistory();
        setStatus("Deleting all stored evaluator reports…");
        ctx.sendToBackend({ type: "evaluator_clear_reports" });
      },
    });
  }

  targetConnection.addEventListener("change", () => { remountTargetModel(selectedConnection(targetConnection)?.model || ""); saveConfig(); });
  judgeConnection.addEventListener("change", () => { remountJudgeModel(selectedConnection(judgeConnection)?.model || ""); saveConfig(); });
  for (const node of [suiteSelect, temperatureInput, maxTokensInput, reasoningSelect, modeSelect, judgeEnabled, officialJudge, calibrationEnabled, judgeTemperature, judgeTokens, judgeReasoning, ...targetAdvanced.nodes, ...judgeAdvanced.nodes]) node.addEventListener("change", saveConfig);
  refreshButton.addEventListener("click", () => ctx.sendToBackend({ type: "evaluator_refresh_connections" }));
  addButton.addEventListener("click", () => {
    const target = currentTarget();
    if (!target.connectionId || !target.model) return setStatus("Choose a connection and model before adding it.", 0, true);
    queue.push(target);
    renderQueue();
    saveConfig();
  });
  runNowButton.addEventListener("click", () => launch([currentTarget()]));
  runSelectedButton.addEventListener("click", () => launch(queue));
  clearButton.addEventListener("click", () => { queue = []; renderQueue(); saveConfig(); });
  stopButton.addEventListener("click", () => { stopping = true; stopButton.disabled = true; stopCountdown(); setStatus("Stopping the current test…"); ctx.sendToBackend({ type: "evaluator_stop" }); });
  compareButton.addEventListener("click", () => { if (latestBatch.length) openComparisonReport(ctx, latestBatch); });
  clearReportsButton.addEventListener("click", requestClearReports);

  cleanups.push(tab.onActivate(() => ctx.sendToBackend({ type: "evaluator_bootstrap_request" })));
  cleanups.push(ctx.onBackendMessage((payload) => {
    if (payload?.type === "evaluator_bootstrap") {
      if (Array.isArray(payload.suites)) {
        const selected = suiteSelect.value;
        suiteSelect.replaceChildren();
        for (const suite of payload.suites) {
          const option = element("option", "", `${suite.name} · ${suite.targetCalls} target calls`);
          option.value = suite.id;
          suiteSelect.appendChild(option);
        }
        suiteSelect.value = selected;
      }
      connections = Array.isArray(payload.connections) ? payload.connections : [];
      history = Array.isArray(payload.history) ? payload.history : [];
      const saved = payload.config && typeof payload.config === "object" ? payload.config : null;
      if (saved?.target) {
        suiteSelect.value = saved.target.suite || "quick";
        temperatureInput.value = saved.target.temperature ?? "";
        maxTokensInput.value = saved.target.maxTokens ?? 16384;
        modeSelect.value = saved.target.evaluationMode ?? "capability";
        targetAdvanced.restore(saved.target);
        reasoningSelect.value = saved.target.reasoning || "inherit";
      }
      if (saved?.judge) {
        judgeEnabled.checked = saved.judge.enabled === true;
        officialJudge.checked = saved.judge.official !== false;
        calibrationEnabled.checked = saved.judge.calibrate !== false;
        judgeTokens.value = saved.judge.maxTokens ?? 8192;
        judgeTemperature.value = saved.judge.temperature ?? "";
        judgeReasoning.value = saved.judge.reasoning ?? "inherit";
        judgeAdvanced.restore(saved.judge);
      }
      if (!queue.length && Array.isArray(saved?.queue)) queue = saved.queue;
      renderConnections(saved);
      renderQueue();
      renderHistory();
      if (payload.running === true) {
        setRunning(true);
        if (payload.progress) showProgress(payload.progress);
        else if (countdownInterval === null) setStatus("Evaluation running · preparing the next request…");
      }
      if (payload.error) setStatus(`Connection catalog error: ${payload.error}`, 0, true);
      else if (!connections.length) setStatus("No saved LLM connections are available. Add one in Connect, then refresh.", 0, true);
    }
    if (payload?.type === "evaluator_queue_started") {
      stopping = false;
      stopCountdown();
      setRunning(true);
      setStatus(`Queue started: ${payload.totalModels} model${payload.totalModels === 1 ? "" : "s"}.`, 0);
    }
    if (payload?.type === "evaluator_run_started") {
      stopCountdown();
      setStatus(`Model ${payload.queueIndex + 1} of ${payload.totalModels}: ${payload.run.target.model}`, 0);
    }
    if (payload?.type === "evaluator_progress") {
      showProgress(payload);
    }
    if (payload?.type === "evaluator_request_complete") stopCountdown();
    if (payload?.type === "evaluator_run_complete") {
      stopCountdown();
      latestBatch.push(payload.run);
      history = [payload.run, ...history.filter((item) => item.id !== payload.run.id)];
      renderHistory();
    }
    if (payload?.type === "evaluator_model_rejected") { stopCountdown(); setStatus(payload.message, 0, true); }
    if (payload?.type === "evaluator_queue_complete") {
      setRunning(false);
      setStatus(payload.error || (payload.stopped ? `Stopped. ${latestBatch.length} completed report${latestBatch.length === 1 ? "" : "s"} saved.` : `Complete. ${latestBatch.length} report${latestBatch.length === 1 ? "" : "s"} saved.`), payload.error ? 0 : 100, Boolean(payload.error));
      if (latestBatch.length === 1) openRunReport(ctx, latestBatch[0], { requestDelete, requestGrade });
      else if (latestBatch.length > 1) openComparisonReport(ctx, latestBatch);
    }
    if (payload?.type === "evaluator_run_detail" && payload.run) {
      pendingReportId = "";
      openRunReport(ctx, payload.run, { requestDelete, requestGrade });
      renderHistory();
    }
    if (payload?.type === "evaluator_run_deleted") {
      pendingDeleteId = "";
      history = Array.isArray(payload.history) ? payload.history : history.filter((run) => run.id !== payload.id);
      latestBatch = latestBatch.filter((run) => run.id !== payload.id);
      renderHistory();
      setStatus(payload.deleted === false ? "The stale report entry was removed." : "The selected report was deleted.", 0);
    }
    if (payload?.type === "evaluator_reports_cleared") {
      pendingDeleteId = "";
      clearingReports = false;
      history = [];
      latestBatch = [];
      renderHistory();
      setStatus(`${payload.deletedCount ?? 0} stored report${Number(payload.deletedCount) === 1 ? "" : "s"} deleted. Evaluator settings were preserved.`, 0);
    }
    if (payload?.type === "evaluator_error") {
      setRunning(false);
      pendingReportId = "";
      pendingDeleteId = "";
      clearingReports = false;
      setStatus(payload.message || "The evaluator encountered an error.", 0, true);
      renderHistory();
    }
  }));

  ctx.ready();
  renderQueue();
  renderHistory();
  ctx.sendToBackend({ type: "evaluator_bootstrap_request" });

  return () => {
    stopCountdown();
    try { targetModelHandle?.destroy(); } catch { /* best effort */ }
    try { judgeModelHandle?.destroy(); } catch { /* best effort */ }
    for (const handle of mounted.reverse()) {
      try { handle.destroy(); } catch { /* best effort */ }
    }
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch { /* best effort */ }
    }
    ctx.dom.cleanup();
  };
}
