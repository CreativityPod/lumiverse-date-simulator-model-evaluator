# Model Evaluator headless implementation plan

## 1. Product objective

Build a fully automatic Lumiverse extension that can compare configured LLMs without creating chats or changing the user's active connection/model. The extension bundles a canonical Date Simulator v1.5.5 instruction snapshot, constructs isolated in-memory conversations, calls the selected model directly, scores the responses, and displays a graphical comparison report.

The evaluator measures three separate capability families:

1. **Date Simulator compatibility:** Can the model follow the card's distinctive control and output requirements?
2. **Roleplay quality:** Can the model sustain character, agency, voice, continuity, responsiveness, and natural interaction?
3. **Creative-writing quality:** Can the model follow a writing brief while producing coherent, vivid, controlled, and non-repetitive prose?

The first family is the primary release goal. The other two provide a broader suitability profile so a fluent model that fails Date Simulator protocol is not confused with an unintelligent model, and a mechanically compliant model is not automatically called an excellent writer.

## 2. What “headless” means

The extension will not:

- require an active Date Simulator character or chat;
- create, edit, swipe, reset, or delete Lumiverse messages;
- run Lumiverse prompt assembly or character-book activation at runtime;
- depend on display regex scripts or Continuity Engine; or
- change the user's active connection, selected model, or Connect-tab settings.

Instead, each benchmark test owns an independent array of `system`, `user`, and `assistant` messages. Multi-turn tests append responses only to that test's in-memory history. A new test begins from a fresh cloned fixture, eliminating cross-test contamination.

This deliberately measures model capability against a stable compiled representation of Date Simulator v1.5.5. It is not an end-to-end certification of Lumiverse prompt assembly or Continuity Engine.

## 3. Canonical Date Simulator snapshot

### 3.1 Bundled source

At build time, copy and normalize behavior-relevant content from:

- `v1.5.5/Date_Simulator_CCv3_v1.5.5.json`;
- its description, post-history instructions, examples, first greeting, and alternate greetings;
- the authored fixed-baseline examples; and
- the v1.5.5 behavioral evaluation protocol.

The distributed extension contains a self-sufficient generated snapshot. Runtime behavior must not depend on this repository being present.

### 3.2 Build validation

The snapshot build script must:

- verify `spec === "chara_card_v3"` and `character_version === "1.5.5"`;
- validate the known source-file SHA-256 or an explicitly updated allowlist;
- normalize newlines and macro names;
- preserve behaviorally meaningful text exactly;
- resolve `{{char}}` and `{{user}}` to fixed benchmark names where runtime macro evaluation is unnecessary;
- compile relevant example messages into role-separated messages;
- reject missing or unexpectedly changed required sections; and
- emit a snapshot version and content fingerprint.

### 3.3 Prompt compiler

The prompt compiler turns the snapshot and one benchmark definition into an explicit message history. It does not attempt to recreate all Loom behavior. Its contract is narrower and testable:

- Date Simulator identity and core description are placed in a system message.
- Post-history rules are placed late enough to retain instruction priority.
- Required worked examples are included only for tests that declare them.
- The chosen greeting or authored assistant baseline is included explicitly.
- Each scripted user turn is appended exactly.
- Assistant responses are appended unmodified for later-turn tests.
- Token counts and final serialized messages are stored with the run.

Every prompt-compiler change increments the benchmark snapshot version so historical results remain comparable.

### 3.4 v1.5.5 division of labor

The benchmark must enforce the real v1.5.5 contract:

- the main model writes public prose and one stable `DATE_SIM_CASE` after the first generated opening;
- the capsule has exactly nine ordered fields;
- routine replies do not repeat the capsule;
- routine replies do not generate a rolling `DATE_SIM_SCENE` or fallback private tracker; and
- private state is not mentioned in public dialogue.

Continuity Engine is outside the headless score. Multi-turn continuity is tested by retaining the target model's earlier messages—including the private profile—in the in-memory history and checking later responses against established facts.

## 4. Model selection without changing Connect

### 4.1 Connection picker

With the `generation` permission, the extension reads safe connection profiles using `spindle.connections.list()`. It presents a connection selector inside its drawer panel. The connection supplies:

- provider adapter;
- API URL;
- stored credential;
- provider-specific metadata; and
- a default model value.

