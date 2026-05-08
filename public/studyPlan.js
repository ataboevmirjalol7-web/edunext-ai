/**
 * A2 → B1 (30 kun): diagnostika A2 / Elementary yo‘nalishi uchun kunlik reja ma’lumotlari.
 * Dashboard rejasi: Workplace uchun Grammar + Reading + Listening + Writing (`buildDayPlan`).
 */

export const A2_B1_STUDY_META = {
  grammarBook: "English Grammar in Use (Murphy Red)",
  readingBook: "Oxford Bookworms Library — Level 2",
  listeningSource: "BBC Learning English",
  /**
   * Haqiqiy fayl nomlari `public/pdfs/` da (masalan: grammar_a1_a2.pdf.pdf).
   */
  workplacePdfPath: "/pdfs/grammar_a1_a2.pdf.pdf",
  /** Oxford Bookworms (Sherlock Holmes) — `public/pdfs/reading_a2.pdf` */
  readingPdfPath: "/pdfs/reading_a2.pdf",
  /** Dashboard Reading vazifasi matni va sarlavha. */
  readingAssignment: {
    title: "Oxford Bookworms: Sherlock Holmes",
    url: "/pdfs/reading_a2.pdf",
    task: "Bugun 1-bobni o'qing va yangi so'zlarni AI-dan so'rang",
  },
  /** Dashboard Listening mini-pleyer (BBC Learning English — YouTube embed). */
  bbcEmbedUrl:
    "https://www.youtube.com/embed/pXRviuL6vMY?rel=0&modestbranding=1",
  external: {
    reading: "https://elt.oup.com/student/",
    listening: "https://www.bbc.co.uk/learningenglish/english/",
  },
};

/**
 * A2 → B1: 30 kunlik yo'l xaritasi (Murphy Red + Oxford Bookworms).
 * Dashboard va Workplace `buildDayPlan` orqali kunlik vazifani shu jadvaldan oladi.
 */
