/* ───────────── v3.84 · ONE REQUEST per question (the quota-first engine) ─────────────
   A question is analysed by ONE streaming request to a Flash-Lite model that returns a flat structured object whose FIRST two fields are the answer letter
   and the one-line reason, so the app can show them seconds after the request starts while the rest of the lesson keeps streaming in the same request.

   • no parallel hedging, no sleeping: a request that fails (429 · 5xx · network) or stays silent longer than the first-byte limit of its thinking level is
     given up AT ONCE and the next candidate (another model = another quota, or the next key of the ring) is asked instead
   • quota.js is the pacer: a model that has no room right now is skipped in favour of one that has; only when nothing has room is a short, announced pause taken
   • the request body is linted: no -latest, no sampling parameters, no thinkingBudget, no logprobs, no prefilled model turn, minimal never sent to a model that
     does not accept it. The structure lives in `responseSchema` ONLY (the instructions never describe it). */

import { API_BASE, hdrs, apiError, abortError, timeoutError } from "./gemini.js";
import { GATEWAY_URL } from "./config.js";
import * as Ring from "./keyring.js";
import { trackRequest, nextResetMs } from "./usage.js";
import { noteSend, refundSend, noteQuotaError, paceMs, finishedToday, noteTtft, noteHealth } from "./quota.js";
import { MODELS, LEVELS, assertModel, isBannedModel, supportsMinimal, clampLevel, firstByteMs, IDLE_MS, TOTAL_MS, MAX_OUT } from "./models.js";

/* ───────── the flat schema: answer first, then the lesson parts, then the brief fields the trust layer reads ───────── */
export const ANSWER_FIELD = "answer_letter";
export const FIELDS = Object.freeze(["answer_letter", "short_rationale", "ask", "decode", "basics", "steps", "options", "vary", "memo", "tricks", "type", "keyword", "concepts", "data", "calc", "conf"]);
export function makeSchema() {
  const properties = {}; for (const k of FIELDS) properties[k] = { type: "STRING" };
  return { type: "OBJECT", properties, required: [...FIELDS], propertyOrdering: [...FIELDS] };
}

/* ───────── the request body + its linter ───────── */
const BANNED_KEYS = new Set(["temperature", "topP", "topK", "top_p", "top_k", "frequencyPenalty", "presencePenalty", "thinkingBudget", "thinking_budget", "responseLogprobs", "response_logprobs", "logprobs"]);

export function lintBody(model, body) {
  const v = [];
  if (isBannedModel(model)) v.push(`model "${model}" is not allowed`);
  (function walk(o, p) { if (o && typeof o === "object") for (const [k, val] of Object.entries(o)) { if (BANNED_KEYS.has(k)) v.push(`banned field ${p}${k}`); walk(val, `${p}${k}.`); } })(body, "");
  const c = body.contents;
  if (!Array.isArray(c) || !c.length) v.push("contents is empty");
  else if (c[c.length - 1].role === "model") v.push("last turn has role=model (prefill → 400)");
  const gc = body.generationConfig || {}, tc = gc.thinkingConfig;
  if (!tc || !LEVELS.includes(tc.thinkingLevel)) v.push("thinkingConfig.thinkingLevel missing or invalid");
  if (tc && tc.includeThoughts === true) v.push("includeThoughts must be off");
  if (tc && tc.thinkingLevel === "minimal" && !supportsMinimal(model)) v.push(`thinkingLevel=minimal is not supported by ${model}`);
  if (!(gc.maxOutputTokens >= 4096)) v.push("maxOutputTokens too small: hidden thinking could swallow the answer");
  if (!body.systemInstruction) v.push("systemInstruction missing");
  if (v.length) throw Object.assign(new Error("request body lint failed: " + v.join("; ")), { lint: v, fatal: true });
  return true;
}

export function buildBody({ model, level, system, parts, maxOut = MAX_OUT }) {
  assertModel(model);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxOut, responseMimeType: "application/json", responseSchema: makeSchema(), thinkingConfig: { thinkingLevel: clampLevel(model, level), includeThoughts: false } },
  };
  lintBody(model, body);
  return body;
}

/* ───────── incremental reading of the streamed JSON text ───────── */
export function extractString(buf, key, from = 0) {
  const at = buf.indexOf(`"${key}"`, from); if (at < 0) return null;
  let i = at + key.length + 2;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== ":") return null; i++;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== '"') return null;
  let j = i + 1;
  while (j < buf.length) { if (buf[j] === "\\") { j += 2; continue; } if (buf[j] === '"') { try { return JSON.parse(buf.slice(i, j + 1)); } catch (e) { return null; } } j++; }
  return null;                                  // the closing quote has not arrived yet
}
/* every field that is already complete in a (possibly cut-off) reply */
export function completeFields(text) {
  const out = {}; for (const k of FIELDS) { const v = extractString(text, k); if (v !== null) out[k] = v; } return out;
}

