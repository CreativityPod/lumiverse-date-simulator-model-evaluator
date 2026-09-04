# Changelog

## 0.4.1

- Confirm **Add model** inline: briefly change the button to **Added ✓**, identify the queued model, highlight and reveal its new queue row, then focus the connection selector for the next addition. The interaction supports screen readers and reduced-motion preferences.

## 0.4.0

- Separate behavioral pass/fail decisions from 0–4 quality ratings. A 2/4 is now shown as mixed but usable instead of becoming a failed requirement.
- Make result badges severity-aware: minor deterministic deviations are amber warnings, while major and critical requirement failures retain stronger states. Roleplay and writing result scores now show judged quality instead of length-only mechanical scores.
- Balance family scores equally by fixture, then repetition, so longer conversations and fixtures with more rubric dimensions do not silently dominate rankings.
- Scope criteria and deterministic checks to the turns where they apply. Add a real `/new` follow-through turn with a setup-phase prompt transition.
- Confirm semantic critical failures only across fresh repetitions or agreement from a different regrade model. Multiple turns in one conversation no longer confirm each other, and summary counts represent unique failed requirements.
- Require complete Date Simulator behavioral coverage before a Full-suite Ready verdict.
- Tighten exact numbered-menu option count/order, canonical age headers, reset marker occurrence/order, and word-limit deviation diagnostics.
- Add benign Teen Mode and established-consent controls. Full now contains 20 fixtures and 78 target calls; Standard contains 32 target calls.
- Use an explicit compact judge protocol with separate batches of at most six behavior or quality criteria, aimed at reliable structured output from capable local judges including Qwen 3.6 35B and Gemma 4 26B.
- Expand judge sanity calibration from six to eight anchors with mixed and strong quality examples. Bump report schema to 3, benchmark to 2.1.0, scorer to 3.0.0, and judge rubric to contextual-rubric.4.

## 0.3.3

- Give **Add model** the same primary color as **Run now**.
- Keep **Open report** available during active evaluations. Reports opened during a run remain viewable and exportable while delete and regrade controls stay disabled.

## 0.3.2

- Place **Add model** and **Refresh** in a vertical action area beside the target output-limit guidance. Both stay close to the model selector inside the collapsible Target model section, with **Refresh** below **Add model**; **Run now** remains visible while the section is collapsed.

## 0.3.1

- Make Target model settings collapsed by default, matching the Semantic judge section, while keeping **Run now** and **Add model** visible.
- Clarify why the 16,384-token capability default remains safer across reasoning and non-reasoning target models, and when a 3,000-token fixed budget is appropriate.

## 0.3.0

- Split report status into independent execution, evaluation-coverage and Date Simulator compatibility cards.
- Replace the ambiguous partial-compatibility verdict with scoped passes, noncritical issues, unresolved evaluations, semantic critical concerns and confirmed critical failures.
- Treat a deterministic critical failure as confirmed; require a repeated result or regrade agreement to confirm a semantic critical failure.
- Show triggering tests, rule source, rationale and evidence on the overview, with a direct action that opens the expanded Date Simulator result.
- Bump scorer version to 2.1.0 while retaining legacy verdict display support.

## 0.2.2

- Restore the Date Simulator protocol score on the main report and comparison cards; keep semantic behavior separate.
- Make judge sanity checks advisory and run them after grading. A disagreement no longer blocks all semantic scores.
- Simplify the judge format, retain valid partial grades, recover complete judgments from truncated JSON, and retry only missing criteria in bounded groups. Label unverified quotations instead of discarding otherwise usable ratings.
- Add **Grade saved responses** / **Regrade saved responses**, using the currently selected judge and creating a separate report without target calls.
- Show actionable reasons for missing quality scores. Bump the judge rubric to contextual-rubric.3.

## 0.2.1

- Add a run-status spinner and live per-request timeout countdown for target, judge and calibration calls.
- Restore the current countdown when reopening the panel; account for elapsed server time and delayed background-tab updates.
- Clear timers on request completion, Stop, run completion, errors and extension teardown. Respect reduced-motion preferences.

## 0.2.0

- Replace behavioral keyword heuristics with explicit contextual criteria across all 18 fixtures. Retain deterministic protocol and length checks.
- Add independent local/API judging for all fixtures, anchored quality ratings, strict JSON/coverage/evidence validation, explicit uncertainty, and six synthetic judge sanity examples.
- Separate completion, protocol compliance, semantic behavior and prose quality. Exclude incomplete outputs from capability scoring without losing response, reasoning or usage evidence.
- Scope readiness findings to their associated gates. Show planned/assessed coverage and prevent missing judging from becoming a pass or a quality score.
- Add live follow-up turns and preserve native reasoning carriers for target continuations. Keep reasoning and model identity out of judge input.
- Expose independent target/judge token, temperature, reasoning, timeout and provider-specific generation controls. Accept exact local or API model IDs through saved Lumiverse connections.
- Expand headless compilation to personality, scenario, phase-gated examples and command-gated card book entries. Bump benchmark/scorer/compiler versions to 2.0.0, snapshot to headless.2, report schema to 2, and judge rubric to contextual-rubric.2.
- Add detailed judge diagnostics and comparison configuration keys. Preserve and label legacy reports; no automatic migration or rescoring.
- Update suite target limits to Quick 7, Standard 30, Full 69. Judge limits with the enabled sanity check are 13, 36 and 75 additional calls.

Existing saved settings remain in effect. An older saved 2,000-token target limit or 2,400-token judge limit will not silently expand; review these fields when upgrading. Semantic judging remains opt-in.
