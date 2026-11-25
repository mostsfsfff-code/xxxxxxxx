# Difficulty corpora (v3.73)
Labels follow the cognitive demand of the item: **easy** = recall of one fact/range/term/antidote; **medium** = apply knowledge to a patient in 2–3 steps (priority, teaching, one action, recognising a complication); **hard** = multi-step: calculation with unit conversion or protocol, acid-base / multi-lab interpretation, interacting drugs, sequences, select-all with data, multi-system emergencies.
* `difficulty-dev.json` (60) — the set the rules were tuned on. 100 % there is NOT an accuracy estimate.
* `difficulty-heldout.json` (36) — written and frozen before any tuning. First run: **94.4 %**. Two generic gaps (age phrases like "6-month-old", delegation/judgement items) were then fixed, so it is no longer a clean estimate.
* `difficulty-validation.json` (30) — written after all tuning, evaluated once: **96.7 % (29/30)**; the miss (V29) got a rule afterwards.
**Labelled by the assistant that wrote the rules, not by an exam board, and all in the same style: the numbers are optimistic.** Add your own questions as `{id,label,text}` to `difficulty-dev.json` (or a new file) and run `node scripts/difficulty-eval.mjs <file> --verbose`.

## Pure-theory corpora (v3.74): no numbers, no drug, no patient
`difficulty-theory-dev.json` (36, tuned on) · `-heldout.json` (24) · `-validation.json` (18) · `-validation-2.json` (24) · `-validation-3.json` (24, a deliberately different style).
**First-run accuracy of each fresh set, before anything was tuned on it** (these are the only honest numbers): held-out 87.5 % (the rules before the concept model: 45.8 %) · validation 77.8 % · validation-2 79.2 % · validation-3 70.8 % → mean ≈ 79 %. Every one of those sets was then used to tune, so the 95–100 % they show today are regression gates, not estimates. A new unseen theory set would be the next honest measurement; not yet done.
One item (T314 "main function of the lymphatic system", labelled medium) is inconsistent with the easy label of "main function of the large intestine": label noise, kept visible.
