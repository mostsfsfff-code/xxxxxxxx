import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, reset, log, script } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { isExamItem, auditClinicalQuality, EXAM_QUALITY_INSTRUCTION, CLINICAL_QUALITY_INSTRUCTION } from "../src/lib/clinical-quality.js";

installFetch();
const G = (m) => `gemini:${m}`;

const STEM = `A 68-year-old client weighing 80 kg is on day 6 of an unfractionated heparin infusion. Platelets: 98,000/mm³ (admission 245,000/mm³). The client reports new pain in the left leg. Which action should the nurse take first?
A) Hold the infusion for 1 hour, then restart at 14.4 mL/hr per protocol
B) Stop the heparin infusion and notify the provider immediately
C) Continue the infusion and repeat the platelet count in 24 hours
D) Request an order for protamine sulfate`;

test("isExamItem: lettered options → exam item; an open question → not", () => {
  assert.equal(isExamItem(STEM), true);
  assert.equal(isExamItem("A patient asks about current evidence for hypertension treatment."), false);
  assert.equal(isExamItem("Vitamin A) is fat soluble"), false);
});

test("a patient's weight is not a medication dose (no false 'dose-instruction-incomplete')", () => {
  const a = auditClinicalQuality({ caseText: "A client weighing 80 kg is on heparin.", answerText: "Stop the heparin infusion and notify the provider.", narrative: "The client weighing 80 kg has HIT." });
  assert.ok(!a.advisories.some((x) => x.code === "dose-instruction-incomplete"));
  const b = auditClinicalQuality({ caseText: "A medical patient needs treatment.", answerText: "Start insulin 10 units.", narrative: "" });
  assert.ok(b.advisories.some((x) => x.code === "dose-instruction-incomplete"), "a real dose is still checked");
});

test("the exam rules are far shorter than the universal protocol", () => {
  assert.ok(EXAM_QUALITY_INSTRUCTION.length * 5 < CLINICAL_QUALITY_INSTRUCTION.length);
});

test("an exam item: no search, the short rules instead of the universal protocol, no generic advisory section", async () => {
  const key = "AIzaEXAMLEAN00000001";
  reset(); Router.__resetRouter(); window.localStorage.clear();
  setExtKeys({}); setEnginePrefs({ mode: "auto" });
  script(G("gemini-flash-latest"), { ok: "## ✅ Answer\nB) Stop the heparin infusion. Never restart heparin when HIT is suspected. The client weighing 80 kg got 14.4 mL/hr in option A." });
  let text = "";
  const trust = [];
  await new Promise((resolve, reject) => {
    const done = new Set();
    const timeout = setTimeout(() => reject(new Error("analysis did not finish")), 10000);
    createAnalysis({
      kind: "question", history: [], dataUrl: null,
      doc: { kind: "text", name: "question.txt", text: STEM },
      extra: "", chips: [], apiKey: key, modeId: "balanced",
      onUpdate: (name, t) => { if (name === "reason" && t && t.explanation) text = t.explanation; },
      onDone: (name) => { done.add(name); if (done.has("reason") && done.has("words")) { clearTimeout(timeout); resolve(); } },
      onError: (name, err) => { clearTimeout(timeout); reject(new Error(`${name}: ${err?.message || err}`)); },
      onNotice() {}, onTrust: (t) => trust.push(t),
    }).start();
  });
  const reqs = log.filter((x) => x.lane !== "list");
  assert.equal(reqs.filter((x) => Array.isArray(x.body?.tools) && x.body.tools.some((t) => t.google_search)).length, 0, "no live search for an exam item");
  const sys = reqs.map((x) => x.body?.systemInstruction?.parts?.[0]?.text || "");
  assert.ok(!sys.some((s) => s.includes("UNIVERSAL HEALTHCARE ANSWER QUALITY PROTOCOL")), "the 2,400-token protocol is not sent");
  assert.ok(sys.some((s) => s.includes("EXAM ITEM QUALITY RULES")), "the short exam rules are sent instead");
  assert.ok(!/فحوص جودة الإجابة الصحية العامة|التحقق من المصادر الخارجية/.test(text), "no generic real-world advisories in a study answer");
  const final = trust.find((x) => x.phase === "final");
  assert.ok(!final || !final.medicalSearch);
});

import { splitText } from "../src/lib/accuracy.js";
test("v3.80 · a **bold term** in the middle of a sentence is not a sentence boundary", () => {
  const l = splitText("Heparin activates **antithrombin III** (a natural body protein) → clotting factors slow down — الدواء بينشط **antithrombin III** فده بيبطئ العوامل")[0];
  assert.equal(l.sentences.length, 1);
  const m = splitText("**Do this first.** Then stop the drip.")[0];
  assert.equal(m.sentences.length, 2);
});