/* ───────── one streaming attempt ───────── */
async function attempt({ key, model, level, body, signal, onField, onChunk }) {
  const url = `${API_BASE}/${model}:streamGenerateContent?alt=sse`;
  const ctrl = new AbortController(); const link = () => ctrl.abort();
  if (signal) { if (signal.aborted) throw abortError(); signal.addEventListener("abort", link); }
  const fbMs = firstByteMs(level), t0 = Date.now();
  let why = null, timer = null;
  const arm = (ms, w) => { clearTimeout(timer); timer = setTimeout(() => { why = w; ctrl.abort(); }, ms); };
  arm(fbMs, "first-byte");
  const total = setTimeout(() => { why = "total"; ctrl.abort(); }, TOTAL_MS);
  const R = { text: "", usage: null, finish: null, ttfbMs: null, fieldMs: {}, order: [] };
  const timeoutErr = () => Object.assign(timeoutError(why === "first-byte" ? `no first byte within ${fbMs} ms (${level})` : why), { silent: true, kind: why });
  try {
    let res;
    try { res = await fetch(url, { method: "POST", headers: hdrs(key), body: JSON.stringify(body), signal: ctrl.signal }); }
    catch (e) {
      if (signal && signal.aborted) throw abortError();
      if (why) throw timeoutErr();
      throw Object.assign(new Error("مفيش اتصال بسيرفرات Google. اتأكد من النت وجرّب تاني."), { detail: "fetch: " + String((e && e.message) || e), netBeforeStart: true, busy: true });
    }
    if (!res.ok) throw apiError(res.status, await res.text());
    const handle = (line) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") return;
      let j; try { j = JSON.parse(payload); } catch (e) { return; }
      const now = Date.now() - t0;
      if (R.ttfbMs === null) R.ttfbMs = now;
      arm(IDLE_MS, "idle");
      if (j.error) throw apiError(j.error.code || 500, JSON.stringify({ error: j.error }));
      if (j.usageMetadata) R.usage = j.usageMetadata;
      if (j.promptFeedback && j.promptFeedback.blockReason) throw Object.assign(new Error("Google رفض الطلب ده (محتوى محجوب)."), { blocked: true, detail: "blocked: " + j.promptFeedback.blockReason });
      const cand = j.candidates && j.candidates[0]; if (!cand) return;
      if (cand.finishReason) R.finish = cand.finishReason;
      let added = false;
      for (const p of (cand.content && cand.content.parts) || []) if (!p.thought && typeof p.text === "string") { R.text += p.text; added = true; }
      if (!added) return;
      if (onChunk) onChunk(R.text);
      for (const k of FIELDS) if (!(k in R.fieldMs)) { const v = extractString(R.text, k); if (v !== null) { R.fieldMs[k] = now; R.order.push(k); if (onField) onField(k, v, now); } }
    };
    const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
    if (!reader) { (await res.text()).split("\n").forEach((l) => handle(l.replace(/\r$/, ""))); }
    else {
      const dec = new TextDecoder("utf-8"); let buf = "";
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); }
        catch (e) {
          if (signal && signal.aborted) throw abortError();
          if (why) throw timeoutErr();
          throw Object.assign(new Error("النت قطع في نص التحميل. دوس إعادة المحاولة."), { detail: "stream: " + String((e && e.message) || e), interrupted: true, busy: true });
        }
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let nl; while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1); handle(line); }
      }
      buf += dec.decode(); if (buf.trim()) handle(buf.replace(/\r$/, ""));
    }
  } finally { clearTimeout(timer); clearTimeout(total); if (signal) signal.removeEventListener("abort", link); }
  R.ms = Date.now() - t0;
  return R;
}

/* ───────── which (key, model) pairs may be asked, in order ───────── */
const keysFor = (apiKey) => (GATEWAY_URL ? [""] : (() => { const k = Ring.candidates("gemini", { extra: apiKey }); return k.length ? k : (apiKey ? [apiKey] : []); })());

export function planFor({ deep = false, level = "low" } = {}) {
  /* «أقوى تحليل»: ONE request on the stronger model first; everything else: Flash-Lite, then the other Flash-Lite generation */
  if (deep) return [{ model: MODELS.escalation, level: level === "low" || level === "minimal" ? "medium" : level }, { model: MODELS.primary, level: "high" }, { model: MODELS.fallback, level: "high" }];
  return [{ model: MODELS.primary, level }, { model: MODELS.fallback, level }];
}

const MAX_PACE_PAUSE_MS = 15000;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(abortError());
  const t = setTimeout(() => { if (signal) signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
});

