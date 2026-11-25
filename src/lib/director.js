/*
 * ClinixStudy · The Director (v3.73) — local question analyser.
 *
 * Replaces "count a few keywords" with an estimate of the number of REASONING STEPS the item demands, built from structure, not vocabulary:
 *   1 parse        stem / options / inline options / select-all / case-study formats
 *   2 data         named analytes with values (pH, PaCO2, Na, K, INR, MAP …) → distinct-analyte count and clinical PANELS (acid-base, anion gap …)
 *   3 calculation  dose / rate / formula detection and its complexity (weight-based, per-minute→per-hour, concentration, divided doses, named formulas)
 *   4 cognition    recall vs apply vs analyse: decision words, exam traps, multi-client priority, multi-part asks, select-all, sequences
 *   5 drugs        high-risk drugs and interactions
 *   6 topics       a hand-written knowledge base of topics that are intrinsically multi-step (acid-base, DKA, sepsis, burns, ECG, toxicity …)
 *   7 options      length, near-duplicate options (fine discrimination), combined/mixed/sequence options
 * → steps (sum, each family capped) → level (easy / medium / hard) + confidence + the signals that produced it (shown to the student).
 *
 * Safety floors: EASY only on positive evidence of a recall item; anything with a calculation or a clinical panel is at least medium; a low-confidence
 * borderline between medium and hard is rated hard (an under-powered answer is worse than a slower one).
 *
 * What it is NOT: it does not understand the question. It is a transparent, tunable estimator whose accuracy is MEASURED against labelled corpora
 * (scripts/difficulty-eval.mjs, tests/fixtures/difficulty-*.json); add your own labelled questions there to tune it to your exam.
 * Speed: one pass, pre-compiled patterns, ~0.1 ms per question.
 */
export const DIRECTOR_VERSION = "3.73.0";
const MAX_CHARS = 8000;
export const DIRECTOR_CONFIG = { easyMax: 1, mediumMax: 3, biasUpOnLowConfidence: true };

/* ── 1 · parse ── */
const OPT_LINE = /^\s*\(?([A-Ha-h]|\d{1,2})[.)]\s+(\S.*)$/;
function parse(text) {
  const lines = text.split("\n");
  const stemLines = [], options = [];
  for (const ln of lines) { const m = OPT_LINE.exec(ln); if (m && (options.length || /^[Aa1]$/.test(m[1]))) options.push(m[2].trim()); else if (!options.length || !m) stemLines.push(ln); }
  let stem = stemLines.join("\n").trim();
  if (options.length < 3) {                                           // inline options: "… ? A) x B) y C) z D) w"
    const inline = stem.split(/\s+(?=[A-H][.)]\s)/);
    if (inline.length >= 4 && /^[A-H][.)]\s/.test(inline[1])) { stem = inline[0]; inline.slice(1).forEach((o) => options.push(o.replace(/^[A-H][.)]\s+/, "").trim())); }
  }
  return { stem, options, selectAll: /\bselect all that apply\b|\bSATA\b|\bchoose all\b|اختر كل/i.test(text) };
}

/* ── 2 · data: analytes with values ── */
const ANALYTE = new Map(Object.entries({
  ph: "ph", paco2: "paco2", pco2: "paco2", pao2: "pao2", po2: "pao2", hco3: "hco3", bicarbonate: "hco3", bicarb: "hco3", na: "na", sodium: "na", k: "k", potassium: "k",
  cl: "cl", chloride: "cl", glucose: "glucose", bg: "glucose", bun: "bun", creatinine: "cr", cr: "cr", inr: "inr", aptt: "aptt", ptt: "aptt", pt: "pt", hgb: "hgb", hemoglobin: "hgb", hb: "hgb",
  hct: "hct", hematocrit: "hct", wbc: "wbc", platelets: "plt", platelet: "plt", plt: "plt", lactate: "lactate", troponin: "trop", spo2: "spo2", map: "map", bp: "bp", hr: "hr", rr: "rr",
  temp: "temp", temperature: "temp", gcs: "gcs", mg: "mg", magnesium: "mg", ca: "ca", calcium: "ca", ammonia: "nh3", bilirubin: "bili", alt: "alt", ast: "ast", albumin: "alb", ldh: "ldh",
  osmolality: "osm", osm: "osm", bnp: "bnp", crp: "crp", esr: "esr", fio2: "fio2", peep: "peep", sg: "sg", level: "level", trough: "level", salicylate: "sal", digoxin: "level", lithium: "level",
}));
const ANALYTE_RE = /\b(pH|PaCO2|PCO2|PaO2|PO2|HCO3|bicarbonate|bicarb|Na|sodium|K|potassium|Cl|chloride|glucose|BG|BUN|creatinine|Cr|INR|aPTT|PTT|PT|Hgb|hemoglobin|Hb|Hct|hematocrit|WBC|platelets?|PLT|lactate|troponin|SpO2|MAP|BP|HR|RR|temp(?:erature)?|GCS|Mg|magnesium|Ca|calcium|ammonia|bilirubin|ALT|AST|albumin|LDH|osmolality|BNP|CRP|ESR|FiO2|PEEP|salicylate|trough)\b[^\n\d]{0,18}?(-?\d+(?:[.,]\d+)?(?:\/\d+)?)/gi;
function analytes(stem) {
  const set = new Set();
  ANALYTE_RE.lastIndex = 0;
  let m;
  while ((m = ANALYTE_RE.exec(stem))) { const k = ANALYTE.get(m[1].toLowerCase()); if (k) set.add(k); }
  if (/\b\d{2,3}\/\d{2,3}\s*mm\s?Hg\b/i.test(stem)) set.add("bp");
  return set;
}

