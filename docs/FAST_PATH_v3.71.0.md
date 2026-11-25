# v3.71.0 — Why a trivial question took 30 s, and what changed

## Diagnosis from the run the student pasted (potassium range, 4 options)
| Evidence in the report | Meaning |
|---|---|
| `حلّ 21.8ث · أساس 6.8ث · تفصيص 28.4ث` | the **balanced** pipeline ran (silent solve + part A + part B): the question was NOT treated as easy |
| `انتظار أول رد 16.2ث … كتابة 0.5ث (140 توكن)` | the time was spent **waiting for the first byte**, not working; the model that answered was Flash-Lite after the Flash lane was slow |
| no `كلمات` timing | the words switch (off by default) worked: v3.70 was deployed |
| `💡 Mnemonic:` empty, a stray K-king sentence | cosmetic template leftovers |

Root causes found in code:
1. **Rule bug**: `mEq` was in the dosing regex, so `mEq/L` in the answer options made the potassium question look like a **calculation** (score 3 → "medium") and sent it to the model; option lines also inflated the "measured values" count.
2. **The router sat on the critical path** (up to 8 s, a loaded Flash-Lite can take longer for one line) and the model, told to "choose the higher when unsure", drifts upward on pure recall.
3. **"Easy" still cost three requests** (solve + part A + part B) and wrote a nine-section lesson.
4. Nothing in the report said which preset ran, so a wrong route was invisible.

## Changes
| Change | Effect |
|---|---|
| Rules decide the **obvious** cases locally (`sure`): pure recall (short, no patient, no calculation, no drug, no EXCEPT/NOT, ≤ 1 value cluster) → easy; ≥ 7 independent hard signals → hard. Only the uncertain middle is sent to the model. `ROUTER_POLICY.skipModelWhenSure=false` sends everything to the model | 0 requests, 0 s of router wait for the obvious |
| Rule fixes: `mEq` is no longer "dosing"; answer-option lines are not counted as data | the potassium question is sure-easy |
| Classifier prompt: a normal value / definition / name is EASY even when it mentions a lab or drug; "higher" only for a patient decision, calculation, interacting data or drug safety; box 8 s → 5 s | less upward drift |
| `light` = **ONE request** (single-path writer), **COMPACT lesson** (ask · ≤ 2 concepts with key facts · answer · one line per option · 2 memo sentences · 1–2 tricks; no decode, steps, vary, analogies, tip), ~560 words, thinking minimal, **lightest lane first** | easy question: 1 generative request instead of 3 |
| Report line `⚙️ الوضع: سهل ← سريع (طلب واحد مختصر) · القرار: قواعد محلية` | a wrong route is visible |
| Guard drops a label with nothing after it (`💡 **Mnemonic:**`) silently, not counted as a leak (no rewrite request) | cosmetic leftover gone |

## Verified
`npm test` 624/624 (new: potassium rules, sure-easy → no router request and 1 generative request, compact prompt + lite-first lane, sure-hard, floor/hard-by-model on uncertain text, empty-label strip); build OK.

## Not verified / honest limits
* The 16 s first-byte wait is **Google-side latency**; code cannot remove it. What changed is how many requests wait on it (1 instead of 3 + router) and that the lightest lane is asked first.
* Flash-Lite for easy items: answer quality was not compared with Flash on real easy questions.
* "Sure" rules can mislabel a short tricky recall item as easy; *Retry* goes one level up.
* UI not run in a browser.
