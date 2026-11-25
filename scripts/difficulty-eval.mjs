/* ClinixStudy · difficulty evaluation (v3.73).  node scripts/difficulty-eval.mjs [corpus.json ...] [--rater=heuristic|director] [--verbose]
 * Prints accuracy, the confusion matrix and the dangerous errors (hard rated easy/medium, medium rated easy) for each corpus.
 * Add your own labelled questions as {id,label,text} to a JSON file and pass it: that is how the rater is tuned to YOUR exam. */
import fs from "node:fs";
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const rater = (args.find((a) => a.startsWith("--rater=")) || "--rater=auto").split("=")[1];
const verbose = args.includes("--verbose");
const D = await import("../src/lib/difficulty.js");
let assess = null;
try { const m = await import("../src/lib/director.js"); assess = m.assessQuestion; } catch (e) { /* director not built yet */ }
const pick = (t) => (rater === "heuristic" || !assess ? D.heuristicLevel(t).local : assess(t).level);
const LV = ["easy", "medium", "hard"];
for (const f of files.length ? files : ["tests/fixtures/difficulty-heldout.json"]) {
  const rows = JSON.parse(fs.readFileSync(f, "utf8"));
  const m = Object.fromEntries(LV.map((a) => [a, Object.fromEntries(LV.map((b) => [b, 0]))]));
  const bad = []; const t0 = process.hrtime.bigint();
  for (const r of rows) { const got = pick(r.text); m[r.label][got]++; if (got !== r.label) bad.push({ id: r.id, want: r.label, got }); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / rows.length;
  const ok = rows.length - bad.length;
  const danger = bad.filter((x) => (x.want === "hard" && x.got !== "hard") || (x.want === "medium" && x.got === "easy"));
  console.log(`\n${f}  [${assess && rater !== "heuristic" ? "director" : "heuristic"}]  n=${rows.length}  accuracy ${(100 * ok / rows.length).toFixed(1)}%  ${ms.toFixed(3)} ms/question`);
  console.log("            rated→   easy  medium  hard");
  for (const a of LV) console.log(`  truth ${a.padEnd(7)}      ${String(m[a].easy).padStart(4)}  ${String(m[a].medium).padStart(6)}  ${String(m[a].hard).padStart(4)}`);
  const hardLow = bad.filter((x) => x.want === "hard" && x.got === "easy").length, hardMed = bad.filter((x) => x.want === "hard" && x.got === "medium").length, medEasy = bad.filter((x) => x.want === "medium" && x.got === "easy").length, over = bad.filter((x) => LV.indexOf(x.got) > LV.indexOf(x.want)).length;
  console.log(`  dangerous: hard→easy ${hardLow} · hard→medium ${hardMed} · medium→easy ${medEasy}   | over-rated (costly, safe): ${over}`);
  if (verbose || danger.length) console.log("  misses:", bad.map((x) => `${x.id} ${x.want}→${x.got}`).join(", ") || "none");
}
