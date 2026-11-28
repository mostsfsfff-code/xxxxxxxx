import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, reset, script } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { loadKb } from "../src/lib/kb/index.js";
import { rangeContradiction } from "../src/lib/kb/ranges.js";
installFetch();

const STEM = `A 68-year-old client weighing 80 kg is on day 6 of an unfractionated heparin infusion. The infusion is currently running at 1,600 units/hr.
- aPTT: 96 seconds (therapeutic range 60-80 seconds)
- Platelets: 98,000/mm3 (admission value: 245,000/mm3)
- Hemoglobin: stable
- The client reports new pain in the left leg. No bleeding is noted.
The facility protocol states: "aPTT 91-110 seconds: hold the infusion for 1 hour, then restart at a rate decreased by 2 units/kg/hr."
Which action should the nurse take first?
A) Hold the infusion
B) Stop the heparin infusion and notify the provider
C) Continue
D) Protamine`;

test("pipeline: the real analysis restores the dropped stem sentences and removes an invented acronym", async () => {
  reset(); Router.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" });
  script("gemini:gemini-3.5-flash-lite", { ok: "## 🎯 السؤال بيسأل عن إيه؟\npriority\n\n## 🔤 فكّ السؤال بالإنجليزي\n- **aPTT: 96 seconds** — التحليل\n- **Which action should the nurse take first?** — أي إجراء\n\n## 📚 الأساس من الصفر\nheparin\n\n💡 **HIT = Halt It Today** — وقف" });
  let exp = "";
  await new Promise((res, rej) => {
    const done = new Set(); const to = setTimeout(() => rej(new Error("timeout")), 10000);
    createAnalysis({ kind: "question", history: [], dataUrl: null, doc: { kind: "text", name: "q.txt", text: STEM }, extra: "", chips: [], apiKey: "AIzaPIPE000000001", modeId: "balanced",
      onUpdate: (n, t) => { if (t && t.explanation) exp = t.explanation; },
      onDone: (n) => { done.add(n); if (done.has("reason") && done.has("words")) { clearTimeout(to); res(); } },
      onError: (n, e) => { clearTimeout(to); rej(new Error(n + ":" + (e?.message || e))); }, onNotice() {}, onTrust() {} }).start();
  });
  for (const must of [/No bleeding is noted/, /Hemoglobin: stable/, /decreased by 2 units\/kg\/hr/, /weighing 80 kg/]) assert.match(exp, must);
  assert.ok(!/Halt It Today/.test(exp), "invented acronym is gone");
  assert.equal((exp.match(/aPTT: 96 seconds/g) || []).length >= 1, true);
});

test("ranges: a thousands separator is not a decimal comma (no false 'Platelets 400 /mm3 is below the reference range')", async () => {
  await loadKb({});
  assert.equal(rangeContradiction("Normal platelet count is 150,000 to 400,000/mm3", null, {}), null);
  assert.equal(rangeContradiction("Platelets: 250,000/mm3 are normal", null, {}), null);
  assert.equal(rangeContradiction("Platelets of 98,000/mm3 are low", null, {}), null);
  const bad = rangeContradiction("Platelets of 250,000/mm3 are low", null, {});
  assert.ok(bad && /250000/.test(bad.text) && /within/.test(bad.text), "a real contradiction is still corrected, with the right number");
});