export const A2_B1_THIRTY_DAY_ROADMAP = [
  {
    grammarTask: "Present Simple vs Continuous — Murphy Units 1–4",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 1 — o'qing; 8 ta yangi so'z va 3 ta asosiy fikr",
    grammarPdfUrl: "/pdfs/grammar_a1_a2.pdf.pdf#page=10",
    outline: "Murphy 1–4 · Sherlock ch.1",
  },
  {
    grammarTask: "Past Simple (Regular / Irregular) — Murphy Units 5–6",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 2 — o'qing; yangi lug'at va qisqa xulosa",
    outline: "Past Simple · Sherlock ch.2",
  },
  {
    grammarTask: "Past Continuous (I was doing) — Murphy Unit 12",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 3",
    outline: "Past Cont. · Sherlock ch.3",
  },
  {
    grammarTask: "Present Perfect 1 (I have done) — Murphy Units 7–8",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 4",
    outline: "Pres. Perfect 1 · ch.4",
  },
  {
    grammarTask: "Present Perfect 2 (just, already, yet) — Murphy Unit 13",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 5",
    outline: "Pres. Perfect 2 · ch.5",
  },
  {
    grammarTask: "For / Since; How long…? — Murphy Units 11–12",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 6",
    outline: "For-Since · ch.6",
  },
  {
    grammarTask: "Present Perfect vs Past Simple — Murphy Units 13–14",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 7",
    outline: "PP vs Past · ch.7",
  },
  {
    grammarTask: "Past Perfect (I had done) — Murphy Unit 15",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Chapter 8",
    outline: "Past Perfect · ch.8",
  },
  {
    grammarTask: "Used to (do) — Murphy Unit 18",
    readingBook: "Oxford Bookworms: Sherlock Holmes (Level 2)",
    readingTask: "Sherlock Holmes — yakuniy boblar / finishing",
    outline: "Used to · Sherlock finish",
  },
  {
    grammarTask: "Review Day — o'tgan zamonlar (Murphy Units 1–18 takror)",
    readingBook: "AI Mentor",
    readingTask: "O'qish tanaffus — AI Mentor bilan o'tgan zamonlar bo'yicha suhbat",
    writingTask:
      "Kunning voqealari yoki reja mavzusi bo'yicha inglizcha yozma (paragraf yoki uzun-roq yozuv) — mentor akademik tuzatish beradi",
    outline: "Review · Mentor suhbat",
  },
  {
    grammarTask: "Future: Present Continuous vs going to — Murphy Units 19–20",
    readingBook: "Oxford Bookworms — Stage 2 (yangi kitob)",
    readingTask: "Yangi kitobni oching — tanishtirish va 1-bob",
    outline: "Future · Stage 2 start",
  },
  {
    grammarTask: "Will / Shall — Murphy Units 21–22",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 1",
    outline: "Will-Shall · St.2 ch.1",
  },
  {
    grammarTask: "Can, Could, (be) able to — Murphy Unit 26",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 2",
    outline: "Can-Could · ch.2",
  },
  {
    grammarTask: "Could (do) vs Could have (done) — Murphy Unit 27",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 3",
    outline: "Could have · ch.3",
  },
  {
    grammarTask: "Must and Can't (deduction) — Murphy Unit 28",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 4",
    outline: "Must-Can't · ch.4",
  },
  {
    grammarTask: "May and Might — Murphy Units 29–30",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 5",
    outline: "May-Might · ch.5",
  },
  {
    grammarTask: "Should — Murphy Units 33–34",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 6",
    outline: "Should · ch.6",
  },
  {
    grammarTask: "Have to and Must — Murphy Unit 31",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 7",
    outline: "Have to · ch.7",
  },
  {
    grammarTask: "Passive 1 (is done / was done) — Murphy Unit 42",
    readingBook: "Oxford Bookworms — Stage 2",
    readingTask: "Chapter 8",
    outline: "Passive 1 · ch.8",
  },
  {
    grammarTask: "Haftalik Progress Test — Murphy Units 11–20 bo'limi",
    readingBook: "AI Writing",
    readingTask: "100 so'z essay — AI Mentor tahlili (B1 kirish)",
    writingTask: "100 so'z: haftaning grammatik mavzulari bo'yicha INGLIZCHA essay",
    outline: "Progress test · 100 so'z",
  },
  {
    grammarTask: "Passive 2 (be done / been done) — Murphy Unit 43",
    readingBook: "Oxford Bookworms — Stage 3 (yangi kitob)",
    readingTask: "Yangi kitobni tanishtirish — muqova, janr, 1-bobni rejalashtirish",
    outline: "Passive 2 · Stage 3 start",
  },
  {
    grammarTask: "Reported Speech (He said that…) — Murphy Units 47–48",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 1",
    outline: "Reported speech · ch.1",
  },
  {
    grammarTask: "Questions (Who, What, Which…) — Murphy Units 49–50",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 2",
    outline: "Questions · ch.2",
  },
  {
    grammarTask: "Relative Clauses 1 (who / that / which) — Murphy Units 92–93",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 3",
    outline: "Relative · ch.3",
  },
  {
    grammarTask: "Conditionals 1 & 2 (If I do… / If I did…) — Murphy Units 38–39",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 4",
    outline: "If 1-2 · ch.4",
  },
  {
    grammarTask: "Conditional 3 (If I had known…) — Murphy Unit 40",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 5",
    outline: "If 3 · ch.5",
  },
  {
    grammarTask: "-ing and to… (Gerund / Infinitive) — Murphy Units 53–54",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 6",
    outline: "Gerund-Inf · ch.6",
  },
  {
    grammarTask: "Adjectives vs Adverbs — Murphy Units 99–100",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 7",
    outline: "Adj-Adv · ch.7",
  },
  {
    grammarTask: "Prepositions (in / at / on) — Murphy Units 121–123",
    readingBook: "Oxford Bookworms — Stage 3",
    readingTask: "Chapter 8",
    outline: "Prep · ch.8",
  },
  {
    grammarTask: "Final Exam — grammar va reading umumiy (A2 → B1)",
    readingBook: "Dashboard",
    readingTask: "30 kunlik o'sish grafigini ko'rib chiqing; reading va Murphy bo'yicha xulosa",
    writingTask: "80–100 so'z: 30 kunda nimalarni o'rgandingiz (refleksiya, inglizcha)",
    outline: "Final · jadval + xulosa",
  },
];

