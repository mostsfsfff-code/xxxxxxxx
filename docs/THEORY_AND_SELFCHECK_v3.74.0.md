# v3.74.0 — Pure-theory difficulty, the model's self-check, learning from Retry

## What was wrong
A hard question with no numbers, drugs or listed topics read as MEDIUM (or EASY). Measured honestly on pure-theory sets the v3.73 Director scored **45.8 %** (frozen held-out, n = 24) and **41.7 %** (dev, n = 36); on the held-out set 0 of 8 hard items were rated hard and 1 was rated easy.

## What the research says (opened in this audit)
* **BEA 2024 shared task** (predicting USMLE item difficulty from text): the "predict the mean" baseline scored RMSE ≈ 0.315 and the participating teams — including fine-tuned biomedical BERT models — landed around 0.30–0.315. Predicting how hard an item is *for examinees* from its text alone barely beats guessing, even with strong models. What helped was the answers of LLMs (UnibucLLM, arXiv 2404.13343).
* **Bloom's-taxonomy question classification** from verbs and sentence structure is a mature, workable technique (TF-IDF/POS features, keyword weighting; labels are subjective). That is the right target here: *how much reasoning the item demands*, not examinee difficulty.
Consequence: no local rule set can honestly promise "very high accuracy" on subtle theory items. The design below pushes the local model as far as measurement shows it can go, and adds model-based safety nets that cost no extra request unless they disagree.

## What was built
1. **Concept model** (director.js): question class (why/how → causal, differentiate/compare, predict/what-if, role/purpose, evaluate statements, negated explanation, multi-axis "in terms of A, B and C", conditions/exceptions/thresholds, contrast/paradox), relation density, mechanism vocabulary (≈ 230 terms) and morphology, body-system integration from the **stem** (distractor options no longer inflate it), clause structure, option structure (explanatory options, one very long option, compound options), a **comprehension floor** (why/how/compare/predict are never plain recall) and a **multi-operation** step (two different reasoning operations in one item = a chain).
2. **Principled fixes found by fresh sets**: a recall pattern is cancelled when any reasoning operation is present; the loose "Which of the following is…" recall branch was tightened; "mechanism" counts only as a question about a mechanism ("Frank-Starling mechanism" is a name); a single high-risk drug name in a theory item is not a drug-safety item; "both" is not a mixed-disorder cue.
3. **Self-check for light answers** (analysis.js): a question the rules rate EASY gets the compact one-request answer, and its writer ends with `@@LEVEL: easy|medium|hard@@` (a few tokens, same request). If it says medium/hard, that answer is discarded unseen and the question is re-run one level up, **once**. Extra request only when the rater and the model disagree. The marker is stripped from everything the student sees. Local rater says easy → protects the costly error (hard answered as easy).
4. **Learning from Retry** (director-learn.js): Retry is the one free ground-truth signal ("not deep enough"). It is recorded against the question TYPE and the locally-rated level; 2 recent Retries of a type lift future questions of that type one level, 4 lift two; never lowers; 45-day expiry; `clearLearning()` resets; the route line says when a question was lifted for this reason.

## Measured (first run on each fresh set, before it was tuned on)
| Pure-theory set | n | v3.73 | first run of v3.74 rules at that time |
|---|---:|---:|---:|
| held-out (frozen) | 24 | 45.8 % | **87.5 %** |
| validation | 18 | — | **77.8 %** (3 hard→medium, 1 hard→easy) |
| validation-2 | 24 | — | **79.2 %** (5 hard→medium, 0 hard→easy) |
| validation-3 (different style) | 24 | — | **70.8 %** (hard 7/8; 5 medium→easy from a recall false positive, fixed) |
Mean of the four first runs ≈ **79 %**. After tuning, all sets show 94–100 % — **not estimates**. Clinical corpora stayed at 100 % throughout. Speed ≈ 0.4–1.9 ms per question.

## Tests (654/654)
Theory regression gates (every theory set ≥ 90 %; 0 hard→easy; ≤ 1 medium→easy; ≤ 2 hard→medium), principled-fix cases, distractor-inflation case, marker parsing (strip, half-stream), E2E self-check (easy → no escalation; medium → balanced; hard → deepflash, one final answer only, marker never shown; missing marker → no escalation; medium/hard-routed questions are never self-checked), learning (thresholds, hard never recorded, expiry, reset, E2E lift after two Retries).

## Limits — read before trusting
1. **The honest accuracy on unseen pure-theory questions is about 70–88 % (four fresh first runs), not "very high".** After the last fixes it has not been measured on a new set. The residual error is mostly hard→medium (shallower answer, not a wrong fact); hard→easy was 0 in the last three fresh sets.
2. The self-check covers only **light** (easy-routed) answers. A hard question rated MEDIUM is not caught by it: adding a rating line to the balanced prompts would exceed the repository's prompt-token budget test (a deliberate guard); raising that budget is a decision for the owner. The model's self-rating is also unmeasured for calibration (LLMs rate their own difficulty imperfectly); it can only move a question UP.
3. Labels and questions were written by the same assistant as the rules (one style, one labeller); one label (lymphatic function) is noisy. Add your own labelled questions and run `node scripts/difficulty-eval.mjs <file>`.
4. Learning needs the student to press Retry; it never lowers a level and has no UI yet (storage key `clinix:directorLearn:v1`).
5. UI not run in a browser.
