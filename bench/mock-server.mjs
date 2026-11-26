/* Local fake of the Gemini streaming endpoint, for dry-running the bench without a key or quota.
   node bench/mock-server.mjs [port]   then   GEMINI_API_KEY=x node scripts/bench-flashlite.mjs --base-url http://127.0.0.1:PORT/v1beta/models ...
   Misbehaves on purpose: every 7th primary call 429, every 11th 503, every 13th hangs (no first byte); replies are split into odd chunks. */
import http from "node:http";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export function start(port = 0, { delayScale = 1, chaos = true, omitThink = false } = {}) {
  let n = 0;
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ models: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"].map((m) => ({ name: "models/" + m })) }));
    }
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}"), model = url.pathname.split("/").pop().split(":")[0], primary = model === "gemini-3.5-flash-lite";
    const bad = JSON.stringify(body).match(/"(temperature|topP|topK|thinkingBudget|responseLogprobs)"/);
    if (bad || body.contents?.at(-1)?.role === "model") { res.statusCode = 400; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ error: { code: 400, message: "mock: bad request " + (bad ? bad[1] : "prefill") } })); }
    n++;
    if (chaos && primary && n % 7 === 0) { res.statusCode = 429; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ error: { code: 429, message: "mock per-minute quota" } })); }
    if (chaos && primary && n % 11 === 0) { res.statusCode = 503; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ error: { code: 503, message: "mock overloaded" } })); }
    if (chaos && primary && n % 13 === 0) { await wait(3000); return res.end(); }
    const level = body.generationConfig?.thinkingConfig?.thinkingLevel, think = { minimal: 80, low: 150, medium: 400, high: 800 }[level] * delayScale;
    const text = body.contents[0].parts[0].text, letter = "ABCD"[(text.length + n) % 4];
    const order = body.generationConfig.responseSchema.propertyOrdering;
    const vals = { answer_letter: letter, short_rationale: `الإجابة ${letter} لأن aPTT يراقب الهيبارين.`, explain: `الإجابة الصحيحة هي ${letter}. الجرعة 500 mg مرتين.`, traps: "فخ 1\nفخ 2", numbers: "dose=500 mg", terms: "aPTT — زمن الثرومبوبلاستين", conf: "med" };
    const json = "{" + order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(vals[k])}`).join(",") + "}";
    res.writeHead(200, { "content-type": "text/event-stream" }); await wait(think);
    const parts = json.match(/[\s\S]{1,23}/g);
    for (const [i, p] of parts.entries()) { const last = i === parts.length - 1; res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] }, ...(last ? { finishReason: "STOP" } : {}) }], ...(last ? { usageMetadata: { promptTokenCount: text.length / 4 | 0, ...(omitThink ? {} : { thoughtsTokenCount: think | 0 }), candidatesTokenCount: json.length / 3 | 0, cachedContentTokenCount: 0 } } : {}) })}\r\n\r\n`); await wait(5); }
    res.end();
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r({ srv, port: srv.address().port })));
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) start(parseInt(process.argv[2] || "8787", 10)).then(({ port }) => console.log(`mock Gemini on http://127.0.0.1:${port}/v1beta/models`));