/* the engine. Resolves with the parsed object; rejects with an error shaped like the rest of the app's errors (busy / fatal / daily …). */
export async function runOneCall({ apiKey, system, parts, level = "low", deep = false, plan, maxOut = MAX_OUT, signal, onField, onChunk, onAttempt, onNotice } = {}) {
  const steps = plan || planFor({ deep, level });
  const keys = keysFor(apiKey);
  const cands = [];
  for (const s of steps) for (const key of keys.length ? keys : [""]) cands.push({ ...s, key });
  const trace = { attempts: [], requests: 0, lostMs: 0 };
  let last = null, waited = false;
  const alive = () => cands.filter((c) => !c.out && !(c.key && finishedToday(c.key, c.model)) && !(c.key && !Ring.isLive(c.key, "weak")));
  for (;;) {
    if (signal && signal.aborted) throw abortError();
    let pool = alive();
    if (!pool.length) break;
    /* quota.js as the pacer: take the first candidate that has room NOW; a candidate that is resting is passed over (never slept on) */
    let c = pool.find((x) => !x.key || paceMs(x.key, x.model) === 0);
    if (!c) {
      const wait = Math.min(MAX_PACE_PAUSE_MS, Math.min(...pool.map((x) => paceMs(x.key, x.model))));
      if (waited || !(wait > 0)) c = pool[0];
      else { waited = true; if (onNotice) onNotice({ kind: "pace", ms: wait }); await sleep(wait, signal); continue; }
    }
    c.out = true;                                                   // each candidate is asked at most once per analysis
    const body = buildBody({ model: c.model, level: c.level, system, parts, maxOut });   // lints: a bad body is a programming error, never sent
    const stamp = noteSend(c.key, c.model);
    trackRequest(c.model); trace.requests += 1;
    if (onAttempt) onAttempt({ model: c.model, level: clampLevel(c.model, c.level), index: trace.attempts.length });
    const t0 = Date.now();
    try {
      const R = await attempt({ key: c.key, model: c.model, level: clampLevel(c.model, c.level), body, signal, onField, onChunk });
      let out = null, partial = false;
      try { out = JSON.parse(R.text); } catch (e) { out = completeFields(R.text); partial = true; }
      if (!out || typeof out[ANSWER_FIELD] !== "string") throw Object.assign(new Error("رد غير مكتمل من النموذج. جرّب تاني."), { empty: true, busy: true, detail: `unreadable reply (${R.finish || "?"})` });
      const u = R.usage || {};
      if (c.key) { noteTtft(c.key, c.model, R.ttfbMs || R.ms, "solve"); noteHealth(c.key, c.model, false); }
      trace.attempts.push({ model: c.model, level: c.level, ok: true, ms: R.ms });
      return {
        out, text: R.text, model: c.model, level: clampLevel(c.model, c.level), partial: partial || R.finish === "MAX_TOKENS", finish: R.finish,
        usage: { prompt: u.promptTokenCount ?? null, thinking: u.thoughtsTokenCount ?? null, output: u.candidatesTokenCount ?? null, cached: u.cachedContentTokenCount ?? 0 },
        ttfbMs: (R.ttfbMs ?? 0) + trace.lostMs, ttfaMs: ANSWER_FIELD in R.fieldMs ? R.fieldMs[ANSWER_FIELD] + trace.lostMs : null, totalMs: R.ms + trace.lostMs,
        order: R.order, requests: trace.requests, attempts: trace.attempts, failover: trace.attempts.length > 1,
      };
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      last = err; trace.lostMs += Date.now() - t0;
      trace.attempts.push({ model: c.model, level: c.level, ok: false, status: err.status || 0, why: err.kind || (err.timeout ? "timeout" : err.status ? String(err.status) : "net") });
      if (stamp && (err.status === 429 || (err.status >= 500) || err.timeout || err.netBeforeStart)) refundSend(c.key, c.model, stamp);      // Google did not do the work: it is not counted
      if (c.key) {
        if (err.status === 429 && err.quota) noteQuotaError(c.key, c.model, err.quota);
        if (err.timeout || [500, 502, 503, 504, 529].includes(err.status)) noteHealth(c.key, c.model, true);
        if (err.fatal) Ring.penalize(c.key, 24 * 3600e3, "bad");
        else if (err.daily) Ring.penalize(c.key, Math.max(60000, nextResetMs() - Date.now()), "day", "weak");
      }
      if (err.blocked || err.lint) throw err;                       // the same request would be refused again
      /* nothing to wait for: the loop simply goes on with the next candidate */
    }
  }
  if (last) throw last;
  if (!keys.length && !GATEWAY_URL) throw Object.assign(new Error("مفيش مفتاح Gemini شغّال دلوقتي. أضف مفتاح من أيقونة 🔑."), { fatal: true, needGemini: true });
  throw Object.assign(new Error("كل النماذج على مفتاحك وصلت حدها اليومي. جرّب بعد الريست أو أضف مفتاح تاني من أيقونة 🔑."), { busy: true, daily: true, detail: "every candidate finished for today" });
}
