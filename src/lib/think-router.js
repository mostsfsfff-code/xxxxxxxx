/* ───────────── v3.84 · adaptive thinking level (deterministic, local, no request) ─────────────
   Measured on 100 hard NCLEX items: thinkingLevel "low" answered every non-calculation item correctly (96 of 96) in 0.5–2.5 s;
   its only misses were multi-step clinical calculations (Parkland, weight-based drips, heparin units/kg/hr, osmolality).
   So the default is "low", and a question that LOOKS like a calculation gets "high" for that question only. A regex, not a model call. */

const STRONG = [
  /\bparkland\b/i, /\bholliday[\s-]*segar\b/i, /\banion\s+gap\b/i, /\bcorrected\s+(?:ca\b|calcium)/i, /\bosmolality\b/i, /\bosmolarity\b/i,
  /\bcerebral\s+perfusion\s+pressure\b/i, /\bCPP\b/, /\bmean\s+arterial\s+pressure\b.{0,60}\b(?:calculate|compute|determine)/i, /\b(?:calculate|compute)\b.{0,60}\b(?:MAP|mean\s+arterial)/i,
  /\bcreatinine\s+clearance\b/i, /\bcockcroft\b/i, /\bbody\s+surface\s+area\b/i, /\bBSA\b/, /\bdrip\s+rate\b/i, /\binfusion\s+rate\b/i, /\bflow\s+rate\b/i, /\bdrop\s+factor\b/i,
  /\bpercent(?:age)?\s+(?:of\s+)?(?:TBSA|total\s+body\s+surface)/i, /\bTBSA\b/, /\brule\s+of\s+nines\b/i,
];
const RATE_UNITS = [
  /\b(?:mL|ml)\s*\/\s*(?:hr|h|hour|min|minute)\b/i, /\bmL\s+per\s+(?:hour|minute)\b/i,
  /\b(?:mcg|µg|μg|mg|units?|mEq|mmol|g)\s*\/\s*kg(?:\s*\/\s*(?:min|hr|h|day|dose|minute|hour))?\b/i,
  /\b(?:mcg|µg|μg|mg|units?|mEq|g)\s*\/\s*(?:min|hr|h|minute|hour)\b/i,
  /\b(?:gtt|drops?)\s*\/\s*min\b/i, /\bdrops?\s+per\s+minute\b/i, /\bgtts?\b/i,
];
const ASK = /\b(?:calculate|compute|determine\s+the\s+(?:rate|dose|amount|volume)|how\s+(?:many|much)|what\s+(?:rate|dose|amount|volume)|set\s+the\s+(?:pump|rate)|program\s+the\s+pump|should\s+(?:the\s+nurse\s+)?(?:set|infuse|administer|program|give)|nearest\s+(?:tenth|whole|hundredth)|round(?:ed)?\s+to|per\s+(?:hour|minute|day|kg|dose)|mL\s+per|mg\s+per|units\s+per)\b|(?:احسب|كم\s+(?:مل|ملي|جرعة|معدل)|معدل\s+(?:التنقيط|الضخ|التسريب))/i;
const WEIGHT = /\b\d+(?:[.,]\d+)?\s*(?:lbs?|pounds?|kg|kilograms?)\b/i;
const BIGNUMS = /\d[\d,]*(?:\.\d+)?\s*(?:mL|ml|units?|mg|mcg|g|mEq|L)\b/gi;

export function needsDeepThinking(text) {
  const t = String(text || "");
  const reasons = [];
  if (!t.trim()) return { deep: false, level: "low", reasons };
  for (const re of STRONG) if (re.test(t)) { reasons.push(`keyword:${re.source.slice(0, 24)}`); break; }
  const rate = RATE_UNITS.some((re) => re.test(t)), ask = ASK.test(t), weight = WEIGHT.test(t);
  if (rate && ask) reasons.push("rate/dose unit + a numeric ask");
  if (weight && ask && rate) reasons.push("weight + dose/rate ask");
  else if (weight && ask && /\b(?:dose|dosage|mg|mcg|units?|mL|ml|rate)\b/i.test(t) && (t.match(BIGNUMS) || []).length >= 2) reasons.push("weight + quantities + numeric ask");
  const deep = reasons.length > 0;
  return { deep, level: deep ? "high" : "low", reasons };
}

/* the level for one analysis: «أقوى تحليل» (deep mode) runs on the stronger model at least at "medium" */
export function levelFor(text, { deepMode = false } = {}) {
  const r = needsDeepThinking(text);
  if (deepMode) return { ...r, level: r.deep ? "high" : "medium" };
  return r;
}
