/* node --test bench/bench-selftest.mjs   — offline checks of the bench itself (uses the local mock, never the real API) */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as B from "../scripts/bench-flashlite.mjs";
import { start } from "./mock-server.mjs";

const good = () => B.buildBody({ model: B.MODELS.primary, level: "low", system: "s", userText: "q", variant: "af", maxOut: 16384 });

test("linter blocks every banned thing", () => {
  const bad = (mut, model = B.MODELS.primary) => { const b = good(); mut(b); assert.throws(() => B.lintBody(model, b), /lint/i); };
  bad((b) => { b.generationConfig.temperature = 0.1; });
  bad((b) => { b.generationConfig.topP = 0.9; });
  bad((b) => { b.generationConfig.topK = 3; });
  bad((b) => { b.generationConfig.thinkingConfig.thinkingBudget = 0; });
  bad((b) => { b.generationConfig.responseLogprobs = true; });
  bad((b) => { b.generationConfig.logprobs = 5; });
  bad((b) => { b.contents.push({ role: "model", parts: [{ text: "{" }] }); });
  bad((b) => { b.generationConfig.thinkingConfig.includeThoughts = true; });
  bad((b) => { b.generationConfig.maxOutputTokens = 300; });
  bad(() => {}, "gemini-flash-latest");
  bad(() => {}, "gemini-3.5-flash");
  bad(() => {}, "gemini-2.0-flash-lite");
  bad((b) => { b.generationConfig.thinkingConfig.thinkingLevel = "minimal"; }, "gemini-3.8-flash");
});

test("minimal is clamped to low for gemini-3.8-flash and passes the linter", () => {
  const b = B.buildBody({ model: "gemini-3.8-flash", level: "minimal", system: "s", userText: "q", variant: "af", maxOut: 8000 });
  assert.equal(b.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(B.buildBody({ model: B.MODELS.primary, level: "minimal", system: "s", userText: "q", variant: "af", maxOut: 8000 }).generationConfig.thinkingConfig.thinkingLevel, "minimal");
});

test("schema: answer_letter first, flat, ordering = required; the prompt never restates the structure", () => {
  const s = B.makeSchema("af");
  assert.equal(s.propertyOrdering[0], "answer_letter"); assert.equal(s.propertyOrdering[1], "short_rationale");
  assert.deepEqual(Object.keys(s.properties), s.propertyOrdering); assert.deepEqual(s.required, s.propertyOrdering);
  assert.ok(Object.values(s.properties).every((p) => !p.properties && !p.items));
  assert.notEqual(B.makeSchema("rf").propertyOrdering[0], "answer_letter");
  const sys = B.systemText("ar"); assert.ok(!/answer_letter|\{|\}|JSON/i.test(sys), "no JSON/field description in the instructions");
});

test("incremental extraction waits for the closing quote", () => {
  assert.equal(B.extractString('{"answer_letter":"', "answer_letter"), null);
  assert.equal(B.extractString('{"answer_letter":"C","short', "answer_letter"), "C");
  assert.equal(B.extractString('{"a":"x\\"y', "a"), null);
  assert.equal(B.extractString('{"a":"x\\"y","b":1', "a"), 'x"y');
});

test("stats", () => {
  assert.ok(Math.abs(B.mcnemarExact(0, 5) - 0.0625) < 1e-9);
  assert.equal(B.mcnemarExact(0, 0), 1);
  const [lo, hi] = B.wilson(80, 100); assert.ok(lo > 0.70 && lo < 0.72 && hi > 0.86 && hi < 0.88);
  assert.equal(B.percentile([1, 2, 3, 4, 5], 0.5), 3);
});

test("consistency checks", () => {
  const q = { stem: "Heparin 5000 units SC. Which lab?", options: { A: "aPTT", B: "INR" } };
  const dict = [{ abbr: "aPTT", en: "x", ar: "y", bad: ["ضغط"] }];
  const base = { answer_letter: "A", short_rationale: "aPTT.", explain: "The correct answer is A. Dose 5000 units.", traps: "", numbers: "dose=5000 units", terms: "", conf: "high" };
  const ok = B.checkConsistency(base, q, dict); assert.ok(!ok.letter_conflict && !ok.num_conflict && !ok.num_missing && !ok.trans_err.length);
  assert.ok(B.checkConsistency({ ...base, explain: "الإجابة الصحيحة هي B." }, q, dict).letter_conflict);
  assert.ok(!B.checkConsistency({ ...base, explain: "Option B is wrong. The answer is a drug dose." }, q, dict).letter_conflict);
  assert.ok(B.checkConsistency({ ...base, explain: "Dose 500 units. correct answer is A", numbers: "dose=5000 units" }, q, dict).num_conflict);
  assert.ok(B.checkConsistency({ ...base, numbers: "rate=77 mL/h" }, q, dict).num_missing);
  assert.deepEqual(B.checkConsistency({ ...base, terms: "aPTT — ضغط" }, q, dict).trans_err, ["aPTT:ضغط"]);
  assert.ok(B.checkConsistency({ ...base, numbers: "٥٠٠٠ units" }, q, dict).num_format_err);
});

test("glossary injects only matching entries", () => {
  const d = B.loadDict(new URL("./nursing-dict.seed.json", import.meta.url).pathname);
  assert.ok(d.length >= 10);
  const m = B.matchDict(d, "Monitor aPTT and the INR; give PRN."); assert.deepEqual(m.map((e) => e.abbr).sort(), ["INR", "PRN", "aPTT"]);
  assert.equal(B.matchDict(d, "no terms here").length, 0);
  assert.ok(B.dictBlock(m).length < 400);
});

function tmpDataset(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-")); const f = path.join(dir, "d.jsonl");
  fs.writeFileSync(f, Array.from({ length: n }, (_, i) => JSON.stringify({ id: `s${i}`, format: "mcq", stem: `SYNTHETIC ${i}: monitor aPTT for heparin, dose 500 mg BID?`, options: { A: "a", B: "b", C: "c", D: "d" }, key: ["ABCD"[i % 4]], tags: i % 2 ? ["hard"] : [], verifiedBy: "harness" })).join("\n"));
  return { dir, f };
}
const common = (dir, f, port, extra = []) => ["--dataset", f, "--out-dir", path.join(dir, "out"), "--base-url", `http://127.0.0.1:${port}/v1beta/models`, "--allow-synthetic", "--rpm", "1000", "--fb-scale", "0.05", "--dict-file", new URL("./nursing-dict.seed.json", import.meta.url).pathname, ...extra];
const rd = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const quiet = async (fn) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = log; console.error = err; } };

