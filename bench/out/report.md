# Phase 0 bench report

Generated 2026-11-26T23:22:22.231Z · trials: 216

## Per configuration

Failed trials count as wrong answers. Times exclude the bench's own pacing wait (shown separately). Lost time = mean ms per trial spent on failed attempts before the fallback.

| config | n | failed | Acc % (95% CI) | letter/num conflicts | trans err | parse/trunc | fallback | req/q | TTFA P50 / P95 ms | total P50 / P95 ms | lost 429 / 503 / 5xx / timeout / net / sleep | think tok | cached tok | prompt tok | pacer wait ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A|high|dict=on|af | 100 | 0 | 100.0 (96–100) | 31.0% | 0.0% | 0 | 2% | 1.02 | 6604 / 10278 | 7284 / 11072 | 0 / 93 / 0 / 0 / 0 / 0 | 2238 | 0 | 422 | 2436 |
| A|low|dict=on|af | 100 | 0 | 96.0 (90–98) | 33.0% | 0.0% | 0 | 8% | 1.08 | 903 / 3603 | 1979 / 4843 | 0 / 171 / 0 / 0 / 0 / 0 | 115 | 0 | 422 | 2474 |

> ⚠ The glossary has no `bad` forms yet, so **translation errors are not measurable** (trans err is always 0). Fill `bad` from errors actually observed.

## Paired comparison between levels (exact McNemar)

With ~100 questions only large differences are detectable (95% CI is about ±9 points): p > 0.05 means "not distinguishable", not "equal".

| pair | paired q | only first right | only second right | p |
|---|---|---|---|---|
| low vs high (dict on) | 100 | 0 | 4 | 0.125 |

## Acceptance gate

- ✅ zero HTTP 400 in the whole run (found 0)
- ✅ zero sleep time on failures (0 ms)
- ⏳ pass --chosen <level> to evaluate the level-specific gates below
