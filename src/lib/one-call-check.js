/* ───────────── v3.84 · what is done with the reply of the one request ─────────────
   1. composeLesson   the flat parts → the same markdown the screen already renders (headings from prompts.js) + the tricks text
   2. makeBrief       the parts → the PREMISE / ANSWER / … brief that solvecheck.js, the calculation audit and the safety audit already read
   3. postCheck       deterministic checks in code (no request): the letter, the option marks, the numbers, the glossary's bad renderings.
                      A bad rendering is repaired in code; a contradiction asks for ONE escalation (analysis.js) or shows the «راجع» badge. */

import { fixBadForms, hasBadForm } from "./nursing-dict.js";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const normDigits = (s) => String(s || "").replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/٫/g, ".").replace(/٬/g, "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");   // 25,000 → 25000
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* a part written by the model: no code fences, no heading line of its own (the app adds the headings), no stray markers */
export function cleanField(s) {
  return String(s == null ? "" : s).replace(/\r/g, "").replace(/```[a-z]*\n?|```/gi, "").split("\n").filter((l) => !/^\s*#{1,4}\s/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const LETTERS_RE = /^[A-H](?:\s*[,،&/]\s*[A-H]|\s+and\s+[A-H])*$/i;
export function answerLetters(raw) {
  const t = String(raw || "").trim().replace(/[().*]/g, "").trim();
  if (!t || !LETTERS_RE.test(t)) return [];
  return [...new Set((t.toUpperCase().match(/[A-H]/g) || []))];
}

/* ✅ / ❌ per option, read from the "options" part:  - **A) text** ✅ — why */
export function parseOptionMarks(optionsText) {
  const out = [];
  for (const line of String(optionsText || "").split("\n")) {
    const m = /(?:^|[\s*-])\**([A-H])\s*[).:]\**.*?(✅|✔|✓|❌|✗|✘)\s*[—–-]?\s*(.*)$/u.exec(line.trim());
    if (m && !out.some((o) => o.letter === m[1])) out.push({ letter: m[1], mark: /✅|✔|✓/.test(m[2]) ? "yes" : "no", why: m[3].replace(/\*+/g, "").split(/\s+/).slice(0, 15).join(" ") });
  }
  return out;
}

/* ───────── 1 · the screen text ───────── */
/* the memorization part is kept ONLY when it holds a real mnemonic / acronym (or the item is not easy), is short, and is not just the answer again */
const ACRONYM = /(?:\b[A-Z]{3,}\b|\b(?:[A-Z]\s*[-–=]\s*){2,}[A-Z]\b|mnemonic)/;
const wordSet = (t) => new Set((String(t || "").toLowerCase().match(/[a-z]{3,}/g) || []));
export function gateMemo(out, tier = "medium") {
  let memo = cleanField(out.memo);
  if (!memo) return "";
  const lines = memo.split("\n").filter((l) => l.trim());
  if (lines.length > 4) memo = lines.slice(0, 4).join("\n");
  if (tier === "easy" && !ACRONYM.test(memo)) return "";                       // an easy item rarely needs a mnemonic: no filler
  const a = wordSet(memo), b = wordSet(`${out.short_rationale || ""}`);
  if (a.size && b.size) { let common = 0; for (const w of a) if (b.has(w)) common++; if (common / a.size >= 0.7) return ""; }   // it only restates the answer
  return memo;
}

export function composeLesson(out, H, { tier = "medium" } = {}) {
  out = { ...out, memo: gateMemo(out, tier) };
  const part = (heading, key) => { const t = cleanField(out[key]); return t ? `${heading}\n${t}` : ""; };
  const raw = cleanField(out.answer_letter), letters = answerLetters(raw), why = cleanField(out.short_rationale);
  const answer = !raw ? "" : letters.length
    ? `${H.answer}\n- **${letters.join(", ")})**${why ? ` ${why}` : ""}`
    : `${H.answer}\n- **${raw}**${why ? `\n- ${why}` : ""}`;
  const explanation = [part(H.ask, "ask"), part(H.decode, "decode"), part(H.basics, "basics"), part(H.steps, "steps"), part(H.options, "options"), answer, part(H.vary, "vary"), part(H.memo, "memo")].filter(Boolean).join("\n\n");
  return { explanation, tricks: cleanField(out.tricks) };
}

/* ───────── 2 · the brief the trust layer reads ───────── */
export function makeBrief(out) {
  const one = (s) => cleanField(s).replace(/\s*\n\s*/g, " ").trim();
  const raw = one(out.answer_letter), letters = answerLetters(raw);
  const marks = parseOptionMarks(out.options);
  const lines = [
    `PREMISE: ${one(out.short_rationale).split(/\s+/).slice(0, 20).join(" ")}`,
    `ANSWER: ${letters.length ? letters.join(", ") : raw}`,
    `TYPE: ${one(out.type) || "MCQ"}`,
    `KEYWORD: ${one(out.keyword) || "NOT APPLICABLE"}`,
    `CONCEPTS: ${one(out.concepts)}`,
    `DATA: ${one(out.data)}`,
    "OPTIONS:",
    ...(marks.length ? marks.map((o) => `${o.letter}) ${o.mark === "yes" ? "✅" : "❌"} ${o.why}`) : [letters.length ? "NONE — option verdicts were not written" : "NONE — no answer choices supplied"]),
  ];
  const calc = one(out.calc); if (calc) lines.push(`CALC: ${calc}`);
  lines.push(`CONFIDENCE: ${one(out.conf) || "medium"}`);
  return lines.join("\n");
}

/* ───────── 3 · deterministic checks ───────── */
const LETTER_STATEMENT = /(?:correct\s+(?:answer|option|choice)\s*(?:is|:)?|the\s+answer\s+is|answer\s*:|الإجابة\s+الصح(?:يحة|ة)?(?:\s+هي)?|الإجابة\s+هي|الاختيار\s+الصح(?:يح)?(?:\s+هو)?|الخيار\s+الصح(?:يح)?(?:\s+هو)?)\s*[:：]?\s*\(?\s*\**\s*([A-Ha-h])\b/gi;

export function parseData(s) {
  return String(s || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = normDigits(x).match(/^(.+?)\s*[=:]\s*(-?\d+(?:\.\d+)?)\s*(.*)$/);
    return m ? { name: m[1].trim(), value: m[2], unit: m[3].trim() } : null;
  }).filter(Boolean);
}

export function postCheck(out, { stem = "", dict, language = null } = {}) {
  const fixed = { ...out }; const issues = []; let fixes = 0;
  const textKeys = ["short_rationale", "ask", "decode", "basics", "steps", "options", "vary", "memo", "tricks", "concepts"];
  /* repair: an observed bad rendering becomes the glossary rendering (safe string replacement) */
  const dopts = dict ? { dict } : undefined;
  for (const k of textKeys) { const r = fixBadForms(fixed[k], dopts); if (r.fixes) { fixed[k] = r.text; fixes += r.fixes; } }
  const left = textKeys.flatMap((k) => hasBadForm(fixed[k], dopts));
  if (left.length) issues.push({ code: "bad-rendering", severity: "low", detail: left.join(", ") });

  const raw = cleanField(fixed.answer_letter), letters = answerLetters(raw), srcText = normDigits(stem);
  const lettered = /(?:^|[\s(])A[.)]\s+\S[\s\S]*?(?:^|[\s(])B[.)]\s+\S/m.test(stem);
  if (!raw) issues.push({ code: "no-answer", severity: "high", detail: "answer_letter is empty" });
  else if (lettered && !letters.length && !/open|source-only/i.test(String(fixed.type || ""))) issues.push({ code: "no-letter", severity: "high", detail: `the source has lettered options but the answer is "${raw}"` });

  /* every option mark must agree with the chosen letter(s) */
  const marks = parseOptionMarks(fixed.options), yes = marks.filter((o) => o.mark === "yes").map((o) => o.letter);
  if (letters.length && marks.length >= 2 && yes.length) {
    const a = [...letters].sort().join(""), b = [...yes].sort().join("");
    if (a !== b) issues.push({ code: "marks-mismatch", severity: "high", detail: `answer ${letters.join(",")} but ✅ on ${yes.join(",")}` });
  }
  /* an explicit "the correct answer is X" anywhere else must name the same letter */
  if (letters.length === 1) {
    const prose = normDigits(["short_rationale", "basics", "steps", "vary", "memo", "tricks"].map((k) => fixed[k] || "").join("\n"));
    for (const m of prose.matchAll(LETTER_STATEMENT)) { const L = m[1]; if (L !== L.toUpperCase()) continue; if (L !== letters[0]) { issues.push({ code: "letter-conflict", severity: "high", detail: `says ${L}, answer is ${letters[0]}` }); break; } }
  }
  /* decisive inputs: each must come from the source, and the same name must not carry another value in the prose */
  if (srcText.trim().length > 30) {
    /* only the places that restate the patient's value AS A FACT: the reason and the calculation. The other parts legitimately quote other numbers
       (normal ranges, "if the stem said 55 instead …"), so scanning them would raise false alarms and waste the one escalation request. */
    const prose = normDigits([fixed.short_rationale, fixed.calc].join("\n"));
    for (const d of parseData(fixed.data)) {
      if (!new RegExp(`(?<![\\d.])${esc(d.value)}(?!\\d|\\.\\d)`).test(srcText)) { issues.push({ code: "data-not-in-source", severity: "high", detail: `${d.name}=${d.value}` }); continue; }
      if (d.name.length < 3) continue;
      /* only a value stated for that very name ("aPTT is 69", "weight = 82", "K: 3.1"): a bare word like "units" next to some other number is not a restatement */
      for (const m of prose.matchAll(new RegExp(`(?<![A-Za-z])${esc(d.name)}\\s*(?:=|:|\\bis\\b|\\bwas\\b|\\bof\\b)\\s*(-?\\d+(?:\\.\\d+)?)`, "gi"))) if (parseFloat(m[1]) !== parseFloat(d.value)) { issues.push({ code: "num-conflict", severity: "high", detail: `${d.name}: ${d.value} vs ${m[1]}` }); break; }
    }
  }
  /* language quality (the output guard's own "how bad was it" number): a lot of repairs means the small model wrote badly → ONE rewrite by the stronger model, within the guard's budget */
  if (language && language.rewrite) issues.push({ code: "language-quality", severity: "high", detail: `${language.badness} repairs (${language.fixes} spelling, ${language.leaks} leaks, ${language.glitched} glitches)` });
  if (/calc/i.test(String(fixed.type || "")) && !cleanField(fixed.calc)) issues.push({ code: "calc-missing", severity: "medium", detail: "a calculation item without its calculation" });
  return { out: fixed, issues, fixes, escalate: issues.some((i) => i.severity === "high") };
}

export const reviewConcern = { code: "one-call-review", en: "An automatic consistency check found a contradiction in this answer and could not settle it: verify it against your source.", ar: "فحص الاتساق التلقائي لقى تعارض في الإجابة دي ومقدرش يحسمه: راجعها مع مصدرك قبل ما تعتمد عليها." };
