/* v3.73 · the Director: accuracy gates on labelled corpora (they FAIL if accuracy regresses), speed, determinism, and unit behaviour. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assessQuestion, DIRECTOR_CONFIG, TOPICS } from "../src/lib/director.js";
import { legacyHeuristicLevel, heuristicLevel } from "../src/lib/difficulty.js";

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/difficulty-${n}.json`, import.meta.url), "utf8"));
const CORP = { dev: load("dev"), heldout: load("heldout"), validation: load("validation") };
const LV = ["easy", "medium", "hard"];
function score(rows, rater) {
  const bad = [];
  for (const r of rows) { const got = rater(r.text); if (got !== r.label) bad.push({ id: r.id, want: r.label, got }); }
  return { acc: (rows.length - bad.length) / rows.length, bad };
}
const dir = (t) => assessQuestion(t).level;

test("corpora are balanced and well-formed (labels easy/medium/hard, no duplicates between sets)", () => {
  const seen = new Set();
  for (const [name, rows] of Object.entries(CORP)) {
    for (const r of rows) { assert.ok(LV.includes(r.label), `${name}/${r.id}`); assert.ok(r.text.length > 20); assert.ok(!seen.has(r.text), `duplicate ${r.id}`); seen.add(r.text); }
    for (const l of LV) assert.ok(rows.filter((r) => r.label === l).length >= 10, `${name} has ≥ 10 ${l}`);
  }
});

test("ACCURACY GATE: dev ≥ 95 %, held-out ≥ 95 %, validation ≥ 90 %", () => {
  for (const [name, min] of [["dev", 0.95], ["heldout", 0.95], ["validation", 0.9]]) {
    const r = score(CORP[name], dir);
    assert.ok(r.acc >= min, `${name} accuracy ${(100 * r.acc).toFixed(1)} % < ${100 * min} %: ${r.bad.map((b) => `${b.id} ${b.want}→${b.got}`).join(", ")}`);
  }
});

test("SAFETY GATE: across every corpus no hard item is rated easy, no medium item is rated easy, and at most one hard item is rated medium", () => {
  const all = Object.values(CORP).flat();
  const { bad } = score(all, dir);
  assert.equal(bad.filter((b) => b.want === "hard" && b.got === "easy").length, 0);
  assert.equal(bad.filter((b) => b.want === "medium" && b.got === "easy").length, 0);
  assert.ok(bad.filter((b) => b.want === "hard" && b.got === "medium").length <= 1, JSON.stringify(bad));
});

test("the Director beats the keyword rater it replaced by ≥ 15 points on the held-out set", () => {
  const d = score(CORP.heldout, dir).acc, l = score(CORP.heldout, (t) => legacyHeuristicLevel(t).local).acc;
  assert.ok(d - l >= 0.15, `director ${d} legacy ${l}`);
});

test("the exact acid-base question that was rated MEDIUM is now HARD, with the reasons shown", () => {
  const q = "A client has the following results: pH 7.28, PaCO2 30 mmHg, HCO3 14 mEq/L, Na 140, Cl 108. Which interpretation is best?\nA) Uncompensated metabolic acidosis\nB) High anion gap metabolic acidosis with appropriate respiratory compensation only\nC) Mixed high anion gap and normal anion gap metabolic acidosis with appropriate respiratory compensation\nD) Metabolic acidosis with a concurrent respiratory acidosis";
  const a = assessQuestion(q);
  assert.equal(a.level, "hard");
  assert.ok(a.signals.some((s) => s.id === "abg-panel") && a.signals.some((s) => s.id === "ag-possible") && a.signals.some((s) => s.id === "combined-options"));
  assert.ok(a.reasons.length >= 2);
  assert.equal(a.type, "interpretation");
  /* even without the words "anion gap", Na/Cl/HCO3 with an ABG is enough */
  assert.equal(assessQuestion("pH 7.30, PaCO2 28, HCO3 13, Na 139, Cl 109. What is the acid-base disorder?").level, "hard");
});