/* ── 3 · calculation ── */
const CALC_ASK = /\bcalculate\b|\bhow many (?:mL|ml|mg|mcg|units?|tablets?|capsules?|drops?|gtt)\b|\b(?:what|how many)[^.?\n]{0,40}\b(?:mL\/h(?:r|our)?|rate|drops? per minute|gtt\/min)\b|\bat what rate\b|\bhow much\b[^.?\n]{0,30}\b(?:should|will|to give)\b|\bset the pump\b|\bround to the nearest\b|\bhow many mL\b|احسب|كم مل/i;
const CALC_FEATURES = [
  [/\b(?:mcg|mg|units?|mEq|mL|g)\s*\/\s*kg\b|\bper kg\b/i, 1, "جرعة بالوزن"],
  [/\/\s*kg\s*\/\s*(?:min|h|hr|hour|day)\b|\bper kg per (?:min|hour|day)\b|\bmcg\/kg\/min\b/i, 1, "تحويل وحدات (وزن × زمن)"],
  [/\d[\d,.]*\s*(?:mg|mcg|units?|g|mEq)\s+(?:in|per|\/)\s+\d[\d,.]*\s*m[Ll]\b/, 1, "تركيز من كيس/محلول"],
  [/\b(?:divided|every\s+\d+\s+hours?|q\d+h|per dose|times a day|three times|twice daily|per feeding|each dose|\d+ feedings)\b/i, 1, "جرعات مقسّمة"],
  [/\b(?:Parkland|Holliday|Brooke|Cockcroft|Winter|anion gap|corrected calcium|PaO2\/FiO2|P\/F ratio|BSA|TBSA)\b/i, 1, "معادلة مسمّاة"],
  [/\b(?:titrat\w+|protocol|aPTT|per cent|%)\b[^.\n]{0,60}\b(?:decrease|increase|hold|reduce|adjust)\b|\b(?:decrease|increase|hold|reduce|adjust)\b[^.\n]{0,60}\b(?:rate|units\/kg|units\/hr)\b/i, 1, "تعديل بروتوكول"],
];
function calculation(text, stem) {
  if (!CALC_ASK.test(stem) && !/\bmL\/h(?:r|our)?\b|\bgtt\/min\b/i.test(stem)) {
    const named = /\b(?:Parkland|corrected calcium|PaO2\/FiO2|anion gap)\b/i.test(stem) && /\bcalculate|how many|what rate|mL/i.test(stem);
    if (!named) return { is: false, steps: 0, notes: [] };
  }
  let steps = 2; const notes = ["حساب"];
  for (const [re, w, label] of CALC_FEATURES) if (re.test(stem)) { steps += w; notes.push(label); }
  return { is: true, steps: Math.min(6, steps), notes };
}

