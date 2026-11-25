/* v3.74 · pure-theory gates, the model's self-check for light answers, and learning from Retry. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFetch, reset, script } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis, takeSelfLevel } from "../src/lib/analysis.js";
import { briefWith, FULL_DATA, GOOD_CALC, lessonText } from "./helpers-e2e.mjs";
import { assessQuestion } from "../src/lib/director.js";
import { recordRetry, learnedLift, clearLearning, learningSummary, __learnClock } from "../src/lib/director-learn.js";
import { ROUTER_POLICY } from "../src/lib/difficulty.js";

installFetch();
const load = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/difficulty-${n}.json`, import.meta.url), "utf8"));
const THEORY = ["theory-dev", "theory-heldout", "theory-validation", "theory-validation-2", "theory-validation-3"].map((n) => [n, load(n)]);

/* REGRESSION GATES (the sets were tuned on after their first run: these guard against getting worse, they are NOT accuracy estimates; see DIFFICULTY_CORPORA.md for the first-run numbers) */
test("THEORY regression gate: every theory corpus ≥ 90 %; across all of them 0 hard→easy, ≤ 1 medium→easy (a label-noise item), ≤ 2 hard→medium", () => {
  const bad = [];
  for (const [name, rows] of THEORY) {
    const miss = rows.filter((r) => assessQuestion(r.text).level !== r.label);
    assert.ok(1 - miss.length / rows.length >= 0.9, `${name} ${(100 * (1 - miss.length / rows.length)).toFixed(1)} %`);
    miss.forEach((r) => bad.push({ want: r.label, got: assessQuestion(r.text).level, id: r.id }));
  }
  assert.equal(bad.filter((b) => b.want === "hard" && b.got === "easy").length, 0, JSON.stringify(bad));
  assert.ok(bad.filter((b) => b.want === "medium" && b.got === "easy").length <= 1, JSON.stringify(bad));
  assert.ok(bad.filter((b) => b.want === "hard" && b.got === "medium").length <= 2, JSON.stringify(bad));
});

test("theory: short hard items are not rated easy, and recall items with a loose 'Which of the following is' stem are not mistaken for recall", () => {
  assert.notEqual(assessQuestion("If an infected cell loses MHC class I expression, which consequence follows and which cell type then becomes important for its destruction?\nA) NK cells detect missing self\nB) Helper T cells destroy it\nC) B cells present antigen\nD) Nothing changes").level, "easy");
  assert.notEqual(assessQuestion("Which of the following is a true statement about the difference between active and passive immunity?\nA) Active immunity follows the body's own response and lasts longer; passive immunity is transferred antibodies and is temporary\nB) Passive immunity creates memory cells\nC) Active immunity is immediate\nD) They last equally long").level, "easy");
  assert.equal(assessQuestion("Which of the following is the normal adult serum sodium range?\nA) 115-125\nB) 135-145\nC) 155-165\nD) 175-185").level, "easy");
  assert.equal(assessQuestion("What is the function of red blood cells?\nA) Fight infection\nB) Carry oxygen\nC) Clot blood\nD) Produce antibodies").level, "easy");
});

test("theory: distractor options naming organs do not inflate the integration signal", () => {
  const a = assessQuestion("How does the body increase oxygen delivery during exercise?\nA) By raising cardiac output and redistributing blood flow to working muscle\nB) By lowering the heart rate\nC) By shutting down the lungs\nD) By decreasing hemoglobin");
  assert.notEqual(a.level, "hard");
});

/* ── self-rating marker ── */
test("takeSelfLevel: reads the level, strips the marker, hides a half-streamed marker", () => {
  assert.deepEqual(takeSelfLevel("answer line\n@@LEVEL: hard@@", true), { text: "answer line", level: "hard" });
  assert.equal(takeSelfLevel("x\n@@level = Medium @@\n", true).level, "medium");
  assert.equal(takeSelfLevel("x\n@@LEV", false).text, "x");
  assert.equal(takeSelfLevel("no marker here", true).level, null);
  assert.ok(!/@@/.test(takeSelfLevel("a\n@@LEVEL: easy@@\n", true).text));
});

