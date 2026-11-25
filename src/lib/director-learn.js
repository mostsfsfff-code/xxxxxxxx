/* ClinixStudy · Director learning from the student (v3.74). Zero requests, local only.
   The ONLY honest ground truth the app can collect for free is the student pressing "Retry": it means "this answer was not deep enough".
   Each Retry is recorded against the question TYPE the Director assigned (recall, knowledge, teaching, clinical-judgement, calculation, interpretation,
   prioritization, select-all). Two or more recent Retries on the same type from a level below "hard" lift every FUTURE question of that type one level
   (four or more: two levels). Events expire after 45 days; nothing is ever lowered by this (nothing tells us "too deep"); `clearLearning()` resets it.
   It makes the router adapt to the student's own exam style without touching the rules or any request. */
const LS = "clinix:directorLearn:v1", TTL = 45 * 864e5, MAX = 200;
let _now = () => Date.now();
export const __learnClock = (fn) => { _now = fn || (() => Date.now()); };
const read = () => { try { return JSON.parse(window.localStorage.getItem(LS) || "[]").filter((e) => e && _now() - e.t < TTL); } catch (e) { return []; } };
export function recordRetry({ type, level }) {
  if (!type || level === "hard") return;
  try { window.localStorage.setItem(LS, JSON.stringify([{ type, level, t: _now() }, ...read()].slice(0, MAX))); } catch (e) { /* optional */ }
}
/* how many levels to lift a question of this type */
export function learnedLift(type) {
  const n = read().filter((e) => e.type === type).length;
  return n >= 4 ? 2 : n >= 2 ? 1 : 0;
}
export const learningSummary = () => { const by = {}; read().forEach((e) => { by[e.type] = (by[e.type] || 0) + 1; }); return by; };
export const clearLearning = () => { try { window.localStorage.removeItem(LS); } catch (e) { /* ignore */ } };