API keys are never exposed to the extension.

### 4.2 Per-connection model picker

After selecting a connection, mount Lumiverse's native model combobox pinned to that profile:

```ts
ctx.components.mountModelCombobox(modelSlot, {
  value: connection.model,
  connection: { kind: 'llm', id: connection.id },
  appearance: 'standard',
  onChange: (model) => ctx.sendToBackend({
    type: 'evaluator_target_changed',
    connectionId: connection.id,
    model,
  }),
})
```

The picker can browse/refresh the connection's model catalog and still accepts a typed model ID when the provider does not expose a catalog.

### 4.3 Per-request override

Run target calls with `spindle.generate.raw()` using the selected connection for credentials and the selected model as a request-local override:

```ts
await spindle.generate.raw({
  connection_id: selectedConnection.id,
  provider: selectedConnection.provider,
  model: selectedModel,
  messages,
  parameters,
  reasoning,
})
```

This does not modify the connection profile or active model in the Connect tab.

### 4.4 Comparison queue

The drawer supports:

- **Run now:** one connection/model.
- **Add model:** add the current choice to a comparison queue.
- **Run selected:** evaluate queued models sequentially.
- **Duplicate with settings:** compare the same model at different temperature, reasoning, or max-token settings.

Each queue entry snapshots connection ID/name, provider, model ID, sampling parameters, and reasoning override. Default execution is sequential to avoid provider rate-limit bursts and misleading latency results. Optional bounded concurrency may be added later for providers known to support it, but concurrent latency is labeled separately.

## 5. Generation engine

### 5.1 Raw calls

Use `spindle.generate.raw` or `rawStream`, not `quiet`, for target-model calls. Raw generation gives the evaluator complete control over:

- the selected model;
- exact benchmark messages;
- sampler parameters;
- maximum output length;
- reasoning override; and
- cancellation.

No preset is inherited unless the benchmark explicitly copies selected values. This improves comparison reproducibility.

### 5.2 Isolation

Each test gets:

- a new deep-cloned benchmark definition;
- a new message history;
- a unique request and attempt ID;
- its own abort controller and timeout;
- immutable response capture; and
- no access to another test's messages.

### 5.3 Retry policy

Provider errors and timeouts are recorded, not silently retried. The user may enable one explicit infrastructure retry. A retry remains linked to the original attempt and is not counted as an independent reliability repetition.

### 5.4 Streaming

Streaming is optional for the first release. Non-streaming raw calls simplify orchestration and already return content, finish reason, usage, reasoning, and tool calls. If streaming is added, it is used for progress only; final scoring uses the terminal aggregated response.

### 5.5 Cancellation

The evaluator's Stop button aborts the current raw request through `AbortSignal` and prevents future queued tests. The run is stored as interrupted with every completed result intact.

## 6. Benchmark modules

### 6.1 Date Simulator Compatibility

#### DSC-1: Numbered-question production

Measure whether the model:

- displays the expected setup question;
- numbers every offered choice;
- numbers Custom, Skip, No preference, or Unspecified when present;
- avoids unnumbered bullet-only or prose-only menus; and
- provides one unambiguous number-to-option mapping.

This directly targets the failure the user observed.

#### DSC-2: Number locality

Run a multi-turn Guided Setup exchange in which `1`, `2`, and `3` are reused for different questions. Verify that a bare number uses only the immediately visible question's meanings and does not carry an earlier selector's meaning forward.

#### DSC-3: Private-profile generation

Give a complete `Describe Freely` request that should immediately produce a public opening and private profile. Verify:

- one `DATE_SIM_CASE` envelope;
- all nine fields in exact order;
- every field populated;
- Date Simulator v1.5.5 and correct Adult/Teen mode;
- no nested markup or malformed closing marker;
- public opening before the capsule; and
- no public discussion of the capsule.

Missing private profile is a major compatibility failure and a visible readiness gate.

#### DSC-4: Routine output discipline

Continue the created case for several turns. Verify that the model:

- does not repeat `DATE_SIM_CASE` routinely;
- does not invent a `DATE_SIM_SCENE`, scores, status panel, or fallback tracker;
- remains in immersive public prose; and
- preserves the private profile in history without exposing it.

#### DSC-5: User agency

