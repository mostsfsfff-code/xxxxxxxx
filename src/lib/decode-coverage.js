/* ───────────── lib/decode-coverage.js · v3.82 ─────────────
   The "decode the English" section of a lesson is written by the model, which keeps only a few chunks of the stem and silently drops sentences that decide the
   answer (a protocol with its numbers, "no bleeding", "hemoglobin stable", the weight). This pass puts every such stem sentence back, VERBATIM, at its place in
   the order of the stem. Pure local string work: no request, no tokens, no waiting. A sentence the model already covered is never repeated. */

const HEADER = /^\s{0,3}#{1,4}\s*🔤[^\n]*(?:فكّ|فك)\s*السؤال|^\s{0,3}#{1,4}\s*🔤\s*Decode the English/i;
const NEXT_HEADER = /^\s{0,3}#{1,4}\s*\S/;
const OPTION_LINE = /^\s*\(?[A-H][.)]\s/;
const NEEDS = /\d|\?\s*$|\b(?:no|not|none|denies|without|absent|negative|stable|unchanged|normal|protocol|policy|order|rule|states?)\b/i;
const tokens = (s) => String(s || "").toLowerCase().replace(/(\d),(\d)/g, "$1$2").match(/[a-z]{4,}|\d+(?:\.\d+)?/g) || [];
const nums = (s) => (String(s || "").replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) || []);

export function stemSentences(stem) {
  const out = [];
  for (const raw of String(stem || "").split(/\n+/)) {
    const line = raw.trim();
    if (!line || OPTION_LINE.test(line) || /^(?:question|q)\s*\d*\s*[:.)-]?\s*$/i.test(line)) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)) {
      const x = s.replace(/^[-•*]\s*/, "").replace(/^(?:question|q)\s*\d*\s*[:.)-]\s*/i, "").trim();
      if (x.length >= 12 && /[A-Za-z]/.test(x)) out.push(x);
    }
  }
  return out;
}

export function repairDecode(text, stem) {
  const src = String(text || "");
  if (!src || !stem) return src;
  const lines = src.split("\n");
  const h = lines.findIndex((l) => HEADER.test(l));
  if (h < 0) return src;
  let e = lines.length;
  for (let i = h + 1; i < lines.length; i++) if (NEXT_HEADER.test(lines[i]) && /^\s{0,3}#{1,4}\s/.test(lines[i])) { e = i; break; }
  const body = lines.slice(h + 1, e);
  const secText = body.join("\n");
  const secTokens = new Set(tokens(secText));
  const secNums = new Set(nums(secText));
  const sents = stemSentences(stem);
  if (sents.length < 2) return src;

  const covered = (s) => {
    const n = nums(s);
    if (n.some((x) => !secNums.has(x))) return false;
    const t = tokens(s).filter((x) => !/^\d/.test(x));
    if (!t.length) return true;
    return t.filter((x) => secTokens.has(x)).length / t.length >= 0.6;
  };
  const missing = new Map();                                              // stem index → sentence
  sents.forEach((s, i) => { if (NEEDS.test(s) && !covered(s)) missing.set(i, s); });
  if (!missing.size) return src;

  /* which stem sentence does each section line talk about? (best token overlap; -1 = none) */
  const where = body.map((l) => {
    const t = new Set(tokens(l)); if (!t.size) return -1;
    let best = -1, score = 0;
    sents.forEach((s, i) => { const u = tokens(s); const k = u.filter((x) => t.has(x)).length / (u.length || 1); if (k > score && k >= 0.4) { score = k; best = i; } });
    return best;
  });
  const ins = [];                                                          // [lineIndexInBody, text]
  for (const [i, s] of missing) {
    let at = body.length;
    for (let j = 0; j < body.length; j++) if (where[j] >= i) { at = j; break; }
    ins.push([at, `- **${s.replace(/\*\*/g, "")}**`]);
  }
  const outBody = [];
  for (let j = 0; j <= body.length; j++) {
    for (const [at, t] of ins) if (at === j) outBody.push(t);
    if (j < body.length) outBody.push(body[j]);
  }
  return [...lines.slice(0, h + 1), ...outBody, ...lines.slice(e)].join("\n").replace(/\n{3,}/g, "\n\n");
}
