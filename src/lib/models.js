/* ───────────── v3.84 · the ONE place that names the Gemini models ─────────────
   Fixed official names only. No "-latest" alias is ever requested: a moving alias changes behaviour (and quota) under our feet.
   Free keys (BYOK) get their quota per project and per model, so the daily work is done by the Flash-Lite family and the standard
   Flash model is kept for the rare, student-requested «أقوى تحليل» (or one verified escalation). */

export const MODELS = Object.freeze({
  primary: "gemini-3.5-flash-lite",       // every ordinary analysis
  fallback: "gemini-3.1-flash-lite",      // instant fail-over (another model = another quota)
  escalation: "gemini-3.6-flash",         // «أقوى تحليل» + the one escalation after a failed deterministic check
  escalationAlt: "gemini-3.8-flash",      // same role; does NOT accept thinkingLevel "minimal"
});

/* names that must never be requested: a moving alias, a retired model, a model that is switched off or redirected */
const BANNED = [/latest/i, /^gemini-3\.5-flash$/i, /^gemini-2\.0-flash-lite/i];
export const isBannedModel = (m) => BANNED.some((re) => re.test(String(m || "")));
export const ALLOWED_MODELS = Object.freeze([MODELS.primary, MODELS.fallback, MODELS.escalation, MODELS.escalationAlt]);

export function assertModel(m) {
  if (isBannedModel(m)) throw Object.assign(new Error(`model "${m}" is not allowed (no -latest alias, no retired model)`), { fatal: true, banned: true });
  return m;
}

/* thinking levels (Gemini 3+): the only knob. Never a token budget. */
export const LEVELS = Object.freeze(["minimal", "low", "medium", "high"]);
export const supportsMinimal = (m) => !/gemini-3\.8-flash$/i.test(String(m || ""));
export const clampLevel = (m, l) => (l === "minimal" && !supportsMinimal(m) ? "low" : l);

/* how long a request may stay silent before it is given up and the fallback model is asked INSTEAD (no sleep, no waiting).
   Measured on a real free key: the slowest first byte was 7.0 s (minimal) · 6.6 s (low) · 11.9 s (medium) · 15.7 s (high);
   these are the measured limits with room to spare (they are written for a thinking model that sends nothing until it has thought). */
export const FIRST_BYTE_MS = { minimal: 11700, low: 11700, medium: 20800, high: 32500 };
export const firstByteMs = (level) => FIRST_BYTE_MS[level] || FIRST_BYTE_MS.high;
export const IDLE_MS = 45000;           // silence AFTER the first byte
export const TOTAL_MS = 240000;         // one attempt, start to end
export const MAX_OUT = 16384;           // enough room for the hidden thinking AND the whole answer