/** `dashboard-30day-outline` va boshqa UI uchun qisqa satr. */
export function getA2DayOutlineLabel(dayNum) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const row = A2_B1_THIRTY_DAY_ROADMAP[d - 1];
  return row?.outline ?? `Kun ${d}`;
}

/**
 * Kunlik Listening — YouTube embed ID (BBC Learning English va boshqa ochiq darslar).
 * Admin keyinroq har kun uchun alohida IDlar bilan almashtirishi mumkin.
 * Hozircha ishonchli ishlashi uchun bir nechta ID navbati bilan takrorlanadi.
 */
/** BBC Learning English — ishchi embed IDlar (noto'g'ri bo'lsa admin `studyPlan.js`da almashtiradi). */
const A2_LISTENING_YOUTUBE_POOL = [
  "pXRviuL6vMY",
  "nDLkFIZzuqo",
  "eGFtMsMWifc",
  "mVqBnYrFoBM",
  "VQHwzEgqaEQ",
  "pXRviuL6vMY",
  "nDLkFIZzuqo",
  "eGFtMsMWifc",
  "mVqBnYrFoBM",
  "VQHwzEgqaEQ",
  "pXRviuL6vMY",
  "nDLkFIZzuqo",
  "eGFtMsMWifc",
  "mVqBnYrFoBM",
  "VQHwzEgqaEQ",
];

export function getA2ListeningYoutubeId(dayNum) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const i = d - 1;
  return A2_LISTENING_YOUTUBE_POOL[i % A2_LISTENING_YOUTUBE_POOL.length];
}

/**
 * Kun raqami (1–30) bo‘yicha bitta kun rejasi — roadmap asosida.
 */
export function buildDayPlan(dayNum) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const row = A2_B1_THIRTY_DAY_ROADMAP[d - 1];
  const writingDefault =
    "Write in English about your day (paragraph or short sentences) using today's grammar and vocabulary — aim for richer, clearer writing.";

  if (!row) {
    return {
      day: d,
      grammar: {
        category: "Grammar",
        resource: A2_B1_STUDY_META.grammarBook,
        task: `Unit ${d} exercises`,
        pdfUrl: A2_B1_STUDY_META.workplacePdfPath,
      },
      reading: {
        category: "Reading",
        resource: A2_B1_STUDY_META.readingAssignment.title,
        task: A2_B1_STUDY_META.readingAssignment.task,
        pdfUrl: A2_B1_STUDY_META.readingAssignment.url,
        href: A2_B1_STUDY_META.external.reading,
      },
      listening: {
        category: "Listening",
        resource: A2_B1_STUDY_META.listeningSource,
        task: "Watch 1 short video and list 5 new words",
        href: A2_B1_STUDY_META.external.listening,
      },
      writing: {
        category: "Writing",
        task: writingDefault,
      },
    };
  }

  const listeningTask =
    d === 10
      ? "BBC Learning English — qisqa audio/video + o'tgan zamonlar bilan bog'lab eshitish"
      : d === 20
        ? "Listening: mentor essaydan oldin 1 ta BBC clips eshitish"
        : d === 30
          ? "Listening: tanlangan eslatma — fav podcast 10 daqiqa"
          : "Watch 1 short video and list 5 new words";

  return {
    day: d,
    grammar: {
      category: "Grammar",
      resource: A2_B1_STUDY_META.grammarBook,
      task: row.grammarTask,
      pdfUrl: row.grammarPdfUrl ?? A2_B1_STUDY_META.workplacePdfPath,
    },
    reading: {
      category: "Reading",
      resource: row.readingBook,
      task: row.readingTask,
      pdfUrl: A2_B1_STUDY_META.readingPdfPath,
      href: A2_B1_STUDY_META.external.reading,
    },
    listening: {
      category: "Listening",
      resource: A2_B1_STUDY_META.listeningSource,
      task: listeningTask,
      href: A2_B1_STUDY_META.external.listening,
    },
    writing: {
      category: "Writing",
      task: row.writingTask ?? writingDefault,
    },
  };
}

const PLAN_START_KEY = "edunext_a2_b1_plan_start_date";

