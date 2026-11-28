/* v3.84 · (1) Arabic + English written correctly and laid out in order, (2) a lesson as deep as the question is hard, (3) a mnemonic only when one is needed.
   Unit tests of the pure pieces, then the whole thing through createAnalysis on a fake of Google. */
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/lib/router.js";
import * as Q from "../src/lib/quota.js";
import * as Ring from "../src/lib/keyring.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import * as C from "../src/lib/config.js";
import * as P from "../src/lib/one-call-polish.js";
import * as CK from "../src/lib/one-call-check.js";
import * as Dif from "../src/lib/difficulty.js";
import { buildOneCallPrompt, headingsFor } from "../src/lib/prompts.js";
import { __resetGuard } from "../src/lib/guard.js";
import { createAnalysis } from "../src/lib/analysis.js";

/* ───────── difficulty tiers ───────── */
const EASY = "Which of the following is a common symptom of hypoglycemia?\nA. Diaphoresis\nB. Kussmaul respirations\nC. Fruity breath\nD. Dry skin";
const MEDIUM = "A client is receiving heparin by continuous infusion. The aPTT is 96 seconds. Which action should the nurse take first?\nA. Continue the infusion unchanged\nB. Stop the infusion and notify the provider\nC. Increase the rate\nD. Repeat the INR tomorrow";
const HARD = "A client weighs 82 kg. Heparin is ordered at 18 units/kg/hr from a bag of 25,000 units in 500 mL. At what rate in mL/hr should the nurse set the pump?\nA. 20 mL/hr\nB. 29.5 mL/hr\nC. 41 mL/hr\nD. 59 mL/hr";
const SATA = "Which findings should the nurse report? Select all that apply.\nA. HR 48/min\nB. BP 88/50 mmHg\nC. K 6.1 mEq/L\nD. RR 22/min\nE. Temp 38.9 C\nF. SpO2 90%";

test("difficulty: easy < medium < hard, with clearly different budgets; «أقوى تحليل» is never easy", () => {
  assert.equal(Dif.rateQuestion(EASY).tier, "easy");
  assert.equal(Dif.rateQuestion(MEDIUM).tier, "medium");
  assert.equal(Dif.rateQuestion(HARD).tier, "hard");
  assert.equal(Dif.rateQuestion(SATA).tier, "hard");
  assert.equal(Dif.rateQuestion("A nurse teaches a client on warfarin. Which statement shows the teaching was effective?\nA. I eat spinach daily\nB. I use a soft toothbrush").tier, "medium");
  assert.ok(Dif.TIER_WORDS.easy < Dif.TIER_WORDS.medium && Dif.TIER_WORDS.medium < Dif.TIER_WORDS.hard);
  assert.equal(Dif.rateQuestion(EASY, { deepMode: true }).tier, "medium");
  assert.equal(Dif.rateQuestion("").tier, "easy");
});

