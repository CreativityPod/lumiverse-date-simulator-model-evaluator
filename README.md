# Date Simulator Model Evaluator

Version **0.3.0** is a headless Lumiverse Spindle extension for evaluating Date Simulator v1.5.5, roleplay, and creative writing with local or hosted models. It uses saved connections and exact request-local model IDs. It does not require a chat or change Connect settings.

## Scoring

Three separate results prevent format compliance from being mistaken for intelligence:

- **Completion:** completed, truncated, empty, filtered, unexpected tool calls, unknown finish reason, or runtime error. Incomplete responses keep their text, reasoning, finish reason and usage, but receive no capability score.
- **Mechanical checks:** exact capsule structure, protocol markers, sequential numbering and requested word ranges. These checks do not infer behavior from keywords.
- **Contextual LLM grading:** every fixture has explicit behavioral requirements. Roleplay and writing also have anchored quality ratings from 0 to 4, displayed on a 0–100 scale. The judge receives the complete task conversation and final response, with model identity and native reasoning omitted.

The main Date Simulator score shows mechanical protocol compliance, including when no judge is enabled. Semantic behavior is shown separately as the percentage of assessed semantic requirements met. The Roleplay and Writing scores are assessed quality ratings. Task compliance is also shown separately. Missing, uncertain or rejected grades never become zeroes or passes; coverage remains visible. Without a judge, semantic behavior and quality remain **Not assessed**.

A gate passes only when all associated checks pass. A failure affects its own gate, not every gate touched by the fixture. Numbered-question and private-profile failures, and critical Date Simulator violations, cannot be averaged away by prose quality.

The report presents three independent status cards:

- **Execution** says how many target requests returned complete responses and separately counts incomplete, truncated, empty, failed and unattempted calls.
- **Evaluation coverage** says how many readiness gates were actually tested and decided, plus the exact number of semantic criteria assessed.
- **Date Simulator compatibility** scopes its conclusion to the evidence. A successful Quick or Standard suite says that its tested requirements passed with limited coverage; only a complete suite with every readiness gate passed says **Ready**. Noncritical failures produce **Compatible with issues**, while missing or unresolved evidence produces **Evaluation incomplete**.

Deterministic critical failures are confirmed immediately. One semantic critical judgment produces **Critical concern — review required**. It becomes **Not ready — confirmed critical failure** only when the same requirement fails in repeated test results or again when saved responses are regraded. Reports list each triggering test, rule, source, rationale and evidence; **View Date Simulator evidence** opens the corresponding expanded result.

## Suites and cost

| Suite | Unique fixtures | Repetitions | Maximum target calls | Judge calls before retries, including sanity check |
|---|---:|---:|---:|---:|
| Quick | 7 | 1 | 7 | 13 |
| Standard | 12 | 2 | 30 | 36 |
| Full | 18 | 3 | 69 | 75 |

Judge calls are additional and occur only when enabled. Each completed target response is graded first. If a response is malformed or incomplete, usable criterion grades are retained and missing criteria get at most one retry in batches of four. These bounded repair calls are additional to the table above; transport failures do not trigger repair calls.

The optional six-example sanity check runs after grading. Disagreements or invalid answers produce a warning and mark semantic grades provisional; they never block grading or erase usable scores. Passing these synthetic examples is a basic reliability check, **not human validation**.

Standard and Full include live follow-ups using actual model responses: object continuity across intervening dialogue, updated signal observations, number-choice recall, and competing objectives under time pressure. Each repetition starts fresh. A failed or incomplete turn skips its dependent follow-ups; the report retains the planned denominator.

## Local and API models

1. Install or update this repository as a Spindle and grant `generation` and `ui_panels`.
2. Open **Evaluator**, select a saved connection, and choose or type the exact model ID supplied by that connection.
3. Configure target settings, then enable **Semantic judge · local or API** and independently choose its connection, model and settings.
4. Choose **Run now**, or add targets to the comparison queue and select **Run selected**.
5. Inspect completion and grading coverage before comparing scores. Open fixture evidence for disagreements.

For a local server, use Lumiverse's Custom/OpenAI-compatible connection with that server's endpoint and loaded model ID. For GLM 5.3, DeepSeek V4, or frontier models, use the appropriate saved native or compatible API connection and its exact model ID. There is no model-name allowlist or hard-coded vendor URL in the extension. Model availability, credentials, request formats and supported parameters remain the responsibility of the configured Lumiverse adapter and server.

Target and judge controls include:

| Setting | Default | Notes |
|---|---|---|
| Temperature | Omitted | Blank allows provider defaults, including models that reject temperature overrides. |
| Target output budget | 16,384 | Configurable 400–262,144; the provider's own limit still applies. |
| Judge output budget | 8,192 | Allow room for both reasoning and structured criteria. |
| Timeout | 300 seconds each | Independently configurable from 10 to 1,800 seconds; Stop remains available. |
| Reasoning | Inherit | Off, auto, minimal, low, medium, high, extra high or maximum; provider support varies. |
| Output parameter | `max_tokens` | Native adapters translate this. Use `max_completion_tokens` only for a compatible endpoint requiring it. |
| Additional parameters | `{}` | JSON generation settings such as `top_p`, `seed`, or provider-specific thinking controls. |

