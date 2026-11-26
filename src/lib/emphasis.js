/* ───────────── Inline layout: bold / highlight + English runs, without ever breaking a word ─────────────
   Two bugs lived here:
   1. A bold marker inside a word ("**S**ymphysis", "ك**بس**ولة") cut the word into separate elements. Each English piece
      became its own LTR island inside the RTL line, so the islands were laid out right-to-left: "ymphysis S".
      Arabic pieces in a different font weight also lost their cursive joining (the garbled letters).
   2. "**Secondary** cartilaginous joint" → the bold word and the words after it were two islands → wrong order.
   The fix: strip the markers FIRST (remembering which characters were emphasised), widen any emphasis that touches a
   word to the whole word, find the English runs on the CLEAN text, and only then cut the text into pieces — so one
   English phrase is always ONE island, whatever formatting sits inside it.
   Markers:  **bold / key term**    ==yellow highlight (link to an earlier question)==                                   */

const W0 = "[A-Za-z0-9+\\-<>=≥≤±/.%'’&]";             // first char of a token inside a run
const WN = "[A-Za-z0-9'’\\-/.%+&,;:!?<>=≥≤±]*";       // the rest of a token (keeps its punctuation)
const PAR = "\\([A-Za-z0-9 ,.'’\\-/%+&<>=≥≤±]*\\)";
export const LATIN_RUN = new RegExp(`(?:[A-H]\\)[ ]+)?[A-Za-z0-9]${WN}(?:[ ]+(?:${W0}${WN}|${PAR}))*(?:[ ]*${PAR})?`, "g");

const isLetter = (c) => !!c && /[\p{L}\p{M}]/u.test(c);
const BOLD = 1, HL = 2;

export function parseEmphasis(src) {
  let s = String(src || "");
  // an odd (unmatched) marker is just noise → drop the last one
  if ((s.match(/\*\*/g) || []).length % 2) s = s.replace(/\*\*(?![\s\S]*\*\*)/, "");
  if ((s.match(/==/g) || []).length % 2) s = s.replace(/==(?![\s\S]*==)/, "");
  let plain = "";
  const flags = [];
  let f = 0;
  for (const part of s.split(/(\*\*|==)/)) {
    if (part === "**") f ^= BOLD;
    else if (part === "==") f ^= HL;
    else for (let i = 0; i < part.length; i++) { plain += part[i]; flags.push(f); }
  }
  // emphasis that touches a letter on either side covers the WHOLE word
  const n = plain.length;
  for (const bit of [BOLD, HL]) {
    let i = 0;
    while (i < n) {
      if (!(flags[i] & bit)) { i++; continue; }
      const s0 = i;
      while (i < n && (flags[i] & bit)) i++;
      let l = s0, r = i - 1;
      while (l > 0 && isLetter(plain[l]) && isLetter(plain[l - 1])) { l--; flags[l] |= bit; }
      while (r < n - 1 && isLetter(plain[r]) && isLetter(plain[r + 1])) { r++; flags[r] |= bit; }
      i = Math.max(i, r + 1);
    }
  }
  return { plain, flags };
}

/* → [{ run:boolean, parts:[{ text, bold, hl }] }]   run = one English LTR island (render it as ONE <bdi>) */
export function layout(src) {
  const { plain, flags } = parseEmphasis(src);
  const groups = (a, b) => {
    const out = [];
    let i = a;
    while (i < b) {
      let j = i;
      while (j < b && flags[j] === flags[i]) j++;
      out.push({ text: plain.slice(i, j), bold: !!(flags[i] & BOLD), hl: !!(flags[i] & HL) });
      i = j;
    }
    return out;
  };
  const nodes = [];
  let last = 0;
  for (const m of plain.matchAll(LATIN_RUN)) {
    /* v3.37: punctuation that CLOSES an English phrase ("Heparin," "Warfarin." "Insulin:") belongs to the Arabic sentence, not to the English island.
       Inside the island an ASCII "," or "." is drawn on the English side (left of the word), i.e. the wrong side of an Arabic line. */
    let end = m.index + m[0].length;
    /* v3.40: but a whole English SENTENCE (4+ words, e.g. a memory tip) keeps its closing . ! ? inside the island: otherwise the "!" is drawn at the
       START of the English line ("! Tip: Prazole pumps …") */
    const sentence = m[0].trim().split(/\s+/).length >= 4;
    const hand = sentence ? /[,;:]/ : /[.,;:!?]/;
    while (end > m.index + 1 && hand.test(plain[end - 1])) end--;
    if (m.index < last) continue;
    if (m.index > last) nodes.push({ run: false, parts: groups(last, m.index) });
    nodes.push({ run: true, parts: groups(m.index, end) });
    last = end;
  }
  if (last < plain.length) nodes.push({ run: false, parts: groups(last, plain.length) });
  return nodes;
}

