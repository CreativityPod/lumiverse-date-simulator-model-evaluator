# Validating a local or API judge

The built-in eight-example check is a sanity check, not proof that a model can judge nuanced fiction. It tests paraphrased autonomy, an unrelated negation masking enacted actions, an empty acknowledgment, reversed object relationships, a synonymous scene event, instructions embedded in candidate text, mixed-but-usable quality, and strong quality. The synthetic anchors are in `src/calibration.js`; their expected labels are never sent to the judge.

The production judge prompt deliberately uses short numbered rules, compact JSON, batches of at most six criteria, and separate behavioral and quality batches. This format is intended to remain practical for capable local judges in the Qwen 3.6 35B and Gemma 4 26B class as well as hosted API models. Reasoning can remain inherited, but disabling visible thinking at the local server can reduce truncation when the model supports that option.

Run Quick with the intended judge settings. Inspect Environment → Judge calibration and errors if a sanity example fails. The check is advisory and runs after target grading; failed examples make the scores provisional. A truncated or malformed judge answer is a configuration issue rather than disagreement about the candidate. Increase output/context allowance or change supported reasoning settings as appropriate; do not treat rejected JSON as a low target score.

Before trusting model rankings, build a separate reviewed sample of real outputs from each evaluated model family. Include strong, weak and borderline responses, paraphrases, omissions, negation, long answers, adult/nonsexual-teen boundaries, ambiguous social cues, and incorrect state relationships. Keep a held-out set distinct from examples used to refine prompts.

For each criterion, have a human reviewer assign pass/fail/uncertain and cite evidence. Compare judge labels with those labels, recording false passes and false failures separately. Prioritize false passes on agency and age safety. Inspect disagreement rather than assuming that majority or the larger model is correct. A second independent reviewer or model can help, but is not ground truth.

Also repeat a selection of identical grading requests. Record label stability, invalid-JSON rate, uncertainty, latency and token use at the actual quantization, context size, sampler and reasoning settings you intend to deploy. Test equivalent paraphrases and reordered surrounding context; a judge should not reward keyword copying or verbosity.

Use one fixed judge configuration for a comparison batch. Avoid the target model judging itself, including renamed copies and fine-tunes. The extension checks exact IDs only. A different family reduces one source of bias but does not establish neutrality. Preserve the exported full evidence and software/model configuration with your human labels.

Do not promote an aggregate quality percentage to a scientific benchmark claim on the basis of this small fixture suite. The displayed percentages apply to assessed criteria; always report completion and grading coverage alongside them.
