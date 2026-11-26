#!/usr/bin/env node
/* ───────────── bench-flashlite.mjs · Phase 0 (Bench Gate) ─────────────
   Standalone: imports NOTHING from src/. It never touches production code.

   What it measures (per trial): accuracy · consistency / translation errors · time-to-first-answer · total time ·
   time lost to 429 / 503 / timeout / sleep · requests per question · thinking tokens · cached tokens.

   Arms:   A  thinking levels × all questions (answer-first schema, glossary ON by default)
           B  glossary OFF vs ON at one level, only on questions the glossary actually matched
           C  schema order ablation (rationale-first) at one level, on the hardest N questions
           D  implicit-cache probe (short vs ≥4,096-token stable prefix, repeated calls)
   Extra:  --smoke   16 questions, levels rotated, separate file, prints a PASS/FAIL checklist
           --validate  checks the dataset only (no network)
           --report    rebuilds report.md from the saved results (no network)

   Policies enforced here (section 2 + 3 of the approved plan):
     · no -latest · only the fixed model names · no temperature/topP/topK · no thinkingBudget · no responseLogprobs
     · no prefilled model turn · minimal is never sent to gemini-3.8-flash (clamped to low) · includeThoughts stays off
     · first-byte timeout depends on the thinking level (5 s minimal/low · 12 s medium · 20 s high) → fail over at once to the fallback model
     · 429 / 5xx / network failure → immediate fallback, NO sleep (the bench's own pacing wait is logged separately as pacer_wait_ms) */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/* ───────── constants ───────── */
export const MODELS = { primary: "gemini-3.5-flash-lite", fallback: "gemini-3.1-flash-lite", escalation: ["gemini-3.6-flash", "gemini-3.8-flash"] };
export const ALLOWED_MODELS = [MODELS.primary, MODELS.fallback, ...MODELS.escalation];
export const LEVELS = ["minimal", "low", "medium", "high"];
export const FIRST_BYTE_MS = { minimal: 5000, low: 5000, medium: 12000, high: 20000 };
const IDLE_MS = 30000, TOTAL_MS = 150000;
export const ANSWER_FIELD = "answer_letter";
const BANNED_KEYS = new Set(["temperature", "topP", "topK", "top_p", "top_k", "thinkingBudget", "thinking_budget", "responseLogprobs", "response_logprobs", "logprobs"]);
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/* ───────── small utils ───────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const ptDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
export const percentile = (arr, p) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
export const mean = (arr) => { const a = arr.filter((x) => Number.isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
/* exact two-sided McNemar on the discordant pairs (b: only X right, c: only Y right) */
export function mcnemarExact(b, c) {
  const n = b + c; if (!n) return 1;
  const k = Math.min(b, c); let p = Math.pow(0.5, n), cdf = 0;
  for (let i = 0; i <= k; i++) { cdf += p; p = p * (n - i) / (i + 1); }
  return Math.min(1, 2 * cdf);
}
const fmt = (x, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x.toFixed(d));
const pct = (k, n, d = 1) => (n ? (100 * k / n).toFixed(d) + "%" : "–");

/* ───────── model rules + body linter ───────── */
export const supportsMinimal = (m) => !/gemini-3\.8-flash$/.test(m);
export const clampLevel = (m, l) => (l === "minimal" && !supportsMinimal(m) ? "low" : l);

export function lintBody(model, body) {
  const v = [];
  if (/latest/i.test(model)) v.push(`model "${model}" uses -latest`);
  if (!ALLOWED_MODELS.includes(model)) v.push(`model "${model}" is not one of the fixed names`);
  (function walk(o, p) {
    if (o && typeof o === "object") for (const [k, val] of Object.entries(o)) { if (BANNED_KEYS.has(k)) v.push(`banned field ${p}${k}`); walk(val, `${p}${k}.`); }
  })(body, "");
  const c = body.contents;
  if (!Array.isArray(c) || !c.length) v.push("contents is empty");
  else if (c[c.length - 1].role === "model") v.push("last turn has role=model (prefill → 400)");
  const gc = body.generationConfig || {}, tc = gc.thinkingConfig;
  if (!tc || !LEVELS.includes(tc.thinkingLevel)) v.push("thinkingConfig.thinkingLevel missing or invalid");
  if (tc && tc.includeThoughts === true) v.push("includeThoughts must stay off in the bench");
  if (tc && tc.thinkingLevel === "minimal" && !supportsMinimal(model)) v.push(`thinkingLevel=minimal is not supported by ${model}`);
  if (!(gc.maxOutputTokens >= 1024)) v.push("maxOutputTokens too small (thinking tokens could swallow the answer)");
  if (!body.systemInstruction) v.push("systemInstruction missing");
  if (v.length) throw Object.assign(new Error("Body lint failed:\n - " + v.join("\n - ")), { lint: v });
  return true;
}

/* ───────── schema (flat, short names; ONE definition, never repeated in the prompt) ───────── */
export const FIELDS_AF = ["answer_letter", "short_rationale", "explain", "traps", "numbers", "terms", "conf"];
export const FIELDS_RF = ["short_rationale", "explain", "answer_letter", "traps", "numbers", "terms", "conf"];
export function makeSchema(variant = "af") {
  const order = variant === "rf" ? FIELDS_RF : FIELDS_AF;
  const def = {
    answer_letter: { type: "STRING", enum: ["A", "B", "C", "D", "E"] },
    short_rationale: { type: "STRING" }, explain: { type: "STRING" }, traps: { type: "STRING" },
    numbers: { type: "STRING" }, terms: { type: "STRING" }, conf: { type: "STRING", enum: ["low", "med", "high"] },
  };
  const properties = {}; for (const k of order) properties[k] = def[k];
  return { type: "OBJECT", properties, required: [...order], propertyOrdering: [...order] };
}