/* ── E2E: light answers are checked by the model that wrote them ── */
const EASY_Q = "Which of the following is the normal adult resting heart rate range? A) 60-100 B) 20-40 C) 120-160 D) 200-240";
const MED_Q = "A nurse is caring for a client with heart failure who has crackles and 2+ pitting edema. Which action should the nurse take first? A) Place the client in high Fowler position B) Offer fluids C) Check the diet order D) Ambulate the client";
let seq = 0;
async function run({ text, marker, keepStorage = false, key }) {
  key = key || `AIzaV374${String(++seq).padStart(10, "0")}`;
  ROUTER_POLICY.mode = "local";
  reset(); Router.__resetRouter(); if (!keepStorage) window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" });
  const kinds = [];
  for (const m of ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest", "gemini-3.1-pro-preview"]) script(`gemini:${m}`, { ok: (b) => {
    const s = String(b?.systemInstruction?.parts?.[0]?.text || "");
    if (/COMPACT LESSON/.test(s)) { kinds.push("compact"); return lessonText("body") + (marker ? `\n@@LEVEL: ${marker}@@` : ""); }
    if (s.includes("PREMISE:")) { kinds.push("solve"); return briefWith({ calc: GOOD_CALC, data: FULL_DATA }); }
    kinds.push("write"); return lessonText("body");
  } });
  const routes = [], updates = [];
  let a;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 15000);
    a = createAnalysis({ kind: "question", history: [], dataUrl: null, doc: { kind: "text", name: "q.txt", text }, extra: "", chips: [], apiKey: key, modeId: "auto", withWords: false,
      onRoute: (r) => routes.push(r), onUpdate: (n, d, m) => updates.push({ n, d, m }),
      onDone: (n) => { if (n === "reason") { clearTimeout(t); resolve(); } }, onError: (n, e) => { clearTimeout(t); reject(new Error(`${n}: ${e && e.message}`)); }, onNotice() {}, onTrust() {} });
    a.start();
  });
  const finals = updates.filter((u) => u.n === "reason" && u.m && u.m.final);
  return { kinds, routes, updates, finals, a };
}
const noMarker = (u) => u.every((x) => !/@@/.test(JSON.stringify(x.d)));

test("light answer rated 'easy' by its own writer: no escalation, marker never shown", async () => {
  const r = await run({ text: EASY_Q, marker: "easy" });
  assert.equal(r.routes.length, 1); assert.equal(r.routes[0].mode, "light");
  assert.equal(r.kinds.length, 1);
  assert.ok(noMarker(r.updates));
});

test("light answer rated 'hard' by its own writer: discarded and re-run one level up ONCE; the student only ever sees the second answer", async () => {
  const r = await run({ text: EASY_Q, marker: "hard" });
  assert.equal(r.routes.length, 2);
  assert.equal(r.routes[0].mode, "light");
  assert.equal(r.routes[1].source, "self-check"); assert.equal(r.routes[1].escalated, true); assert.equal(r.routes[1].mode, "deepflash");
  assert.equal(r.kinds.filter((k) => k === "compact").length, 1, "the light request ran once and is not repeated");
  assert.ok(r.kinds.includes("solve"), "the escalated run uses the solve stage");
  assert.equal(r.finals.length, 1, "only one final answer is ever emitted");
  assert.ok(noMarker(r.updates));
});

test("light answer rated 'medium': escalates to balanced; a missing marker never escalates", async () => {
  const m = await run({ text: EASY_Q, marker: "medium" });
  assert.equal(m.routes[1].mode, "balanced");
  const none = await run({ text: EASY_Q, marker: null });
  assert.equal(none.routes.length, 1);
});

test("a question routed medium/hard locally is never self-checked (the net protects only the costly error: hard answered as easy)", async () => {
  const r = await run({ text: MED_Q, marker: "easy" });
  assert.equal(r.routes[0].mode, "balanced");
  assert.ok(!r.kinds.includes("compact"));
});

/* ── learning from Retry ── */
test("learning: two Retries of a type lift future questions of that type one level, four lift two; Retry of a hard item records nothing; expiry; reset", () => {
  clearLearning();
  assert.equal(learnedLift("knowledge"), 0);
  recordRetry({ type: "knowledge", level: "medium" });
  assert.equal(learnedLift("knowledge"), 0);
  recordRetry({ type: "knowledge", level: "easy" });
  assert.equal(learnedLift("knowledge"), 1);
  recordRetry({ type: "knowledge", level: "medium" }); recordRetry({ type: "knowledge", level: "medium" });
  assert.equal(learnedLift("knowledge"), 2);
  recordRetry({ type: "calculation", level: "hard" });
  assert.equal(learnedLift("calculation"), 0);
  assert.deepEqual(learningSummary(), { knowledge: 4 });
  __learnClock(() => Date.now() + 46 * 864e5);
  assert.equal(learnedLift("knowledge"), 0, "45-day expiry");
  __learnClock();
  clearLearning();
  assert.equal(learnedLift("knowledge"), 0);
});

test("E2E learning: after two Retries on a medium-routed type the next question of that type is routed one level up", async () => {
  clearLearning();
  const first = await run({ text: MED_Q, marker: null });
  const type = first.routes[0].type;
  assert.equal(first.routes[0].level, "medium");
  first.a.retry("reason"); await new Promise((r) => setTimeout(r, 300));
  first.a.retry("reason"); await new Promise((r) => setTimeout(r, 300));
  assert.equal(learnedLift(type), 1);
  const next = await run({ text: MED_Q.replace("heart failure", "chronic heart failure"), marker: null, keepStorage: true });
  assert.equal(next.routes[0].level, "hard");
  assert.equal(next.routes[0].learned, true);
  assert.ok(next.routes[0].reasons.some((x) => /أعدت محاولة/.test(x)));
  clearLearning();
});
