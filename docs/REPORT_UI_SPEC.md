# Headless evaluator UI and graphical report specification

## 1. Drawer workflow

The persistent evaluator drawer is the control center. It must not require an active chat.

### Target model

1. Connection selector populated from `spindle.connections.list()`.
2. Native model combobox pinned to the selected LLM connection.
3. Sampling controls: temperature, maximum output tokens, and reasoning override.
4. **Run now** and **Add model** actions.

Selections remain evaluator-local. The Connect tab and active model are not changed.

### Comparison queue

Each row shows:

- connection name/provider;
- exact model ID;
- suite;
- sampling/reasoning summary;
- estimated requests/time; and
- remove/duplicate actions.

**Run selected** evaluates the queue sequentially by default.

### Optional judge

A separate, visually distinct section contains its own connection and model pickers. Official subjective mode blocks selecting the same target and judge pair. Deterministic-only mode requires no judge.

### Run state

Show current model, suite, fixture, request count, elapsed/remaining estimate, deterministic score progress, Stop, and whether judge calls are pending.

## 2. Report modal

Use frontend `ctx.ui.showModal()` for Lumiverse-owned chrome and extension-owned interactive body content.

### Header context

Always show:

- provider and exact model;
- suite and repetition count;
- Date Simulator snapshot version/fingerprint;
- parameters/reasoning summary;
- judge identity or deterministic-only label; and
- direct-comparability status.

## 3. Overview

The first view answers three questions independently:

1. Is this model ready for Date Simulator v1.5.5?
2. How strong is it at general roleplay?
3. How strong is it at creative writing?

### Date Simulator readiness gates

Display Pass / Fail / Not tested / Inconclusive rows for:

- numbered questions;
- number-only answer locality;
- valid private profile;
- routine format discipline;
- user agency;
- Adult/Teen safety; and
- basic continuity.

If numbered questions or the private profile fail, display **Not ready for Date Simulator v1.5.5** regardless of prose scores.

Not tested means no test was run for that area; it does not mean failure. Inconclusive is reserved for attempted tests without a usable verdict. Use neutral styling for Not tested, distinct from the warning styling for Inconclusive. Completed legacy reports may correct this display from their stored result coverage without rescoring or rewriting the report.

### Capability profiles

Use horizontal bars for Roleplay and Writing dimensions. Bars are more readable than radar charts on narrow screens and support exact labels, values, sample counts, and uncertainty.

### Score distribution across completed tests

Show completed, scored objective results only. Group identical scores into numbered circles showing how many results share that score; stagger nearby groups to avoid overlap. Add a separate diamond for the mean, a 0–100 axis, and a visible textual count breakdown. Show result count, mean, median, and range. Hover/focus evidence identifies the contributing test and repetition.

Explain that a result is one test attempt, including repetitions. This chart compares different tests, not repeat-run reliability; it is not a confidence interval. A result set of 0, 100, 100, 100, 100 must visibly show counts 1 and 4, mean 80, median 100, and range 0–100.

## 4. Detail tabs

- **Overview:** readiness gates, high-level profiles, objective score distribution, highest-severity findings.
- **Date Simulator:** numbered-menu parses, capsule validation, agency/safety/continuity checkpoints, and raw evidence.
- **Roleplay:** fixture-by-fixture rubric dimensions, repetition metrics, and excerpts.
- **Writing:** constraint checks, writing dimensions, and excerpts.
- **Compare:** compatible model rows, category bars, reliability, latency, token use, and critical blockers.
- **Environment:** connection/provider/model, parameters, reasoning, snapshot/compiler/scoring/rubric versions, and judge provenance.

## 5. Evidence and scoring labels

Every assertion shows:

- verdict: Pass, Fail, Not tested, Not applicable, or Inconclusive;
- severity;
- source: Objective, Judge, or Human;
- fixture and repetition;
- exact evidence excerpt; and
- rubric/parser version.

Selecting an assertion expands evidence in the same modal. Avoid consuming a second modal for ordinary drill-down.

## 6. Comparison behavior

Default comparison includes only runs sharing:

- benchmark snapshot/compiler version;
- suite and scoring version;
- relevant parameters/reasoning; and
- judge/rubric version for subjective scores.

An explicit **Show incompatible runs** option reveals others with a persistent explanation of differences.

Default sorting:

1. critical failures;
2. Date Simulator readiness;
3. selected capability family score;
4. reliability; and
5. median latency.

Do not let a general writing score conceal Date Simulator incompatibility.

## 7. Pairwise Battle view

Optional Battle mode shows aggregate wins/ties/losses by dimension. The judge sees anonymized A/B responses in randomized order. The report stores order, judge, rubric, and evidence. Pairwise outcomes never replace deterministic protocol gates.

## 8. Status language

Use icon, text, and color together:

- ✓ Pass
- ! Fail
- – Not applicable
- – Not tested
- ? Inconclusive
- ◆ Critical

Suggested model-level labels:

- **Ready for Date Simulator**
- **Partially compatible**
- **Not ready: setup protocol**
- **Not ready: private profile**
- **Critical safety/agency failure**

Roleplay and Writing use separate descriptive bands and always retain numeric/category detail.

## 9. Empty and partial states

- No connections: explain how to add one and provide a button to open Connections.
- No model catalog: allow typed model ID and refresh.
- Deterministic-only: show Roleplay/Writing objective metrics but label subjective score unavailable.
- Judge failed: keep target results and mark subjective assertions inconclusive.
- Interrupted run: show completed fixtures and exclude missing work transparently.
- One repetition: no confidence language.
- Provider/model rejected: show runtime error separately from capability score.

## 10. Export

Offer explicit privacy levels:

- Summary JSON.
- Summary CSV.
- Summary plus evidence excerpts.
- Full compiled prompts and responses.

The default is summary only. Exports include all version and environment fingerprints required to reproduce the comparison.

## 11. Accessibility and responsive requirements

- Real buttons, labels, and tab semantics.
- Keyboard operation and visible focus.
- Lumiverse modal focus trap/Escape behavior.
- Text alternative for every chart.
- No color-only status.
- Selectable evidence.
- Reduced-motion support.
- Approximately 360 px, 736 px, and 1024 px verification.
- 200% zoom and large-font verification.
- Light, dark, accent, glass, and compact-density themes.
- Mobile comparison rows stack with visible field labels.

## 12. UI acceptance criteria

- A model can be selected and run without opening or changing Connect.
- The exact requested model is visible before, during, and after execution.
- The user can queue several models and leave the evaluator running unattended.
- Missing numbered questions and missing private profiles are immediately understandable.
- Date Simulator, Roleplay, and Writing results cannot be mistaken for one another.
- Objective and judge findings cannot be mistaken for one another.
- Every failure traces to exact evidence.
- Incompatible runs are not silently combined.
- The report remains usable on mobile and with assistive technology.
