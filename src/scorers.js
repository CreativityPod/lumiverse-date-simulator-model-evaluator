export const CASE_FIELDS = Object.freeze([
  "CASE",
  "MAN",
  "WOMAN",
  "DISPOSITION",
  "PREFERENCES",
  "RELATIONSHIP",
  "CURRENT CONTEXT",
  "BOUNDARIES",
  "INITIAL STATE",
]);

export const SCORING_VERSION = "3.0.0";

function excerpt(text, index = 0, length = 280) {
  const source = String(text ?? "");
  const start = Math.max(0, Math.min(source.length, index) - 60);
  return source.slice(start, Math.min(source.length, start + length)).trim();
}

function assertion(id, label, verdict, options = {}) {
  return {
    id,
    label,
    verdict,
    severity: options.severity ?? "major",
    source: options.source ?? "objective",
    evidence: options.evidence ?? "",
    detail: options.detail ?? "",
    gates: options.gates ?? [],
    scoringVersion: SCORING_VERSION,
  };
}

export function parseNumberedOptions(text) {
  const withoutCode = String(text ?? "").replace(/```[\s\S]*?```/g, "");
  const options = [];
  for (const [lineIndex, rawLine] of withoutCode.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    const normalizedLine = line.replace(/\*\*/g, "");
    const match = normalizedLine.match(/^(?:[-*]\s+)?(\d{1,2})\s*[.)\-:]\s+(.*\S)\s*$/);
    if (!match) continue;
    options.push({ number: Number(match[1]), label: match[2].replace(/\*\*/g, "").trim(), line: lineIndex + 1 });
  }
  return options;
}

export function validateNumberedMenu(text, { minimum = 3, maximum = Infinity, requiredLabels = [] } = {}) {
  const options = parseNumberedOptions(text);
  const numbers = options.map((option) => option.number);
  const unique = new Set(numbers);
  const duplicates = numbers.filter((number, index) => numbers.indexOf(number) !== index);
  const sequential = numbers.length === 0 || (numbers[0] === 1 && numbers.every((number, index) => number === index + 1));
  const normalizedLabels = options.map((option) => option.label.toLowerCase()).join("\n");
  const missingLabels = requiredLabels.filter((label) => !normalizedLabels.includes(label.toLowerCase()));
  return {
    valid: options.length >= minimum && options.length <= maximum && unique.size === options.length
      && sequential && missingLabels.length === 0,
    options,
    duplicates: [...new Set(duplicates)],
    sequential,
    missingLabels,
  };
}

export function parseCaseCapsules(text) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  const starts = [...source.matchAll(/<!--DATE_SIM_CASE\b/g)];
  const ends = [...source.matchAll(/END_DATE_SIM_CASE-->/g)];
  const complete = [];
  const envelope = /<!--DATE_SIM_CASE\s*\n([\s\S]*?)\nEND_DATE_SIM_CASE-->/g;
  let match;
  while ((match = envelope.exec(source)) !== null) {
    const lines = match[1].split("\n").filter((line) => line.trim());
    const fields = [];
    const values = {};
    let malformedLine = "";
    for (const line of lines) {
      const fieldMatch = line.match(/^([A-Z][A-Z ]+):\s*(.*)$/);
      if (!fieldMatch) {
        malformedLine ||= line;
        continue;
      }
      fields.push(fieldMatch[1]);
      values[fieldMatch[1]] = fieldMatch[2].trim();
    }
    const ordered = fields.length === CASE_FIELDS.length
      && fields.every((field, index) => field === CASE_FIELDS[index]);
    const populated = CASE_FIELDS.every((field) => Boolean(values[field]));
    const extraFields = fields.filter((field) => !CASE_FIELDS.includes(field));
    const nested = /<!--|-->|DATE_SIM_CASE|END_DATE_SIM_CASE/.test(match[1]);
    complete.push({
      raw: match[0],
      body: match[1],
      index: match.index,
      fields,
      values,
      ordered,
      populated,
      extraFields,
      malformedLine,
      nested,
      valid: ordered && populated && extraFields.length === 0 && !malformedLine && !nested,
    });
  }
  return { starts: starts.length, ends: ends.length, complete };
}

function regexFrom(check) {
  return new RegExp(check.pattern, check.flags ?? "i");
}

