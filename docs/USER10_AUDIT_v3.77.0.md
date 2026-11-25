# v3.77.0 — Audit of ten student-supplied questions

First run (v3.76, strictness "normal"): agreement with my labels 6/10.
| # | Question (short) | my label | normal | strict | max |
|---|---|---|---|---|---|
| 1 | CO poisoning, pulse-oximeter reading | medium | medium | medium | hard |
| 2 | PPV with prevalence 1/1,000, sens/spec 99 % | **hard** | **easy ✗** | medium ✗ | hard |
| 3 | STEMI with SpO2 96 %: which is an error? | medium | hard | hard | hard |
| 4 | DKA, glucose 550, K 3.1: most dangerous | hard | hard | hard | hard |
| 5 | Warfarin skin necrosis mechanism | medium | hard | hard | hard |
| 6 | Scurvy vignette with distractors | medium | medium | medium | hard |
| 7 | Heart-failure signs → which organ | easy | medium | medium | hard |
| 8 | Erythema toxicum neonatorum management | medium | medium | medium | hard |
| 9 | Pre-eclampsia, definitive treatment | medium | medium | medium | hard |
| 10 | Transfusion reaction, first action | medium | medium | medium | hard |

Findings (both generic, both fixed):
1. **Q2 was rated EASY** (steps 0, "no difficulty signal"): a conditional-probability problem written as prose has no "calculate", no unit, no drug. New rule: two or more biostatistics terms (prevalence, sensitivity, specificity, predictive value, likelihood ratio, NNT, relative risk, odds ratio …) + a probability ask + a number = a calculation (4 steps). A definition question that merely names sensitivity/specificity is not.
2. **Q7 got a false "two asks"**: ", which primary organ is failing?" was read as a second question. A second ask now needs a question word earlier in the stem.
After the fixes: **7/10** agree with my labels; Q2 hard under every setting; **no question is under-rated by `normal` below medium, none by `max` at all**. The three remaining differences are over-ratings (safe): Q3 and Q5 are arguable (a guideline/mechanism-recall trap inside a clinical frame: I labelled them medium, the rater says hard) and Q7 is medium instead of easy because it is a patient vignette, not a recall pattern.
No regression: all eight earlier corpora unchanged (tuned ones 94–100 %); 672/672 tests; fixture `tests/fixtures/difficulty-user10.json` (labels are mine; Q2's fix was made after seeing its result, so it is a regression case, not an estimate).
