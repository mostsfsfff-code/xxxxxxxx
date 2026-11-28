/* ───────────── v3.84 · nursing glossary (abbreviation → exact Arabic rendering) ─────────────
   Purpose: stop literal / wrong translations of abbreviations (e.g. aPTT). Only the entries that appear in the question are put in the request (at most
   MAX_HITS, about 50 tokens), so the glossary costs no extra request and almost no tokens.
   Status: a REVIEWED-BY-NOBODY starter set. Every entry needs a clinical reviewer before it is trusted; `bad` lists the literal / wrong renderings that were really
   seen in model output (filled from observed errors only: while it is empty nothing is replaced and nothing is flagged). Add entries by appending rows below. */

const ROWS = [
[
"QD",
"once daily",
"مرة واحدة يوميًا"
],
[
"BID",
"twice daily",
"مرتين يوميًا"
],
[
"TID",
"three times daily",
"ثلاث مرات يوميًا"
],
[
"QID",
"four times daily",
"أربع مرات يوميًا"
],
[
"Q4H",
"every 4 hours",
"كل 4 ساعات"
],
[
"Q6H",
"every 6 hours",
"كل 6 ساعات"
],
[
"Q8H",
"every 8 hours",
"كل 8 ساعات"
],
[
"Q12H",
"every 12 hours",
"كل 12 ساعة"
],
[
"QHS",
"at bedtime",
"عند النوم"
],
[
"PRN",
"as needed",
"عند الحاجة"
],
[
"STAT",
"immediately",
"فورًا"
],
[
"AC",
"before meals",
"قبل الوجبات"
],
[
"PC",
"after meals",
"بعد الوجبات"
],
[
"NPO",
"nothing by mouth",
"الامتناع عن الطعام والشراب"
],
[
"PO",
"by mouth",
"عن طريق الفم"
],
[
"IV",
"intravenous",
"وريدي"
],
[
"IM",
"intramuscular",
"عضلي"
],
[
"SC",
"subcutaneous",
"تحت الجلد"
],
[
"SQ",
"subcutaneous",
"تحت الجلد"
],
[
"SL",
"sublingual",
"تحت اللسان"
],
[
"PR",
"per rectum",
"عن طريق الشرج"
],
[
"IVP",
"IV push",
"حقن وريدي مباشر"
],
[
"IVPB",
"IV piggyback",
"وريدي ثانوي (متصل بخط رئيسي)"
],
[
"KVO",
"keep vein open",
"إبقاء الوريد مفتوحًا بمعدل بطيء"
],
[
"gtt",
"drops",
"قطرات"
],
[
"NG",
"nasogastric",
"أنفي معدي"
],
[
"OG",
"orogastric",
"فموي معدي"
],
[
"NGT",
"nasogastric tube",
"أنبوب أنفي معدي"
],
[
"Foley",
"indwelling urinary catheter",
"قسطرة بولية مقيمة"
],
[
"I&O",
"intake and output",
"السوائل الداخلة والخارجة"
],
[
"HR",
"heart rate",
"معدل ضربات القلب"
],
[
"RR",
"respiratory rate",
"معدل التنفس"
],
[
"BP",
"blood pressure",
"ضغط الدم"
],
[
"SpO2",
"oxygen saturation",
"تشبّع الأكسجين في الدم"
],
[
"MAP",
"mean arterial pressure",
"متوسط الضغط الشرياني"
],
[
"CVP",
"central venous pressure",
"الضغط الوريدي المركزي"
],
[
"CPP",
"cerebral perfusion pressure",
"ضغط التروية الدماغي"
],
[
"ICP",
"intracranial pressure",
"الضغط داخل الجمجمة"
],
[
"GCS",
"Glasgow Coma Scale",
"مقياس غلاسكو للغيبوبة"
],
[
"JVD",
"jugular venous distention",
"انتفاخ الوريد الوداجي"
],
[
"PERRLA",
"pupils equal, round, reactive to light and accommodation",
"الحدقتان متساويتان ومستديرتان وتتفاعلان للضوء والتكيّف"
],
[
"ROM",
"range of motion",
"مدى الحركة"
],
[
"LOC",
"level of consciousness",
"مستوى الوعي"
],
[
"ADL",
"activities of daily living",
"أنشطة الحياة اليومية"
],
[
"CPR",
"cardiopulmonary resuscitation",
"الإنعاش القلبي الرئوي"
],
[
"DNR",
"do not resuscitate",
"عدم الإنعاش"
],
[
"aPTT",
"activated partial thromboplastin time",
"زمن الثرومبوبلاستين الجزئي المنشَّط"
],
[
"PTT",
"partial thromboplastin time",
"زمن الثرومبوبلاستين الجزئي"
],
[
"PT",
"prothrombin time",
"زمن البروثرومبين"
],
[
"INR",
"international normalized ratio",
"النسبة المعيارية الدولية"
],
[
"CBC",
"complete blood count",
"تعداد الدم الكامل"
],
[
"WBC",
"white blood cells",
"كريات الدم البيضاء"
],
[
"RBC",
"red blood cells",
"كريات الدم الحمراء"
],
[
"Hgb",
"hemoglobin",
"الهيموغلوبين"
],
[
"Hct",
"hematocrit",
"الهيماتوكريت (نسبة حجم الكريات الحمراء)"
],
[
"PLT",
"platelets",
"الصفائح الدموية"
],
[
"BUN",
"blood urea nitrogen",
"نيتروجين اليوريا في الدم"
],
[
"GFR",
"glomerular filtration rate",
"معدل الترشيح الكبيبي"
],
[
"eGFR",
"estimated glomerular filtration rate",
"معدل الترشيح الكبيبي المقدَّر"
],
[
"ABG",
"arterial blood gas",
"غازات الدم الشرياني"
],
[
"PaO2",
"arterial partial pressure of oxygen",
"الضغط الجزئي للأكسجين في الدم الشرياني"
],
[
"PaCO2",
"arterial partial pressure of carbon dioxide",
"الضغط الجزئي لثاني أكسيد الكربون في الدم الشرياني"
],
[
"ESR",
"erythrocyte sedimentation rate",
"معدل ترسيب كريات الدم الحمراء"
],
[
"CRP",
"C-reactive protein",
"البروتين التفاعلي سي"
],
[
"BNP",
"B-type natriuretic peptide",
"الببتيد الأذيني المدرّ للصوديوم من النوع B"
],
[
"HbA1c",
"glycated hemoglobin",
"الهيموغلوبين السكري"
],
[
"FBS",
"fasting blood sugar",
"سكر الدم الصائم"
],
[
"LFTs",
"liver function tests",
"وظائف الكبد"
],
[
"RFTs",
"renal function tests",
"وظائف الكلى"
],
[
"TSH",
"thyroid-stimulating hormone",
"الهرمون المحفّز للغدة الدرقية"
],
[
"CK-MB",
"creatine kinase MB isoenzyme",
"إنزيم الكرياتين كيناز MB"
],
[
"ALT",
"alanine aminotransferase",
"ناقلة أمين الألانين"
],
[
"AST",
"aspartate aminotransferase",
"ناقلة أمين الأسبارتات"
],
[
"LDH",
"lactate dehydrogenase",
"نازعة هيدروجين اللاكتات"
],
[
"UA",
"urinalysis",
"تحليل البول"
],
[
"C&S",
"culture and sensitivity",
"المزرعة واختبار الحساسية"
],
[
"MI",
"myocardial infarction",
"احتشاء عضلة القلب"
],
[
"ACS",
"acute coronary syndrome",
"المتلازمة التاجية الحادة"
],
[
"CHF",
"congestive heart failure",
"قصور القلب الاحتقاني"
],
[
"COPD",
"chronic obstructive pulmonary disease",
"مرض الانسداد الرئوي المزمن"
],
[
"ARDS",
"acute respiratory distress syndrome",
"متلازمة الضائقة التنفسية الحادة"
],
[
"DVT",
"deep vein thrombosis",
"تجلّط الأوردة العميقة"
],
[
"PE",
"pulmonary embolism",
"الانصمام (الصمّة) الرئوي"
],
[
"CVA",
"cerebrovascular accident",
"السكتة الدماغية"
],
[
"TIA",
"transient ischemic attack",
"نوبة نقص تروية عابرة"
],
[
"DKA",
"diabetic ketoacidosis",
"الحماض الكيتوني السكري"
],
[
"HHS",
"hyperosmolar hyperglycemic state",
"الحالة السكرية فرط الأسمولية"
],
[
"UTI",
"urinary tract infection",
"التهاب المسالك البولية"
],
[
"AKI",
"acute kidney injury",
"إصابة الكلى الحادة"
],
[
"CKD",
"chronic kidney disease",
"مرض الكلى المزمن"
],
[
"GERD",
"gastroesophageal reflux disease",
"مرض الارتجاع المعدي المريئي"
],
[
"HTN",
"hypertension",
"ارتفاع ضغط الدم"
],
[
"CAD",
"coronary artery disease",
"مرض الشريان التاجي"
],
[
"AF",
"atrial fibrillation",
"الرجفان الأذيني"
],
[
"VF",
"ventricular fibrillation",
"الرجفان البطيني"
],
[
"VT",
"ventricular tachycardia",
"عدم انتظام القلب البطيني السريع"
],
[
"SVT",
"supraventricular tachycardia",
"عدم انتظام القلب فوق البطيني السريع"
],
[
"TB",
"tuberculosis",
"السل"
],
[
"MRSA",
"methicillin-resistant Staphylococcus aureus",
"المكورات العنقودية الذهبية المقاومة للميثيسيلين"
],
[
"SIADH",
"syndrome of inappropriate antidiuretic hormone secretion",
"متلازمة إفراز الهرمون المضاد لإدرار البول غير الملائم"
],
[
"DM",
"diabetes mellitus",
"داء السكري"
],
[
"ECG",
"electrocardiogram",
"مخطط كهربية القلب"
],
[
"EKG",
"electrocardiogram",
"مخطط كهربية القلب"
],
[
"CT",
"computed tomography",
"التصوير المقطعي المحوسب"
],
[
"MRI",
"magnetic resonance imaging",
"التصوير بالرنين المغناطيسي"
],
[
"TPN",
"total parenteral nutrition",
"التغذية الوريدية الكاملة"
],
[
"PICC",
"peripherally inserted central catheter",
"قسطرة مركزية تُدخل عبر وريد طرفي"
],
[
"CVC",
"central venous catheter",
"قسطرة وريدية مركزية"
],
[
"PCA",
"patient-controlled analgesia",
"التسكين المتحكَّم فيه من المريض"
],
[
"BiPAP",
"bilevel positive airway pressure",
"ضغط مجرى الهواء الموجب ثنائي المستوى"
],
[
"CPAP",
"continuous positive airway pressure",
"ضغط مجرى الهواء الموجب المستمر"
],
[
"ETT",
"endotracheal tube",
"أنبوب الرغامى (القصبة الهوائية)"
],
[
"NRB",
"non-rebreather mask",
"قناع عدم إعادة التنفس"
],
[
"ICU",
"intensive care unit",
"وحدة العناية المركزة"
],
[
"ED",
"emergency department",
"قسم الطوارئ"
],
[
"PACU",
"post-anesthesia care unit",
"وحدة الإفاقة بعد التخدير"
],
[
"NSAIDs",
"nonsteroidal anti-inflammatory drugs",
"مضادات الالتهاب غير الستيرويدية"
],
[
"ACE inhibitor",
"angiotensin-converting enzyme inhibitor",
"مثبّط الإنزيم المحوّل للأنجيوتنسين"
],
[
"ARB",
"angiotensin II receptor blocker",
"حاصر مستقبلات الأنجيوتنسين"
],
[
"SSRI",
"selective serotonin reuptake inhibitor",
"مثبّط انتقائي لاسترداد السيروتونين"
],
[
"MAOI",
"monoamine oxidase inhibitor",
"مثبّط أوكسيداز أحادي الأمين"
],
[
"PPI",
"proton pump inhibitor",
"مثبّط مضخة البروتون"
],
[
"LMWH",
"low-molecular-weight heparin",
"الهيبارين منخفض الوزن الجزيئي"
],
[
"UFH",
"unfractionated heparin",
"الهيبارين غير المجزَّأ"
],
[
"tPA",
"tissue plasminogen activator",
"منشّط البلازمينوجين النسيجي"
],
[
"BMI",
"body mass index",
"مؤشر كتلة الجسم"
],
[
"BSA",
"body surface area",
"مساحة سطح الجسم"
],
[
"TBSA",
"total body surface area",
"إجمالي مساحة سطح الجسم"
],
[
"SBAR",
"situation, background, assessment, recommendation",
"الموقف والخلفية والتقييم والتوصية"
],
[
"ABC",
"airway, breathing, circulation",
"مجرى الهواء والتنفس والدورة الدموية"
],
[
"PPE",
"personal protective equipment",
"معدات الوقاية الشخصية"
],
[
"MAR",
"medication administration record",
"سجل إعطاء الأدوية"
],
[
"SATA",
"select all that apply",
"اختر كل ما ينطبق"
],
[
"PQRST",
"provocation, quality, region, severity, timing",
"تقييم الألم (المثير، النوع، الموضع، الشدة، التوقيت)"
],
[
"APGAR",
"Apgar score",
"مقياس أبغار"
],
[
"LMP",
"last menstrual period",
"تاريخ آخر دورة شهرية"
],
[
"EDD",
"estimated date of delivery",
"تاريخ الولادة المتوقع"
],
[
"FHR",
"fetal heart rate",
"معدل ضربات قلب الجنين"
],
[
"PROM",
"premature rupture of membranes",
"التمزق المبكر للأغشية"
],
[
"NICU",
"neonatal intensive care unit",
"وحدة العناية المركزة لحديثي الولادة"
]
];

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* observed bad renderings, by abbreviation (empty until real errors are seen) */
export const BAD_FORMS = {};

