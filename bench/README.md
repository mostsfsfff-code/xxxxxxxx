# Phase 0 · Bench Gate (Flash-Lite)

Standalone. Nothing here imports from `src/` and nothing in production is touched.
Files: `scripts/bench-flashlite.mjs` · `bench/nursing-dict.seed.json` · `bench/nursing100.TEMPLATE.jsonl` · `bench/mock-server.mjs` · `bench/bench-selftest.mjs`

## Order of work
1. Fill `bench/nursing100.jsonl` (same shape as `tests/golden/questions`; `verifiedBy` must name a real reviewer; tag the hard ones with `"tags":["hard"]`).
2. `node scripts/bench-flashlite.mjs --validate` — counts usable rows, key-letter skew, glossary matches.
3. `export GEMINI_API_KEY=...` (never commit it), then **smoke**: `node scripts/bench-flashlite.mjs --smoke --fresh`
   16 questions, levels rotated, prints a PASS/FAIL checklist (zero 400, answer_letter first, no first-byte timeouts, parse ok). Exit code 3 = a check failed.
   Slow connection? add `--fb-scale 1.5` (multiplies the first-byte limits 5/5/12/20 s).
4. **Arm A** (400 requests, about 45 min at 8 rpm): `node scripts/bench-flashlite.mjs --arm A --fresh`
   It stops cleanly at `--daily-cap` (default 450 per model, Pacific-time day) → rerun the same command with `--resume` the next day.
5. Pick the level, then arm B/C at it: `--arm B --level low` · `--arm C --level low --hard 30` · `--arm D --level low`
6. `node scripts/bench-flashlite.mjs --report --chosen low` → `bench/out/report.md` (also rebuilt at the end of every run).

## Dry run without a key
`node bench/mock-server.mjs 8787` then add `--base-url http://127.0.0.1:8787/v1beta/models --allow-synthetic --skip-preflight` (the mock misbehaves on purpose: 429 / 503 / hang). `node --test bench/bench-selftest.mjs` runs the offline checks.

## What is enforced
no `-latest` · fixed model names only · no temperature/topP/topK · no thinkingBudget · no responseLogprobs · no prefilled model turn · `minimal` clamped to `low` for gemini-3.8-flash · includeThoughts off · first byte 5/5/12/20 s by level · 429/5xx/network/no-first-byte → immediate fallback (no sleep) · 400/401/403/404 stop the run (a 400 is a bug, not a retry) · the schema is defined once in `responseSchema`, never described in the instructions.

## Heuristics to know about
- Letter conflict: only explicit statements ("correct answer is X", "الإجابة الصحيحة هي X") are compared with `answer_letter`; "option C is wrong" is not a conflict.
- Number checks: every `numbers` value must appear in the question or the prose, and the same name must not carry a different value next to it.
- Translation errors: measurable only after `bad` forms are added to the glossary from errors actually seen (the report warns while it is empty).
- Failed trials count as wrong answers. Pacing waits are logged as `pacer_wait_ms` and excluded from every latency figure.
- 100 questions detect only large differences (95% CI about ±9 points): read the McNemar table, not the raw percentages.
- The cache probe is inconclusive unless the long prefix really measures ≥ 4,096 prompt tokens (the report says so).
