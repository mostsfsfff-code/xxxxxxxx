# v3.72.0 — Difficulty is rated locally for every question

`ROUTER_POLICY.mode` (src/lib/difficulty.js): **"local"** (default) · "hybrid" (rules for the obvious, Flash-Lite for the middle) · "model" (every text question to the model).

With "local": no router request, no wait, no quota. For images and PDFs the rules read the OCR text the app already produces; if that fails the question is treated as **medium**.

Rules (heuristicLevel): length, measured values (answer-option lines excluded), several lab/system terms, calculation/dosing words, EXCEPT/NOT/FIRST/BEST keywords, high-risk drugs (one or two), clinical-vignette words, select-all/many options.
Local verdict: **easy only on positive evidence** (short, no patient, no calculation, no exam-trap keyword, no high-risk drug, ≤ 1 value cluster); a question the rules cannot place is **medium**, never easy by default; score ≥ 5 → hard. *Retry* goes one level deeper. Numbered-task sources still go to the one-request contract path.
Presets: easy → `light` (one compact request, lightest lane) · medium → `balanced` · hard → `deep`, or `deepflash` on a small key.

Tests: 631/631 (7 new: shipped default is local, easy needs evidence, long plain text is medium, three E2E levels with zero router requests, retry deepens without a request, unreadable scan = medium). The earlier model-driven tests now run under "hybrid".

Limits: the rules are keyword/size heuristics, not understanding. Known blind spots: a short tricky recall item can read easy; a long plain explanation request reads medium; a hard conceptual question with no numbers, drugs or trap words and under ~110 words can read medium or easy. The student's escape is *Retry* (one level up) or choosing a mode by hand. Accuracy against your own questions is unmeasured: try 30–50 and tune `heuristicLevel()`.