test("smoke run against a well-behaved mock passes its checklist", async () => {
  const { srv, port } = await start(0, { delayScale: 0.4, chaos: false }); const { dir, f } = tmpDataset(20);
  try {
    const code = await quiet(() => B.main(common(dir, f, port, ["--smoke"]), { GEMINI_API_KEY: "x" }));
    assert.equal(code, 0);
    const recs = rd(path.join(dir, "out/results-smoke.jsonl")); assert.equal(recs.length, 16);
    assert.deepEqual([...new Set(recs.map((r) => r.level))].sort(), ["high", "low", "medium", "minimal"]);
    assert.ok(recs.every((r) => r.status === "ok" && r.answer_first && r.ttfa_ms > 0 && r.ttfa_ms <= r.total_ms));
  } finally { srv.closeAllConnections(); srv.close(); }
});

test("arm A fails over at once on 429 / 503 / no-first-byte, never sleeps, resumes, and builds the report", async () => {
  const { srv, port } = await start(0, { delayScale: 0.4, chaos: true }); const { dir, f } = tmpDataset(20);
  try {
    const args = common(dir, f, port, ["--arm", "A", "--levels", "minimal,low", "--limit", "14", "--chosen", "low"]);
    assert.equal(await quiet(() => B.main(args, { GEMINI_API_KEY: "x" })), 0);
    const file = path.join(dir, "out/results-a.jsonl"), recs = rd(file); assert.equal(recs.length, 28);
    assert.ok(recs.every((r) => r.status === "ok"), "every trial finishes (fallback catches the failures)");
    const fb = recs.filter((r) => r.fallback); assert.ok(fb.length >= 3, "chaos must have forced fallbacks");
    assert.ok(fb.some((r) => r.lost["429"] > 0) && fb.some((r) => r.lost["503"] > 0) && fb.some((r) => r.lost.timeout > 0), "all three failure kinds seen");
    assert.ok(recs.every((r) => r.lost.sleep === 0));
    const fbk = fb.flatMap((r) => r.attempts).filter((a) => a.cat === "timeout"); assert.ok(fbk.length && fbk.every((a) => a.kind === "fb" && /no first byte within \d+ ms/.test(a.msg)), "timeout kind is named (fb)");
    assert.ok(fb.every((r) => r.attempts[0].ms < 3000), "no waiting on the failed attempt");
    assert.ok(recs.every((r) => r.requests === (r.fallback ? 2 : 1)));
    assert.equal(await quiet(() => B.main(args, { GEMINI_API_KEY: "x" })), 1, "existing results without --resume are refused");
    assert.equal(await quiet(() => B.main([...args, "--resume"], { GEMINI_API_KEY: "x" })), 0); assert.equal(rd(file).length, 28, "resume adds nothing");
    const report = fs.readFileSync(path.join(dir, "out/report.md"), "utf8");
    assert.match(report, /Per configuration/); assert.match(report, /Acceptance gate/); assert.match(report, /translation errors are not measurable/);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test("daily cap stops cleanly and --validate rejects unverified rows", async () => {
  const { srv, port } = await start(0, { delayScale: 0.2, chaos: false }); const { dir, f } = tmpDataset(10);
  try {
    const code = await quiet(() => B.main(common(dir, f, port, ["--arm", "A", "--levels", "low", "--daily-cap", "4"]), { GEMINI_API_KEY: "x" }));
    assert.equal(code, 0); assert.equal(rd(path.join(dir, "out/results-a.jsonl")).length, 4);
  } finally { srv.closeAllConnections(); srv.close(); }
  fs.writeFileSync(f, JSON.stringify({ id: "u1", format: "mcq", stem: "s", options: { A: "a", B: "b" }, key: ["A"], verifiedBy: "" }) + "\n" + JSON.stringify({ id: "u2", format: "mcq", stem: "s", options: { A: "a", B: "b" }, key: ["C"], verifiedBy: "Dr X" }));
  const { items, skipped } = B.loadDataset(f); assert.equal(items.length, 0); assert.equal(skipped.length, 2);
});

test("thinking tokens: a missing field is stored as null and fails the smoke check on medium/high", async () => {
  const { srv, port } = await start(0, { delayScale: 0.3, chaos: false, omitThink: true }); const { dir, f } = tmpDataset(20);
  try {
    const code = await quiet(() => B.main(common(dir, f, port, ["--smoke"]), { GEMINI_API_KEY: "x" }));
    assert.equal(code, 3);
    const recs = rd(path.join(dir, "out/results-smoke.jsonl")); assert.ok(recs.every((r) => r.thinking_tokens === null));
    assert.ok(B.smokeChecklist(recs).some((r) => r.startsWith("FAIL") && /thoughtsTokenCount/.test(r)));
  } finally { srv.closeAllConnections(); srv.close(); }
});

test("--resume duplicates: only the last record per key reaches the report", async () => {
  const { dir } = tmpDataset(1); const out = path.join(dir, "out"); fs.mkdirSync(out);
  const rec = (status, correct) => JSON.stringify({ key: "A|low|1|af|q1", arm: "A", qid: "q1", level: "low", dict: true, variant: "af", status, correct, requests: 1, attempts: [], lost: {}, thinking_tokens: 10, ttfa_ms: 100, total_ms: 200 });
  fs.writeFileSync(path.join(out, "results-a.jsonl"), rec("failed", undefined) + "\n" + rec("ok", true) + "\n");
  assert.equal(B.dedupeByKey([{ key: "k", v: 1 }, { key: "k", v: 2 }, { key: "j", v: 3 }]).find((r) => r.key === "k").v, 2);
  const code = await quiet(() => B.main(["--out-dir", out, "--report", "--dict-file", "none"], {}));
  assert.equal(code, 0);
  assert.match(fs.readFileSync(path.join(out, "report.md"), "utf8"), /\| A\|low\|dict=on\|af \| 1 \| 0 \| 100\.0/);
});

test("smoke headroom uses the scaled first-byte limit", () => {
  const rec = (level, ttfb) => ({ level, status: "ok", fallback: false, answer_first: true, thinking_tokens: 50, attempts: [{ status: 200, cat: null, ttfb_ms: ttfb }] });
  const recs = [rec("minimal", 7000)];
  const row = (scale) => B.smokeChecklist(recs, scale).find((r) => /^(PASS|FAIL)\s+minimal:/.test(r));
  assert.match(row(1), /^FAIL/);                       // 7000 > 70% of 9000
  assert.match(row(1.8), /^PASS/);                     // 7000 ≤ 70% of 16200
  assert.match(row(1.8), /limit 16200/); assert.match(row(1.8), /median 7000/);
  assert.deepEqual(B.FIRST_BYTE_MS, { minimal: 9000, low: 9000, medium: 16000, high: 25000 });
});

test("arm B runs only the glossary-OFF side and pairs it with arm A", async () => {
  const { srv, port } = await start(0, { delayScale: 0.3, chaos: false }); const { dir, f } = tmpDataset(10);
  try {
    assert.equal(await quiet(() => B.main(common(dir, f, port, ["--arm", "A", "--levels", "low"]), { GEMINI_API_KEY: "x" })), 0);
    assert.equal(await quiet(() => B.main(common(dir, f, port, ["--arm", "B", "--level", "low"]), { GEMINI_API_KEY: "x" })), 0);
    const b = rd(path.join(dir, "out/results-b.jsonl")); assert.equal(b.length, 10); assert.ok(b.every((r) => r.dict === false && r.dict_hits.length === 0));
    assert.match(fs.readFileSync(path.join(dir, "out/report.md"), "utf8"), /Glossary effect \(arm B vs arm A at low[^\n]*\n\npaired q: 10 /);
  } finally { srv.closeAllConnections(); srv.close(); }
});
