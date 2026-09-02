# Date Simulator Model Evaluator

A fully automatic, headless Lumiverse Spindle extension for comparing LLMs against the canonical Date Simulator v1.5.5 behavior contract, general roleplay fixtures, and creative-writing briefs.

The evaluator does not require an active character or chat. It does not create messages, run display regex scripts, depend on Continuity Engine, or change the model selected in Connect.

## What it measures

Date Simulator compatibility is reported separately from general prose quality. The release includes:

- numbered Guided Setup choices and `/new` startup routing;
- current-question number locality;
- one valid, exact nine-field `DATE_SIM_CASE` private profile after an initial opening;
- no routine case repetition, legacy scene capsule, score panel, or fallback tracker;
- user and generated-character agency;
- Adult/Teen safety and act-specific autonomy;
- observable/private separation for `/look`;
- object, position, and factual continuity;
- general roleplay agency, voice, responsiveness, initiative, and continuity fixtures; and
- constrained creative writing, revision, dialogue, POV, pacing, and ending-control fixtures.

Missing numbered choices and a missing or malformed private profile are hard readiness gates. They cannot be hidden by a strong writing average.

## Suites

| Suite | Target calls | Repetitions | Typical purpose |
|---|---:|---:|---|
| Quick Capability Scan | 7 | 1 | Fast compatibility diagnosis |
| Standard Comparison | 24 | 2 | Routine cross-model comparison |
| Full Capability Suite | 54 | 3 | Reliability-oriented model profile |

If the optional independent judge is enabled, subjective roleplay and writing outputs are scored in compact batches. Judge calls are additional. Official mode prevents a target model from judging itself.

## Using the extension

1. Install the repository as a Lumiverse Spindle and grant `generation` and `ui_panels` permissions.
2. Open **Evaluator** in the Lumiverse drawer.
3. Choose a saved LLM connection, then use the connection-bound model combobox to browse or type a model ID.
4. Choose Quick, Standard, or Full and adjust temperature, maximum output tokens, or reasoning.
5. Use **Run now**, or add several choices to the comparison queue and choose **Run selected**.
6. Leave the queue running unattended. Every completed response is journaled.
7. Open a stored graphical report or the automatic comparison modal.

The connection supplies its provider adapter, endpoint, and stored credential. The chosen model ID is passed only to each evaluator request and is never written back to the connection profile.

## Reports and exports

The report modal includes:

- Date Simulator readiness gates;
- separate Date Simulator, Roleplay, and Creative Writing scores;
- objective versus independent-judge labels;
- fixture-level findings and evidence;
- raw target responses;
- provider, exact model, sampler, reasoning, token use, latency, and errors;
- canonical card source, snapshot, compiler, scorer, and judge-rubric fingerprints; and
- summary-only and full-evidence JSON export.

Provider failures and interrupted tests are recorded as runtime errors or inconclusive evidence, not arbitrary capability failures.

## Canonical snapshot

`npm run build` regenerates the prompt snapshot from the bundled `benchmark-source/Date_Simulator_CCv3_v1.5.5.json` and rejects any source whose SHA-256 is not explicitly approved. The project and distributed backend are self-contained and do not need the parent Date Simulator repository.

Current approved card SHA-256:

```text
ec859dc21fc2af4bc662c5f3e5de07b72fbf2194e44b4e9324d8a868327c2634
```

## Development

```bash
npm run check
```

The package has no runtime or development dependencies. Build output is committed under `dist/` because Lumiverse loads the manifest entry files directly.

Further design references:

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Benchmark and extension test plan](docs/TEST_PLAN.md)
- [Graphical report specification](docs/REPORT_UI_SPEC.md)

## Scope boundary

This measures model capability against a stable, explicit headless compilation of Date Simulator v1.5.5. It is not an end-to-end certification of Lumiverse prompt assembly, regex rendering, live card macro activation, image understanding, memory extensions, or Continuity Engine tracking.
