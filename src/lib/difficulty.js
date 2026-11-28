/* ───────────── v3.84 · how deep should THIS lesson be? (deterministic, local, no request) ─────────────
   An ordinary recall question must not get an essay, and a multi-step case must not get three lines. Three tiers with clearly different depth:
     easy    one fact or one rule             → a short lesson (about 230 words)
     medium  apply a concept / a priority     → a medium lesson (about 480 words)
     hard    calculations, select-all, labs, several traps → the full lesson (about 850 words)
   The score only looks at the text of the question (length, numbers, format, what is asked). The mode's own word cap stays the ceiling. */

import { needsDeepThinking } from "./think-router.js";

export const TIER_WORDS = Object.freeze({ easy: 230, medium: 480, hard: 850 });
const FORMAT_HARD = /\b(?:select\s+all\s+that\s+apply|SATA|all\s+that\s+apply|prioriti[sz]e\s+the\s+following|order\s+of\s+priority|drag\s+and\s+drop|matrix|bow[\s-]?tie|hot\s*spot|cloze|highlight)\b|اختر\s+كل\s+ما\s+ينطبق/i;
const PRIORITY = /\b(?:first(?!\s+\d)|priority|most\s+important|most\s+urgent|immediately|next\s+action|best\s+(?:initial\s+)?action|delegate|delegation|assign|triage|which\s+(?:client|patient)\s+should)\b/i;
const TEACHING = /\b(?:teaching|further\s+teaching|statement(?:s)?\s+(?:by|made\s+by)|understanding|discharge\s+instructions?|effective)\b/i;
const NEGATION = /\b(?:EXCEPT|NOT|LEAST|contraindicated|avoid|unsafe)\b/;
const LAB_OR_ACID = /\b(?:ABG|pH|PaCO2|PaO2|HCO3|anion\s+gap|acid[\s-]?base|acidosis|alkalosis|potassium|sodium|calcium|magnesium|troponin|creatinine|INR|aPTT|lactate|bilirubin|ECG|EKG|rhythm|telemetry|hemoglobin)\b/i;
const DRUG_SAFETY = /\b(?:dose|dosage|overdose|toxicity|antidote|titrat|infusion|drip|anticoagulant|insulin|heparin|warfarin|opioid|digoxin|lithium|vancomycin|chemotherapy)\w*/i;
const EASY_ASK = /^\s*(?:which|what)\b[^?]{0,80}\b(?:is|are)\s+(?:a|an|the)?\s*(?:common|normal|expected|characteristic|definition|purpose|function|symptom|sign|example)\b/i;

const words = (s) => (String(s || "").match(/[A-Za-z\u0621-\u064A0-9]+/g) || []).length;
const numbers = (s) => (String(s || "").match(/(?<![A-Za-z])\d+(?:[.,]\d+)?\s*(?:%|mmHg|mg|mcg|g|kg|mL|mEq|mmol|units?|bpm|breaths|°C|°F|mg\/dL|mEq\/L|\/min|\/hr)?/gi) || []).length;

export function rateQuestion(text, { deepMode = false } = {}) {
  const t = String(text || "");
  const reasons = []; let score = 0;
  const add = (n, why) => { score += n; reasons.push(why); };
  if (needsDeepThinking(t).deep) add(4, "clinical calculation");
  if (FORMAT_HARD.test(t)) add(3, "select-all / ordered / next-gen format");
  const w = words(t);
  if (w > 120) add(2, "long stem"); else if (w > 60) add(1, "medium stem");
  const n = numbers(t);
  if (n >= 7) add(2, "many findings"); else if (n >= 4) add(1, "several findings");
  if (LAB_OR_ACID.test(t) && n >= 2) add(1, "lab / rhythm interpretation");
  if (DRUG_SAFETY.test(t)) add(1, "drug safety");
  if (PRIORITY.test(t)) add(1, "priority / delegation");
  if (TEACHING.test(t)) add(1, "teaching / evaluating a statement");
  if (NEGATION.test(t)) add(1, "negative wording");
  if (EASY_ASK.test(t) && w <= 45) add(-1, "plain recall");
  let tier = score >= 4 ? "hard" : score >= 2 ? "medium" : "easy";
  if (deepMode && tier === "easy") { tier = "medium"; reasons.push("«أقوى تحليل» is never answered as an easy item"); }
  return { tier, score, words: TIER_WORDS[tier], reasons };
}
