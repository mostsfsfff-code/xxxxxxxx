/* v3.84 · the ONE-REQUEST question path: adaptive thinking level, forbidden request parameters, no hedging / no long waits, the incremental SSE reader,
   instant fail-over, the deterministic post-check, and the whole thing through the real createAnalysis. Runs on a hand-made fake of Google. */
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/lib/router.js";
import * as Q from "../src/lib/quota.js";
import * as Ring from "../src/lib/keyring.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import * as C from "../src/lib/config.js";
import * as M from "../src/lib/models.js";
import { needsDeepThinking, levelFor } from "../src/lib/think-router.js";
import * as OC from "../src/lib/one-call.js";
import * as CK from "../src/lib/one-call-check.js";
import * as D from "../src/lib/nursing-dict.js";
import * as G from "../src/lib/gemini.js";
import { createAnalysis } from "../src/lib/analysis.js";

const enc = new TextEncoder();
const sse = (o) => `data: ${JSON.stringify(o)}\r\n\r\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── a fake of the streaming endpoint, programmable per model ── */
const log = [];
let behaviour = {};                                  // model → (body, n) => { status?, msg?, hang?, delay?, reply?: object|string }
const fresh = (key = "AIzaV384" + String(Math.random()).slice(2, 12).padEnd(10, "0")) => {
  log.length = 0; behaviour = {}; R.__resetRouter(); Q.__resetQuota(); Q.__setClock(null); window.localStorage.clear(); Ring.__resetKeyring(); Ring.__setClock(); setExtKeys({}); setEnginePrefs({ mode: "auto" });
  return key;
};
const ok = (o) => ({ reply: o });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!/streamGenerateContent/.test(u)) return new Response(JSON.stringify({ models: [] }), { status: 200 });
  const model = (u.match(/models\/([^:?]+)/) || [])[1], body = JSON.parse(init.body), signal = init.signal;
  log.push({ model, body, key: (init.headers || {})["x-goog-api-key"], at: Date.now() });
  const n = log.filter((l) => l.model === model).length;
  const b = (behaviour[model] || (() => ({ status: 404, msg: "no behaviour for " + model })))(body, n);
  if (b.status) return new Response(JSON.stringify({ error: { code: b.status, message: b.msg || "x", ...(b.details ? { details: b.details } : {}) } }), { status: b.status });
  if (b.hang) return new Promise((_, rej) => { signal && signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }); });
  if (b.delay) await sleep(b.delay);
  const text = typeof b.reply === "string" ? b.reply : JSON.stringify(b.reply);
  const cut = b.cut || 23, parts = text.match(new RegExp(`[\\s\\S]{1,${cut}}`, "g")) || [text];
  return new Response(new ReadableStream({
    async start(c) {
      for (const [i, p] of parts.entries()) {
        if (b.errorAfter !== undefined && i >= b.errorAfter) { c.error(new Error("connection lost")); return; }
        const last = i === parts.length - 1;
        c.enqueue(enc.encode(sse({ candidates: [{ content: { parts: [{ text: p }] }, ...(last ? { finishReason: b.finish || "STOP" } : {}) }], ...(last ? { usageMetadata: { promptTokenCount: 321, thoughtsTokenCount: 77, candidatesTokenCount: 555 } } : {}) })));
        if (b.gap) await sleep(b.gap);
      }
      c.close();
    },
  }), { status: 200 });
};

const STEM = "A client receives heparin by continuous infusion. The aPTT is 96 seconds (normal control 30 seconds). Which action should the nurse take first?\nA. Continue the infusion unchanged\nB. Stop the infusion and notify the provider\nC. Increase the rate by 2 units/kg/hr\nD. Obtain a repeat INR tomorrow";
const reply = (over = {}) => ({
  answer_letter: "B", short_rationale: "An aPTT of 96 s is supratherapeutic: hold the heparin and call the provider.",
  ask: "- Priority question (safety)", decode: "- **aPTT 96 seconds** — far above target", basics: "**aPTT** — clotting time monitored for heparin.", steps: "1. Compare with target.\n2. Hold the drug.",
  options: "- **A) Continue** ❌ — unsafe\n- **B) Stop and notify** ✅ — correct\n- **C) Increase** ❌ — worsens bleeding risk\n- **D) Repeat INR** ❌ — wrong test",
  vary: "- If the aPTT were 55 seconds, continue.", memo: "> Hold heparin when the aPTT is high.\nاوقف الهيبارين لما الـ aPTT يعلى.", tricks: "- **Wrong lab:** INR is for warfarin.\n💡 aPTT = heparin.",
  type: "MCQ", keyword: "FIRST", concepts: "heparin; aPTT", data: "aPTT=96 seconds", calc: "", conf: "high", ...over,
});

/* ───────── 1 · adaptive thinking level ───────── */
test("adaptive thinking: a clinical calculation gets high for that question only; everything else stays low", () => {
  const calc = [
    "A client has burns over 40% TBSA and weighs 70 kg. Using the Parkland formula, how many mL should be infused in the first 8 hours?",
    "Dopamine 5 mcg/kg/min is ordered for a client who weighs 176 lb. The bag has 400 mg in 250 mL. At what rate in mL/hr should the nurse set the pump?",
    "Heparin is ordered at 18 units/kg/hr. The client weighs 82 kg and the bag holds 25,000 units in 500 mL. How many mL/hr?",
    "Na 140 mEq/L, glucose 180 mg/dL, BUN 28 mg/dL. Calculate the serum osmolality.",
    "Calculate the anion gap: Na 140, Cl 100, HCO3 24.", "Using the Holliday-Segar method, what is the maintenance fluid for a 22 kg child?",
    "Compute the corrected calcium for Ca 7.8 mg/dL and albumin 2.5 g/dL.", "Mean arterial pressure: calculate MAP for BP 90/50.", "The nurse sets the drip rate with a drop factor of 15 gtt/mL.",
  ];
  for (const q of calc) assert.equal(needsDeepThinking(q).level, "high", q);
  const plain = [STEM, "A client with potassium 3.1 mEq/L and ECG changes. Which action should the nurse take first?", "Which statement by the client shows teaching about warfarin was effective?",
    "A nurse cares for a client who weighs 70 kg after surgery. Which finding requires immediate action?", "The nurse reviews Na 128 mEq/L and K 5.2 mEq/L. Which client is the priority?", ""];
  for (const q of plain) assert.equal(needsDeepThinking(q).level, "low", q);
  assert.deepEqual(levelFor(STEM, { deepMode: true }).level, "medium", "«أقوى تحليل» is at least medium");
  assert.equal(levelFor(calc[0], { deepMode: true }).level, "high");
  assert.equal(levelFor(STEM).level, "low");
});

/* ───────── 2 · forbidden parameters, fixed model names ───────── */
test("the request body: only thinkingLevel, includeThoughts off, 16384 tokens, a flat schema with answer_letter first, nothing deprecated", () => {
  const b = OC.buildBody({ model: M.MODELS.primary, level: "low", system: "s", parts: [{ text: "q" }] });
  assert.equal(b.generationConfig.maxOutputTokens, 16384);
  assert.deepEqual(b.generationConfig.thinkingConfig, { thinkingLevel: "low", includeThoughts: false });
  assert.equal(b.generationConfig.responseMimeType, "application/json");
  const sc = b.generationConfig.responseSchema;
  assert.equal(sc.propertyOrdering[0], "answer_letter"); assert.equal(sc.propertyOrdering[1], "short_rationale");
  assert.deepEqual(sc.required, sc.propertyOrdering); assert.ok(Object.values(sc.properties).every((p) => !p.properties && !p.items), "flat");
  const dump = JSON.stringify(b);
  for (const bad of ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "thinkingBudget", "responseLogprobs", "logprobs"]) assert.ok(!dump.includes(bad), bad);
  assert.notEqual(b.contents.at(-1).role, "model");
});

test("the linter refuses every forbidden thing; minimal is clamped to low for gemini-3.8-flash", () => {
  const mk = () => OC.buildBody({ model: M.MODELS.primary, level: "low", system: "s", parts: [{ text: "q" }] });
  const bad = (f, model = M.MODELS.primary) => { const b = mk(); f(b); assert.throws(() => OC.lintBody(model, b), /lint/); };
  bad((b) => { b.generationConfig.temperature = 0; }); bad((b) => { b.generationConfig.topP = 1; }); bad((b) => { b.generationConfig.topK = 1; });
  bad((b) => { b.generationConfig.frequencyPenalty = 0.1; }); bad((b) => { b.generationConfig.presencePenalty = 0.1; });
  bad((b) => { b.generationConfig.thinkingConfig.thinkingBudget = 0; }); bad((b) => { b.generationConfig.responseLogprobs = true; });
  bad((b) => { b.contents.push({ role: "model", parts: [{ text: "{" }] }); }); bad((b) => { b.generationConfig.thinkingConfig.includeThoughts = true; });
  bad((b) => { b.generationConfig.maxOutputTokens = 1000; }); bad((b) => { b.generationConfig.thinkingConfig.thinkingLevel = "minimal"; }, "gemini-3.8-flash");
  const e = OC.buildBody({ model: "gemini-3.8-flash", level: "minimal", system: "s", parts: [{ text: "q" }] });
  assert.equal(e.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(OC.buildBody({ model: M.MODELS.primary, level: "minimal", system: "s", parts: [{ text: "q" }] }).generationConfig.thinkingConfig.thinkingLevel, "minimal");
});

test("no -latest anywhere: fixed defaults, banned names refused at the door, retired / redirected names refused", async () => {
  assert.deepEqual([C.MODEL_FAST, C.MODEL_PRO], ["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
  for (const m of ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-2.0-flash-lite"]) assert.equal(M.isBannedModel(m), true, m);
  for (const m of Object.values(M.MODELS)) assert.equal(M.isBannedModel(m), false, m);
  const key = fresh();
  const lists = G.getModelLists(key);
  for (const m of [...lists.fast, ...lists.pro]) assert.ok(!M.isBannedModel(m) && M.ALLOWED_MODELS.includes(m), `list entry ${m}`);
  for (const m of ["gemini-flash-latest", "gemini-3.5-flash", "gemini-2.0-flash-lite"]) {
    await assert.rejects(G.runTask({ apiKey: key, task: "words", models: [m], system: "s", parts: [{ text: "x" }], spec: { levels: ["low"], budget: 0 }, maxOut: 1000, firstMs: 500, idleMs: 500 }), (e) => e.banned || /not allowed/.test(e.message), m);
  }
  assert.equal(log.length, 0, "no banned request ever left the app");
});

/* ───────── 3 · no hedging, no long sleeping, no deprecated parameters on the shared engine either ───────── */
test("hedging is off and the waits are short; withBackoff is gone; Gemini 3 never gets logprobs or a thinking budget", async () => {
  assert.equal(C.HEDGING, false);
  assert.ok(C.NET.maxWait <= 4000 && C.NET.maxHint <= 4000);
  assert.equal(G.withBackoff, undefined); assert.equal(G.BACKOFF, undefined);
  assert.equal(G.wantsLogprobs("gemini-3.5-flash-lite", "solve:balanced", "k"), false);
  assert.equal(G.wantsLogprobs("gemini-3.8-flash", "solve:balanced", "k"), false);
  const key = fresh();
  behaviour["gemini-3.5-flash-lite"] = () => ({ reply: "ANSWER: B\nTYPE: priority\nKEYWORD: FIRST\nCONCEPTS: a; b\nOPTIONS:\nA) ❌ x\nB) ✅ y\nCONFIDENCE: high" });
  await G.runTask({ apiKey: key, task: "solve:balanced", models: ["gemini-3.5-flash-lite"], system: "s", parts: [{ text: "q" }], spec: { levels: ["low", "minimal"], budget: 128 }, maxOut: 2000, firstMs: 2000, idleMs: 2000 });
  const gc = log[0].body.generationConfig;
  assert.ok(!("responseLogprobs" in gc) && !("logprobs" in gc) && !("temperature" in gc));
  assert.ok(!JSON.stringify(gc).includes("thinkingBudget"));
});

test("a silent lane on the shared engine is not raced: the second lane waits for the first lane's silence limit", async () => {
  const key = fresh();
  behaviour["gemini-3.5-flash-lite"] = () => ({ hang: true });
  behaviour["gemini-3.1-flash-lite"] = () => ({ reply: "second lane" });
  const t0 = Date.now();
  const r = await G.runTask({ apiKey: key, task: "lessonA:balanced", models: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], system: "s", parts: [{ text: "q" }], spec: { levels: ["low"], budget: 0 }, maxOut: 1000, firstMs: 600, idleMs: 600 });
  assert.equal(r.text, "second lane");
  assert.ok(Date.now() - t0 >= 550, "no race: the first lane had its full silence limit");
  assert.equal(log.length, 2);
  assert.ok(log[1].at - log[0].at >= 550, "the second request started only after the first one was given up");
});

/* ───────── 4 · the incremental reader ───────── */
test("extractString: a field is available only when its closing quote has arrived; escapes survive", () => {
  assert.equal(OC.extractString('{"answer_letter":"', "answer_letter"), null);
  assert.equal(OC.extractString('{"answer_letter":"B","short', "answer_letter"), "B");
  assert.equal(OC.extractString('{"a":"x\\"y', "a"), null);
  assert.equal(OC.extractString('{"a":"x\\"y\\n","b":1', "a"), 'x"y\n');
  assert.deepEqual(OC.completeFields('{"answer_letter":"C","short_rationale":"why","ask":"cut o'), { answer_letter: "C", short_rationale: "why" });
});

test("the stream: answer_letter and short_rationale reach the app BEFORE the rest of the reply has been sent (cut anywhere, \\r\\n framing)", async () => {
  const key = fresh();
  const seen = [];
  behaviour["gemini-3.5-flash-lite"] = () => ({ reply: reply(), cut: 7, gap: 8 });
  const t0 = Date.now(); let doneAt = 0;
  const res = await OC.runOneCall({ apiKey: key, system: "s", parts: [{ text: "q" }], level: "low", onField: (k, v) => seen.push([k, v, Date.now() - t0]) });
  doneAt = Date.now() - t0;
  assert.deepEqual(seen.slice(0, 2).map((x) => x[0]), ["answer_letter", "short_rationale"], "the first two fields to arrive");
  assert.equal(seen[0][1], "B");
  assert.ok(seen[1][2] < doneAt - 150, `the reason was shown ${doneAt - seen[1][2]} ms before the end of the reply`);
  assert.equal(res.out.answer_letter, "B"); assert.equal(res.requests, 1); assert.equal(res.model, "gemini-3.5-flash-lite");
  assert.equal(res.usage.thinking, 77); assert.deepEqual(res.order.slice(0, 2), ["answer_letter", "short_rationale"]);
  assert.ok(res.ttfaMs > 0 && res.ttfaMs <= res.totalMs);
  assert.equal(log.length, 1, "ONE request");
});

test("a reply that stops half-way (MAX_TOKENS) still yields the finished parts and is flagged partial", async () => {
  const key = fresh();
  const full = JSON.stringify(reply()); behaviour["gemini-3.5-flash-lite"] = () => ({ reply: full.slice(0, full.indexOf('"vary"') - 2), finish: "MAX_TOKENS" });
  const res = await OC.runOneCall({ apiKey: key, system: "s", parts: [{ text: "q" }], level: "low" });
  assert.equal(res.partial, true); assert.equal(res.out.answer_letter, "B"); assert.ok(res.out.steps);
});

/* ───────── 5 · instant fail-over ───────── */
test("429 / 503 / network / silence → the next candidate at once, no sleep; the primary asked once", async () => {
  const saved = { ...M.FIRST_BYTE_MS };
  try {
    for (const [name, primary] of [["429", { status: 429, msg: "per minute limit" }], ["503", { status: 503, msg: "overloaded" }], ["silence", { hang: true }]]) {
      M.FIRST_BYTE_MS.low = 350;
      const key = fresh();
      behaviour["gemini-3.5-flash-lite"] = () => primary;
      behaviour["gemini-3.1-flash-lite"] = () => ({ reply: reply() });
      const t0 = Date.now();
      const res = await OC.runOneCall({ apiKey: key, system: "s", parts: [{ text: "q" }], level: "low" });
      const ms = Date.now() - t0;
      assert.equal(res.model, "gemini-3.1-flash-lite", name); assert.equal(res.failover, true); assert.equal(res.requests, 2, name);
      assert.deepEqual(log.map((l) => l.model), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], name);
      assert.ok(ms < (name === "silence" ? 1500 : 400), `${name}: ${ms} ms, no sleeping`);
      assert.ok(res.ttfaMs >= (name === "silence" ? 300 : 0), "the time lost on the failed attempt is counted in the student's wait");
    }
  } finally { Object.assign(M.FIRST_BYTE_MS, saved); }
});

test("the first-byte limits are tiered by thinking level (low 11.7 s · medium 20.8 s · high 32.5 s)", () => {
  assert.deepEqual(M.FIRST_BYTE_MS, { minimal: 11700, low: 11700, medium: 20800, high: 32500 });
  assert.equal(M.firstByteMs("high"), 32500); assert.equal(M.firstByteMs("medium"), 20800);
});

test("quota.js is the pacer: a model with no room is passed over for one that has room (never slept on); a finished model is not asked", async () => {
  const key = fresh();
  Q.noteQuotaError(key, "gemini-3.5-flash-lite", Q.parseQuota({ details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "500", quotaDimensions: { model: "gemini-3.5-flash-lite" } }] }] }, "limit: 500 per day"));
  assert.equal(Q.finishedToday(key, "gemini-3.5-flash-lite"), true);
  behaviour["gemini-3.5-flash-lite"] = () => ({ reply: reply({ answer_letter: "A" }) });
  behaviour["gemini-3.1-flash-lite"] = () => ({ reply: reply() });
  const res = await OC.runOneCall({ apiKey: key, system: "s", parts: [{ text: "q" }], level: "low" });
  assert.equal(res.model, "gemini-3.1-flash-lite"); assert.deepEqual(log.map((l) => l.model), ["gemini-3.1-flash-lite"], "nothing was sent to the finished model");
});

test("a rejected request counts nothing against the quota ledger (Google did no work)", async () => {
  const key = fresh();
  behaviour["gemini-3.5-flash-lite"] = () => ({ status: 503, msg: "overloaded" });
  behaviour["gemini-3.1-flash-lite"] = () => ({ reply: reply() });
  await OC.runOneCall({ apiKey: key, system: "s", parts: [{ text: "q" }], level: "low" });
  assert.equal(Q.remaining(key, "gemini-3.5-flash-lite") === Infinity || Q.paceMs(key, "gemini-3.5-flash-lite") === 0, true);
});

test("every candidate failing → the error of the last attempt (busy / daily), after at most one request per candidate", async () => {
  const key = fresh();
  behaviour["gemini-3.5-flash-lite"] = () => ({ status: 503, msg: "overloaded" });
  behaviour["gemini-3.1-flash-lite"] = () => ({ status: 503, msg: "overloaded" });
  await assert.rejects(OC.runOneCall({ apiKey: key, system: "s", parts: [{ text: "q" }], level: "low" }), (e) => e.status === 503);
  assert.equal(log.length, 2);
});

test("«أقوى تحليل»: ONE request on the escalation model first; Flash-Lite only if it fails", async () => {
  const key = fresh();
  behaviour["gemini-3.6-flash"] = () => ({ reply: reply() });
  const res = await OC.runOneCall({ apiKey: key, system: "s", parts: [{ text: "q" }], level: "medium", deep: true });
  assert.equal(res.model, "gemini-3.6-flash"); assert.equal(log.length, 1); assert.equal(log[0].body.generationConfig.thinkingConfig.thinkingLevel, "medium");
});

/* ───────── 6 · the glossary, the post-check, the composition ───────── */
test("glossary: only the terms in the question are injected, rare ones first, a small block", () => {
  const hits = D.matchTerms("Monitor aPTT and INR; give 5 mg PO BID PRN. The client has a PE and a high PT.");
  assert.deepEqual(hits.slice(0, 3).map((e) => e.abbr), ["aPTT", "PT", "INR"]);
  assert.ok(hits.every((e) => e.ar && e.en));
  const block = D.glossaryBlock(hits); assert.ok(block.length <= D.MAX_BLOCK_CHARS && /aPTT = activated partial thromboplastin time = /.test(block));
  assert.equal(D.glossaryBlock([]), ""); assert.equal(D.matchTerms("the pt had a pe exam").length, 0, "short abbreviations match as written");
  assert.ok(D.NURSING_DICT.length >= 120);
});

test("post-check: a consistent reply passes; a contradiction asks for ONE escalation; a bad rendering is repaired in code", () => {
  const good = CK.postCheck(reply(), { stem: STEM }); assert.deepEqual(good.issues, []); assert.equal(good.escalate, false);
  const m = CK.postCheck(reply({ options: reply().options.replace("**B) Stop and notify** ✅", "**B) Stop and notify** ❌").replace("**A) Continue** ❌", "**A) Continue** ✅") }), { stem: STEM });
  assert.ok(m.issues.some((i) => i.code === "marks-mismatch") && m.escalate);
  const l = CK.postCheck(reply({ steps: "The correct answer is C." }), { stem: STEM }); assert.ok(l.issues.some((i) => i.code === "letter-conflict") && l.escalate);
  const a = CK.postCheck(reply({ answer_letter: "the infusion should stop" }), { stem: STEM }); assert.ok(a.issues.some((i) => i.code === "no-letter") && a.escalate);
  const d = CK.postCheck(reply({ data: "aPTT=69 seconds" }), { stem: STEM }); assert.ok(d.issues.some((i) => i.code === "data-not-in-source") && d.escalate, "a number the source never gave");
  const n = CK.postCheck(reply({ short_rationale: "The aPTT is 69 seconds, so hold the heparin." }), { stem: STEM }); assert.ok(n.issues.some((i) => i.code === "num-conflict") && n.escalate, "the reason restates the patient's value differently");
  assert.deepEqual(CK.postCheck(reply({ vary: "- If the aPTT were 55 seconds, continue.", basics: "**aPTT** normal 30 seconds." }), { stem: STEM }).issues, [], "hypothetical and reference numbers in the other parts are not conflicts");
  const e = CK.postCheck(reply({ answer_letter: "" }), { stem: STEM }); assert.ok(e.escalate);
  /* a bad rendering seen in real output is replaced by the glossary rendering, with no request */
  const dict = [{ abbr: "aPTT", en: "x", ar: "زمن الثرومبوبلاستين الجزئي المنشَّط", bad: ["ضغط الدم المنشط"] }];
  const f = CK.postCheck(reply({ basics: "**aPTT** — ضغط الدم المنشط." }), { stem: STEM, dict });
  assert.equal(f.fixes, 1); assert.ok(f.out.basics.includes("المنشَّط")); assert.deepEqual(f.issues.filter((i) => i.code === "bad-rendering"), []); assert.equal(f.escalate, false);
  assert.equal(CK.postCheck(reply({ answer_letter: "B, D", options: "- **B) x** ✅ — y\n- **D) z** ✅ — y\n- **A) q** ❌ — n" }), { stem: STEM }).escalate, false, "select-all: the ✅ set must equal the chosen set");
});

test("numbers written with a thousands separator are the same number (25,000 = 25000 = ٢٥٬٠٠٠)", () => {
  assert.equal(CK.normDigits("25,000 units and ٢٥٬٠٠٠ and 1,5"), "25000 units and 25000 and 1,5");
  const calcStem = "Heparin 25,000 units in 500 mL. The client weighs 82 kg. Which rate? A. 20 mL/hr B. 29.5 mL/hr";
  assert.deepEqual(CK.postCheck(reply({ data: "units=25000 units; volume=500 mL; weight=82 kg" }), { stem: calcStem }).issues.filter((i) => i.code === "data-not-in-source"), []);
});

test("composition: the same headings as the screen already renders, the answer section built from the first two fields, the tricks apart, no model heading left", () => {
  const H = { ask: "## ASK", decode: "## DECODE", basics: "## BASICS", steps: "## STEPS", options: "## OPTIONS", answer: "## ✅ ANSWER", vary: "## VARY", memo: "## MEMO" };
  const { explanation, tricks } = CK.composeLesson(reply({ steps: "## a heading the model added\n1. think" }), H);
  const order = ["## ASK", "## DECODE", "## BASICS", "## STEPS", "## OPTIONS", "## ✅ ANSWER", "## VARY", "## MEMO"].map((h) => explanation.indexOf(h));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), "every heading, in the lesson order");
  assert.ok(explanation.includes("## ✅ ANSWER\n- **B)** An aPTT of 96 s is supratherapeutic"));
  assert.ok(!explanation.includes("a heading the model added")); assert.ok(tricks.startsWith("- **Wrong lab:**") && !explanation.includes("Wrong lab"));
  const open = CK.composeLesson(reply({ answer_letter: "Start fluids and call rapid response", options: "", vary: "" }), H).explanation;
  assert.ok(open.includes("## ✅ ANSWER\n- **Start fluids and call rapid response**") && !open.includes("## OPTIONS") && !open.includes("## VARY"));
});

test("the brief the trust layer reads is built from the parts (premise, answer, per-option verdicts, data, confidence)", () => {
  const b = CK.makeBrief(reply());
  assert.match(b, /^PREMISE: An aPTT of 96 s/); assert.match(b, /\nANSWER: B\n/); assert.match(b, /\nDATA: aPTT=96 seconds\n/); assert.match(b, /\nB\) ✅ /); assert.match(b, /\nA\) ❌ /); assert.match(b, /\nCONFIDENCE: high$/);
  assert.match(CK.makeBrief(reply({ answer_letter: "stop", options: "" })), /OPTIONS:\nNONE — no answer choices supplied/);
});

/* ───────── 7 · through the real createAnalysis ───────── */
function analyse({ key, stem = STEM, modeId = "balanced", extra = "" } = {}) {
  return new Promise((resolve, reject) => {
    const out = { drafts: [], reason: null, tricks: null, trusts: [], done: {}, notes: [] };
    const timeout = setTimeout(() => reject(new Error("analysis timed out")), 8000);
    const a = createAnalysis({
      kind: "question", history: [], dataUrl: null, doc: { kind: "text", name: "q.txt", text: stem }, extra, chips: [], apiKey: key, modeId,
      onUpdate: (name, t, meta) => { if (name === "reason" && t && t.explanation) { out.reason = t.explanation; out.tricks = t.tricks; out.final = meta; } },
      onTrust: (t) => { out.trusts.push(t); if (t.phase === "draft") out.drafts.push({ ...t.draft, atReasonText: out.reason }); },
      onDone: (name, m) => { out.done[name] = m; if (out.done.reason && out.done.words) { clearTimeout(timeout); resolve(out); } },
      onError: (name, e) => { clearTimeout(timeout); reject(new Error(`${name}: ${e && e.message}`)); }, onNotice: (n, x) => out.notes.push([n, x]),
    });
    a.start();
  });
}
const reasonCalls = () => log.filter((l) => l.body.generationConfig?.responseSchema?.propertyOrdering?.[0] === "answer_letter");

test("createAnalysis (default path): ONE reason request, the preliminary answer is shown before the final text, the lesson is complete, the trust layer ran", async () => {
  C.FLAGS.oneCall = true; C.FLAGS.answerFirst = true;
  try {
    const key = fresh();
    behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: reply(), cut: 31, gap: 3 } : { reply: JSON.stringify({ words: [] }) });
    const out = await analyse({ key });
    assert.equal(reasonCalls().length, 1, "exactly ONE request for the whole question analysis");
    assert.equal(reasonCalls()[0].body.generationConfig.thinkingConfig.thinkingLevel, "low", "a non-calculation question is answered at low");
    assert.equal(reasonCalls()[0].model, "gemini-3.5-flash-lite");
    assert.ok(out.drafts.length >= 1 && out.drafts[0].letter === "B" && out.drafts.at(-1).rationale.startsWith("An aPTT of 96 s"), "the letter and its reason were shown as preliminary");
    assert.equal(out.drafts[0].atReasonText, null, "…before any lesson text existed");
    assert.ok(out.reason.includes("**B)**") && /aPTT/.test(out.reason) && out.tricks.includes("Wrong lab"), "the finished lesson and the tricks arrive together");
    assert.ok(out.final && out.final.final === true);
    assert.ok(out.trusts.some((t) => t.phase === "final"), "the same final trust pass ran");
    assert.equal(out.done.reason.requests, 1); assert.ok(out.done.reason.stages.solve >= 0 && out.done.reason.stages.total >= out.done.reason.stages.solve);
    const sys = reasonCalls()[0].body.systemInstruction.parts[0].text;
    assert.ok(/aPTT = activated partial thromboplastin time/.test(sys), "the glossary entries of THIS question were injected");
    assert.ok(!/frequencyPenalty|responseLogprobs/.test(JSON.stringify(reasonCalls()[0].body)));
    assert.ok(!/"answer_letter"|propertyOrdering|JSON/.test(sys.replace(/answer_letter: the letter/, "")), "the instructions never describe the structure");
  } finally { C.FLAGS.oneCall = false; C.FLAGS.answerFirst = true; }
});

test("createAnalysis: a calculation question is answered at HIGH; «أقوى تحليل» goes straight to the escalation model", async () => {
  C.FLAGS.oneCall = true;
  try {
    const calcStem = "A client weighs 82 kg. Heparin is ordered at 18 units/kg/hr from a bag of 25,000 units in 500 mL. At what rate in mL/hr should the nurse set the pump?\nA. 20 mL/hr\nB. 29.5 mL/hr\nC. 41 mL/hr\nD. 59 mL/hr";
    let key = fresh();
    behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: reply({ answer_letter: "B", type: "calculation", data: "weight=82 kg; dose=18 units/kg/hr; units=25000 units; volume=500 mL", calc: "82 x 18 = 1476 units/hr; 1476 / 50 = 29.5 mL/hr", options: "- **A) 20 mL/hr** ❌ — x\n- **B) 29.5 mL/hr** ✅ — y\n- **C) 41 mL/hr** ❌ — x\n- **D) 59 mL/hr** ❌ — x" }) } : { reply: "{}" });
    await analyse({ key, stem: calcStem });
    assert.equal(reasonCalls().length, 1); assert.equal(reasonCalls()[0].body.generationConfig.thinkingConfig.thinkingLevel, "high");
    key = fresh();
    behaviour["gemini-3.6-flash"] = () => ({ reply: reply() }); behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: reply() } : { reply: "{}" });
    await analyse({ key, modeId: "deep" });
    assert.deepEqual(reasonCalls().map((l) => [l.model, l.body.generationConfig.thinkingConfig.thinkingLevel]), [["gemini-3.6-flash", "medium"]], "one request, on the stronger model");
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: a contradiction costs exactly ONE escalation request; the checked answer replaces it", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    const wrong = reply({ options: reply().options.replace("**B) Stop and notify** ✅", "**B) Stop and notify** ❌").replace("**A) Continue** ❌", "**A) Continue** ✅") });
    behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: wrong } : { reply: "{}" });
    behaviour["gemini-3.6-flash"] = () => ({ reply: reply({ short_rationale: "ESCALATED: hold the heparin." }) });
    const out = await analyse({ key });
    assert.deepEqual(reasonCalls().map((l) => l.model), ["gemini-3.5-flash-lite", "gemini-3.6-flash"], "one request, then ONE escalation");
    assert.ok(out.reason.includes("ESCALATED: hold the heparin."), "the verified reply is the one shown");
    assert.equal(out.done.reason.requests, 2);
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: when the escalation cannot settle it either, the answer is kept with the «راجع» badge; no third request", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    const wrong = reply({ steps: "The correct answer is C." });
    behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: wrong } : { reply: "{}" });
    behaviour["gemini-3.6-flash"] = () => ({ reply: wrong });
    const out = await analyse({ key });
    assert.equal(reasonCalls().length, 2, "never more than one extra request");
    const fin = out.trusts.filter((t) => t.phase === "final").at(-1);
    assert.ok(out.reason.includes("**B)**"));
    assert.ok(fin && JSON.stringify(fin).includes("one-call-review") || JSON.stringify(out.trusts).includes("راجعها"), "the review badge reached the trust layer");
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: the escalation model out of quota → the badge, not a failure", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: reply({ steps: "The correct answer is D." }) } : { reply: "{}" });
    behaviour["gemini-3.6-flash"] = () => ({ status: 429, msg: "You exceeded your current quota, limit: 20 per day", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }] });
    const out = await analyse({ key });
    assert.ok(out.reason && out.reason.includes("**B)**"), "the answer still arrives");
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: ANSWER_FIRST off shows no preliminary answer; the final text is unchanged", async () => {
  C.FLAGS.oneCall = true; C.FLAGS.answerFirst = false;
  try {
    const key = fresh();
    behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: reply() } : { reply: "{}" });
    const out = await analyse({ key });
    assert.equal(out.drafts.length, 0); assert.ok(out.reason.includes("**B)**"));
  } finally { C.FLAGS.oneCall = false; C.FLAGS.answerFirst = true; }
});

test("createAnalysis: a connection lost after the preliminary answer was shown → the preliminary card is withdrawn and the error is reported", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    behaviour["gemini-3.5-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: reply(), cut: 12, errorAfter: 14, gap: 6 } : { reply: "{}" });
    behaviour["gemini-3.1-flash-lite"] = (body) => (body.generationConfig.responseSchema ? { reply: reply(), cut: 12, errorAfter: 14, gap: 6 } : { reply: "{}" });
    const seen = [];
    await assert.rejects(new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out")), 6000);
      createAnalysis({ kind: "question", history: [], doc: { kind: "text", name: "q.txt", text: STEM }, extra: "", chips: [], apiKey: key, modeId: "balanced",
        onUpdate: () => {}, onTrust: (x) => seen.push(x), onDone: () => {}, onError: (n, e) => { clearTimeout(t); reject(new Error(`${n}: ${e && e.message}`)); } }).start();
    }), (e) => { if (process.env.DBG) console.log("ERR", e.message, JSON.stringify(seen).slice(0, 300)); return /reason: /.test(e.message); });
    const drafts = seen.filter((x) => x.phase === "draft");
    assert.ok(drafts.some((x) => x.draft && x.draft.letter === "B"), "the preliminary answer had been shown");
    assert.equal(drafts.at(-1).draft, null, "…and was withdrawn when the analysis failed");
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: a failure of every model is reported once, as the app reports errors, and nothing hangs", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    behaviour["gemini-3.5-flash-lite"] = () => ({ status: 503, msg: "overloaded" }); behaviour["gemini-3.1-flash-lite"] = () => ({ status: 503, msg: "overloaded" });
    await assert.rejects(analyse({ key }), /reason: /);
  } finally { C.FLAGS.oneCall = false; }
});
