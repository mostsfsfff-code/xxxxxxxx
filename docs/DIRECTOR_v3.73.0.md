# v3.73.0 — The Director: a precise, fast local question analyser

## Problem
The v3.72 keyword rater rated a mixed acid-base question (pH, PaCO2, HCO3, Na, Cl, "anion gap", "mixed … compensation" options) as MEDIUM. Measured on labelled sets it was **75.0 %** (held-out, n = 36) and **70.0 %** (dev, n = 60); it recognised only 6 of 20 hard dev items.

## Root cause
It counted words ("calculation", "EXCEPT", a drug name). Difficulty is the number of reasoning steps an item demands, and those come from structure: a clinical panel with values, a calculation and its conversions, interacting drugs, a multi-part ask, near-identical options, an intrinsically multi-step topic.

## The Director (src/lib/director.js)
One pass, pre-compiled patterns, ≈ 0.3–0.6 ms per question (Node, measured):
1. **parse** stem / line options / inline options / select-all / NGN formats
2. **data** named analytes with values (stem only: answer options are choices, not data) → distinct count; panels: acid-base (+ anion-gap possible from Na/Cl/HCO3, + mixed/compensation words)
3. **calculation** detection and complexity: weight-based, per-minute→per-hour, concentration, divided doses, named formulas, protocol titration
4. **cognition** patient context, decision words, exam traps, multi-client priority, sequences, two asks in one, select-all, long stems, judgement items (delegation, scope), Arabic-text guard
5. **drugs** high-risk drugs and interactions
6. **topics** a hand-written list of 21 intrinsically multi-step topics (acid-base, DKA/HHS, sepsis, burns, ECG, toxicity, electrolyte emergencies, transplant, TMA, ventilation, hypertonic saline …)
7. **options** length, near-duplicate options, mixed/combined/sequence options
→ **steps** (each family capped so one noisy family cannot decide) → **level** → **confidence** → **reasons** shown to the student under the route line (e.g. "غازات دم بقيم · فجوة أنيون ممكنة · اختيارات مركّبة").
Safety: EASY only on positive evidence (a recall pattern, or a short plain item); calculation or a clinical panel ≥ medium; a low-confidence medium/hard borderline that involves a calculation, acid-base or ≥ 2 hard topics is rated hard; unreadable text = medium; *Retry* goes one level up.

## Measured (scripts/difficulty-eval.mjs)
| Set | n | v3.72 keyword rater | Director, first run | Director, now |
|---|---:|---:|---:|---:|
| dev (tuned on) | 60 | 70.0 % | 90.0 % → 100 % after tuning | 100 % (not an estimate) |
| held-out (frozen first) | 36 | 75.0 % | **94.4 %** (2 medium→easy) | 100 % after 2 generic fixes (no longer clean) |
| validation (written after tuning) | 30 | — | **96.7 %** (1 hard→medium) | 100 % after 1 topic (no longer clean) |
The honest generalisation estimates are the **first-run** numbers: 94.4 % and 96.7 %. With n = 30 a 29/30 result has a 95 % interval of roughly 83–99 %.
No hard item was ever rated easy; no medium item rated easy in the final state.
Probes outside the corpora (Arabic recall → easy; Arabic vignette and Arabic no-signal item → medium; a protocol question on a heparin drip with aPTT 112 → medium (arguably medium-hard)).

## Guarded by tests (644/644; `tests/v373-director.test.mjs`)
Accuracy gates (dev ≥ 95 %, held-out ≥ 95 %, validation ≥ 90 %), safety gates (0 hard→easy, 0 medium→easy, ≤ 1 hard→medium), ≥ 15-point gain over the old rater, the exact acid-base question is HARD with its reasons, speed (median < 2 ms, p99 < 15 ms, 8,000 characters < 25 ms), determinism/purity/garbage input, units-in-options, calculation complexity, inline options, age phrases, judgement items, confidence, shape compatibility of `heuristicLevel`.

## Limits — read before trusting
1. **It does not understand the question.** It is a transparent estimator; a hard conceptual item with no numbers, drugs, topics or trap words can read medium; a tricky recall item can read easy only if it matches a recall pattern.
2. **The corpora were written and labelled by the same assistant that wrote the rules**, in one style. Real-exam accuracy is unknown and probably lower than these numbers. The fix is data: add your own labelled questions and run the eval script; it prints the confusion matrix and the misses.
3. The topic list (21) and drug list are hand-written and incomplete (no pediatrics-dose tables, psychiatry, etc. beyond a few patterns). Arabic-only questions are handled conservatively (never easy without a recall pattern) rather than analysed.
4. UI not run in a browser; the new "السبب" line under the route note should be checked by eye.