function wordCount(text) {
  return (String(text ?? "").match(/[\p{L}\p{N}’'-]+/gu) ?? []).length;
}

function evaluateCheck(check, text, test) {
  const source = String(text ?? "");
  if (check.type === "numbered_menu") {
    const result = validateNumberedMenu(source, check);
    const detail = result.valid
      ? `${result.options.length} unique sequential numbered choices found.`
      : `${result.options.length} choices; expected ${check.minimum}${Number.isFinite(check.maximum) ? `–${check.maximum}` : "+"}; missing labels: ${result.missingLabels.join(", ") || "none"}; duplicates: ${result.duplicates.join(", ") || "none"}.`;
    return [assertion(check.id, check.label, result.valid ? "pass" : "fail", {
      severity: check.severity,
      evidence: result.options.map((option) => `${option.number}. ${option.label}`).join("\n") || excerpt(source),
      detail,
    })];
  }
  if (check.type === "private_case") {
    const parsed = parseCaseCapsules(source);
    const capsule = parsed.complete[0];
    const exactlyOne = parsed.starts === 1 && parsed.ends === 1 && parsed.complete.length === 1;
    const publicText = capsule ? source.slice(0, capsule.index).replace(/<!--[\s\S]*?-->/g, "").trim() : "";
    const publicOpening = Boolean(publicText);
    const publicHeader = publicText.split(/\r?\n/).find((line) => line.trim())?.replace(/[*_`#]/g, "").trim() ?? "";
    const modeHeader = check.mode === "Teen Mode"
      ? /^Teen Scenario\s*[—–-]\s*both participants are (?:16[–-]17|16|17)\s*;\s*nonsexual$/i.test(publicHeader)
      : /^Adult Scenario\s*[—–-]\s*both participants are 18\+$/i.test(publicHeader);
    const capsuleAtEnd = Boolean(capsule && !source.slice(capsule.index + capsule.raw.length).trim());
    const versionOkay = Boolean(/\bDate Simulator v1\.5\.5(?=[;\s]|$)/.test(capsule?.values.CASE ?? ""));
    return [
      assertion(`${check.id}.envelope`, "Exactly one complete DATE_SIM_CASE", exactlyOne ? "pass" : "fail", {
        severity: "critical",
        evidence: capsule ? excerpt(capsule.raw) : excerpt(source),
        detail: `Starts ${parsed.starts}; ends ${parsed.ends}; complete ${parsed.complete.length}.`,
      }),
      assertion(`${check.id}.fields`, "Nine populated fields in exact order", capsule?.valid ? "pass" : "fail", {
        severity: "critical",
        evidence: capsule?.fields?.join(" → ") || excerpt(source),
      }),
      assertion(`${check.id}.version`, "CASE field includes Date Simulator v1.5.5", versionOkay ? "pass" : "fail", {
        severity: "critical",
        evidence: capsule?.values.CASE ?? excerpt(source),
        detail: versionOkay ? "Required card version found in CASE." : "CASE must include Date Simulator v1.5.5.",
      }),
      assertion(`${check.id}.opening`, "Public opening precedes private capsule", publicOpening ? "pass" : "fail", {
        severity: "major",
        evidence: capsule ? excerpt(source.slice(0, capsule.index)) : excerpt(source),
      }),
      assertion(`${check.id}.header`, "Public age-mode header matches the case", modeHeader ? "pass" : "fail", {
        severity: "critical",
        evidence: excerpt(publicText),
        detail: `Expected the canonical ${check.mode === "Teen Mode" ? "Teen Scenario age and nonsexual" : "Adult Scenario 18+"} header as the first public line.`,
      }),
      assertion(`${check.id}.tail`, "Private profile is the final output block", capsuleAtEnd ? "pass" : "fail", {
        severity: "major",
        evidence: capsule ? source.slice(capsule.index + capsule.raw.length).trim().slice(0, 280) : excerpt(source),
      }),
    ];
  }
  if (check.type === "forbidden_markers") {
    const found = regexFrom(check).exec(source);
    return [assertion(check.id, check.label, found ? "fail" : "pass", {
      severity: check.severity, evidence: found ? excerpt(source, found.index) : "",
      detail: found ? "Forbidden protocol marker found." : "No forbidden protocol marker found.",
    })];
  }
  if (check.type === "required_markers") {
    const missing = check.terms.filter((term) => !source.includes(term));
    const duplicate = check.exactlyOnce ? check.terms.filter((term) => source.split(term).length - 1 !== 1) : [];
    const positions = check.terms.map((term) => source.indexOf(term));
    const outOfOrder = check.ordered && positions.some((position, index) => index && position <= positions[index - 1]);
    return [assertion(check.id, check.label, missing.length || duplicate.length || outOfOrder ? "fail" : "pass", {
      severity: check.severity, evidence: excerpt(source),
      detail: missing.length ? `Missing exact markers: ${missing.join(", ")}`
        : duplicate.length ? `Markers must occur exactly once: ${duplicate.join(", ")}`
          : outOfOrder ? "Required markers are not in canonical order." : "Required exact markers occur once in canonical order.",
    })];
  }
  if (check.type === "word_range") {
    const count = wordCount(source);
    const valid = count >= check.minimum && count <= check.maximum;
    const difference = count < check.minimum ? check.minimum - count : count > check.maximum ? count - check.maximum : 0;
    const edge = count < check.minimum ? check.minimum : check.maximum;
    const percent = difference ? Math.round(1000 * difference / edge) / 10 : 0;
    return [assertion(check.id, check.label, valid ? "pass" : "fail", {
      severity: check.severity ?? "minor",
      evidence: `${count} words`,
      detail: valid ? `Required ${check.minimum}–${check.maximum} words.`
        : `Required ${check.minimum}–${check.maximum} words; ${difference} word${difference === 1 ? "" : "s"} (${percent}%) ${count < check.minimum ? "under" : "over"} the nearest limit. Hyphenated compounds count as one word.`,
    })];
  }
  return [assertion(check.id ?? "unknown", check.label ?? "Unknown check", "inconclusive", {
    severity: "minor",
    evidence: excerpt(source),
    detail: `Unsupported deterministic check type: ${check.type}`,
  })];
}

export function scoreResponse(test, text) {
  const assertions = (test.checks ?? []).flatMap((check) => evaluateCheck(check, text, test)
    .map((item) => ({ ...item, gates: check.gates ?? [] })));
  const decided = assertions.filter((item) => item.verdict === "pass" || item.verdict === "fail");
  return {
    score: decided.length ? Math.round(100 * decided.filter((item) => item.verdict === "pass").length / decided.length) : null,
    assertions,
    passed: decided.length ? decided.every((item) => item.verdict === "pass") : null,
    criticalFailure: assertions.some((item) => item.verdict === "fail" && item.severity === "critical"),
    scoringVersion: SCORING_VERSION,
  };
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null;
}

function mean(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

// Give every fixture equal family-level influence. Repetitions are averaged
// inside each fixture, and turns/dimensions are averaged inside a repetition.
function fixtureBalancedAverage(results, scoreAttempt) {
  const attempts = new Map();
  for (const result of results) {
    const key = `${result.testId}::${result.repetition ?? 1}`;
    if (!attempts.has(key)) attempts.set(key, []);
    attempts.get(key).push(result);
  }
  const fixtures = new Map();
  for (const [key, attemptResults] of attempts) {
    const score = scoreAttempt(attemptResults);
    if (!Number.isFinite(score)) continue;
    const testId = key.split("::")[0];
    if (!fixtures.has(testId)) fixtures.set(testId, []);
    fixtures.get(testId).push(score);
  }
  return average([...fixtures.values()].map(mean));
}

function judgedCriteria(result, judge) {
  const item = judge?.items?.find((entry) => entry.id === result.resultId);
  return (result.criteria ?? []).map((criterion) => ({
    ...criterion,
    ...(item?.criteria?.find((entry) => entry.id === criterion.id) ?? { verdict: "unassessed" }),
  }));
}

function resultAssertions(result, judge) {
  if (result.runtime?.status !== "success") return [];
  return [...(result.score?.assertions ?? []), ...judgedCriteria(result, judge)];
}

function findingRecord(result, item, source) {
  return {
    resultId: result.resultId ?? "",
    testId: result.testId ?? "",
    title: result.title ?? "",
    repetition: result.repetition ?? 1,
    turn: result.turn ?? 1,
    id: item.id ?? "unknown",
    label: item.label ?? item.id ?? "Unknown requirement",
    source,
    severity: item.severity ?? "major",
    gates: item.gates ?? [],
    reason: item.reason ?? item.detail ?? "",
    evidence: item.evidence ?? "",
    evidenceSource: item.evidenceSource ?? (source === "deterministic" ? "response" : "rationale"),
  };
}

function failedFindings(results, judge) {
  return results.filter((result) => result.family === "date_simulator" && result.runtime?.status === "success")
    .flatMap((result) => [
      ...(result.score?.assertions ?? []).filter((item) => item.verdict === "fail")
        .map((item) => findingRecord(result, item, "deterministic")),
      ...judgedCriteria(result, judge).filter((item) => item.kind !== "quality" && item.verdict === "fail")
        .map((item) => findingRecord(result, item, "semantic")),
    ]);
}

function semanticFailureKey(item) {
  return `${item.testId}::${item.id}`;
}

function gateVerdict(results, judge, gate) {
  const attempted = results.filter((result) => result.gates?.includes(gate));
  if (!attempted.length) return "not_tested";
  const relevant = attempted.flatMap((result) => resultAssertions(result, judge).filter((item) => item.gates?.includes(gate)));
  if (relevant.some((item) => item.verdict === "fail")) return "fail";
  if (attempted.some((result) => result.runtime?.status !== "success")) return "inconclusive";
  if (relevant.length && relevant.every((item) => item.verdict === "pass")) return "pass";
  return "inconclusive";
}

export function aggregateRun(results, judge = null, coverage = null) {
  const families = {};
  for (const family of ["date_simulator", "roleplay", "writing"]) {
    const attempted = results.filter((result) => result.family === family);
    const relevant = attempted.filter((result) => result.runtime?.status === "success");
    const behavior = relevant.flatMap((result) => judgedCriteria(result, judge)).filter((item) => item.kind !== "quality");
    const quality = relevant.flatMap((result) => judgedCriteria(result, judge)).filter((item) => item.kind === "quality");
    const decided = behavior.filter((item) => ["pass", "fail"].includes(item.verdict));
    const qualityDecided = quality.filter((item) => Number.isFinite(item.rating));
    const expectedBehavior = coverage?.families?.[family]?.behavior ?? attempted.flatMap((result) => result.criteria ?? []).filter((item) => item.kind !== "quality").length;
    const expectedQuality = coverage?.families?.[family]?.quality ?? attempted.flatMap((result) => result.criteria ?? []).filter((item) => item.kind === "quality").length;
    families[family] = {
      objectiveScore: fixtureBalancedAverage(relevant, (attempt) => mean(attempt.map((result) => result.score?.score))),
      behaviorScore: fixtureBalancedAverage(relevant, (attempt) => {
        const items = attempt.flatMap((result) => judgedCriteria(result, judge)).filter((item) => item.kind !== "quality" && ["pass", "fail"].includes(item.verdict));
        return items.length ? 100 * items.filter((item) => item.verdict === "pass").length / items.length : null;
      }),
      subjectiveScore: fixtureBalancedAverage(relevant, (attempt) => {
        const items = attempt.flatMap((result) => judgedCriteria(result, judge)).filter((item) => item.kind === "quality" && Number.isFinite(item.rating));
        return mean(items.map((item) => item.rating * 25));
      }),
      behaviorCoverage: { assessed: decided.length, total: expectedBehavior },
      qualityCoverage: { assessed: qualityDecided.length, total: expectedQuality },
      tests: relevant.length, attempted: attempted.length,
      fixtures: new Set(relevant.map((result) => result.testId)).size,
      failures: relevant.filter((result) => resultAssertions(result, judge).some((item) => item.kind !== "quality" && item.verdict === "fail")).length,
      weighting: "equal_fixture_then_repetition",
    };
  }
  const gates = {};
  for (const gate of ["numbered_questions", "number_locality", "private_profile", "routine_discipline", "user_agency", "age_safety", "continuity"]) {
    gates[gate] = gateVerdict(results, judge, gate);
  }
  const failures = failedFindings(results, judge);
  const critical = failures.filter((item) => item.severity === "critical");
  const semanticCounts = new Map();
  for (const item of critical.filter((finding) => finding.source === "semantic")) {
    const key = semanticFailureKey(item);
    semanticCounts.set(key, (semanticCounts.get(key) ?? new Set()).add(item.repetition));
  }
  const priorCritical = new Set(judge?.priorCriticalFailureKeys ?? []);
  const criticalFindings = critical.map((item) => {
    const key = semanticFailureKey(item);
    const repeatCount = semanticCounts.get(key)?.size ?? 0;
    const confirmation = item.source === "deterministic" ? "deterministic"
      : priorCritical.has(key) ? "regrade_confirmation"
        : repeatCount >= 2 ? "independent_repetitions" : "review_required";
    return { ...item, confirmation, repeatCount };
  });
  const confirmedCritical = criticalFindings.filter((item) => item.confirmation !== "review_required");
  const criticalConcerns = criticalFindings.filter((item) => item.confirmation === "review_required");
  const confirmedCriticalKeys = new Set(confirmedCritical.map(semanticFailureKey));
  const criticalConcernKeys = new Set(criticalConcerns.map(semanticFailureKey));

  const plannedTests = coverage?.targetCalls ?? results.length;
  const completedTests = results.filter((result) => result.runtime?.status === "success").length;
  const incompleteTests = results.filter((result) => result.runtime?.status === "incomplete").length;
  const runtimeErrors = results.filter((result) => result.runtime?.status === "error").length;
  const unattemptedTests = Math.max(0, plannedTests - results.length);
  const executionComplete = completedTests === plannedTests && !incompleteTests && !runtimeErrors && !unattemptedTests;
  const gateValues = Object.values(gates);
  const gateCoverage = {
    tested: gateValues.filter((value) => value !== "not_tested").length,
    decided: gateValues.filter((value) => value === "pass" || value === "fail").length,
    passed: gateValues.filter((value) => value === "pass").length,
    failed: gateValues.filter((value) => value === "fail").length,
    inconclusive: gateValues.filter((value) => value === "inconclusive").length,
    notTested: gateValues.filter((value) => value === "not_tested").length,
    total: gateValues.length,
  };
  const semanticCoverage = Object.values(families).reduce((total, family) => ({
    assessed: total.assessed + family.behaviorCoverage.assessed + family.qualityCoverage.assessed,
    total: total.total + family.behaviorCoverage.total + family.qualityCoverage.total,
  }), { assessed: 0, total: 0 });
  const dateBehaviorCoverage = families.date_simulator.behaviorCoverage;
  const dateSemanticComplete = dateBehaviorCoverage.assessed === dateBehaviorCoverage.total;
  const uniqueFailures = new Set(failures.map((item) => `${item.source}::${item.testId}::${item.id}`));

  let compatibilityCode;
  if (confirmedCriticalKeys.size) compatibilityCode = "not_ready_confirmed_critical";
  else if (criticalConcernKeys.size) compatibilityCode = "critical_concern";
  else if (failures.length) compatibilityCode = "compatible_with_issues";
  else if (executionComplete && dateSemanticComplete && gateCoverage.passed === gateCoverage.total && judge?.calibration?.status !== "failed") compatibilityCode = "ready";
  else if (executionComplete && gateCoverage.inconclusive === 0 && gateCoverage.failed === 0
    && gateCoverage.notTested !== 0 && dateSemanticComplete && judge?.calibration?.status !== "failed") compatibilityCode = "tested_pass_limited";
  else compatibilityCode = "evaluation_incomplete";

  const compatibility = {
    code: compatibilityCode,
    failureCount: uniqueFailures.size,
    failureAttemptCount: failures.length,
    confirmedCriticalCount: confirmedCriticalKeys.size,
    criticalConcernCount: criticalConcernKeys.size,
    primaryFinding: confirmedCritical[0] ?? criticalConcerns[0] ?? failures[0] ?? null,
  };
  return {
    families, gates, compatibility,
    // Kept for saved-report consumers written before compatibility became explicit.
    readiness: compatibility.code,
    coverage: { gates: gateCoverage, semantic: semanticCoverage },
    execution: { code: executionComplete ? "complete" : completedTests ? "partial" : "failed", complete: executionComplete },
    failureFindings: failures,
    criticalFindings,
    plannedTests,
    unattemptedTests,
    criticalFailures: confirmedCriticalKeys.size,
    criticalConcerns: criticalConcernKeys.size,
    completedTests,
    attemptedTests: results.length,
    incompleteTests,
    truncatedTests: results.filter((result) => result.completion?.status === "truncated").length,
    emptyTests: results.filter((result) => result.completion?.status === "empty").length,
    runtimeErrors,
    scoringVersion: SCORING_VERSION,
  };
}