/* ── 4 · cognition ── */
const RECALL = [
  /^(?:ما هو|ما هي|ما اسم|ما معنى|ما المدى|ماذا يعني|أي مما يلي (?:هو|هي) (?:المدى|المعدل|القيمة) الطبيع)/,
  /^(?:the nurse knows that )?(?:what|which)\b[^?\n]{0,90}\b(?:normal|term|name|called|abbreviation|stands? for|antidote|vitamin|hormone|organ|artery|vein|nerve|cranial nerve|largest|smallest|mean|means|definition|define|is the function|function of|nutrient|electrolyte|blood type)\b/i,
  /^(?:the nurse knows that |the nurse recalls that )?(?:the )?normal\b[^?\n]{0,60}\b(?:range|value|rate|temperature|level|pressure|ph)\b[^?\n]{0,30}\bis\b/i,
  /^which (?:term|vitamin|hormone|organ|blood type) (?:is|are|describes?|means?|causes?|controls?|produces?|provides?|contains?)\b/i,
  /^which of (?:the following|these) (?:is|are) (?:the )?(?:normal|term|name|largest|smallest|antidote|medical term|correct term|function|unit|structure)\b/i,
  /^how many\b(?!\s+(?:mL|ml|mg|mcg|units?|tablets?|drops?|gtt))[^?\n]{0,50}\b(?:are there|bones|nerves|chambers|lobes|pairs)\b/i,
  /^(?:the )?(?:antidote|medical term|term) (?:for|to|that describes?)\b/i,
  /^what does (?:the )?(?:abbreviation )?[A-Za-z]{2,6} (?:mean|stand for)\b/i,
  /^what is the (?:medical |antidote|term|antidote for|normal|function|largest|smallest|name)/i,
  /^what is the (?:basic |main |primary |functional |largest |smallest |other |common )*(?:unit|structure|part|layer|organ|gland|bone|muscle|nerve|hormone|vitamin|cell|type|name|term)\b/i,
  /^which (?:cranial nerve|vitamin|mineral|electrolyte|nutrient|hormone|organ|gland|enzyme)\b/i,
  /^(?:normal|the normal)\b[^?\n]{0,70}(?:is|are|closest to|approximately)\s*:?\s*$/im,
];
const PATIENT = /\b(?:client|patient|child|infant|neonate|newborn|toddler|baby|woman|man|boy|girl|resident|adolescent|mother|postpartum|post-?op(?:erative)?|admitted|presents?|presented|brought to|\d+[- ](?:year|month|week|day)s?[- ]old|aged? \d+)\b|مريض|مريضة/i;
const JUDGEMENT = /\b(?:delegat\w*|unlicensed|UAP|LPN|scope of practice|prioriti[sz]e|which (?:task|action|finding|intervention|response|client|assignment)|best response|therapeutic|informed consent|ethic\w*|precautions?|should the nurse|nurse (?:may|can|must|should))\b/i;
const DECISION = /\b(?:first|priority|initial(?:ly)?|immediately|immediate|best|most appropriate|most likely|next|anticipate|most urgent|requires? (?:immediate|action)|should the nurse (?:do|take|implement))\b/i;
const TRAP = /\b(?:EXCEPT|NOT|LEAST|FURTHER teaching|further teaching|needs? (?:further )?teaching|indicates? (?:the )?(?:need|teaching)|incorrect|contraindicated)\b/;
const MULTICLIENT = /\b(?:two|three|four|five|six|\d)\s+(?:clients|patients)\b|\bwhich client\b|\bwhich patient\b|\bcharge nurse\b|\bassign(?:ment)?\b/i;
const SEQUENCE = /\bwhich sequence\b|\bin what order\b|\bprioriti[sz]e the following\b|\border of (?:priority|importance)\b|\bsequence of orders\b/i;
const TWOASKS = /\b(?:and|,)\s+(?:which|what|how)\b[^?]{0,70}\?|\?\s*[^?]*\?|\btwo (?:actions|interventions|priorities|findings)\b|\bwhich two\b/i;
const TEACHING = /\b(?:teaching|instruct(?:ion)?s?|statement by the client|client (?:states?|says)|understands?)\b/i;

/* ── 5 · drugs ── */
const DRUG = /\b(?:warfarin|heparin|enoxaparin|insulin|digoxin|lithium|amiodarone|vancomycin|gentamicin|tobramycin|tacrolimus|cyclosporin\w*|phenytoin|theophylline|aminophylline|methotrexate|nitroprusside|dopamine|dobutamine|norepinephrine|epinephrine|vasopressin|magnesium sulfate|potassium chloride|propofol|morphine|fentanyl|oxytocin|chemotherapy|ciprofloxacin|fluconazole|clarithromycin|rifampin|furosemide|spironolactone|lisinopril|metformin|levothyroxine|prednisone|carbidopa|levodopa|pyridostigmine|acetaminophen|salicylate|aspirin)\b/gi;
const HIGH_RISK = new Set(["warfarin", "heparin", "enoxaparin", "insulin", "digoxin", "lithium", "amiodarone", "vancomycin", "gentamicin", "tobramycin", "tacrolimus", "phenytoin", "theophylline", "aminophylline", "methotrexate", "nitroprusside", "dopamine", "dobutamine", "norepinephrine", "epinephrine", "vasopressin", "magnesium sulfate", "potassium chloride", "propofol", "oxytocin", "chemotherapy"]);
const INTERACT = /\b(?:interaction|interacts?|started on|was started|has been started|added|also (?:receiving|taking)|concurrent(?:ly)?|new(?:ly)? (?:started|prescribed) \w+ therapy|new fluconazole)\b/i;