/** Profil yoki diagnostika bilan kelgan sana (YYYY-MM-DD). */
export function setPlanStartDate(isoDay) {
  const d = String(isoDay || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  try {
    localStorage.setItem(PLAN_START_KEY, d);
  } catch (_) {
    /* ignore */
  }
}

/** Birinchi ochilishda boshlanish sanasi (YYYY-MM-DD). */
export function ensurePlanStartDate() {
  try {
    let start = localStorage.getItem(PLAN_START_KEY);
    if (!start) {
      start = new Date().toISOString().slice(0, 10);
      localStorage.setItem(PLAN_START_KEY, start);
    }
    return start;
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Joriy o‘quv kuni ko‘rsatkichi (1–30), `localStorage` kaliti. */
export const CURRENT_STUDY_DAY_KEY = "edunext_current_study_day";

function clampDay(d) {
  return Math.min(30, Math.max(1, Math.floor(Number(d)) || 1));
}

/**
 * Joriy o‘quv kuni (1–30): faqat `localStorage` dagi marker (standart).
 * Kun raqami taqvim bilan avtomatik oshmaysin — faqat barcha bo‘limlar tugaganda `maybePushCompletedDay` orqali oshadi
 * yoki profildan sinxronlanadi.
 */
export function getCurrentStudyDayIndex() {
  try {
    const raw = localStorage.getItem(CURRENT_STUDY_DAY_KEY);
    if (raw != null && String(raw).trim() !== "") {
      const n = Math.floor(Number(raw));
      if (Number.isFinite(n)) return clampDay(n);
    }
  } catch (_) {
    /* ignore */
  }
  return 1;
}

/**
 * Dashboard ro‘yxati uchun obyektlar (`generatePersonalPlan` bilan mos).
 * `action`: workplace | workplace_reading | external | mentor_a2_writing
 */
const DAY_SECTIONS_KEY = "edunext_a2_b1_day_sections_v1";
const COMPLETED_DAYS_KEY = "edunext_a2_b1_completed_days_v1";

/** A2 reja: boshlanish sanasi + kunlik progressni tozalash (yangi diagnostika oldidan). */
export function resetLocalStudyPlanProgress() {
  try {
    localStorage.removeItem(PLAN_START_KEY);
    localStorage.removeItem(DAY_SECTIONS_KEY);
    localStorage.removeItem(COMPLETED_DAYS_KEY);
    localStorage.removeItem(CURRENT_STUDY_DAY_KEY);
  } catch (_) {
    /* ignore */
  }
}

export function setCurrentStudyDayMarker(dayNum) {
  const d = clampDay(dayNum);
  try {
    localStorage.setItem(CURRENT_STUDY_DAY_KEY, String(d));
  } catch (_) {
    /* ignore */
  }
}

/** Bo'lim tugmasi: grammar | reading | vocabulary | listening | writing */
export function getDaySectionCompletion(dayIndex) {
  const d = clampDay(dayIndex);
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem(DAY_SECTIONS_KEY) || "{}");
  } catch (_) {
    map = {};
  }
  const row = map[String(d)] || {};
  return {
    grammar: Boolean(row.grammar),
    reading: Boolean(row.reading),
    vocabulary: Boolean(row.vocabulary),
    listening: Boolean(row.listening),
    writing: Boolean(row.writing),
    listening_bb_dict: Boolean(row.listening_bb_dict),
  };
}

function persistCompletedDaysList(days) {
  try {
    localStorage.setItem(COMPLETED_DAYS_KEY, JSON.stringify(days));
  } catch (_) {
    /* ignore */
  }
}

function loadCompletedDaysList() {
  try {
    const raw = localStorage.getItem(COMPLETED_DAYS_KEY) || "[]";
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? [...new Set(arr.map((n) => clampDay(n)))].filter((n) => n >= 1 && n <= 30).sort((a, b) => a - b)
      : [];
  } catch (_) {
    return [];
  }
}

/**
 * Yakuniy kunlik assessment (kamida 4/6 javobdan keyin): kun 30 ro‘yxatiga qo‘shiladi,
 * faol joriy kun bilan mos bo‘lsa `current_day` +1 ga suriladi.
 */
export function finalizeStudyDayViaDailyAssessment(dayNum) {
  const d = clampDay(dayNum);
  const active = getCurrentStudyDayIndex();
  const days = loadCompletedDaysList();
  if (!days.includes(d)) {
    days.push(d);
    days.sort((a, b) => a - b);
    persistCompletedDaysList(days);
  }
  if (active === d && d < 30) {
    const next = d + 1;
    setCurrentStudyDayMarker(next);
    try {
      const g =
        typeof globalThis !== "undefined" &&
        typeof globalThis.__edunextPersistCurrentDay === "function"
          ? globalThis.__edunextPersistCurrentDay
          : null;
      if (g) void Promise.resolve(g(next));
    } catch (_) {
      /* ignore */
    }
  }
  return get30DayProgress();
}

function maybePushCompletedDay(dayNum, sections) {
  const tier = inferDashboardTierFromHost();
  /**
   * Strict 5-bosqichli ketma-ketlik:
   *   Grammar → Listening → Writing → Reading → Vocabulary
   * Kun «bajarilgan» hisoblanishi uchun shu 5 bo‘limning hammasi yopilishi shart.
   * B1 da Listening = listening_bb_dict, A2 da Listening = listening.
   */
  const listeningOk = Boolean(sections.listening || sections.listening_bb_dict);
  const need = ["grammar", "reading", "writing", "vocabulary"];
  if (!listeningOk) return;
  if (!need.every((k) => sections[k])) return;
  const days = loadCompletedDaysList();
  const wasNew = !days.includes(dayNum);
  if (wasNew) {
    days.push(dayNum);
    days.sort((a, b) => a - b);
    persistCompletedDaysList(days);
  }
  if (
    wasNew &&
    dayNum === getCurrentStudyDayIndex() &&
    dayNum < 30
  ) {
    const next = dayNum + 1;
    setCurrentStudyDayMarker(next);
    try {
      const g =
        typeof globalThis !== "undefined" &&
        typeof globalThis.__edunextPersistCurrentDay === "function"
          ? globalThis.__edunextPersistCurrentDay
          : null;
      if (g) void Promise.resolve(g(next));
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Vazifani tugatdim — kunlik bo'limni belgilaydi.
 * Grammar, Reading, Listening, Writing, Vocabulary tugagach, u kun "bajarilgan" ro'yxatiga qo'shiladi (1/30 progress).
 */
export function markDaySectionComplete(dayIndex, section) {
  const d = clampDay(dayIndex);
  const key = String(section || "")
    .trim()
    .toLowerCase();
  const allowed = [
    "grammar",
    "reading",
    "vocabulary",
    "listening",
    "writing",
    "listening_bb_dict",
  ];
  if (!allowed.includes(key)) return get30DayProgress();

  let map = {};
  try {
    map = JSON.parse(localStorage.getItem(DAY_SECTIONS_KEY) || "{}");
  } catch (_) {
    map = {};
  }
  if (!map[String(d)]) map[String(d)] = {};
  map[String(d)][key] = true;
  try {
    localStorage.setItem(DAY_SECTIONS_KEY, JSON.stringify(map));
  } catch (_) {
    /* ignore */
  }
  maybePushCompletedDay(d, map[String(d)]);
  return get30DayProgress();
}

/** 30 kunlik rejada to'liq bajarilgan kunlar soni (Grammar + Reading + Vocabulary + Listening). */
export function get30DayProgress() {
  const days = loadCompletedDaysList();
  const n = days.length;
  return {
    completedDays: n,
    total: 30,
    percent: (n / 30) * 100,
  };
}

export function dashboardTasksFromStudyDay(dayIndex) {
  const plan = buildDayPlan(dayIndex);
  return [
    {
      task: `${plan.grammar.resource}: ${plan.grammar.task}`,
      type: "Grammar",
      action: "workplace",
      unit: plan.day,
      pdfUrl: plan.grammar.pdfUrl,
      /** Dashboard: PDF + 30 dk o‘qish, keyin 20 savol, natija + AI mentor. */
      dashboardPhasedGrammar: true,
    },
    {
      task: `${plan.reading.resource}: ${plan.reading.task}`,
      type: "Reading",
      action: "workplace_reading",
      href: plan.reading.href,
      pdfUrl: plan.reading.pdfUrl,
      /** Dashboard: Grammar dan keyingi fazali o‘quv eksperimenti (timed Reading). */
      dashboardTimedReading: true,
    },
    {
      task: `${plan.listening.resource} — ${plan.listening.task}`,
      type: "Listening",
      action: "external",
      href: plan.listening.href,
    },
    {
      task: plan.writing.task,
      type: "Writing",
      action: "mentor_a2_writing",
    },
  ];
}

/** B1 Intermediate — dashboard “Bugungi reja” uchun Murphy Blue + reading manbasi. */
export const B1_STUDY_META = {
  /** Diagnostika B1 — `KITOBNI OCHISH (PDF)` tugmasi shu faylni ochadi (`public/pdfs/`). */
  grammarPdfPath: "/pdfs/destination-b2.pdf",
  grammarBook: "Destination B2 (Macmillan) — asosiy grammar kitob",
  grammarPracticeUrl: "https://www.cambridge.org/gb/cambridgeenglish/catalog/grammar-vocabulary/english-grammar-in-use-4th-edition",
  readingTitle: "BBC Learning English — Intermediate",
  readingTask:
    "1 ta Intermediate dars/matnni o‘qing, 8 ta yangi lug‘at va 3 ta asosiy fikr yozing",
  readingUrl: "https://www.bbc.co.uk/learningenglish/english/course/lower-intermediate-english",
  /** Qoʻshimcha o‘quv materiallari (timed Reading tugmasidan tashqari). */
  readingPdfPath: "/pdfs/reading_a2.pdf",
};

/**
 * B1 → B2 yo‘nalish: Destination B2 + CEFR Writing (rasm paketi / kunlar).
 * `pdf_page`: o‘quv rejangizdagi unitga eng yaqin *Destination B2 Grammar & Vocabulary*
 * kitobidagi Contents bo‘yicha boshlanish sahifasi (nashr yiliga qarab ±1–2 sahifa tekshiring).
 */
export const B1_THIRTY_DAY_ROADMAP = [
  { grammarLabel: "Unit 1: Present Simple, Present Continuous", pdfPage: 6 },
  { grammarLabel: "Unit 2: Past Simple, Past Continuous", pdfPage: 18 },
  { grammarLabel: "Unit 3: Vocabulary (Food and Drink)", pdfPage: 100 },
  { grammarLabel: "Unit 4: Present Perfect Simple & Continuous", pdfPage: 6 },
  { grammarLabel: "Unit 5: Past Perfect Simple & Continuous", pdfPage: 18 },
  { grammarLabel: "Unit 6: Vocabulary (Education & Learning)", pdfPage: 112 },
  { grammarLabel: "Review 1 (Units 1-6)", pdfPage: 90 },
  { grammarLabel: "Unit 7: Future forms", pdfPage: 30 },
  { grammarLabel: "Unit 8: Modals (Ability, Permission)", pdfPage: 78 },
  { grammarLabel: "Unit 9: Vocabulary (The Media)", pdfPage: 48 },
  { grammarLabel: "Unit 10: Modals (Certainty, Advice)", pdfPage: 78 },
  { grammarLabel: "Unit 11: Passive 1", pdfPage: 94 },
  { grammarLabel: "Unit 12: Vocabulary (People & Society)", pdfPage: 60 },
  { grammarLabel: "Review 2 (Units 7-12)", pdfPage: 118 },
  { grammarLabel: "Unit 13: Passive 2", pdfPage: 94 },
  { grammarLabel: "Unit 14: Conditionals 1 (Zero, 1st, 2nd)", pdfPage: 54 },
  { grammarLabel: "Unit 15: Vocabulary (Health & Fitness)", pdfPage: 84 },
  { grammarLabel: "Unit 16: Conditionals 2 (3rd, Mixed)", pdfPage: 54 },
  { grammarLabel: "Unit 17: Relative Clauses", pdfPage: 142 },
  { grammarLabel: "Unit 18: Vocabulary (Environment)", pdfPage: 118 },
  { grammarLabel: "Review 3 (Units 13-18)", pdfPage: 130 },
  { grammarLabel: "Unit 19: Reported Speech", pdfPage: 130 },
  { grammarLabel: "Unit 20: Reported Questions/Commands", pdfPage: 130 },
  { grammarLabel: "Unit 21: Vocabulary (Technology)", pdfPage: 36 },
  { grammarLabel: "Unit 22: Adjectives and Adverbs", pdfPage: 66 },
  { grammarLabel: "Unit 23: Nouns and Articles", pdfPage: 42 },
  { grammarLabel: "Unit 24: Vocabulary (Work & Business)", pdfPage: 172 },
  { grammarLabel: "Unit 25: Pronouns and Determiners", pdfPage: 166 },
  { grammarLabel: "Unit 26: Vocabulary (Travel)", pdfPage: 12 },
  { grammarLabel: "Final Grand Test — CEFR full practice (grammar review)", pdfPage: 178 },
];

/** `dayIndex` 1–30; 30 dan oshsa 30 ga qadoqlanadi. */
export function getB1GrammarRowForDay(dayIndex) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayIndex)) || 1));
  return B1_THIRTY_DAY_ROADMAP[d - 1] || B1_THIRTY_DAY_ROADMAP[0];
}