test("SPEED: median under 2 ms, 99th percentile under 15 ms, a 8,000-character text under 25 ms", () => {
  const all = Object.values(CORP).flat();
  for (let i = 0; i < 3; i++) all.forEach((r) => assessQuestion(r.text));            // warm-up
  const ts = all.map((r) => { const t0 = process.hrtime.bigint(); assessQuestion(r.text); return Number(process.hrtime.bigint() - t0) / 1e6; }).sort((a, b) => a - b);
  assert.ok(ts[Math.floor(ts.length / 2)] < 2, `median ${ts[Math.floor(ts.length / 2)]}`);
  assert.ok(ts[Math.floor(ts.length * 0.99)] < 15, `p99 ${ts[Math.floor(ts.length * 0.99)]}`);
  const big = "A client with sepsis has MAP 60 and lactate 4. ".repeat(250);
  const t0 = process.hrtime.bigint(); assessQuestion(big); assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 25);
});

test("deterministic and pure: same input → same output, input never mutated, empty/garbage input is safe", () => {
  const t = CORP.dev[5].text;
  const a = assessQuestion(t), b = assessQuestion(t);
  delete a.ms; delete b.ms;
  assert.deepEqual(a, b);
  for (const x of ["", " ", null, undefined, "?", "A) B) C) D)", "٣٤٥ مريض عنده ضغط ١٢٠/٨٠"]) { const r = assessQuestion(x); assert.ok(LV.includes(r.level)); }
});

test("easy needs positive evidence: unknown plain text is medium, a recall item with a drug name is still easy", () => {
  assert.ok(["medium", "hard"].includes(assessQuestion("Explain the general role of the kidneys in maintaining the balance of water and salts and why it matters for health in children and older adults in a way a first year student can follow. ".repeat(2)).level), "open explain-why request: never easy");
  assert.equal(assessQuestion("The antidote for heparin overdose is:\nA) Vitamin K\nB) Protamine sulfate\nC) Naloxone\nD) Flumazenil").level, "easy");
});

test("units in answer options are not data and not dosing (the potassium question stays easy)", () => {
  const q = "Which of the following is the normal adult serum potassium range?\nA) 1.5-2.5 mEq/L\nB) 3.5-5.0 mEq/L\nC) 6.0-7.5 mEq/L\nD) 8.0-9.5 mEq/L";
  const a = assessQuestion(q);
  assert.equal(a.level, "easy"); assert.equal(a.calc, false); assert.equal(a.features.analytes, 0);
});

test("calculation: simple is at least medium; weight-based per-minute with concentration is hard", () => {
  assert.ok(["medium", "hard"].includes(assessQuestion("The prescriber orders 250 mg. The tablets are 125 mg each. How many tablets should the nurse give?").level));
  const hard = assessQuestion("The order is dopamine 5 mcg/kg/min. The client weighs 70 kg. The pharmacy sends dopamine 400 mg in 250 mL. At how many mL/hr should the nurse set the pump?");
  assert.equal(hard.level, "hard"); assert.ok(hard.signals.find((s) => s.id === "calc").steps >= 4);
});

test("inline options, 'select all', age phrases and judgement items are understood", () => {
  assert.equal(assessQuestion("Which organ produces insulin? A) Liver B) Pancreas C) Kidney D) Spleen").features.options, 4);
  assert.ok(assessQuestion("Which findings need action? Select all that apply.\nA) x\nB) y\nC) z").signals.some((s) => s.id === "select-all"));
  assert.equal(assessQuestion("A 6-month-old with bronchiolitis has a respiratory rate of 68/min and retractions. Which action should the nurse take first?").features.patient, true);
  assert.equal(assessQuestion("Which task may the registered nurse delegate to the unlicensed assistive personnel?\nA) a\nB) b\nC) c\nD) d").level, "medium");
});

test("confidence: boundary cases are not 'high'; and the low-confidence bias only lifts calculation / acid-base / multi-topic borderlines", () => {
  const sepsis = assessQuestion("A nurse is caring for a client with sepsis who has a MAP of 62 mmHg and a lactate of 3.5 mmol/L. Which action should the nurse take first?");
  assert.notEqual(sepsis.confidence, "high");
  assert.equal(DIRECTOR_CONFIG.biasUpOnLowConfidence, true);
  assert.ok(TOPICS.length >= 20 && TOPICS.every(([id, re, w, label]) => id && re instanceof RegExp && w >= 1 && label));
});

test("heuristicLevel keeps its old shape and exposes the full analysis", () => {
  const r = heuristicLevel("Which vitamin deficiency causes scurvy?\nA) A\nB) B12\nC) C\nD) D");
  for (const k of ["level", "local", "score", "reasons", "calc", "sure", "type", "confidence", "director"]) assert.ok(k in r, k);
  assert.equal(r.sure, "easy");
});