/* the instructions carry constraints and content rules ONLY: the structure lives in responseSchema */
export const systemText = (lang = "ar") => [
  "You are a senior nursing educator answering a hard nursing-exam question for a student.",
  "Follow standard nursing references and current practice. Never invent values that are not in the question.",
  lang === "ar"
    ? "Write short_rationale, explain and traps in simple Modern Standard Arabic. Keep every medical term, drug name, abbreviation and unit in English."
    : "Write everything in clear, simple English.",
  "short_rationale: at most two sentences (about 40 words): the single decisive reason.",
  "explain: at most about 150 words. Say why the chosen option is right and why the main distractor is wrong.",
  "traps: at most three short lines, one per line.",
  "numbers: every dose, rate, lab value or vital sign you cite, as name=value unit separated by semicolons; empty when none.",
  "terms: up to five new terms as EN — AR pairs separated by semicolons.",
  "Consistency: the chosen letter, every number and every drug name must be identical in every field. If a glossary is given, use its Arabic renderings exactly.",
  "If the question is ambiguous choose the best answer by standard references and set conf to low.",
].join("\n");

/* ───────── dictionary (glossary injection) ───────── */
export function loadDict(file) {
  if (!file || !fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = Array.isArray(raw) ? raw : raw.entries || [];
  return list.map((e) => ({ ...e, bad: e.bad || [], _re: new RegExp(`(?<![A-Za-z0-9])(?:${esc(e.abbr)}${e.en ? `|${esc(e.en)}` : ""})(?![A-Za-z0-9])`, "i") }));
}
export const matchDict = (dict, text, max = 8) => { const out = []; for (const e of dict) { if (e._re.test(text)) out.push(e); if (out.length >= max) break; } return out; };
export const dictBlock = (entries) => (entries.length ? "Glossary (use these Arabic renderings exactly):\n" + entries.map((e) => `- ${e.abbr} = ${e.en} = ${e.ar}`).join("\n") : "");

export function questionText(q, block) {
  const opts = Object.entries(q.options).map(([k, v]) => `${k}) ${v}`).join("\n");
  return `${block ? block + "\n\n" : ""}Question:\n${q.stem}\n\nOptions:\n${opts}\n\nChoose exactly one option letter (${Object.keys(q.options).join("/")}).`;
}
/* arm D: a stable prefix long enough for implicit caching (estimate; the real size is read back from usage) */
export function longPrefix(dict, lang) {
  let s = systemText(lang) + "\n\nReference glossary (stable prefix, identical on every call):\n" + dict.map((e) => `${e.abbr} = ${e.en} = ${e.ar}`).join("\n");
  const filler = (dict.length ? dict.map((e) => `${e.abbr}: ${e.en}`).join("; ") : systemText(lang)); let i = 1;
  while (s.length < 26000) s += `\n\n[Reference pass ${i++}]\n${filler}`;
  return s;
}

/* ───────── dataset (same shape as tests/golden/questions: {id, format, stem, options, key[], source, verifiedBy, verifiedAt}) ───────── */
export function loadDataset(file, { allowSynthetic = false } = {}) {
  if (!fs.existsSync(file)) throw new Error(`dataset not found: ${file}`);
  const txt = fs.readFileSync(file, "utf8").trim();
  const rows = txt.startsWith("[") ? JSON.parse(txt) : txt.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("//")).map((l, i) => { try { return JSON.parse(l); } catch (e) { throw new Error(`line ${i + 1}: invalid JSON`); } });
  const items = [], skipped = [], seen = new Set();
  for (const r of rows) {
    const why = [];
    if (!r.id || seen.has(r.id)) why.push("missing/duplicate id");
    if (r.format && r.format !== "mcq") why.push(`format ${r.format} (only single-answer mcq is scored)`);
    if (!r.stem || !r.options || Object.keys(r.options).length < 2) why.push("stem/options missing");
    else if (!Object.keys(r.options).every((k) => /^[A-E]$/.test(k))) why.push("option letters must be A–E");
    if (!Array.isArray(r.key) || r.key.length !== 1 || !(r.options && r.key[0] in r.options)) why.push("key must be exactly one existing option letter");
    if (!r.verifiedBy) why.push("verifiedBy is empty (no unverified gold answers allowed)");
    else if (r.verifiedBy === "harness" && !allowSynthetic) why.push("synthetic harness item (use --allow-synthetic only for plumbing tests)");
    if (why.length) { skipped.push({ id: r.id, reason: why.join("; ") }); continue; }
    seen.add(r.id); items.push({ ...r, tags: r.tags || [] });
  }
  return { items, skipped };
}