function inferDashboardTierFromHost() {
  try {
    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.inferEducationPlanTier === "function"
    ) {
      return globalThis.inferEducationPlanTier();
    }
  } catch (_) {
    /* ignore */
  }
  return "A2";
}

/**
 * Dashboard: A2 — Grammar + Reading + Listening + Writing + Vocabulary.
 * B1 — Destination B2 (grammar + sahifa) + CEFR Writing (`writing_tasks`, `level = B1`).
 */
export function dashboardGrammarReadingTasksForTier(tier, dayIndex) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayIndex)) || 1));
  if (tier === "A2") {
    const parts = dashboardTasksFromStudyDay(d);
    /**
     * Strict ketma-ketlik tartibida: Grammar → Listening → Writing → Reading → Vocabulary.
     * BBC dictation (ListeningDictation) ham Listening fazasiga tegishli — uni Listening
     * yonida qoldiramiz, biroq DOM tartibi yuqoridagi 5 bosqichni qat'iy aks ettiradi.
     */
    const grammarRow = parts.find((x) => x.type === "Grammar");
    const readingRow = parts.find((x) => x.type === "Reading");
    const listenRow = parts.find((x) => x.type === "Listening");
    const listening = listenRow
      ? { ...listenRow, youtubeId: getA2ListeningYoutubeId(d) }
      : null;
    return [
      ...(grammarRow ? [grammarRow] : []),
      ...(listening ? [listening] : []),
      {
        task: "LISTENING — BBC Learning English",
        type: "ListeningDictation",
        dashboardListeningDictation: true,
      },
      {
        task: "",
        type: "Writing",
        dashboardWriting: true,
      },
      ...(readingRow ? [readingRow] : []),
      {
        task: "Kunlik lug'at: 20 ta yangi so'zni yodlang",
        type: "Vocabulary",
      },
    ];
  }
  if (tier === "B1") {
    const g = getB1GrammarRowForDay(d);
    const pdfUrl = `${B1_STUDY_META.grammarPdfPath}#page=${encodeURIComponent(String(g.pdfPage))}`;
    return [
      {
        task: `Destination B2 — ${g.grammarLabel}`,
        type: "Grammar",
        pdfUrl,
        href: B1_STUDY_META.grammarPracticeUrl,
        dashboardPhasedGrammar: true,
      },
      {
        task: "LISTENING — BBC Learning English",
        type: "ListeningDictation",
        dashboardListeningDictation: true,
      },
      {
        task:
          "CEFR B1 Writing — dashboarddagi rasm/mavzu paketi bo‘yicha (aniq matn Supabase writing_tasks jadvalida).",
        type: "Writing",
        dashboardWriting: true,
        writingLevel: "B1",
      },
      {
        task:
          "CEFR timed Reading — 4 bosqich (matn 30 dk, savollar bilan 20+20+20 dk), yakunda AI tahlili.",
        type: "Reading",
        dashboardTimedReading: true,
        pdfUrl: B1_STUDY_META.readingPdfPath,
        href: B1_STUDY_META.readingUrl,
      },
      {
        task: "Vocabulary — kunlik lug'at va quiz",
        type: "Vocabulary",
      },
    ];
  }
  return [];
}