/* ── 6 · topics that are intrinsically multi-step (hand-written; extend freely) ── */
export const TOPICS = [
  ["acid-base", /\b(?:ABG|arterial blood gas|respiratory (?:acidosis|alkalosis)|metabolic (?:acidosis|alkalosis)|acid[- ]base|base excess|Winter|delta[- ]delta)\b/i, 2, "اتزان حمضي قاعدي"],
  ["anion-gap", /\banion gap\b/i, 2, "فجوة الأنيون"],
  ["dka-hhs", /\b(?:DKA|diabetic ketoacidosis|hyperosmolar hyperglycemic|HHS)\b/i, 2, "حماض كيتوني/HHS"],
  ["sepsis", /\b(?:sepsis|septic shock|qSOFA|SIRS|vasopressor|MAP goal)\b/i, 2, "إنتان/صدمة"],
  ["burns", /\b(?:Parkland|burns?\b[^.\n]{0,40}TBSA|% TBSA)\b/i, 1, "حروق"],
  ["ecg-acute", /\b(?:ST elevation|STEMI|NSTEMI|torsades|ventricular tachycardia|ventricular fibrillation|widened QRS)\b/i, 2, "تخطيط قلب حاد"],
  ["ecg-complex", /\b(?:AV block|Wenckebach|QTc|peaked T waves)\b/i, 1, "تخطيط قلب"],
  ["toxicity", /\b(?:toxicity|overdose|toxic level|poisoning|antidote)\b/i, 1, "سمّية/جرعة زائدة"],
  ["electrolyte-emerg", /\b(?:hyperkalemia|hypokalemia|hyponatremia|hypernatremia|hypercalcemia|hypocalcemia|hypomagnesemia|SIADH|diabetes insipidus)\b/i, 1, "اضطراب أملاح"],
  ["endocrine-crisis", /\b(?:adrenal crisis|Addison|Cushing|thyroid storm|myxedema|pheochromocytoma)\b/i, 2, "أزمة صماوية"],
  ["heme-onc", /\b(?:TTP|HUS|DIC|HIT|thrombotic microangiopathy|schistocytes|tumor lysis|neutropeni\w+|transfusion reaction)\b/i, 2, "دم/أورام معقّد"],
  ["transplant", /\b(?:transplant|tacrolimus|cyclosporin\w*|rejection|immunosuppress\w*)\b/i, 2, "زراعة/مثبطات مناعة"],
  ["liver-renal", /\b(?:cirrhosis|hepatic encephalopathy|hepatorenal|asterixis|ascites|spontaneous bacterial peritonitis|CKD|dialysis|uremic)\b/i, 1, "كبد/كلى"],
  ["ventilation", /\b(?:ARDS|PEEP|ventilator|PaO2\/FiO2|mechanical ventilation|FiO2)\b/i, 2, "تنفس صناعي"],
  ["hemodynamics", /\b(?:cardiac output|SVR|PAWP|pulmonary artery|cardiogenic shock|mottled|vasopressors?|norepinephrine)\b/i, 1, "ديناميكا دموية"],
  ["obstetric-emerg", /\b(?:preeclampsia|eclampsia|HELLP|magnesium sulfate|abruptio|placenta previa|prolapsed cord|shoulder dystocia|postpartum hemorrhage|late decelerations)\b/i, 1, "طوارئ توليد"],
  ["neuro-emerg", /\b(?:increased intracranial pressure|Cushing(?:'s)? (?:triad|reflex)|status epilepticus|stroke|hemiparesis|right-sided weakness|autonomic dysreflexia|myasthenic crisis|cholinergic crisis)\b/i, 1, "طوارئ أعصاب"],
  ["neonatal", /\b(?:bilirubin|phototherapy|neonat\w+|APGAR)\b/i, 1, "حديثي الولادة"],
  ["antithrombotic", /\b(?:aPTT|heparin (?:drip|infusion|protocol)|INR\b[^.\n]{0,20}\d|anticoagulat\w+)\b/i, 1, "مضادات تخثر"],
  ["hypertonic-saline", /\b(?:3\s?%\s*(?:sodium chloride|saline|NaCl)|hypertonic saline|osmotic demyelination|overcorrect\w*|correction (?:limit|rate))\b/i, 2, "تصحيح الصوديوم / محلول مركّز"],
  ["interaction-tox", /\b(?:theophylline|digoxin|lithium|phenytoin|warfarin)\b[^.\n]{0,120}\b(?:ciprofloxacin|amiodarone|fluconazole|clarithromycin|rifampin|NSAID|furosemide|started)\b/i, 2, "تفاعل دوائي"],
];

/* ── 7 · options ── */
const wordsOf = (s) => (s.toLowerCase().match(/[a-z\u0600-\u06ff]{3,}/g) || []);
function optionFeatures(options) {
  const out = { avgWords: 0, longest: 0, similar: false, combined: 0, seq: false };
  if (options.length < 2) return out;
  const sets = options.map((o) => new Set(wordsOf(o)));
  out.avgWords = options.reduce((n, o) => n + (o.match(/\S+/g) || []).length, 0) / options.length;
  out.longest = Math.max(...options.map((o) => (o.match(/\S+/g) || []).length));
  let sum = 0, n = 0;
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { const a = sets[i], b = sets[j]; if (!a.size || !b.size) continue; let inter = 0; a.forEach((x) => { if (b.has(x)) inter++; }); sum += inter / (a.size + b.size - inter); n++; }
  out.similar = n > 0 && sum / n >= 0.45 && out.avgWords >= 5;
  const j = options.join(" | ");
  out.combined = (j.match(/\b(?:mixed|concurrent|combined|appropriate (?:respiratory )?compensation|uncompensated|partially compensated|co-?existing|superimposed)\b/gi) || []).length;
  out.seq = /,\s*then\b|\bfollowed by\b|;\s*(?:then\s+)?\w/i.test(j) && /\bthen\b|\bfollowed by\b/i.test(j);
  return out;
}


/* ── 8 · CONCEPT MODEL (v3.74): pure-theory items ──
   A theory question has no numbers, no drug and no patient, so none of the families above can see its difficulty. What it has is LANGUAGE that
   encodes the cognitive operation (Bloom / Graesser question types): why/how-does → causal reasoning; differentiate/compare → discrimination;
   "and why" → a second reasoning chain; "would be expected / what would happen if" → prediction; relation words and mechanism vocabulary → how many
   concepts must be held and linked; long explanatory options → every option is a multi-claim statement to evaluate. All of it is read from the text.
   Measured separately on theory-only corpora (tests/fixtures/difficulty-theory-*.json). */
const Q_CAUSAL = /\b(?:why|how (?:does|do|can|might|would|is|are)|explain(?:s|ed)? (?:why|how)|what (?:causes|accounts for|explains|is the mechanism|is the rationale)|(?:the )?mechanism (?:of|by which|behind|for|underlying|responsible)|best explains?|which explanation|most consistent|most likely explanation|best accounts? for|accounts? for|underlying (?:cause|mechanism|defect|basis)|pathophysiolog\w*|rationale|physiological basis|basis of)\b/i;
const Q_SECOND = /\b(?:and|but|yet|while)\s+(?:why|how)\b|,\s*(?:and|but)\s+(?:why|how)\b|\bwhy\b[^?\n]{12,160}\b(?:and|but|yet|while)\b[^?\n]{0,40}\b(?:why|how|which|what)\b|\band explain (?:why|how)\b/i;
const Q_COMPARE = /\b(?:differentiate|distinguish(?:es)?|compare|contrast|difference(?:s)? between|differs? from|differ(?:s|ence)? in|what distinguishes|similarit\w+)\b/i;
const Q_PREDICT = /\b(?:would be expected|what would happen|is expected to|predict\w*|if (?:the|a|an)\b[^?\n]{3,90}\b(?:would|were|is blocked|is inhibited|fails?|falls?|rises?|increases?|decreases?|loses?|lacks?|is (?:absent|missing|deficient|removed|mutated)|stops?|cannot)\b|(?:mutation|deficiency|loss|absence|blockade|knockout|defect) (?:of|in|prevents?|impairs?|blocks?)\b[^?\n]{3,90}\b(?:which|what|how)\b|which combination of|would you expect)\b/i;
const Q_EVAL = /\bwhich (?:statement|explanation|description|example|answer|response)\b[^?\n]{0,70}\b(?:best|correctly|accurately|true|correct|most consistent|most likely)\b|\b(?:best|most accurately) (?:illustrates?|exemplif\w+|demonstrates?|describes?|explains?)\b|\bis an example of\b|\bwhich of the following (?:is|are) (?:a )?(?:true|correct|false|incorrect) statements?\b/i;
const Q_ROLE = /\b(?:what is the (?:main |primary |major )?(?:role|purpose|importance|significance)\b|(?:role|purpose|importance|significance) of)\b/i;
const Q_MULTIAXIS = /\b(?:in terms of|based on|using|with respect to|on the basis of)\b[^?\n]{8,140}(?:,|\band\b)[^?\n]{3,}/i;
const Q_CONTRAST = /\b(?:while|whereas|yet|although|even though|paradox\w*|coexist\w*|still produce|nonetheless|nevertheless|at the same time|but (?:can|may|could|also)|both\b[^?\n]{3,60}\band\b)\b/i;
const Q_CONDITION = /\b(?:only (?:after|when|if|once|in)|but not|yet not|without (?:changing|affecting|impairing)|even (?:when|though|if)|at rest but|rather than|instead of|despite)\b/i;
const Q_NEGEVAL = /\b(?:does not explain|do not explain|is false|are false|is incorrect|all of the following except|which of the following is not)\b/i;
const REL = /\b(?:because|due to|leads? to|results? in|resulting in|causes?|causing|caused by|inhibit\w*|activat\w*|increas\w*|decreas\w*|reduc\w*|impair\w*|stimulat\w*|block\w*|compensat\w*|despite|whereas|although|while|yet|however|unless|only when|even when|even though|which in turn|thereby|so that|therefore|resulting|accumulat\w*|amplif\w*|attenuat\w*|overcome\w*|shift\w*)\b/gi;
const JARGON_MORPH = /\b[a-z]*(?:emia|aemia|itis|osis|pathy|penia|plasia|uria|ectomy|algia|trophy|cytosis|lysis|genesis|megaly|oxia|capnia|stenosis|sclerosis|ischemia|infarct[a-z]*|hypertrophy|natremia|kalemia|calcemia|albuminemia|proteinemia|glycemia|tension|volemia|thrombo[a-z]+|erythro[a-z]+|leuko[a-z]+|nephr[a-z]+|hepat[a-z]+|cardi[a-z]+|pulmon[a-z]+|neur[a-z]+|myo[a-z]+|angio[a-z]+|immun[a-z]+|endocrin[a-z]+)\b/gi;
const MECH_LEX = new Set(("antagonist agonist receptor cotransporter transporter cascade feedback gradient conduction saltatory oncotic hydrostatic osmolality osmolarity afterload preload contractility compliance autoregulation homeostasis permeability affinity clearance bioavailability prevalence specificity sensitivity predictive value null alpha beta saturation shunt dead space diffusion perfusion ventilation chemoreceptor baroreceptor aldosterone angiotensin renin bradykinin histamine complement immunoglobulin cytokine hypersensitivity myelin axon synapse synaptic channel phospholipid antibody antigen coagulation fibrin thrombin platelet hepatocyte nephron tubule glomerulus glomerular medullary medulla cortex parenchyma endothelium epithelium ligand kinase enzyme substrate cofactor inhibitor hormone feedback upregulation downregulation redundancy pathway signalling signaling adhesion leukocyte monocyte macrophage lymphocyte mast degranulation hemoglobin oxyhemoglobin carboxyhemoglobin extraction shunting capacitance resistance conductance potential depolarization repolarization threshold refractory sodium potassium calcium bicarbonate buffer chemoreceptor hypercapnia hypoxemia vasodilation vasoconstriction vasopressin natriuretic ejection fraction stroke volume cardiac output venous return end-systolic end-diastolic frank-starling bohr haldane fick oxygen consumption arteriovenous isosthenuria osmotic countercurrent reabsorption secretion filtration oxidative metabolism glycolysis gluconeogenesis glycogen ketone lipolysis proteolysis catabolism anabolism apoptosis necrosis fibrosis remodeling hypertrophy atrophy hyperplasia dysplasia metaplasia neoplasia efflux pump multidrug resistance plasmid mutation transporter lipophilic hydrophilic distribution elimination clearance half-life sequestration tissue-binding unbound protein-bound intrinsic extrinsic parenteral absorption ileum malabsorption hyperinsulinemia insulin-resistance lipolysis ketogenesis ketosis autoregulation arteriolar vasomotor myogenic baroreflex vmax km michaelis noncompetitive competitive uncompetitive inhibitor allosteric").split(/\s+/));
const SYSTEMS = [/\b(?:heart|cardiac|ventricul\w*|atri\w*|myocard\w*|cardiovascular|vascular|afterload|preload|stroke volume)\b/i, /\b(?:kidney|renal|nephron|tubul\w*|glomerul\w*|urine|urinary|diuretic)\b/i, /\b(?:lung|alveol\w*|pulmonary|respirat\w*|ventilat\w*|airway|hypercapnia|hypoxemia|oxygen)\b/i, /\b(?:liver|hepat\w*|bile|cirrhosis)\b/i, /\b(?:brain|neuro\w*|axon|myelin|synap\w*|nerve|cerebr\w*)\b/i, /\b(?:immun\w*|antibod\w*|lymph\w*|hypersensitivity|cytokine|complement|leukocyte|mast)\b/i, /\b(?:coagulat\w*|clotting|platelet\w*|fibrin\w*|thromb\w*|bleeding|hemoglobin|erythro\w*)\b/i, /\b(?:hormone|endocrin\w*|insulin|thyroid|parathyroid|cortisol|aldosterone|pituitary|adrenal)\b/i, /\b(?:intestin\w*|gastric|stomach|digest\w*|bowel|colon)\b/i, /\b(?:muscle|skeletal|bone|joint|cartilage)\b/i];
const SUBORD = /\b(?:while|whereas|although|though|because|since|unless|which|that|when|if)\b/gi;

export function conceptModel(stem, options) {
  const out = [];
  const add = (id, steps, label) => out.push({ cat: "concept", id, steps, label });
  const opt = options.join(" \n ");
  const all = `${stem}\n${opt}`;
  const sw = (stem.match(/\S+/g) || []).length;
  const causal = Q_CAUSAL.test(stem), second = Q_SECOND.test(stem), compare = Q_COMPARE.test(stem), predict = Q_PREDICT.test(stem), evalq = Q_EVAL.test(stem), negEval = Q_NEGEVAL.test(all);
  if (causal) add("causal", 1, "سؤال سببي (لماذا/كيف/آلية)");
  if (second) add("second-chain", 1, "سلسلة تفسير ثانية (…ولماذا)");
  if (compare) add("compare", 1, "تمييز/مقارنة بين مفهومين");
  if (predict) add("predict", 1, "تنبّؤ بالنتيجة");
  if (negEval || (evalq && !causal && !compare && !predict)) add("evaluate", 1, "تقييم عبارات الاختيارات");
  if (negEval && causal) add("neg-causal", 1, "نفي تفسير (كل اختيار يُقاس بآلية)");
  if (Q_CONDITION.test(stem)) add("condition", 1, "شرط/عتبة/استثناء في السؤال");
  if (Q_ROLE.test(stem)) add("role", 1, "دور/غرض آلية (فهم)");
  if (Q_MULTIAXIS.test(stem)) add("multi-axis", 1, "مقارنة على أكثر من محور");
  /* MULTI-OPERATION: two different reasoning operations in one item (a cause AND a condition, a prediction AND a second ask …) is a chain, not a single step */
  const contrast = Q_CONTRAST.test(stem);
  if (contrast && (causal || compare || predict)) add("contrast", 1, "تفسير أمرين يبدوان متعارضين");
  const ops = [causal, second, compare, predict, contrast && (causal || compare || predict), Q_CONDITION.test(stem), Q_MULTIAXIS.test(stem), TWOASKS.test(stem)].filter(Boolean).length;
  if (ops >= 2) add("multi-operation", 1, "أكثر من عملية استدلال في سؤال واحد");
  /* UNDERSTANDING FLOOR: why / how-does / compare / predict / role-of ask for comprehension, never plain recall */
  if (causal || compare || predict || evalq || Q_ROLE.test(stem)) add("understanding", 1, "فهم لا حفظ");
  /* relations: how many cause-effect links the text asks the student to hold */
  const rel = ((all.match(REL) || []).length);
  if (rel >= 8) add("relations", 2, `شبكة علاقات سببية (${rel})`); else if (rel >= 4) add("relations", 1, `علاقات سببية (${rel})`);
  /* concepts: distinct mechanism / pathophysiology terms */
  const concepts = new Set();
  for (const w of (all.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])) if (MECH_LEX.has(w)) concepts.add(w);
  const morph = new Set((all.match(JARGON_MORPH) || []).map((x) => x.toLowerCase()));
  morph.forEach((m) => concepts.add(m));
  const nc = concepts.size;
  if (nc >= 11) add("concepts", 2, `${nc} مفهومًا مترابطًا`); else if (nc >= 6) add("concepts", 1, `${nc} مفاهيم مترابطة`);
  /* integration across body systems */
  const sysStem = SYSTEMS.filter((re) => re.test(stem)).length, sysAll = SYSTEMS.filter((re) => re.test(all)).length;     // distractor options name organs too: the stem decides
  if (sysStem >= 3) add("systems", 2, `تكامل ${sysStem} أجهزة في السؤال`); else if (sysStem === 2 || sysAll >= 5) add("systems", 1, "تكامل أجهزة");
  /* syntax: a long, multi-clause stem is several questions in one */
  const sub = (stem.match(SUBORD) || []).length, commas = (stem.match(/[,;]/g) || []).length;
  if (sw >= 28 && (sub >= 3 || commas >= 3)) add("syntax", 1, "جملة السؤال مركّبة");
  /* options: every option a full explanatory statement */
  if (options.length >= 3) {
    const lens = options.map((o) => (o.match(/\S+/g) || []).length);
    const avg = lens.reduce((n, x) => n + x, 0) / options.length, longest = Math.max(...lens);
    if (avg >= 14) add("explanatory-options", 2, "اختيارات شارحة طويلة (عبارات متعددة الادعاءات)"); else if (avg >= 10 || longest >= 18) add("explanatory-options", 1, "اختيارات جُمل");
    const semi = options.filter((o) => /;|\bwhile\b|\bwhereas\b|\bbecause\b|\bso that\b/i.test(o)).length;
    if (semi >= 2) add("compound-options", 1, "اختيارات مركّبة بعلل");
  }
  return out;
}

const LV = ["easy", "medium", "hard"];
const RANK = { easy: 0, medium: 1, hard: 2 };

/* ── the Director ── */
export function assessQuestion(raw, { optionsCount } = {}) {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const text = String(raw || "").slice(0, MAX_CHARS);
  const { stem, options, selectAll } = parse(text);
  const sig = [];                                        // {id, steps, label, cat}
  const add = (cat, id, steps, label) => { if (steps) sig.push({ cat, id, steps, label }); };
  const words = (stem.match(/\S+/g) || []).length;
  const nOpts = Math.max(options.length, optionsCount || 0);

  const an = analytes(stem);
  const calc = calculation(text, stem);
  const patient = PATIENT.test(stem);
  const recall = RECALL.some((re) => re.test(stem.trim()));
  const drugsAll = (stem.match(DRUG) || []).map((x) => x.toLowerCase());
  const drugs = new Set(drugsAll), highRisk = [...drugs].filter((d) => HIGH_RISK.has(d));

  /* data */
  const abg = an.has("ph") && (an.has("paco2") || an.has("hco3") || an.has("pao2"));
  if (abg) { add("data", "abg-panel", 2, "غازات دم بقيم"); if (an.has("na") && an.has("cl") && an.has("hco3")) add("data", "ag-possible", 2, "فجوة أنيون ممكنة (Na/Cl/HCO3)"); if (/\b(?:compensat|mixed|concurrent|Winter|delta|respiratory and|metabolic and)\w*/i.test(text)) add("data", "ab-mixed", 1, "تعويض/اضطراب مختلط"); }
  const nAn = an.size - (abg ? Math.min(3, an.size) : 0);                       // the panel itself is already counted
  if (nAn >= 6) add("data", "many-analytes", 2, `${an.size} تحاليل/علامات`); else if (nAn >= 3) add("data", "several-analytes", 1, `${an.size} تحاليل/علامات`);

  /* calculation */
  if (calc.is) add("calc", "calc", calc.steps, calc.notes.join(" + "));

  /* cognition */
  const judgement = JUDGEMENT.test(stem) && !recall;
  if (patient) add("cog", "patient", 1, "حالة مريض (تطبيق)");
  else if (judgement) add("cog", "judgement", 1, "حكم تمريضي/إداري (تفويض/أولوية/إجراء)");
  if (patient && DECISION.test(stem)) add("cog", "decision", 1, "قرار/أولوية");
  if (TRAP.test(text)) add("cog", "trap", 1, "صيغة فخ (NOT/EXCEPT/تعليم)");
  if (selectAll) add("cog", "select-all", 2, "اختيار متعدد");
  if (/\b(?:case study|bowtie|bow-tie|matrix|drag and drop|highlight|exhibit|NGN)\b/i.test(text)) add("cog", "ngn", 2, "صيغة NGN/حالة");
  if (MULTICLIENT.test(stem) && DECISION.test(stem)) add("cog", "multi-client", 1, "أولوية بين عدة مرضى");
  if (SEQUENCE.test(text)) add("cog", "sequence", 1, "ترتيب خطوات");
  if (TWOASKS.test(stem)) add("cog", "two-asks", 1, "سؤالان في سؤال");
  if (words > 200) add("cog", "long-stem", 2, "حالة طويلة"); else if (words > 110) add("cog", "long-stem", 1, "حالة مطوّلة");

  /* drugs */
  if (highRisk.length >= 2 || (drugs.size >= 2 && INTERACT.test(stem))) add("drug", "interaction", 2, "تفاعل أدوية");
  else if (highRisk.length === 1 && (patient || calc.is)) add("drug", "high-risk-drug", 1, `دواء عالي الخطورة (${highRisk[0]})`);

  /* topics (each counted once, total capped at 4) */
  let topicSteps = 0; const topicHits = [];
  for (const [id, re, w, label] of TOPICS) if (re.test(stem)) { if (topicSteps < 4) { const take = Math.min(w, 4 - topicSteps); topicSteps += take; topicHits.push({ id, take, label }); } }
  topicHits.forEach((h) => add("topic", h.id, h.take, h.label));

  /* options */
  const of = optionFeatures(options);
  if (of.similar) add("opt", "similar-options", 1, "اختيارات متقاربة (تمييز دقيق)");
  if (of.combined >= 2) add("opt", "combined-options", 2, "اختيارات مركّبة/مختلطة"); else if (of.combined === 1) add("opt", "combined-options", 1, "اختيار مركّب");
  if (of.seq) add("opt", "sequence-options", 1, "اختيارات متسلسلة");

  /* concept model (pure theory and mechanism questions) */
  const cm = conceptModel(stem, options);
  cm.forEach((c) => sig.push(c));

  /* total: each family capped so one noisy family cannot decide alone */
  const CAP = { data: 5, calc: 6, cog: 5, drug: 2, topic: 4, opt: 3, concept: 5 };
  const byCat = {};
  for (const s of sig) byCat[s.cat] = (byCat[s.cat] || 0) + s.steps;
  let steps = 0;
  for (const [c, v] of Object.entries(byCat)) steps += Math.min(v, CAP[c] || v);

  /* recall evidence: a recall pattern with nothing else is steps 0 */
  /* a recall pattern about a drug or a toxicity ("the antidote for X is") is still recall when there is no patient, no data and no calculation */
  const OPS = new Set(["causal", "compare", "predict", "evaluate", "role", "condition", "contrast", "second-chain", "multi-axis"]);
  const opCue = cm.some((c) => OPS.has(c.id));
  const recallOnly = recall && !calc.is && !abg && !patient && !TRAP.test(text) && nAn < 3 && !opCue;
  if (recallOnly) steps = 0;

  let level = steps <= DIRECTOR_CONFIG.easyMax ? "easy" : steps <= DIRECTOR_CONFIG.mediumMax ? "medium" : "hard";
  const floors = [];
  /* EASY needs positive evidence: a recall pattern, or no patient / no data / no calculation / no trap and a short stem */
  /* text that is mostly Arabic is only provably easy through a recall pattern: the English signal patterns cannot see inside it */
  const arabicShare = ((stem.match(/[\u0600-\u06ff]/g) || []).length) / Math.max(1, stem.replace(/\s/g, "").length);
  const positiveEasy = recallOnly || (steps <= 1 && !patient && !judgement && nAn < 2 && !calc.is && words <= 40 && arabicShare < 0.3 && !(options.length >= 3 && (of.avgWords > 8 || of.longest > 14)));
  if (level === "easy" && !positiveEasy) { level = "medium"; floors.push("easy-needs-evidence"); }
  if (calc.is && RANK[level] < 1) { level = "medium"; floors.push("calculation"); }
  if (abg && RANK[level] < 1) { level = "medium"; floors.push("acid-base-panel"); }

  /* confidence: distance to the nearest boundary (boundaries sit at easyMax+.5 and mediumMax+.5) */
  const m1 = Math.abs(steps - (DIRECTOR_CONFIG.easyMax + 0.5)), m2 = Math.abs(steps - (DIRECTOR_CONFIG.mediumMax + 0.5));
  const margin = Math.min(m1, m2);
  let confidence = recallOnly || steps >= DIRECTOR_CONFIG.mediumMax + 3 ? "high" : margin >= 1.5 ? "high" : margin >= 0.5 ? "medium" : "low";
  if (DIRECTOR_CONFIG.biasUpOnLowConfidence && level === "medium" && steps === DIRECTOR_CONFIG.mediumMax && confidence !== "high" && (calc.is || abg || topicSteps >= 2)) { level = "hard"; floors.push("borderline-medium-hard→hard"); }

  const top = [...sig].sort((a, b) => b.steps - a.steps).slice(0, 4).map((s) => s.label);
  const type = calc.is ? "calculation" : abg || an.size >= 4 ? "interpretation" : MULTICLIENT.test(stem) && DECISION.test(stem) ? "prioritization" : selectAll ? "select-all" : recallOnly ? "recall" : TEACHING.test(stem) ? "teaching" : patient ? "clinical-judgement" : "knowledge";
  return {
    level, steps, confidence, type, calc: calc.is, signals: sig, floors, reasons: top.length ? top : [recallOnly ? "سؤال حفظ مباشر" : "لا توجد إشارات صعوبة"],
    features: { words, options: nOpts, analytes: an.size, patient, recall: recallOnly, highRisk },
    ms: typeof performance !== "undefined" ? +(performance.now() - t0).toFixed(3) : 0,
  };
}