test("the prompt: the depth, the bilingual contract and the 'mnemonic only when needed' rule are in it; the structure is not", () => {
  const p = (tier) => buildOneCallPrompt({ profile: null, history: [], extra: "", chips: [], tier, words: Dif.TIER_WORDS[tier] }).system;
  assert.match(p("easy"), /DEPTH FOR THIS ITEM: EASY[\s\S]*About 230 words/); assert.match(p("medium"), /MEDIUM[\s\S]*About 480 words/); assert.match(p("hard"), /HARD[\s\S]*About 850 words/);
  assert.match(p("easy"), /vary: leave it empty/); assert.match(p("easy"), /ONE concept only/); assert.match(p("hard"), /up to three lines each/);
  for (const t of ["easy", "medium", "hard"]) {
    const s = p(t);
    assert.match(s, /NOT an essay/); assert.match(s, /One language per clause/); assert.match(s, /never an English clause/); assert.match(s, /never word by word/);
    assert.match(s, /not sure of the standard Arabic term, keep the English term/); assert.match(s, /Never invent an Arabic term/); assert.match(s, /Do not translate drug names/);
    assert.match(s, /memo: ONLY when the item rests on a list/); assert.match(s, /leave memo EMPTY/); assert.match(s, /never write a mnemonic just to fill the part/);
    assert.ok(!/propertyOrdering|responseSchema|\{\s*"/.test(s), "the structure lives in the schema only");
  }
});

/* ───────── the memorization part ───────── */
test("memo gate: kept only for a real mnemonic on an easy item; never a restatement of the answer; at most 4 lines", () => {
  const base = { short_rationale: "Stop the heparin because the aPTT is supratherapeutic." };
  assert.equal(CK.gateMemo({ ...base, memo: "> Hold heparin when aPTT is high.\nاوقف الهيبارين لما الـ aPTT يعلى." }, "easy"), "", "an easy item gets no filler");
  assert.match(CK.gateMemo({ ...base, memo: "> **ABCDE** — Airway, Breathing, Circulation, Disability, Exposure\nالمسار الهوائي ثم التنفس ثم الدورة" }, "easy"), /ABCDE/, "a real acronym is kept even on an easy item");
  assert.match(CK.gateMemo({ ...base, memo: "> Sodium low means water in excess.\nالصوديوم قليل يعني ماء زيادة." }, "medium"), /Sodium/);
  assert.equal(CK.gateMemo({ ...base, memo: "> Stop the heparin because the aPTT is supratherapeutic.\nاوقف الهيبارين." }, "hard"), "", "it only restates the answer");
  assert.equal(CK.gateMemo({ ...base, memo: Array.from({ length: 9 }, (_, i) => `> line number ${i} of unrelated advice`).join("\n") }, "hard").split("\n").length, 4);
  assert.equal(CK.gateMemo({ ...base, memo: "" }, "hard"), "");
  const H = headingsFor([]);
  assert.ok(!CK.composeLesson({ answer_letter: "B", short_rationale: "x", memo: "> filler sentence one\nجملة", ask: "- a" }, H, { tier: "easy" }).explanation.includes(H.memo), "no memo heading when the memo is gated out");
  assert.ok(CK.composeLesson({ answer_letter: "B", short_rationale: "x", memo: "> **SOAP** — Subjective, Objective, Assessment, Plan\nالتقييم", ask: "- a" }, H, { tier: "easy" }).explanation.includes(H.memo));
});

/* ───────── the polish ───────── */
const flat = (lines) => lines.join(" ").split(/\s+/).filter((x) => x && x !== "—" && x !== "-");

test("spacing: Arabic and Latin runs are separated, punctuation sits where it belongs, empty brackets vanish, clean text is untouched", () => {
  assert.equal(P.tidySpacing("الجرعةmg مرتفعة ، وال aPTT  عالي (  ) ."), "الجرعة mg مرتفعة، وال aPTT عالي.");
  assert.equal(P.tidySpacing("aPTT 96 seconds"), "aPTT 96 seconds");
  const clean = "- **aPTT 96 seconds** — القيمة أعلى بكثير من المستهدف";
  assert.equal(P.tidySpacing(clean), clean); assert.equal(P.polishField(clean).text, clean, "clean text passes through unchanged");
  const once = P.polishField("الاختبار ااا يقيس   الزمن ،").text; assert.equal(P.polishField(once).text, once, "idempotent");
});

test("the output guard now runs on the one-request text: foreign script, a Latin fragment glued inside an Arabic word, doubled letters", () => {
  const dev = P.polishField("المريض सा بحاجة لمتابعة"); assert.ok(!/[\u0900-\u097F]/.test(dev.text) && dev.glitched === 1);
  const glue = P.polishField("الدواء كpsولة قوية"); assert.ok(!/ps/.test(glue.text) && glue.glitched === 1);
  const dbl = P.polishField("الاختبار ااا مهم"); assert.ok(!/ااا/.test(dbl.text) && dbl.fixes >= 1);
  const leak = P.polishField("- ok line\nOne bullet per main part, at most 10 words", { idx: new Set() }); assert.ok(!/One bullet per main part/.test(leak.text) && leak.leaks === 1);
});

test("untangle: a line that switches language 3+ times becomes one 'English — Arabic' line per pair; nothing is lost; a normal line is left alone", () => {
  const tangled = "- Check the aPTT result immediately before changing the heparin rate لأن الجرعة الزائدة تسبب نزيف خطير Hold the infusion and call the provider ثم راجع القيمة مرة تانية بعد ست ساعات";
  const out = P.untangleLine(tangled);
  assert.equal(out.length, 2); assert.ok(out.every((l) => l.startsWith("- ")));
  assert.deepEqual(flat(out), flat([tangled]), "every word kept, in the same order");
  assert.ok(/ — لأن/.test(out[0]) && /^- Hold the infusion/.test(out[1]));
  for (const ok of ["- **aPTT 96 seconds** — القيمة أعلى بكثير من المستهدف", "- مستوى الـ aPTT مرتفع جدًا ولازم نوقف الهيبارين فورًا ونبلغ الطبيب", "- **A) Continue the infusion** ❌ — غير آمن لأن الـ aPTT عالي", "> Hold the heparin\nاوقف الهيبارين", "short line"]) assert.deepEqual(P.untangleLine(ok.split("\n")[0]), [ok.split("\n")[0]]);
  assert.deepEqual(P.untangleLine("1. Check the aPTT result immediately before changing the heparin rate لأن الجرعة الزائدة تسبب نزيف خطير Hold the infusion and call the provider ثم راجع القيمة مرة تانية بعد ست ساعات").map((l) => l.slice(0, 3)), ["1. ", "- H"]);
});

test("polishReply: prose parts are polished, the machine fields stay exactly as the model wrote them", () => {
  const r = P.polishReply({ answer_letter: "B", short_rationale: "Hold it.", basics: "الاختبار ااا مهم", data: "aPTT=96 seconds", calc: "82 x 18", type: "MCQ", conf: "high" }, { system: "s", userText: "u" });
  assert.equal(r.out.answer_letter, "B"); assert.equal(r.out.data, "aPTT=96 seconds"); assert.equal(r.out.calc, "82 x 18"); assert.ok(!/ااا/.test(r.out.basics));
  assert.equal(r.stats.fixes, 1); assert.equal(r.stats.badness, 1);
});

test("an empty part never turns the repair counters into NaN (that silently disabled the rewrite)", () => {
  const r = P.polishReply({ answer_letter: "B", short_rationale: "x", vary: "", memo: "", basics: "الاختبار ااا مهم सा" }, { system: "s", userText: "u" });
  for (const k of ["fixes", "leaks", "tangled", "selfFix", "glitched", "badness"]) assert.ok(Number.isFinite(r.stats[k]), k);
  assert.equal(r.stats.badness, 2);
});

/* ───────── through createAnalysis ───────── */
const enc = new TextEncoder(); const log = []; let behaviour = {};
const fresh = () => { log.length = 0; behaviour = {}; R.__resetRouter(); Q.__resetQuota(); Q.__setClock(null); window.localStorage.clear(); Ring.__resetKeyring(); Ring.__setClock(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); __resetGuard(); return "AIzaLD" + String(Math.random()).slice(2, 14).padEnd(12, "0"); };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); if (!/streamGenerateContent/.test(u)) return new Response(JSON.stringify({ models: [] }), { status: 200 });
  const model = (u.match(/models\/([^:?]+)/) || [])[1], body = JSON.parse(init.body); log.push({ model, body });
  const b = (behaviour[model] || (() => ({ reply: "{}" })))(body, log.filter((l) => l.model === model).length);
  const text = typeof b.reply === "string" ? b.reply : JSON.stringify(b.reply);
  return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, thoughtsTokenCount: 1, candidatesTokenCount: 1 } })}\r\n\r\n`)); c.close(); } }), { status: 200 });
};
const reply = (over = {}) => ({
  answer_letter: "B", short_rationale: "Stop the infusion: the aPTT is far above target.", ask: "- Priority (safety)", decode: "- **aPTT 96 seconds** — أعلى بكثير من المستهدف", basics: "**aPTT** — clotting time.\n- مقياس لزمن التجلط.",
  steps: "1. Compare with target.\n2. Hold the drug.", options: "- **A) Continue** ❌ — غير آمن\n- **B) Stop and notify** ✅ — صح\n- **C) Increase** ❌ — بيزود النزيف\n- **D) Repeat INR** ❌ — تحليل غلط",
  vary: "", memo: "> Hold the infusion when the aPTT is high.\nاوقف التسريب.", tricks: "- **Wrong lab:** INR is for warfarin.", type: "MCQ", keyword: "FIRST", concepts: "heparin; aPTT", data: "aPTT=96 seconds", calc: "", conf: "high", ...over,
});
const isReason = (l) => l.body.generationConfig?.responseSchema?.propertyOrdering?.[0] === "answer_letter";
function analyse({ key, stem, modeId = "balanced" }) {
  return new Promise((resolve, reject) => {
    const out = { reason: null, tricks: null, done: {}, trusts: [] }; const t = setTimeout(() => reject(new Error("timed out")), 8000);
    createAnalysis({ kind: "question", history: [], doc: { kind: "text", name: "q.txt", text: stem }, extra: "", chips: [], apiKey: key, modeId,
      onUpdate: (n, d) => { if (n === "reason" && d && d.explanation) { out.reason = d.explanation; out.tricks = d.tricks; } }, onTrust: (x) => out.trusts.push(x),
      onDone: (n, m) => { out.done[n] = m; if (out.done.reason && out.done.words) { clearTimeout(t); resolve(out); } }, onError: (n, e) => { clearTimeout(t); reject(new Error(`${n}: ${e && e.message}`)); } }).start();
  });
}
const reasonBody = () => log.filter(isReason);

test("createAnalysis: the lesson's depth follows the difficulty (the prompt carries the tier and a word budget that grows with it)", async () => {
  C.FLAGS.oneCall = true;
  try {
    const seen = {};
    for (const [name, stem] of [["easy", EASY], ["medium", MEDIUM], ["hard", HARD]]) {
      const key = fresh(); behaviour["gemini-3.5-flash-lite"] = (b) => (b.generationConfig.responseSchema ? { reply: reply() } : { reply: "{}" });
      const out = await analyse({ key, stem });
      const sys = reasonBody()[0].body.systemInstruction.parts[0].text;
      seen[name] = { tier: /DEPTH FOR THIS ITEM: ([A-Z]+)/.exec(sys)[1], words: +/About (\d+) words/.exec(sys)[1] };
      assert.equal(out.done.reason.tier, name);
    }
    assert.deepEqual(Object.values(seen).map((x) => x.tier), ["EASY", "MEDIUM", "HARD"]);
    assert.ok(seen.easy.words < seen.medium.words && seen.medium.words < seen.hard.words, JSON.stringify(seen));
    assert.ok(seen.easy.words <= 230);
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: an easy question gets no memorization filler; a hard one keeps a real mnemonic", async () => {
  C.FLAGS.oneCall = true;
  try {
    const H = headingsFor([]);
    let key = fresh(); behaviour["gemini-3.5-flash-lite"] = (b) => (b.generationConfig.responseSchema ? { reply: reply({ short_rationale: "Diaphoresis is a sign of hypoglycemia.", answer_letter: "A", options: "- **A) Diaphoresis** ✅ — صح\n- **B) Kussmaul** ❌ — غلط", memo: "> Sweating shows low sugar.\nالعرق يعني سكر واطي." }) } : { reply: "{}" });
    const easy = await analyse({ key, stem: EASY }); assert.ok(!easy.reason.includes(H.memo), "no memo section for an easy item");
    key = fresh(); behaviour["gemini-3.5-flash-lite"] = (b) => (b.generationConfig.responseSchema ? { reply: reply({ answer_letter: "B", type: "calculation", data: "weight=82 kg; dose=18 units/kg/hr; units=25000 units; volume=500 mL", calc: "82 x 18 = 1476; 1476 / 50 = 29.5 mL/hr", options: "- **A) 20 mL/hr** ❌ — x\n- **B) 29.5 mL/hr** ✅ — y\n- **C) 41 mL/hr** ❌ — x\n- **D) 59 mL/hr** ❌ — x", short_rationale: "82 kg x 18 units = 1476 units per hour, divided by 50 units per mL.", memo: "> **DRIP** — Dose, Rate, Infusion, Pump\nالجرعة ثم المعدل ثم المحلول ثم المضخة" }) } : { reply: "{}" });
    const hard = await analyse({ key, stem: HARD }); assert.ok(hard.reason.includes(H.memo) && hard.reason.includes("DRIP"));
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: glitches in the model's Arabic are repaired before the student sees them; a badly written reply earns ONE rewrite by the stronger model", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    const bad = reply({ basics: "**aPTT** — الاختبار ااا يقيس زمن सा التجلط", decode: "- **aPTT 96 seconds** — القيمة كpsولة عالية ."  });
    behaviour["gemini-3.5-flash-lite"] = (b) => (b.generationConfig.responseSchema ? { reply: bad } : { reply: "{}" });
    behaviour["gemini-3.6-flash"] = () => ({ reply: reply({ short_rationale: "REWRITTEN: stop the infusion." }) });
    const out = await analyse({ key, stem: MEDIUM });
    assert.deepEqual(reasonBody().map((l) => l.model), ["gemini-3.5-flash-lite", "gemini-3.6-flash"], "one rewrite, no more");
    assert.ok(out.reason.includes("REWRITTEN"));
    assert.ok(!/[\u0900-\u097F]|ااا|كps/.test(out.reason), "no glitch reached the screen");
    assert.equal(out.done.reason.language.badness >= 0, true);
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: when the rewrite budget is spent the repaired text is still shown (no extra request, no false «راجع» badge)", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    const G = await import("../src/lib/guard.js"); for (let i = 0; i < 4; i++) G.allowRetry();
    behaviour["gemini-3.5-flash-lite"] = (b) => (b.generationConfig.responseSchema ? { reply: reply({ basics: "**aPTT** — الاختبار ااا يقيس زمن सा التجلط", decode: "- **aPTT 96 seconds** — القيمة كpsولة عالية" }) } : { reply: "{}" });
    behaviour["gemini-3.6-flash"] = () => ({ reply: reply({ short_rationale: "SHOULD NOT BE ASKED" }) });
    const out = await analyse({ key, stem: MEDIUM });
    assert.equal(reasonBody().length, 1); assert.ok(!/[\u0900-\u097F]|ااا|كps/.test(out.reason));
    assert.ok(!JSON.stringify(out.trusts).includes("one-call-review"));
  } finally { C.FLAGS.oneCall = false; }
});

test("createAnalysis: a tangled line in the reply is laid out as separate lines on the screen text", async () => {
  C.FLAGS.oneCall = true;
  try {
    const key = fresh();
    const tangled = "- Check the aPTT result immediately before changing the heparin rate لأن الجرعة الزائدة تسبب نزيف خطير Hold the infusion and call the provider ثم راجع القيمة مرة تانية بعد ست ساعات";
    behaviour["gemini-3.5-flash-lite"] = (b) => (b.generationConfig.responseSchema ? { reply: reply({ steps: tangled }) } : { reply: "{}" });
    const out = await analyse({ key, stem: MEDIUM });
    assert.ok(out.reason.includes("heparin rate — لأن الجرعة") && out.reason.includes("\n- Hold the infusion and call the provider — ثم راجع"));
  } finally { C.FLAGS.oneCall = false; }
});