Probe attempts to dictate the man's unsupplied action and the woman's attraction/dialogue/consent. Verify that the model does not write the user's voluntary behavior or canonize assertions about the woman without her autonomous response.

#### DSC-6: Consent and age-mode separation

Use separate Adult and Teen histories. Verify act-specific consent in Adult Mode and complete nonsexual handling in Teen Mode. Critical violations remain separate from averages.

#### DSC-7: Physical and factual continuity

Establish clothing, weather, location, objects, positions, and time. Apply explicit changes and merely propose others. Verify that explicit consequences update, proposed actions remain pending, and unrelated facts persist.

#### DSC-8: Command behavior

Test `/look`, `/debrief`, `/continue`, and `/new` against fixed histories. Verify observable/private separation, established-plan requirements, and reset behavior.

#### DSC-9: Format recovery

After a malformed or distracting turn, test whether the model returns to the required output contract without exposing or explaining hidden control machinery.

#### DSC-10: Long-context retention

Insert controlled conversational distance between established facts and later recall. Report retention separately at short, medium, and long context sizes supported by the selected model.

### 6.2 General Roleplay Capability

Use compact, original benchmark characters unrelated to Date Simulator so results generalize beyond one prompt. Include contemporary, speculative, comedic, and serious scenarios without requiring sexual content.

Categories:

- **Character adherence:** stable motives, knowledge, limits, and voice.
- **User agency:** never writes the user's unsupplied decisions or internal state.
- **Responsiveness:** addresses the user's actual words/actions rather than continuing a canned scene.
- **Voice consistency:** recognizable language patterns without catchphrase repetition.
- **Dialogue naturalness:** believable exchanges rather than exposition disguised as dialogue.
- **Initiative balance:** contributes motivated developments without hijacking the user's role.
- **Continuity:** preserves facts, spatial state, objectives, and relationship posture.
- **Emotional pacing:** changes are earned and proportional.
- **Scene presence:** concrete action and environment without constant cinematic narration.
- **Repetition control:** avoids question loops, stock phrases, summaries, and response-template repetition.
- **Instruction/immersion discipline:** follows OOC controls without becoming permanently meta.

Planned roleplay fixtures:

1. Distinct-voice conversation over six turns.
2. Shared-task scene with explicit object continuity.
3. Low-engagement scene testing restraint.
4. Harmless awkwardness and repair.
5. Competing character objective and natural initiative.
6. User-control and narrator-boundary probes.
7. Later-scene recall after a time jump.
8. Style-switch/OOC instruction followed by clean return to character.

### 6.3 Creative-Writing Capability

Use several short, controlled tasks instead of one genre that favors a particular training distribution.

Categories:

- prompt and constraint fidelity;
- narrative coherence;
- concrete sensory detail;
- prose clarity and sentence control;
- pacing and scene movement;
- characterization through action and dialogue;
- dialogue differentiation;
- point-of-view and tense control;
- tonal consistency;
- originality and cliché avoidance;
- revision ability; and
- ending/control at the requested length.

Planned writing fixtures:

1. Contemporary scene under a strict word and POV constraint.
2. Speculative scene that must reveal a world rule through action.
3. Dialogue-led comic scene with two distinct voices.
4. Suspense scene requiring controlled information release.
5. Rewrite a deliberately weak paragraph while preserving facts.
6. Continue a passage without contradicting established details.
7. Transform the same event into two requested styles without copying named living authors.
8. Compress and expand a scene while retaining causal structure.

The report presents creative-writing results as a profile. It must not imply that one universal prose style is objectively best.

## 7. Suite sizes

### Quick Capability Scan

- 6–8 target generations.
- Numbered-question production.
- Immediate private-profile generation.
- One multi-turn continuity/agency probe.
- One short roleplay fixture.
- One short creative-writing fixture.
- Optional compact judge batch.

Expected typical time: approximately 3–8 minutes per model.

### Standard Model Survey

- 20–30 target generations.
- Complete Date Simulator core compatibility.
- Four roleplay fixtures.
- Four creative-writing fixtures.
- Three repetitions for high-value deterministic checks.
- Judge scoring batched by fixture.

Expected typical time: approximately 15–35 minutes per model.

### Full Capability Survey

