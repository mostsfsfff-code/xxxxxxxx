/* ───────────── v3.84 · Arabic + English that is written correctly and laid out in order ─────────────
   ROOT CAUSE found while reading the pipeline: every older lesson passed through runTask(), which runs the OUTPUT GUARD (prompt-leak stripper, Arabic spelling
   repair, foreign-script / glued-Latin-fragment removal). The one-request path talks to Google directly, so none of that ran: a small model's glitches reached
   the screen untouched. This file puts the SAME guard on every text part, and adds the layout rules the guard never had:

     1. fixText            foreign-script letters, Latin fragments glued inside an Arabic word, look-alike letters, invisible characters   (text.js, existing)
     2. stripLeaks         a line that is the prompt talking                                                                                 (guard.js, existing)
     3. repairArabic       doubled / invented letters, known bad spellings                                                                   (guard.js, existing)
     4. tidySpacing        one space between an Arabic run and a Latin run, no space before ، . : ؟ ؛ ) , no double spaces, no empty brackets
     5. untangle           a line that switches language 3+ times becomes one line per "English — Arabic" pair (nothing is dropped, nothing is reworded)
   Nothing here calls the network. Clean text passes through unchanged. */

import { fixText, looksGlitched } from "./text.js";
import { leakIndex, stripLeaks, repairArabic, selfCorrections } from "./guard.js";

const AR = "\\u0621-\\u063A\\u0641-\\u064A";
const hasAr = (s) => new RegExp(`[${AR}]`).test(s);
const hasEn = (s) => /[A-Za-z]/.test(s);

/* ───────── 4 · spacing ───────── */
export function tidySpacing(text) {
  if (!text || typeof text !== "string") return text;
  return text.split("\n").map((line) => {
    if (!hasAr(line)) return line.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, "");
    let t = line
      .replace(/\([ \t]*\)|\[[ \t]*\]/g, "")                                    // empty brackets first, so the space they leave is tidied below
      .replace(new RegExp(`([${AR}])([A-Za-z0-9])`, "g"), "$1 $2")            // العربيEnglish → العربي English
      .replace(new RegExp(`([A-Za-z0-9])([${AR}])`, "g"), "$1 $2")             // English العربي
      .replace(/[ \t]+([،؛؟.:,;!?)\]])/g, "$1")                                // no space before closing punctuation
      .replace(/([(\[])[ \t]+/g, "$1")                                         // no space after an opening bracket
      .replace(/([،؛؟.:!])(?=[A-Za-z\u0621-\u064A])/g, "$1 ")                  // one space after the punctuation
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+$/g, "");
    return t;
  }).join("\n");
}

/* ───────── 5 · untangle ───────── */
const MARKER = /^(\s*(?:>\s*|[-*•]\s+|\d+[.)]\s+))?/;
const kindOf = (tok) => (hasAr(tok) ? "ar" : hasEn(tok) ? "en" : null);

/* runs of the same language; a short island of the other language (a term, an abbreviation, a unit) belongs to the run around it */
function runsOf(body) {
  const toks = body.split(/(\s+)/);                      // keeps the spaces so the text can be rebuilt exactly
  const raw = [];
  for (const tk of toks) {
    if (!tk.trim()) { if (raw.length) raw[raw.length - 1].text += tk; else raw.push({ k: null, n: 0, text: tk }); continue; }
    const k = kindOf(tk), last = raw[raw.length - 1];
    if (!last || (k && last.k && last.k !== k)) raw.push({ k, n: k ? 1 : 0, text: tk });
    else { last.text += tk; if (k) { last.k = last.k || k; last.n++; } }
  }
  /* absorb islands: ≤ 2 English tokens between Arabic runs, ≤ 1 Arabic token between English runs */
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 1; i < raw.length - 1; i++) {
      const r = raw[i], a = raw[i - 1], b = raw[i + 1];
      const small = (r.k === "en" && r.n <= 2 && a.k === "ar" && b.k === "ar") || (r.k === "ar" && r.n <= 1 && a.k === "en" && b.k === "en");
      if (small) { a.text += r.text + b.text; a.n += r.n + b.n; raw.splice(i, 2); merged = true; break; }
    }
  }
  return raw;
}
const BIG = { en: 4, ar: 3 };

/* → an array of lines (usually just [line]) */
export function untangleLine(line) {
  const m = MARKER.exec(line), marker = (m && m[1]) || "", body = line.slice(marker.length);
  if (body.length < 40 || !hasAr(body) || !hasEn(body) || body.includes("```")) return [line];
  const runs = runsOf(body).filter((r) => r.k);
  const big = runs.filter((r) => r.n >= BIG[r.k]);
  if (big.length < 3) return [line];                       // at most one switch of language between two big runs: the screen already lays that out
  /* group the runs into consecutive pairs: "first run — second run", each pair on its own line (the same marker), nothing dropped */
  const pieces = runs.map((r) => r.text.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const pair = pieces.slice(i, i + 2);
    const bullet = i === 0 ? marker : (marker.trim().startsWith(">") ? marker : marker.replace(/\d+[.)]/, "-"));
    out.push(`${bullet}${pair.join(" — ")}`);
  }
  return out;
}
/* → { text, tangled }   tangled = how many lines had to be split */
export function untangleText(text) {
  if (!text || typeof text !== "string") return { text: text || "", tangled: 0 };
  const out = []; let tangled = 0;
  for (const l of text.split("\n")) { const r = untangleLine(l); if (r.length > 1) tangled += 1; out.push(...r); }
  return { text: out.join("\n"), tangled };
}
export const untangle = (text) => untangleText(text).text;

/* ───────── one text part ───────── */
export function polishField(text, { idx = null } = {}) {
  if (!text || typeof text !== "string") return { text: text || "", fixes: 0, leaks: 0, tangled: 0, selfFix: 0, glitched: 0 };
  const glitched = looksGlitched(text) ? 1 : 0;           // a foreign-script letter / a Latin fragment glued inside an Arabic word: the model glitched
  let t = fixText(text);
  const leaked = stripLeaks(t, idx, true); t = leaked.text;
  const sp = repairArabic(t); t = sp.text;
  const selfFix = selfCorrections(t);
  t = tidySpacing(t);
  const u = untangleText(t); t = u.text; const tangled = u.tangled;
  return { text: t.trim(), fixes: sp.fixes, leaks: leaked.leaks, tangled, selfFix, glitched };
}

/* the parts the student reads. answer_letter / type / keyword / data / calc / conf are machine fields and stay exactly as written. */
export const PROSE_FIELDS = Object.freeze(["short_rationale", "ask", "decode", "basics", "steps", "options", "vary", "memo", "tricks", "concepts"]);

export function polishReply(out, { system = "", userText = "" } = {}) {
  const idx = leakIndex(system, userText);
  const fixed = { ...out }; const stats = { fixes: 0, leaks: 0, tangled: 0, selfFix: 0, glitched: 0 };
  for (const k of PROSE_FIELDS) {
    if (typeof out[k] !== "string") continue;
    const r = polishField(out[k], { idx });
    fixed[k] = r.text;
    stats.fixes += r.fixes || 0; stats.leaks += r.leaks || 0; stats.tangled += r.tangled || 0; stats.selfFix += r.selfFix || 0; stats.glitched += r.glitched || 0;
  }
  /* the same "how bad was it" number the guard uses to decide on a rewrite: each repair 1, each self-correction 2 */
  stats.badness = stats.fixes + stats.leaks + 2 * stats.selfFix + stats.glitched;
  return { out: fixed, stats };
}