/* ───────── deterministic consistency checks (heuristics, documented in README) ───────── */
const normDigits = (s) => String(s || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/٫/g, ".").replace(/٬/g, "");
const LETTER_RE = /(?:correct\s+(?:answer|option|choice)\s*(?:is|:)?|the\s+answer\s+is|answer\s*:|الإجابة\s+الصحيحة(?:\s+هي)?|الإجابة\s+هي|الاختيار\s+الصحيح(?:\s+هو)?|الخيار\s+الصحيح(?:\s+هو)?)\s*[:：]?\s*\(?\s*([A-Ea-e])\b/gi;
export function parseNumbers(s) {
  return String(s || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = normDigits(x).match(/^(.+?)\s*=\s*(-?\d+(?:\.\d+)?)\s*(.*)$/);
    return m ? { name: m[1].trim(), value: m[2], unit: m[3].trim() } : { raw: x, bad: true };
  });
}
export function checkConsistency(out, q, dictAll = []) {
  const r = { letter_conflict: false, num_conflict: false, num_missing: false, num_format_err: false, trans_err: [], fields_missing: [] };
  if (!out || typeof out !== "object") return { ...r, fields_missing: ["*"] };
  for (const k of FIELDS_AF) if (typeof out[k] !== "string" || (k !== "numbers" && k !== "traps" && k !== "terms" && !out[k].trim())) r.fields_missing.push(k);
  const prose = normDigits([out.short_rationale, out.explain, out.traps].join("\n"));
  for (const m of prose.matchAll(LETTER_RE)) {
    const L = m[1]; if (L !== L.toUpperCase()) continue;
    if (out.answer_letter && L !== out.answer_letter) { r.letter_conflict = true; break; }
  }
  const evidence = normDigits([q.stem, Object.values(q.options).join(" "), prose].join("\n"));
  for (const n of parseNumbers(out.numbers)) {
    if (n.bad) { r.num_format_err = true; continue; }
    if (!new RegExp(`(?<![\\d.])${esc(n.value)}(?!\\d|\\.\\d)`).test(evidence)) r.num_missing = true;
    const near = new RegExp(`${esc(n.name)}[^\\d\\n]{0,25}(-?\\d+(?:\\.\\d+)?)`, "gi");
    for (const m of prose.matchAll(near)) if (parseFloat(m[1]) !== parseFloat(n.value)) { r.num_conflict = true; break; }
  }
  const text = [out.short_rationale, out.explain, out.traps, out.terms].join("\n").toLowerCase();
  for (const e of dictAll) for (const b of e.bad || []) if (b && text.includes(String(b).toLowerCase())) r.trans_err.push(`${e.abbr}:${b}`);
  return r;
}

/* ───────── incremental field extraction from the streamed JSON text ───────── */
export function extractString(buf, key, from = 0) {
  const at = buf.indexOf(`"${key}"`, from); if (at < 0) return null;
  let i = at + key.length + 2;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== ":") return null; i++;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== '"') return null;
  let j = i + 1;
  while (j < buf.length) { if (buf[j] === "\\") { j += 2; continue; } if (buf[j] === '"') { try { return JSON.parse(buf.slice(i, j + 1)); } catch (e) { return null; } } j++; }
  return null;       // closing quote has not arrived yet
}

/* ───────── pacer + daily counter (bench-side only) ───────── */
class StopRun extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }
class Pacer {
  constructor(rpm) { this.rpm = rpm; this.win = {}; }
  async acquire(model) {
    const w = (this.win[model] ||= []); let waited = 0;
    for (;;) {
      const t = Date.now(); while (w.length && t - w[0] >= 60000) w.shift();
      if (w.length < this.rpm) { w.push(Date.now()); return waited; }
      const ms = w[0] + 60000 - t + 50; await sleep(ms); waited += ms;
    }
  }
}
class Daily {
  constructor(file) { this.file = file; this.s = { date: ptDay(), counts: {} }; try { const o = JSON.parse(fs.readFileSync(file, "utf8")); if (o.date === ptDay()) this.s = o; } catch (e) { /* new day or file */ } }
  count(m) { return this.s.counts[m] || 0; }
  inc(m) { this.s.counts[m] = this.count(m) + 1; try { fs.writeFileSync(this.file, JSON.stringify(this.s)); } catch (e) { /* ignore */ } }
}

/* ───────── one HTTP attempt (streaming) ───────── */
async function attempt(ctx, { model, body, level, fields }) {
  const url = `${ctx.base}/${model}:streamGenerateContent?alt=sse`;
  const ctrl = new AbortController(), fbMs = Math.round(FIRST_BYTE_MS[level] * ctx.fbScale);
  const t0 = now(); let why = null, timer = null;
  const arm = (ms, w) => { clearTimeout(timer); timer = setTimeout(() => { why = w; ctrl.abort(); }, ms); };
  arm(fbMs, "fb");
  const totalTimer = setTimeout(() => { why = "total"; ctrl.abort(); }, TOTAL_MS);
  const R = { model, level, status: 0, cat: null, ok: false, ms: 0, ttfb_ms: null, fieldTimes: {}, fieldOrder: [], usage: null, finish: null, text: "", message: "" };
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": ctx.apiKey }, body: JSON.stringify(body), signal: ctrl.signal });
    R.status = res.status;
    if (!res.ok) {
      const txt = await res.text(); R.message = txt.slice(0, 600);
      try { R.message = JSON.parse(txt).error?.message || R.message; } catch (e) { /* keep raw */ }
      R.cat = res.status === 429 ? "429" : res.status === 503 ? "503" : res.status >= 500 ? "5xx" : "fatal";
      R.daily = res.status === 429 && /per\s?day|daily/i.test(R.message);
      return R;
    }
    const dec = new TextDecoder(); let pending = "";
    for await (const chunk of res.body) {
      pending += dec.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      let idx; while ((idx = pending.indexOf("\n\n")) >= 0) {
        const ev = pending.slice(0, idx); pending = pending.slice(idx + 2);
        const data = ev.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!data || data === "[DONE]") continue;
        let j; try { j = JSON.parse(data); } catch (e) { continue; }
        const tNow = now() - t0;
        if (R.ttfb_ms === null) R.ttfb_ms = tNow;
        arm(IDLE_MS, "idle");
        if (j.error) { R.status = j.error.code || 500; R.message = j.error.message || ""; R.cat = R.status === 429 ? "429" : R.status === 503 ? "503" : R.status >= 500 ? "5xx" : "fatal"; return R; }
        if (j.usageMetadata) R.usage = j.usageMetadata;
        if (j.promptFeedback?.blockReason) { R.cat = "fatal"; R.message = "blocked: " + j.promptFeedback.blockReason; return R; }
        const cand = j.candidates?.[0]; if (cand?.finishReason) R.finish = cand.finishReason;
        for (const p of cand?.content?.parts || []) if (!p.thought && typeof p.text === "string") R.text += p.text;
        for (const k of fields) if (!(k in R.fieldTimes)) { const v = extractString(R.text, k); if (v !== null) { R.fieldTimes[k] = tNow; R.fieldOrder.push(k); } }
      }
    }
    if (!R.text.trim()) { R.cat = "empty"; return R; }
    R.ok = true; return R;
  } catch (e) {
    R.cat = why ? "timeout" : "net"; R.kind = why || undefined;
    R.message = why === "fb" ? `no first byte within ${fbMs} ms (first-byte limit for ${level})` : why === "idle" ? `stream silent for ${IDLE_MS} ms after the first byte` : why === "total" ? `exceeded the total limit of ${TOTAL_MS} ms` : String(e.message || e);
    return R;
  } finally { clearTimeout(timer); clearTimeout(totalTimer); R.ms = now() - t0; }
}

