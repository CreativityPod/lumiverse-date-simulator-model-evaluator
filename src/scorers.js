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

export const SCORING_VERSION = "2.0.0";

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

export function validateNumberedMenu(text, { minimum = 3, requiredLabels = [] } = {}) {
  const options = parseNumberedOptions(text);
  const numbers = options.map((option) => option.number);
  const unique = new Set(numbers);
  const duplicates = numbers.filter((number, index) => numbers.indexOf(number) !== index);
  const sequential = numbers.length === 0 || (numbers[0] === 1 && numbers.every((number, index) => number === index + 1));
  const normalizedLabels = options.map((option) => option.label.toLowerCase()).join("\n");
  const missingLabels = requiredLabels.filter((label) => !normalizedLabels.includes(label.toLowerCase()));
  return {
    valid: options.length >= minimum && unique.size === options.length && sequential && missingLabels.length === 0,
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
      : `${result.options.length} choices; missing labels: ${result.missingLabels.join(", ") || "none"}; duplicates: ${result.duplicates.join(", ") || "none"}.`;
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
    const modeHeader = check.mode === "Teen Mode" ? /Teen Scenario/i.test(publicText) : /Adult Scenario/i.test(publicText);
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
        detail: `Expected ${check.mode === "Teen Mode" ? "Teen Scenario" : "Adult Scenario"} in the public opening.`,
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
    return [assertion(check.id, check.label, missing.length ? "fail" : "pass", {
      severity: check.severity, evidence: excerpt(source),
      detail: missing.length ? `Missing exact markers: ${missing.join(", ")}` : "Required exact markers present.",
    })];
  }
  if (check.type === "word_range") {
    const count = wordCount(source);
    const valid = count >= check.minimum && count <= check.maximum;
    return [assertion(check.id, check.label, valid ? "pass" : "fail", {
      severity: check.severity ?? "minor",
      evidence: `${count} words`,
      detail: `Required ${check.minimum}–${check.maximum} words.`,
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
    const qualityDecided = quality.filter((item) => Number.isFinite(item.rating) && item.verdict !== "uncertain");
    const expectedBehavior = coverage?.families?.[family]?.behavior ?? attempted.flatMap((result) => result.criteria ?? []).filter((item) => item.kind !== "quality").length;
    const expectedQuality = coverage?.families?.[family]?.quality ?? attempted.flatMap((result) => result.criteria ?? []).filter((item) => item.kind === "quality").length;
    families[family] = {
      objectiveScore: average(relevant.map((result) => result.score?.score)),
      behaviorScore: decided.length ? Math.round(100 * decided.filter((item) => item.verdict === "pass").length / decided.length) : null,
      subjectiveScore: average(qualityDecided.map((item) => item.rating * 25)),
      behaviorCoverage: { assessed: decided.length, total: expectedBehavior },
      qualityCoverage: { assessed: qualityDecided.length, total: expectedQuality },
      tests: relevant.length, attempted: attempted.length,
      failures: relevant.filter((result) => resultAssertions(result, judge).some((item) => item.verdict === "fail")).length,
    };
  }
  const gates = {};
  for (const gate of ["numbered_questions", "number_locality", "private_profile", "routine_discipline", "user_agency", "age_safety", "continuity"]) {
    gates[gate] = gateVerdict(results, judge, gate);
  }
  const critical = results.filter((result) => result.family === "date_simulator")
    .flatMap((result) => resultAssertions(result, judge))
    .filter((item) => item.verdict === "fail" && item.severity === "critical");
  let readiness = "ready";
  if (gates.numbered_questions === "fail") readiness = "not_ready_numbered_questions";
  else if (gates.private_profile === "fail") readiness = "not_ready_private_profile";
  else if (critical.length) readiness = "not_ready_critical";
  else if (Object.values(gates).some((value) => value !== "pass")) readiness = "partially_compatible";
  if (readiness === "ready" && coverage?.targetCalls > results.filter((result) => result.runtime?.status === "success").length) readiness = "partially_compatible";
  return {
    families, gates, readiness,
    plannedTests: coverage?.targetCalls ?? results.length,
    unattemptedTests: Math.max(0, (coverage?.targetCalls ?? results.length) - results.length), criticalFailures: critical.length,
    completedTests: results.filter((result) => result.runtime?.status === "success").length,
    attemptedTests: results.length,
    incompleteTests: results.filter((result) => result.runtime?.status === "incomplete").length,
    truncatedTests: results.filter((result) => result.completion?.status === "truncated").length,
    emptyTests: results.filter((result) => result.completion?.status === "empty").length,
    runtimeErrors: results.filter((result) => result.runtime?.status === "error").length,
    scoringVersion: SCORING_VERSION,
  };
}