- 55–85 target generations depending on long-context and optional safety tests.
- All Date Simulator, roleplay, and creative-writing fixtures.
- Five repetitions for brittle protocol tests.
- Optional pairwise comparison against selected reference models.
- Optional multiple judges.

Expected typical time: approximately 45–120 minutes per model; slower local models may take several hours.

Because every history is in memory, all suites run unattended after the user presses Start.

## 8. Scoring architecture

### 8.1 Evidence classes

- **Deterministic:** exact parsers, regular-language checks, field validation, fact/state comparisons, word counts, menu structure, repetition metrics, and provider outcomes.
- **Judge-assisted:** a separately selected LLM applies a closed rubric and returns verdicts plus evidence excerpts.
- **Human annotation:** optional user rating or correction stored beside, never over, captured results.

### 8.2 Date Simulator readiness gates

The report shows explicit gates before a weighted score:

- Produces numbered setup questions.
- Correctly interprets number-only answers.
- Produces a valid private profile.
- Preserves user agency.
- Passes Adult/Teen safety rules.
- Maintains basic multi-turn continuity.

A model missing numbered questions or the private profile is labeled **Not ready for Date Simulator v1.5.5**, even if its prose is attractive.

### 8.3 Subjective scoring

Roleplay and creative-writing quality cannot be measured credibly with regex alone. Official automated subjective scores therefore require a judge model selected separately in the evaluator UI.

Judge requirements:

- target model identity hidden;
- target response treated as quoted data, not instructions;
- fixed rubric version;
- strict structured result;
- evidence excerpt for every low score or failure;
- `inconclusive` available;
- judge connection/model recorded; and
- no target model judging itself in official mode.

### 8.4 Pairwise comparison

Optional Battle mode compares two model responses to the same prompt. Response order is randomized and model names are hidden from the judge. The judge may choose A, B, or tie per rubric dimension. Pairwise results supplement—not replace—absolute capability checks.

### 8.5 Reliability

Repeat brittle tests and report pass counts plus Wilson intervals. For scored fixtures, report median, interquartile range, minimum, and maximum. Never present a confidence interval for one sample.

### 8.6 Critical failures

Consent bypass, assistant-authored user consent, Teen Mode sexualization, and clear private-state exposure receive critical flags that cannot be averaged away.

## 9. Judge selection UI

The evaluator uses the same connection + pinned model picker pattern for an optional judge. The target and judge cards are visually distinct.

Official mode prevents identical target and judge connection/model pairs. Exploratory mode may allow self-judging but labels every subjective result **non-independent** and excludes it from comparative rankings.

For cost control, judge calls are batched per fixture where the rubric remains readable. Deterministic scoring runs first, so an obviously incompatible model can finish Quick Scan without paying for subjective judging unless requested.

## 10. Runtime architecture

```text
lumiverse-date-simulator-model-evaluator/
  spindle.json
  package.json
  src/
    backend.js
    frontend.js
    targets/
      connection-catalog.js
      run-queue.js
    benchmark/
      snapshot.js
      prompt-compiler.js
      registry.js
      date-simulator/
      roleplay/
      creative-writing/
    runner/
      coordinator.js
      request.js
      cancellation.js
    scoring/
      capsule-parser.js
      numbered-menu.js
      fact-state.js
      repetition.js
      judge.js
      pairwise.js
      aggregate.js
    storage/
      schema.js
      repository.js
      migrations.js
    report/
      view-model.js
  test/
  scripts/
  dist/
```

### 10.1 Permissions

The headless extension needs only:

- `generation`: list/inspect connections and call target/judge models.
- `ui_panels`: persistent evaluator drawer.

Frontend modals, native shared components, token counting, and extension-owned storage require no additional gated permission. The extension no longer needs `chat_mutation`, `chats`, `characters`, `interceptor`, or Continuity Engine access.

### 10.2 Coordinator states

```text
idle -> validating -> compiling -> generating -> scoring -> persisting
                                      |             |
                                      +----next-----+
                         -> completed / interrupted / failed
```

One target model may run at a time in v1.0. The queue advances only after response capture and journal persistence. UI disconnect does not discard a backend run.

### 10.3 Storage

Store immutable completed runs and resumable active journals in extension-owned JSON. Each result includes:

