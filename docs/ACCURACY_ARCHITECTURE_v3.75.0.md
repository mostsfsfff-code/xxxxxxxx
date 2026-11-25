# v3.75.0 — Making "Auto" safe to be the only button

## The goal, stated so that it can actually be met
"100 % accurate difficulty label" cannot be achieved by any rater, human or machine, because the label itself is subjective: in the BEA 2024 shared task (USMLE item difficulty from text) the "predict the mean" baseline had RMSE ≈ 0.315 and fine-tuned biomedical BERT teams reached only ≈ 0.30–0.315; Bloom-level labels of exam questions are inconsistent between raters. What CAN be engineered is the thing the student actually needs:

> **No answer is written with less depth than the model's own judgement of that question calls for, and nothing slow is spent where it is not needed.**

## Layers (each free unless it disagrees with the one before)
| Level the local Director picked | Safety net that checks it | Cost of the check |
|---|---|---|
| easy → `light` (one compact request) | the writer ends with `@@LEVEL: easy|medium|hard@@`; medium/hard → that answer is discarded unseen and the question is re-run one level up, once | a few tokens; +1 request only on disagreement |
| medium → `balanced` | the silent solve ends with `LEVEL: easy|medium|hard` (the prompt already had CONFIDENCE; LEVEL added inside the frozen token budget: 1013 ≤ 1022); `hard` → ONE more careful solve (Flash, high thinking) before the writers start | a few tokens; +1 request only on disagreement |
| hard → `deepflash` / `deep` | already the deepest preset | — |
| numbered tasks | one-request contract path with item audit | — |
Floors (always): easy only on positive evidence; any calculation or clinical panel ≥ medium; unreadable text = medium; Retry = one level up.

## Learning (director-learn.js, local, zero requests)
Every light/balanced answer now yields a free teacher signal: the model's own rating. Retry is the human one. Compared with the local rating they adjust per-signal weights and a bias that are ADDED to the Director's steps next time (clamped −1…+2; pure recall items never adjusted; 90-day expiry; reset with `clearLearning()`). The local rater therefore converges, on the student's own questions, toward what the model and the student consider hard: fewer answers need an escalation, fewer easy ones are over-rated. It cannot be better than its teacher. A human never teaches "too deep".

## Calibrate it on YOUR questions (scripts/route-audit.mjs)
`GEMINI_API_KEY=… node --import ./tests/register.mjs scripts/route-audit.mjs questions.json` sends each question once to Flash-Lite (≈ 60 output tokens, paced for 15 req/min), prints the Director-vs-model agreement matrix, lists the cases where the Director is LOWER than the model (the risky side) and writes `route-audit-out.json` to label by hand and feed to `scripts/difficulty-eval.mjs`. Without a key it only describes the Director's distribution.

## Measured / tested (661/661)
* Rule accuracy history (honest numbers = first run on fresh sets): clinical 94.4 % / 96.7 %; pure theory 87.5 / 77.8 / 79.2 / 70.8 % (mean ≈ 79 %; before the concept model 41.7–45.8 %). Corpus-tuned figures (95–100 %) are regression gates, not estimates.
* The self-checks and the learning are covered end to end with a mocked model: light hard/medium/easy/missing marker, balanced hard/medium/easy/none, one final answer only, markers never shown, LEVEL line never reaches a writer, observation recorded, learned lift visible in the route, bounds, expiry, reset, recall immunity, purity of the Director.

## What is NOT guaranteed — read this
1. **The accuracy of the labels is not 100 % and cannot be.** On unseen pure-theory questions the local rater's first-run accuracy was about 70–88 %.
2. **The safety nets are only as good as the model's self-rating, which was not measured.** LLMs rate their own difficulty imperfectly. The nets only move a question UP, so the failure mode is extra time, but a question both the rater and the model under-rate is not caught. A medium rating from the solve in `balanced` does not escalate (only `hard` does); a light answer escalates on medium or hard.
3. A question routed `hard` that is actually easy costs time (deepflash = same number of requests as balanced, more thinking). The router never goes DOWN on its own.
4. The learning needs volume (a few dozen answered questions) to matter and nothing validates it against ground truth except you; verify with `route-audit.mjs` and `difficulty-eval.mjs` on your own data.
5. The corpora were written and labelled by the same assistant as the rules.
6. UI not run in a browser; Google's latency is outside the code.
