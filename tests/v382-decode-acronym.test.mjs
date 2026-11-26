import test from "node:test";
import assert from "node:assert/strict";
import { repairDecode, stemSentences } from "../src/lib/decode-coverage.js";
import { inventedAcronym, definedAcronyms, analyze } from "../src/lib/accuracy.js";

const STEM = `A 68-year-old client weighing 80 kg is on day 6 of an unfractionated heparin infusion. The infusion is currently running at 1,600 units/hr.
- Platelets: 98,000/mm³ (admission value: 245,000/mm³)
- Hemoglobin: stable
- The client reports new pain in the left leg. No bleeding is noted.
The facility protocol states: "aPTT 91–110 seconds: hold the infusion for 1 hour, then restart at a rate decreased by 2 units/kg/hr."
Which action should the nurse take first?
A) Hold
B) Stop
C) Continue`;
const TEXT = `## 🔤 فكّ السؤال بالإنجليزي\n- **Platelets: 98,000/mm³ (admission value: 245,000/mm³)** — الصفائح نزلت\n- **Which action should the nurse take first?** — أي إجراء الأول\n\n## 📚 الأساس\nx`;

test("decode: stem sentences with numbers / negations / the protocol are put back verbatim, none repeated, options never added", () => {
  const out = repairDecode(TEXT, STEM);
  assert.match(out, /No bleeding is noted/);
  assert.match(out, /decreased by 2 units\/kg\/hr/);
  assert.match(out, /Hemoglobin: stable/);
  assert.match(out, /weighing 80 kg/);
  assert.equal((out.match(/Platelets: 98,000/g) || []).length, 1, "a covered sentence is not repeated");
  assert.ok(!/Hold|Continue/.test(out), "options are not part of the decode");
  assert.ok(out.indexOf("Hemoglobin") < out.indexOf("Which action"), "stem order is kept (question last)");
});
test("decode: nothing to add → text unchanged; no decode section → unchanged", () => {
  const full = TEXT.replace("- **Which", STEM.split("\n").filter((l) => !/^[A-C]\)/.test(l)).map((l) => `- **${l.replace(/^- /, "")}**`).join("\n") + "\n- **Which");
  assert.equal(repairDecode(full, STEM), full);
  assert.equal(repairDecode("## 📚 الأساس\nx", STEM), "## 📚 الأساس\nx");
  assert.ok(stemSentences(STEM).every((s) => !/^[A-C]\)/.test(s)));
});
test("acronym: an invented one is detected, standard / real expansions are kept", () => {
  const d = definedAcronyms("Heparin-Induced Thrombocytopenia (HIT) is dangerous.");
  assert.equal(inventedAcronym("💡 **HIT = Halt It Today** — أول ما تشوف HIT", d), true);
  assert.equal(inventedAcronym("HIT = Heparin Induced Thrombocytopenia", d), false);
  assert.equal(inventedAcronym("ABC = Airway Breathing Circulation", d), false);
  assert.equal(inventedAcronym("💡 Day 5 to 10, platelets drop, new clots pop — Heparin MUST stop!", d), false);
});
test("acronym: an invented acronym line is removed in Part B too (not just boxed)", () => {
  const r = analyze("Stop the heparin.\n💡 **HIT = Halt It Today** — أول ما تشوف HIT وقف الهيبارين", { part: "B", source: "", known: () => false });
  assert.ok(!/Halt It Today/.test(r.text));
  assert.ok(r.memoAids.every((m) => !/Halt It Today/.test(m.sentence)));
  assert.ok(r.stripped.some((s) => s.reason === "invented-acronym"));
});