/* ───────── one trial = one question through the fail-over policy ───────── */
export function buildBody({ model, level, system, userText, variant, maxOut }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { maxOutputTokens: maxOut, responseMimeType: "application/json", responseSchema: makeSchema(variant), thinkingConfig: { thinkingLevel: clampLevel(model, level) } },
  };
  lintBody(model, body); return body;
}
const trialKey = (c, qid) => `${c.arm}|${c.level}|${c.dictOn ? 1 : 0}|${c.variant}|${qid}`;

async function runTrial(ctx, q, cfg) {
  const matched = cfg.dictOn ? matchDict(ctx.dict, q.stem + " " + Object.values(q.options).join(" ")) : [];
  const userText = questionText(q, dictBlock(matched));
  const system = cfg.system || systemText(ctx.lang);
  const fields = cfg.variant === "rf" ? FIELDS_RF : FIELDS_AF;
  const rec = { key: trialKey(cfg, q.id), arm: cfg.arm, qid: q.id, level: cfg.level, dict: !!cfg.dictOn, variant: cfg.variant, dict_hits: matched.map((e) => e.abbr),
    status: "failed", model_used: null, fallback: false, requests: 0, attempts: [], lost: { "429": 0, "503": 0, "5xx": 0, timeout: 0, net: 0, empty: 0, sleep: 0 }, pacer_wait_ms: 0, at: new Date().toISOString() };
  let spent = 0;                              // time the student would have lost on failed attempts (pacer waits are NOT in it)
  for (const [i, model] of [ctx.models.primary, ctx.models.fallback].entries()) {
    if (ctx.maxRequests && ctx.sent >= ctx.maxRequests) throw new StopRun(`--max-requests (${ctx.maxRequests}) reached`, 0);
    if (ctx.daily.count(model) >= ctx.dailyCap) throw new StopRun(`daily cap (${ctx.dailyCap}) reached for ${model}; resume tomorrow with --resume`, 0);
    rec.pacer_wait_ms += await ctx.pacer.acquire(model);
    const body = buildBody({ model, level: cfg.level, system, userText, variant: cfg.variant, maxOut: ctx.maxOut });
    ctx.daily.inc(model); ctx.sent++; rec.requests++;
    const a = await attempt(ctx, { model, body, level: clampLevel(model, cfg.level), fields });
    rec.attempts.push({ model, level: a.level, status: a.status, cat: a.cat, kind: a.kind, ok: a.ok, ms: Math.round(a.ms), ttfb_ms: a.ttfb_ms === null ? null : Math.round(a.ttfb_ms), msg: a.ok ? undefined : a.message.slice(0, 300) });
    if (a.ok) {
      let out = null, parse_error = false; try { out = JSON.parse(a.text); } catch (e) { parse_error = true; }
      const u = a.usage || {};
      Object.assign(rec, { status: "ok", model_used: model, fallback: i > 0, parse_error, truncated: a.finish === "MAX_TOKENS", finish: a.finish, out,
        ttfb_ms: Math.round(spent + (a.ttfb_ms ?? 0)), ttfa_ms: ANSWER_FIELD in a.fieldTimes ? Math.round(spent + a.fieldTimes[ANSWER_FIELD]) : null, total_ms: Math.round(spent + a.ms),
        field_order: a.fieldOrder, answer_first: a.fieldOrder[0] === ANSWER_FIELD,
        prompt_tokens: u.promptTokenCount ?? null, thinking_tokens: u.thoughtsTokenCount ?? null, output_tokens: u.candidatesTokenCount ?? null, cached_tokens: u.cachedContentTokenCount ?? 0 });
      rec.pred = out?.answer_letter ?? null; rec.gold = q.key[0]; rec.correct = rec.pred === rec.gold;
      Object.assign(rec, checkConsistency(out, q, ctx.dict));
      return rec;
    }
    if (a.cat === "fatal") {
      rec.error = { status: a.status, message: a.message };
      if (a.status === 400 && ctx.halt400) { ctx.writeRec(rec); throw new StopRun(`HTTP 400 from ${model} — stopped on purpose.\n${a.message}\nRequest body was:\n${JSON.stringify(body, null, 1).slice(0, 1800)}`, 2); }
      if ([401, 403, 404].includes(a.status)) { ctx.writeRec(rec); throw new StopRun(`HTTP ${a.status} from ${model}: ${a.message}`, 2); }
      return rec;
    }
    if (a.daily && i === 0) { ctx.writeRec(rec); throw new StopRun(`primary model ${model} has no daily quota left (${a.message.slice(0, 160)}). Resume tomorrow with --resume`, 0); }
    rec.lost[a.cat] = (rec.lost[a.cat] || 0) + Math.round(a.ms); spent += a.ms;   // fail over NOW: no sleep
  }
  return rec;
}