export const NURSING_DICT = ROWS.map(([abbr, en, ar]) => ({
  abbr, en, ar, bad: BAD_FORMS[abbr] || [],
  re: new RegExp(`(?<![A-Za-z0-9])(?:${esc(abbr)}|${esc(en)})(?![A-Za-z0-9])`, /^[a-z]+$/.test(abbr) || abbr.length <= 3 ? "" : "i"),
}));

export const MAX_HITS = 8;
export const MAX_BLOCK_CHARS = 330;

/* case matters for short abbreviations (PT ≠ pt, PE ≠ pe): they match as written; longer ones and the English expansions match without case */
/* the abbreviations every model already renders correctly: they only fill the block when nothing rarer matched */
const COMMON = new Set(["QD", "BID", "TID", "QID", "PRN", "PO", "IV", "IM", "SC", "SQ", "NPO", "HR", "RR", "BP", "ECG", "EKG", "CT", "MRI", "ICU", "ED", "STAT", "AC", "PC", "QHS", "ROM", "CPR", "UA", "DM", "HTN", "TB"]);
export function matchTerms(text, { dict = NURSING_DICT, max = MAX_HITS } = {}) {
  const t = String(text || "");
  const hits = [];
  for (const e of dict) {
    if (e.re.test(t) || (e.en && new RegExp(`(?<![A-Za-z0-9])${esc(e.en)}(?![A-Za-z0-9])`, "i").test(t))) hits.push(e);
  }
  const rare = hits.filter((e) => !COMMON.has(e.abbr)), common = hits.filter((e) => COMMON.has(e.abbr));
  return [...rare, ...common].slice(0, max);
}

export function glossaryBlock(entries) {
  if (!entries || !entries.length) return "";
  const head = "GLOSSARY (write these Arabic renderings exactly when the term appears):";
  let body = "";
  for (const e of entries) { const line = `\n- ${e.abbr} = ${e.en} = ${e.ar}`; if ((head + body + line).length > MAX_BLOCK_CHARS) break; body += line; }
  return body ? head + body : "";
}

/* the safe programmatic repair: replace an OBSERVED bad rendering by the glossary one. Returns { text, fixes }. */
export function fixBadForms(text, { dict = NURSING_DICT } = {}) {
  let out = String(text || ""), fixes = 0;
  for (const e of dict) for (const bad of e.bad || []) {
    if (!bad || !out.includes(bad)) continue;
    out = out.split(bad).join(e.ar); fixes += 1;
  }
  return { text: out, fixes };
}
export const hasBadForm = (text, { dict = NURSING_DICT } = {}) => {
  const t = String(text || "").toLowerCase(); const hits = [];
  for (const e of dict) for (const bad of e.bad || []) if (bad && t.includes(String(bad).toLowerCase())) hits.push(`${e.abbr}:${bad}`);
  return hits;
};
