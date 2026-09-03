# Changelog

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