/* ───────── plan per arm ───────── */
function buildPlan(o, ctx) {
  const items = ctx.items, plan = [];
  if (o.smoke) {
    items.slice(0, 16).forEach((q, i) => plan.push({ q, cfg: { arm: "SMOKE", level: LEVELS[i % 4], dictOn: o.dict === "on", variant: "af" } }));
    return plan;
  }
  const levels = o.levels.split(",").map((s) => s.trim()).filter(Boolean);
  for (const l of levels) if (!LEVELS.includes(l)) throw new Error(`unknown level "${l}"`);
  if (o.arm === "A") for (const q of items) for (const level of levels) plan.push({ q, cfg: { arm: "A", level, dictOn: o.dict === "on", variant: "af" } });
  else if (o.arm === "B") {
    if (!o.level) throw new Error("arm B needs --level");
    for (const q of items) if (matchDict(ctx.dict, q.stem + " " + Object.values(q.options).join(" ")).length) for (const dictOn of [false, true]) plan.push({ q, cfg: { arm: "B", level: o.level, dictOn, variant: "af" } });
  } else if (o.arm === "C") {
    if (!o.level) throw new Error("arm C needs --level");
    const hard = items.filter((q) => q.tags.includes("hard")), pool = hard.length ? hard : items;
    for (const q of pool.slice(0, parseInt(o.hard, 10))) plan.push({ q, cfg: { arm: "C", level: o.level, dictOn: o.dict === "on", variant: "rf" } });
  } else if (o.arm === "D") {
    const level = o.level || "low", qs = items.slice(0, 3);
    for (const [name, system] of [["cache-short", systemText(ctx.lang)], ["cache-long", longPrefix(ctx.dict, ctx.lang)]]) for (const q of qs) plan.push({ q, cfg: { arm: "D", level, dictOn: false, variant: name, system } });
  } else throw new Error(`unknown arm ${o.arm}`);
  return plan;
}

