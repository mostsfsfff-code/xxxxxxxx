import test from "node:test";
import assert from "node:assert/strict";
import { splitMixed } from "../src/lib/emphasis.js";

test("an English sentence + an Arabic sentence on one line become two lines", () => {
  const r = splitMixed("The patient should restrict sodium intake and monitor daily weight المريض لازم يقلل الملح ويقيس وزنه كل يوم");
  assert.equal(r.length, 2);
  assert.match(r[0], /^The patient/);
  assert.match(r[1], /^المريض/);
});
test("a short English term inside an Arabic sentence stays inline", () => {
  const s = "الهيبارين Heparin بيمنع التجلط عن طريق antithrombin III وده مهم جدا";
  assert.deepEqual(splitMixed(s), [s]);
});
test("pure Arabic / pure English / link chips are never split", () => {
  for (const s of ["ده سطر عربي بس من غير أي إنجليزي خالص ومفيش حاجة", "A plain English sentence with no Arabic at all here", "==🔗 Related question== The patient should restrict sodium intake المريض لازم يقلل الملح فعلا"]) assert.deepEqual(splitMixed(s), [s]);
});
test("bold stays balanced across the cut and the joining dash is dropped", () => {
  const r = splitMixed("**Warfarin must be monitored with INR every week** ويتراقب كل أسبوع بتحليل INR — مهم");
  for (const x of r) assert.equal((x.match(/\*\*/g) || []).length % 2, 0);
  const d = splitMixed("Priority action: assess airway first — المريض لازم نقيّم مجرى الهواء الأول قبل أي حاجة");
  assert.ok(!/—\s*$/.test(d[0]));
});
