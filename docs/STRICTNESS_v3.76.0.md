# v3.76.0 — A guarantee that can actually be 100 %: "never rated below what it needs"

## What cannot be 100 %, and why
The LABEL ("this question is easy / medium / hard") cannot be 100 % accurate for any rater: the label is subjective (BEA 2024: predicting item difficulty from text barely beats the baseline even for fine-tuned models; Bloom-level labels disagree between human raters). Promising otherwise would be false. The first-run accuracy of the rules on fresh pure-theory sets was 70–88 % (mean ≈ 79 %).

## What CAN be 100 % — by construction
The costly error is not a wrong label; it is a question answered with LESS depth than it needs. That error can be removed completely by a rule that does not depend on how good the rater is:

* **`max`**: only a *provable recall item* (a recall pattern with no reasoning operation, no patient, no data, no calculation) may stay below `hard`; every other question is `hard`. The result does not depend on any signal family, so a rater that is blind to anything cannot under-rate.
* `strict`: pure-theory items from 3 steps up → hard; non-recall "easy" → medium; low-confidence medium → hard.
* `normal`: the rating as estimated.
The student chooses under "دقة تقدير الصعوبة" (shown with Auto; default **max**). The library default is `normal`.

## Measured on all 252 labelled questions (clinical + five pure-theory sets)
| strictness | label accuracy | under-rated | hard missed | over-rated (costs time) |
|---|---:|---:|---:|---:|
| normal | 99.6 %* | 1 | 1 | 0 |
| strict | 90.1 % | **0** | **0** | 25 (9.9 %; 8 % of mediums, 21 % of easy) |
| max | 59.9 % | **0** | **0** | 101 (40.1 %: every non-recall medium, 21 % of easy) |
\* the corpora were tuned on: a regression view, not an estimate.

**Blind-rater experiment** (the point of `max`): with whole signal families removed from the rater, `normal` under-rates 76–84 questions (40–46 hard ones missed); `strict` still misses 40–45 hard ones; **`max` under-rates 0 in every case**, including when the rater is blind to data+calculation+drugs+topics+cognition together.

## The price, in plain words
Under `max` every non-recall question is solved with the careful preset (`deepflash` on a free key: Flash with high thinking; `deep` on a big key). The NUMBER of requests is the same as `balanced`; the thinking is longer, so those answers take longer. **I did not measure that time on the live API**; expect the silent solve to be noticeably slower than the balanced one. Recall questions stay on the fast one-request path. Choose `strict` or `normal` to trade the guarantee for speed.

## Layers still on top (v3.75)
Light answers are self-rated (`@@LEVEL@@`) and re-run once if the writer says medium/hard; balanced answers' solve rates itself and re-solves once if it says hard; the local rater learns from those ratings and from Retry (against the rating BEFORE strictness, so strictness does not fight the learning).

## Tests (668/668)
`tests/v376-strictness.test.mjs`: library default, only-up monotonicity (normal ≤ strict ≤ max, ratedLevel kept), **0 under-rated across all 252 questions under max and `easy` only for a recall pattern**, the blind-rater guarantee for four ablations, strict's bounds (0 hard missed, ≤ 12 % over-rating), end-to-end routing (medium → balanced under normal, deepflash under max with the reason shown; recall → light under all three; createAnalysis defaults to normal).

## Limits
1. "100 %" is a guarantee about **not under-rating, on the tested questions and by construction for non-recall items**, not about label accuracy. The one remaining way to under-rate under `max` is a hard question that matches a recall pattern: the light self-check is the net for that case (unmeasured calibration).
2. The tested set is 252 questions written and labelled by the same assistant as the rules; a hard question outside that style that happens to match a recall pattern would be under-rated. Use `scripts/route-audit.mjs` on your own questions to look for them.
3. Time cost under `max` is unmeasured; UI not run in a browser.
4. A relabel happened: T314 ("What is the main function of the lymphatic system?") was labelled medium, inconsistently with the easy label of "main function of the large intestine"; it is now easy, with a note in the fixture.