For example, a local server that supports this option can receive:

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

This is a server-specific option, not a universal switch. Native reasoning overrides are translated by Lumiverse. Additional parameters cannot replace the model, messages, output limit, temperature, tools, endpoint or credentials. Use the dedicated controls and saved connection instead. Configure settings appropriate to the model; no universal sampler is imposed.

The full prompt plus requested output must fit the loaded model's context window. Date Simulator setup prompts are substantial (roughly 55–57 thousand characters before tokenization); judge prompts add criteria and the target answer. A 32K context can be tight with the default target budget. Use the server's tokenizer/context information and adjust context or output allowance. The evaluator does not silently truncate prompts or retry with a different budget.

**Capability** mode labels runs intended to have adequate output headroom. **Fixed output budget** labels comparisons with equal configured limits. They use the same execution path, without automatic retries. Equal output limits do not imply equal reasoning compute. Record and keep the relevant settings consistent across compared models.

Independent judge mode rejects the same exact model ID even across different connections. It cannot detect aliases, related fine-tunes or shared model families. Choose a different model family where practical and review domain-specific examples before trusting rankings. See [judge validation guidance](docs/JUDGE_VALIDATION.md).

## Reports and stored evidence

Run status includes an activity spinner and a live countdown for the current target, judge or calibration request. The countdown uses that request's configured timeout, resets for the next request, and resumes from elapsed time when reopening the panel. It shows the remaining request allowance, not an estimated completion time. Animation respects reduced-motion preferences.

Reports include mechanical and semantic findings, exact evidence excerpts or explicitly reasoned absence judgments, uncertainty, per-family assessment coverage, completion diagnostics, raw target/judge responses, submitted parameters, full target conversations, and judge sanity results. The parser accepts JSON surrounded by prose or fences and retains complete criterion objects from truncated JSON. Unknown/duplicate criteria or invalid ratings are excluded individually; valid grades survive. Quality scores derive from the explicit 0–4 rating, and null remains uncertain. Reasons are required. Quotes are optional diagnostics: quotations not found verbatim are labeled unverified, rather than erasing the grade.

Reasoning-only and truncated responses retain usage even when no final answer was generated. Leading `<think>`, `<thinking>` and `<reasoning>` blocks are separated when returned as plain content; original text remains available. Native reasoning carriers/signatures are retained for target continuations and excluded from judge input. Missing provider finish metadata is disclosed; nonempty text without it is accepted as complete.

Comparison keys include benchmark, snapshot, compiler, scorer, rubric, output budget, sampler parameters, reasoning and judge configuration. Different configurations and legacy reports are flagged. Connection/server defaults inherited at execution time are not fully captured by the extension; set explicit values or record those defaults when reproducibility matters.

Version 1 reports keep their stored scores and display a legacy label. They are not re-scored or directly ranked against version 2. Mechanical score distributions describe heterogeneous test attempts, not semantic quality, confidence intervals or statistical repeatability.

Use **Grade saved responses** (or **Regrade saved responses**) in a version 2 report to grade its completed target outputs with the judge currently selected in Evaluator settings. This makes judge calls only and saves a separate report with a link to its source; it never reruns the target model or changes the original report. The new report's token usage counts only its new judge calls. Failed/incomplete target responses cannot be recovered by regrading.

Use **Export full evidence** for review and **Export summary JSON** for a compact record. **Delete this report** and **Clear all reports** retain their explicit confirmation flows and preserve saved evaluator settings. Deletion is disabled during runs.

## Canonical headless prompt

The distributed extension is self-contained. The build verifies the approved source SHA-256:

```text
ec859dc21fc2af4bc662c5f3e5de07b72fbf2194e44b4e9324d8a868327c2634
```

Snapshot `date-simulator-v1.5.5-headless.2` includes description, personality, scenario, phase-gated examples, the card's command-gated book entries selected by the latest user message, and post-history instructions. It resolves the declared phase/case macros. This deliberately bounded compiler does not reproduce host lorebook recursion, display regexes, arbitrary extensions, image understanding or Continuity Engine. Its changed fingerprint prevents comparison with the previous smaller prompt.

## Development and verification

```bash
npm run check
```

No dependencies are required. The command regenerates the snapshot, builds `dist/`, runs the automated suite, and validates the Spindle package. The committed distribution files are the files Lumiverse loads. Tests use a fake Spindle generation host; they verify request routing, settings, scoring, storage, UI behavior and failure handling without paid or local inference calls. Most tests use simulated providers. Local LM Studio smoke checks additionally exercise real Qwen grading output; this does not establish agreement across all model families or providers. Judge reliability still needs validation with the configured models.

[Release notes](CHANGELOG.md) · [Judge validation](docs/JUDGE_VALIDATION.md)

The original [implementation plan](docs/IMPLEMENTATION_PLAN.md), [test plan](docs/TEST_PLAN.md), and [report specification](docs/REPORT_UI_SPEC.md) are design references, including future ideas. This README and the release notes describe implemented behavior.