/* ───────── report ───────── */
/* a key can appear twice after --resume (failed first, ok later): keep only the LAST record per key */
export const dedupeByKey = (recs) => { const m = new Map(); for (const r of recs) m.set(r.key, r); return [...m.values()]; };
const readJsonl = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const group = (recs, f) => { const m = new Map(); for (const r of recs) { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
const num = (recs, f) => recs.map(f).filter((x) => Number.isFinite(x));

export function summarize(rs) {
  const n = rs.length, ok = rs.filter((r) => r.status === "ok"), k = rs.filter((r) => r.correct).length, [lo, hi] = wilson(k, n);
  const cons = rs.filter((r) => r.letter_conflict || r.num_conflict).length;
  const lost = {}; for (const c of ["429", "503", "5xx", "timeout", "net", "empty", "sleep"]) lost[c] = mean(rs.map((r) => r.lost?.[c] ?? 0));
  return { n, ok: ok.length, failed: n - ok.length, acc: n ? k / n : null, k, lo, hi, cons, trans: rs.filter((r) => r.trans_err?.length).length, parse: rs.filter((r) => r.parse_error || r.truncated).length,
    fb: rs.filter((r) => r.fallback).length, req: mean(rs.map((r) => r.requests)), ttfa50: percentile(num(ok, (r) => r.ttfa_ms), 0.5), ttfa95: percentile(num(ok, (r) => r.ttfa_ms), 0.95),
    tot50: percentile(num(ok, (r) => r.total_ms), 0.5), tot95: percentile(num(ok, (r) => r.total_ms), 0.95), lost, think: mean(ok.map((r) => r.thinking_tokens)), cached: mean(ok.map((r) => r.cached_tokens)), prompt: mean(ok.map((r) => r.prompt_tokens)),
    answerFirst: ok.filter((r) => r.answer_first).length, pacer: mean(rs.map((r) => r.pacer_wait_ms)) };
}

export function buildReport(recs, { chosen = null, dictHasBad = false } = {}) {
  const L = [`# Phase 0 bench report`, ``, `Generated ${new Date().toISOString()} · trials: ${recs.length}`, ``];
  const main = recs.filter((r) => r.arm !== "SMOKE");
  const gs = group(main, (r) => `${r.arm}|${r.level}|dict=${r.dict ? "on" : "off"}|${r.variant}`);
  L.push(`## Per configuration`, ``, `Failed trials count as wrong answers. Times exclude the bench's own pacing wait (shown separately). Lost time = mean ms per trial spent on failed attempts before the fallback.`, ``);
  L.push(`| config | n | failed | Acc % (95% CI) | letter/num conflicts | trans err | parse/trunc | fallback | req/q | TTFA P50 / P95 ms | total P50 / P95 ms | lost 429 / 503 / 5xx / timeout / net / sleep | think tok | cached tok | prompt tok | pacer wait ms |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  const sums = new Map();
  for (const [k, rs] of [...gs.entries()].sort()) {
    const s = summarize(rs); sums.set(k, { s, rs });
    L.push(`| ${k} | ${s.n} | ${s.failed} | ${fmt(100 * s.acc, 1)} (${fmt(100 * s.lo, 0)}–${fmt(100 * s.hi, 0)}) | ${pct(s.cons, s.n)} | ${pct(s.trans, s.n)} | ${s.parse} | ${pct(s.fb, s.n, 0)} | ${fmt(s.req, 2)} | ${fmt(s.ttfa50)} / ${fmt(s.ttfa95)} | ${fmt(s.tot50)} / ${fmt(s.tot95)} | ${["429", "503", "5xx", "timeout", "net", "sleep"].map((c) => fmt(s.lost[c])).join(" / ")} | ${fmt(s.think)} | ${fmt(s.cached)} | ${fmt(s.prompt)} | ${fmt(s.pacer)} |`);
  }
  if (!dictHasBad) L.push(``, `> ⚠ The glossary has no \`bad\` forms yet, so **translation errors are not measurable** (trans err is always 0). Fill \`bad\` from errors actually observed.`);
  /* paired comparisons between levels (arm A, answer-first, same dict setting) */
  const A = main.filter((r) => r.arm === "A" && r.variant === "af");
  const pairs = [];
  for (const dict of [true, false]) {
    const byLevel = group(A.filter((r) => r.dict === dict), (r) => r.level);
    const lv = LEVELS.filter((l) => byLevel.has(l));
    for (let i = 0; i < lv.length; i++) for (let j = i + 1; j < lv.length; j++) {
      const X = new Map(byLevel.get(lv[i]).map((r) => [r.qid, r.correct])), Y = new Map(byLevel.get(lv[j]).map((r) => [r.qid, r.correct]));
      let b = 0, c = 0, both = 0; for (const [id, x] of X) if (Y.has(id)) { const y = Y.get(id); if (x && !y) b++; else if (!x && y) c++; else both++; }
      pairs.push(`| ${lv[i]} vs ${lv[j]} (dict ${dict ? "on" : "off"}) | ${both + b + c} | ${b} | ${c} | ${mcnemarExact(b, c).toFixed(3)} |`);
    }
  }
  if (pairs.length) L.push(``, `## Paired comparison between levels (exact McNemar)`, ``, `With ~100 questions only large differences are detectable (95% CI is about ±9 points): p > 0.05 means "not distinguishable", not "equal".`, ``, `| pair | paired q | only first right | only second right | p |`, `|---|---|---|---|---|`, ...pairs);
  /* arm B */
  const B = main.filter((r) => r.arm === "B");
  if (B.length) {
    const on = new Map(B.filter((r) => r.dict).map((r) => [r.qid, r])), off = new Map(B.filter((r) => !r.dict).map((r) => [r.qid, r]));
    let b = 0, c = 0, both = 0, tOn = 0, tOff = 0; for (const [id, r1] of on) { const r0 = off.get(id); if (!r0) continue; if (r1.correct && !r0.correct) b++; else if (!r1.correct && r0.correct) c++; else both++; if (r1.trans_err?.length) tOn++; if (r0.trans_err?.length) tOff++; }
    L.push(``, `## Glossary effect (arm B, matched questions only)`, ``, `paired q: ${b + c + both} · only-with-glossary right: ${b} · only-without right: ${c} · McNemar p = ${mcnemarExact(b, c).toFixed(3)} · translation errors with/without: ${tOn}/${tOff}`);
  }
  /* arm C */
  const C = main.filter((r) => r.arm === "C");
  if (C.length) {
    const lvl = C[0].level, base = new Map(A.filter((r) => r.level === lvl && r.dict === C[0].dict).map((r) => [r.qid, r]));
    let b = 0, c = 0, both = 0; for (const r of C) { const a = base.get(r.qid); if (!a) continue; if (a.correct && !r.correct) b++; else if (!a.correct && r.correct) c++; else both++; }
    L.push(``, `## Schema order (arm C: rationale-first vs answer-first at ${lvl})`, ``, `paired q: ${b + c + both} · only answer-first right: ${b} · only rationale-first right: ${c} · McNemar p = ${mcnemarExact(b, c).toFixed(3)}`);
  }
  /* arm D */
  const D = main.filter((r) => r.arm === "D");
  if (D.length) {
    L.push(``, `## Implicit cache probe (arm D)`, ``, `| prefix | call # | prompt tokens | cached tokens |`, `|---|---|---|---|`);
    for (const v of ["cache-short", "cache-long"]) D.filter((r) => r.variant === v).forEach((r, i) => L.push(`| ${v} | ${i + 1} | ${r.prompt_tokens ?? "–"} | ${r.cached_tokens ?? "–"} |`));
    const longMax = Math.max(0, ...D.filter((r) => r.variant === "cache-long").map((r) => r.prompt_tokens || 0));
    if (longMax && longMax < 4096) L.push(``, `> ⚠ The long prefix measured only ${longMax} prompt tokens (< 4,096): the probe is inconclusive, enlarge the padding.`);
  }
  /* acceptance gate */
  L.push(``, `## Acceptance gate`, ``);
  const all400 = main.reduce((n, r) => n + r.attempts.filter((a) => a.status === 400).length, 0), sleepSum = main.reduce((n, r) => n + (r.lost?.sleep || 0), 0);
  const line = (ok, t) => L.push(`- ${ok === null ? "⏳" : ok ? "✅" : "❌"} ${t}`);
  line(all400 === 0, `zero HTTP 400 in the whole run (found ${all400})`);
  line(sleepSum === 0, `zero sleep time on failures (${sleepSum} ms)`);
  if (!chosen) line(null, `pass --chosen <level> to evaluate the level-specific gates below`);
  else {
    const cs = sums.get(`A|${chosen}|dict=on|af`)?.s, hs = sums.get(`A|high|dict=on|af`)?.s;
    if (!cs) line(null, `no arm-A trials for level ${chosen} with the glossary ON`);
    else {
      line(cs.req <= 1.05, `mean requests per question ≤ 1.05 at ${chosen} (${fmt(cs.req, 3)})`);
      line(cs.n ? cs.cons / cs.n <= 0.02 : null, `letter/number conflicts ≤ 2% at ${chosen} (${pct(cs.cons, cs.n)})`);
      line(cs.ttfa50 === null ? null : cs.ttfa50 <= 5000, `TTFA P50 ≤ 5,000 ms at the production level ${chosen} (${fmt(cs.ttfa50)} ms)`);
      if (chosen === "high") line(null, `accuracy gate is relative to high; chosen = high`);
      else if (!hs) line(null, `accuracy gate needs arm-A trials at high as the reference`);
      else line(100 * cs.acc >= 100 * hs.acc - 3, `accuracy at ${chosen} not more than 3 points below high (${fmt(100 * cs.acc, 1)} vs ${fmt(100 * hs.acc, 1)})`);
    }
  }
  return L.join("\n") + "\n";
}

export function smokeChecklist(recs) {
  const ok = recs.filter((r) => r.status === "ok"), atts = recs.flatMap((r) => r.attempts);
  const rows = [];
  const add = (pass, t) => rows.push(`${pass ? "PASS" : "FAIL"}  ${t}`);
  add(atts.every((a) => a.status !== 400), `zero HTTP 400 (${atts.filter((a) => a.status === 400).length} found)`);
  add(recs.length > 0 && recs.every((r) => r.status === "ok"), `every trial finished (${ok.length}/${recs.length})`);
  add(ok.every((r) => !r.parse_error && !r.truncated && !r.fields_missing?.length), `every reply parsed, not truncated, all fields present (${ok.filter((r) => r.parse_error || r.truncated || r.fields_missing?.length).length} problems)`);
  add(ok.every((r) => r.answer_first), `answer_letter was the FIRST field to arrive in every reply (${ok.filter((r) => !r.answer_first).length} exceptions)`);
  const deep = ok.filter((r) => r.level === "medium" || r.level === "high"), noThink = deep.filter((r) => r.thinking_tokens === null || r.thinking_tokens === undefined);
  add(deep.length > 0 && noThink.length === 0, `thoughtsTokenCount present on every medium/high reply (${noThink.length} of ${deep.length} missing; minimal/low may legitimately omit it)`);
  const tk = (k) => atts.filter((a) => a.cat === "timeout" && a.kind === k).length;
  add(tk("fb") === 0, `no first-byte timeouts (${tk("fb")}) — if > 0 raise --fb-scale or the level limit, then rerun the smoke test`);
  add(tk("idle") + tk("total") === 0, `no idle/total timeouts (idle ${tk("idle")}, total ${tk("total")})`);
  for (const l of LEVELS) { const t = recs.filter((r) => r.level === l && r.status === "ok").map((r) => r.attempts.at(-1).ttfb_ms).filter(Number.isFinite); if (t.length) { const lim = FIRST_BYTE_MS[l]; const p = Math.max(...t); add(p <= 0.7 * lim, `${l}: slowest first byte ${p} ms vs limit ${lim} ms (needs ≤ 70% headroom)`); } }
  add(ok.every((r) => !r.fallback), `no trial needed the fallback model (${ok.filter((r) => r.fallback).length} did)`);
  return rows;
}

/* ───────── preflight ───────── */
async function preflight(ctx) {
  const names = new Set(); let tok = "", pages = 0;
  do {
    const res = await fetch(`${ctx.base}?pageSize=200${tok ? `&pageToken=${tok}` : ""}`, { headers: { "x-goog-api-key": ctx.apiKey } });
    if (!res.ok) throw new StopRun(`models.list failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json(); for (const m of j.models || []) names.add(String(m.name).replace(/^models\//, "")); tok = j.nextPageToken || ""; pages++;
  } while (tok && pages < 6);
  const have = (m) => names.has(m);
  console.log(`preflight · primary ${MODELS.primary}: ${have(MODELS.primary) ? "ok" : "MISSING"} · fallback ${MODELS.fallback}: ${have(MODELS.fallback) ? "ok" : "MISSING"} · escalation: ${MODELS.escalation.map((m) => `${m}=${have(m) ? "ok" : "missing"}`).join(", ")}`);
  if (!have(ctx.models.primary)) throw new StopRun(`primary model ${ctx.models.primary} is not available for this key`);
  if (!have(ctx.models.fallback)) console.log(`⚠ fallback ${ctx.models.fallback} is not listed: failover trials will fail`);
}

/* ───────── main ───────── */
export async function main(argv, env = process.env) {
  const { values: o } = parseArgs({ args: argv, allowPositionals: false, options: {
    arm: { type: "string", default: "A" }, levels: { type: "string", default: LEVELS.join(",") }, level: { type: "string" }, dict: { type: "string", default: "on" },
    dataset: { type: "string", default: "bench/nursing100.jsonl" }, "dict-file": { type: "string", default: "bench/nursing-dict.seed.json" }, "out-dir": { type: "string", default: "bench/out" },
    limit: { type: "string" }, rpm: { type: "string", default: "8" }, "daily-cap": { type: "string", default: "450" }, "max-requests": { type: "string" },
    smoke: { type: "boolean", default: false }, resume: { type: "boolean", default: false }, fresh: { type: "boolean", default: false },
    "base-url": { type: "string", default: DEFAULT_BASE }, model: { type: "string" }, "fallback-model": { type: "string" }, "max-out": { type: "string", default: "16384" },
    "no-halt-on-400": { type: "boolean", default: false }, hard: { type: "string", default: "30" }, lang: { type: "string", default: "ar" },
    validate: { type: "boolean", default: false }, report: { type: "boolean", default: false }, chosen: { type: "string" }, "fb-scale": { type: "string", default: "1" },
    "allow-synthetic": { type: "boolean", default: false }, "skip-preflight": { type: "boolean", default: false }, "key-env": { type: "string", default: "GEMINI_API_KEY" },
  } });
  const outDir = o["out-dir"]; fs.mkdirSync(outDir, { recursive: true });
  const dict = loadDict(o["dict-file"]), dictHasBad = dict.some((e) => e.bad.length);
  const readAll = () => dedupeByKey(fs.readdirSync(outDir).filter((f) => /^results-.*\.jsonl$/.test(f)).flatMap((f) => readJsonl(path.join(outDir, f))));

  if (o.report) { const recs = readAll(); fs.writeFileSync(path.join(outDir, "report.md"), buildReport(recs, { chosen: o.chosen, dictHasBad })); console.log(`report → ${path.join(outDir, "report.md")} (${recs.length} trials)`); return 0; }

  const { items: all, skipped } = loadDataset(o.dataset, { allowSynthetic: o["allow-synthetic"] });
  const items = o.limit ? all.slice(0, parseInt(o.limit, 10)) : all;
  if (o.validate) {
    const dist = {}; for (const q of all) dist[q.key[0]] = (dist[q.key[0]] || 0) + 1;
    const matched = all.filter((q) => matchDict(dict, q.stem + " " + Object.values(q.options).join(" ")).length).length;
    console.log(`dataset ${o.dataset}: usable ${all.length}, skipped ${skipped.length}\nkey letters: ${JSON.stringify(dist)} (a heavy skew means position bias)\nhard-tagged: ${all.filter((q) => q.tags.includes("hard")).length} · matched by glossary: ${matched} (arm B size)\nglossary: ${dict.length} entries, ${dict.filter((e) => e.bad.length).length} with bad forms`);
    for (const s of skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
    if (all.length < 100) console.log(`⚠ ${all.length} usable questions, the plan needs 100.`);
    return 0;
  }
  if (!items.length) { console.error("no usable questions (see --validate)"); return 1; }
  if (skipped.length) console.log(`note: ${skipped.length} dataset rows skipped (run --validate for reasons)`);

  const apiKey = env[o["key-env"]]; if (!apiKey) { console.error(`set ${o["key-env"]} (never commit the key)`); return 1; }
  const models = { primary: o.model || MODELS.primary, fallback: o["fallback-model"] || MODELS.fallback };
  const ctx = { base: o["base-url"].replace(/\/+$/, ""), apiKey, models, items, dict, lang: o.lang, maxOut: parseInt(o["max-out"], 10), fbScale: parseFloat(o["fb-scale"]),
    pacer: new Pacer(parseInt(o.rpm, 10)), daily: new Daily(path.join(outDir, "daily-counter.json")), dailyCap: parseInt(o["daily-cap"], 10),
    maxRequests: o["max-requests"] ? parseInt(o["max-requests"], 10) : 0, sent: 0, halt400: !o["no-halt-on-400"] };
  const armName = o.smoke ? "smoke" : o.arm.toLowerCase(), file = path.join(outDir, `results-${armName}.jsonl`);
  if (fs.existsSync(file) && !o.resume) {
    if (!o.fresh) { console.error(`${file} exists: pass --resume to continue it or --fresh to archive it and start over`); return 1; }
    fs.renameSync(file, `${file}.bak-${Date.now()}`);
  }
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === "ok").map((r) => r.key) : []);
  ctx.writeRec = (r) => fs.appendFileSync(file, JSON.stringify(r) + "\n");

  const plan = buildPlan(o, ctx).filter(({ q, cfg }) => !done.has(trialKey(cfg, q.id)));
  console.log(`${o.smoke ? "SMOKE" : "arm " + o.arm} · ${plan.length} trials to run (${done.size} already done) · primary ${models.primary} → fallback ${models.fallback} · pacer ${o.rpm} rpm · daily used ${ctx.daily.count(models.primary)}/${ctx.dailyCap}`);
  if (plan.length > ctx.dailyCap - ctx.daily.count(models.primary)) console.log(`⚠ the plan needs more requests than today's remaining cap: it will stop cleanly and --resume continues tomorrow`);
  try {
    if (!o["skip-preflight"]) await preflight(ctx);
    let i = 0;
    for (const { q, cfg } of plan) {
      const rec = await runTrial(ctx, q, cfg); ctx.writeRec(rec); i++;
      console.log(`[${i}/${plan.length}] ${cfg.arm} ${cfg.level.padEnd(7)} ${q.id.padEnd(14)} ${rec.status === "ok" ? `${rec.correct ? "✓" : "✗"} ttfa ${rec.ttfa_ms} ms · total ${rec.total_ms} ms · think ${rec.thinking_tokens}${rec.fallback ? " · FALLBACK" : ""}` : `FAILED ${rec.error ? rec.error.status : rec.attempts.map((a) => a.cat).join(",")}`}`);
    }
  } catch (e) {
    if (!(e instanceof StopRun)) throw e;
    console.error(`\nSTOPPED: ${e.message}\nprogress is saved; continue with the same command plus --resume`);
    if (!o.smoke && fs.existsSync(file)) fs.writeFileSync(path.join(outDir, "report.md"), buildReport(readAll(), { chosen: o.chosen, dictHasBad }));
    return e.code;
  }
  if (o.smoke) {
    const recs = dedupeByKey(readJsonl(file));
    const rows = smokeChecklist(recs); console.log("\nSMOKE CHECKLIST\n" + rows.join("\n"));
    return rows.some((r) => r.startsWith("FAIL")) ? 3 : 0;
  }
  fs.writeFileSync(path.join(outDir, "report.md"), buildReport(readAll(), { chosen: o.chosen, dictHasBad }));
  console.log(`\nreport → ${path.join(outDir, "report.md")}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message || e); process.exit(1); });
}