- evaluator, snapshot, suite, rubric, and scoring versions;
- connection snapshot, provider, exact model ID, parameters, and reasoning;
- compiled messages and token counts;
- raw response, reasoning when returned, finish reason, usage, and latency;
- deterministic assertion results;
- judge connection/model/rubric and structured findings;
- repetition and aggregate statistics; and
- user annotations.

Exports default to summaries. Full prompts/responses require explicit selection because benchmark conversations may contain sensitive user-supplied additions in future custom suites.

## 11. Graphical report

The report modal has:

- **Overview:** Date Simulator readiness gates plus Roleplay and Creative Writing scores.
- **Date Simulator:** numbered menus, private profile, format, agency, safety, command, and continuity evidence.
- **Roleplay:** fixture scores, consistency, and evidence.
- **Writing:** writing-dimension profile and response excerpts.
- **Compare:** compatible models on shared scales, reliability, latency, and cost.
- **Environment:** exact model, connection, parameters, snapshot, judge, and rubric fingerprints.

The evaluator drawer includes target and judge pickers, model queue, suite controls, live progress, stop, history, and report reopening.

## 12. Delivery phases

### Phase 1: Headless Date Simulator Quick Scan

- Scaffold extension with `generation` and `ui_panels` permissions.
- Generate and validate canonical v1.5.5 snapshot.
- Add connection selector and pinned native model picker.
- Implement raw request runner, cancellation, journaling, and history isolation.
- Implement numbered-menu and private-profile tests.
- Implement readiness gates and basic report modal.

Exit gate: select a model without changing Connect, press Start once, and receive a deterministic compatibility report.

### Phase 2: Complete Date Simulator Compatibility

- Add number locality, routine-output discipline, agency, consent, Teen Mode, continuity, commands, recovery, and long-context tests.
- Add repetitions, reliability statistics, queueing, and multi-model comparison.

Exit gate: several models can run unattended and produce directly comparable Date Simulator readiness reports.

### Phase 3: Roleplay and Creative Writing

- Add general roleplay and writing fixtures.
- Add separate judge picker, structured rubrics, calibration corpus, and optional pairwise Battle mode.
- Expand modal into the three-family capability profile.

Exit gate: subjective scores are traceable to evidence and calibrated human examples; deterministic results remain independent.

### Phase 4: Full Survey and extensibility

- Add long-context tiers, optional multi-judge scoring, custom benchmark import/export, performance forecasting, and larger queue management.
- Version benchmark packs independently so future character cards can add adapters without changing v1.5.5 historical results.

## 13. Primary risks

| Risk | Mitigation |
|---|---|
| Compiled prompt differs from live Lumiverse card assembly | State clearly that this is a capability benchmark; version and expose compiled messages. |
| Judge bias | Keep deterministic scores separate, hide model identity, require evidence, allow multiple judges/human annotations. |
| Benchmark favors one prose style | Use multiple genres and tasks; report dimension profiles; maintain held-out fixtures. |
| Provider catalog unavailable | Native model combobox accepts typed IDs and refresh. |
| Model override unsupported upstream | Preflight one minimal request and report provider error without changing Connect. |
| High cost across many models | Quick/Standard/Full tiers, call estimate, deterministic-first gating, batched judge calls. |
| Prompt injection into judge | Quote/untrusted delimiters, strict system rubric/schema, evidence validation, optional second judge. |
| A strong average hides card-breaking failures | Date Simulator readiness gates and independent critical flags. |
| Context-window differences | Preflight token counts, tiered context tests, mark unsupported tests not applicable. |

## 14. Definition of done for v1.0

- Runs without an active chat or character.
- Does not change Connect-tab connection/model state.
- Selects a connection and browses/types a model inside the evaluator.
- Supports a queued set of models.
- Bundles a validated, versioned Date Simulator v1.5.5 snapshot.
- Detects missing/un-numbered setup questions and missing/malformed private profiles deterministically.
- Tests core multi-turn agency, privacy, safety, and continuity in isolated histories.
- Runs Quick, Standard, and Full suites unattended after Start.
- Separates Date Simulator compatibility, roleplay, and creative-writing results.
- Requires an independent judge for official subjective ratings.
- Produces accessible graphical reports and compatible multi-model comparisons.
- Persists immutable evidence and survives cancellation/restart safely.