/* reading direction of one line: Arabic when Arabic words are at least half as many as the English ones (an Arabic sentence with a few English
   terms), English when the line is mostly English with one Arabic word. (Any Arabic used to make the whole line right-to-left.) */
export function dirFor(s) {
  const t = String(s || "").replace(/\*\*|==/g, "");
  const ar = (t.match(/[\u0600-\u06FF]+/g) || []).length;
  if (!ar) return "ltr";
  const en = (t.match(/[A-Za-z][A-Za-z0-9'’\-/.%+&]*/g) || []).length;
  return ar * 2 >= en ? "rtl" : "ltr";
}


/* v3.78/v3.80 · ONE line that holds a whole English sentence AND a whole Arabic sentence ("English sentence — ترجمتها بالعربي") is shown as two lines, English
   together and Arabic together, each in its own direction. STRICT: exactly one cut, between two whole sentences. An English term (even a long one) inside an
   Arabic sentence is never a cut, and a short Arabic word right after the dash belongs to the Arabic sentence. Pure local string work: no request, no tokens.
   A line with a ==link== chip is never split. */
const AR_W = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const EN_W = /[A-Za-z]/;
const wordStats = (x) => { let ar = 0, en = 0; for (const w of String(x).split(/\s+/)) { if (AR_W.test(w)) ar++; else if (EN_W.test(w)) en++; } return { ar, en }; };
const sentenceLike = (x, en) => en >= 5 || /[.!?:؟]\s*(?:\*\*)?$/.test(x.trim());
const balanceBold = (parts) => {
  const out = []; let open = false;
  for (const g of parts) {
    let x = g.trim().replace(/\s*[—–]\s*$/, "").replace(/^[—–]\s*/, "");
    if (!x) continue;
    if (open) x = "**" + x;
    open = ((x.match(/\*\*/g) || []).length % 2) === 1;
    if (open) x += "**";
    out.push(x);
  }
  return out;
};
export function splitMixed(src, { minEn = 4, minAr = 3 } = {}) {
  const s = String(src || "");
  if (s.length < 24 || s.includes("==") || !AR_W.test(s) || !EN_W.test(s)) return [s];
  const okEn = (x) => { const w = wordStats(x); return w.en >= minEn && w.ar * 3 <= w.en && sentenceLike(x, w.en); };
  const okAr = (x) => { const w = wordStats(x); return w.ar >= minAr && w.en * 2 <= w.ar + 1; };
  /* 1 · a dash between the two sentences */
  for (const m of s.matchAll(/\s[—–]\s/g)) {
    const l = s.slice(0, m.index), r = s.slice(m.index + m[0].length);
    if ((okEn(l) && okAr(r)) || (okAr(l) && okEn(r))) { const o = balanceBold([l, r]); if (o.length === 2) return o; }
  }
  /* 2 · no dash: exactly two big runs of different languages, one cut at the first word of the second language */
  const words = s.split(/(\s+)/);
  const kind = (w) => (AR_W.test(w) ? "ar" : EN_W.test(w) ? "en" : null);
  const runs = [];
  for (const w of words) {
    if (!w.trim()) { if (runs.length) runs[runs.length - 1].text += w; else runs.push({ k: null, n: 0, text: w }); continue; }
    const k = kind(w), last = runs[runs.length - 1];
    if (!last || (k && last.k && last.k !== k)) runs.push({ k, n: k ? 1 : 0, text: w });
    else { last.text += w; if (k) { last.k = last.k || k; last.n++; } }
  }
  const big = runs.map((r, i) => (r.k === "en" ? r.n >= minEn : r.k === "ar" ? r.n >= minAr : false) ? i : -1).filter((i) => i >= 0);
  if (big.length !== 2 || runs[big[0]].k === runs[big[1]].k) return [s];
  const B = runs[big[1]].k;
  let cut = big[1];
  for (let i = big[0] + 1; i < big[1]; i++) if (runs[i].k === B) { cut = i; break; }
  const left = runs.slice(0, cut).map((r) => r.text).join(""), right = runs.slice(cut).map((r) => r.text).join("");
  const ok = runs[big[0]].k === "en" ? okEn(left) && okAr(right) : okAr(left) && okEn(right);
  if (!ok) return [s];
  const o = balanceBold([left, right]);
  return o.length === 2 ? o : [s];
}
