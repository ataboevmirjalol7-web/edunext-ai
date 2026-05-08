/**
 * Timed Reading exam — avvalo JSONga o‘xshash tuzilma:
 *   part1: Multiple choice (correct = "A"|"B"|...)
 *   part2: T/F/NG (type: "T/F/NG", correct = "TRUE"|"FALSE"|"NOT GIVEN")
 *   part3: Vocabulary match (word + options[] + correct_match = harf)
 *
 * UI va tekshirish uchun `flattenReadingExamParts()` → birlashtirilgan `questions[]`.
 */

/**
 * @typedef {{ id:number, question:string, options:string[], correct:string }} ReadingPart1Item
 * @typedef {{ id:number, question:string, type?:string, correct:string }} ReadingPart2Item
 * @typedef {{ id:number, word:string, question?:string, options:string[], correct_match:string }} ReadingPart3Item
 * @typedef {{ part1:ReadingPart1Item[], part2:ReadingPart2Item[], part3:ReadingPart3Item[] }} ReadingExamParts
 */

/**
 * Kelajakda tashqi JSON faylni yuklash uchun ham ishlatish mumkin.
 * @param {ReadingExamParts} parts
 */
export function flattenReadingExamParts(parts) {
  const questions = [];

  function letterToMcqIndex(letterRaw, len) {
    const ch = String(letterRaw ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .charAt(0);
    const idx = ch ? ch.charCodeAt(0) - 65 : -1;
    if (Number.isFinite(idx) && idx >= 0 && idx < len) return idx;
    return 0;
  }

  function normalizeTfngCorrect(c) {
    let u = String(c ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");
    if (u === "T") u = "TRUE";
    if (u === "F") u = "FALSE";
    if (u === "NG" || u === "N/G") u = "NOT GIVEN";
    return u;
  }

  for (const row of parts.part1 || []) {
    const opts = Array.isArray(row.options) ? row.options : [];
    const correctIndex = letterToMcqIndex(row.correct, opts.length);
    questions.push({
      id: row.id,
      kind: "mcq",
      phase: "mcq",
      stem: String(row.question ?? ""),
      options: opts,
      correctIndex,
    });
  }

  for (const row of parts.part2 || []) {
    questions.push({
      id: row.id,
      kind: "tfng",
      phase: "tfng",
      stem: String(row.question ?? ""),
      tfngType: row.type ?? "T/F/NG",
      correct: normalizeTfngCorrect(row.correct),
    });
  }

  for (const row of parts.part3 || []) {
    const opts = Array.isArray(row.options) ? row.options : [];
    const correctIndex = letterToMcqIndex(row.correct_match, opts.length);
    const w = String(row.word ?? "").trim();
    const stem =
      row.question?.trim?.() ||
      (w ? `Choose the closest meaning of "${w}":` : "Choose the closest meaning:");
    questions.push({
      id: row.id,
      kind: "vocab_pick",
      phase: "vocab",
      stem,
      word: w,
      options: opts,
      correctIndex,
    });
  }

  return questions.sort((a, b) => a.id - b.id);
}

/**
 * Supabase `reading_tasks.questions` (jsonb) dan part1/2/3 chiqarish.
 * @param {unknown} raw
 * @returns {ReadingExamParts | null}
 */
export function normalizeReadingExamParts(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (obj);
  const part1 = Array.isArray(o.part1) ? /** @type {ReadingPart1Item[]} */ (o.part1) : [];
  const part2 = Array.isArray(o.part2) ? /** @type {ReadingPart2Item[]} */ (o.part2) : [];
  const part3 = Array.isArray(o.part3) ? /** @type {ReadingPart3Item[]} */ (o.part3) : [];
  if (!part1.length && !part2.length && !part3.length) return null;
  return { part1, part2, part3 };
}

/**
 * Bazadan kelgan passage + savollar uchun UI/payload.
 * @param {{ passage: unknown, title: unknown, parts: ReadingExamParts, dayNum: number, tierLabel: string }} p
 */
export function buildTimedReadingPayloadFromSources(p) {
  const passageSafe = String(p.passage ?? "").trim();
  const titleSafe = String(p.title ?? "Reading").trim() || "Reading";
  const parts = p.parts;
  if (!parts || passageSafe.length < 20) return null;
  const questions = flattenReadingExamParts(parts);
  if (!questions.length) return null;
  const d = Math.min(30, Math.max(1, Math.floor(Number(p.dayNum)) || 1));
  const tl = p.tierLabel === "B1" ? "B1" : "A2";
  return {
    dayNumber: d,
    tierLabel: tl,
    title: titleSafe,
    passage: passageSafe,
    phaseDurationsMs: {
      passage: 1 * 60 * 1000,
      mcqBlock: 1 * 60 * 1000,
      tfngBlock: 1 * 60 * 1000,
      vocabBlock: 20 * 60 * 1000,
    },
    part1: parts.part1,
    part2: parts.part2,
    part3: parts.part3,
    questions,
  };
}

/** Savollar — boshqalar uchun namuna tuzilmasi (JSON import bilan almashtirish oson). */
const EXAM_PARTS_B1 = {
  part1: [
    {
      id: 1,
      question:
        "According to paragraph 2, questionnaires about new parks:",
      options: [
        "Prove that parks eliminate stress permanently.",
        "Show lower reported stress yet cannot prove causality alone.",
        "Replace the need for physiological measurements.",
        "Were rejected by most researchers.",
      ],
      correct: "B",
    },
    {
      id: 2,
      question: "Cautious reviewers worry that correlations might be affected because:",
      options: [
        "Parks shrink wages.",
        "Omitted factors such as income may confuse the pattern.",
        "Heatwaves distort surveys.",
        "Meta‑analyses are illegal.",
      ],
      correct: "B",
    },
    {
      id: 3,
      question: 'Walking meetings are mentioned as:',
      options: [
        "A government law.",
        "A practice employers claim aids informal teamwork.",
        "A replacement for HR departments.",
        "Proven harmful.",
      ],
      correct: "B",
    },
    {
      id: 4,
      question: "Trees are connected to:",
      options: [
        "Hotter pavement at night.",
        "Cooler surfaces during heatwaves.",
        "Mandatory traffic speed.",
        "Reducing questionnaires.",
      ],
      correct: "B",
    },
    {
      id: 5,
      question: '"Consultation fatigue" is linked to:',
      options: [
        "Too few benches.",
        "Frequent questionnaires without visible follow‑up.",
        "Playgrounds.",
        "Seniors rejecting paths.",
      ],
      correct: "B",
    },
  ],
  part2: [
    {
      id: 6,
      question: "Increasing greenery policies always silence critics completely.",
      type: "T/F/NG",
      correct: "FALSE",
    },
    {
      id: 7,
      question: "Heart‑rate variability is offered as supplementary evidence besides surveys.",
      type: "T/F/NG",
      correct: "TRUE",
    },
    {
      id: 8,
      question: "The text proves walking meetings raise wages.",
      type: "T/F/NG",
      correct: "FALSE",
    },
    {
      id: 9,
      question: "Media narratives frequently explain subtle policy trade‑offs about species.",
      type: "T/F/NG",
      correct: "FALSE",
    },
    {
      id: 10,
      question: "The passage settles moral debates about historically unequal green space.",
      type: "T/F/NG",
      correct: "FALSE",
    },
  ],
  part3: [
    {
      id: 11,
      word: "meta‑analyses",
      question:
        'In "...Recent meta‑analyses synthesise heterogeneous studies...", closest meaning:',
      options: [
        "Combining findings from multiple studies systematically.",
        "A single patient's medical scan.",
        "Random street interviews only.",
        "Traffic speed measurements.",
        "Painting park benches.",
      ],
      correct_match: "A",
    },
    {
      id: 12,
      word: "longitudinal",
      question: '"Longitudinal designs" implies research that:',
      options: [
        "Measures once and stops.",
        "Tracks the same phenomena or people over extended time.",
        "Ignores statistics.",
        "Only studies trees.",
        "Excludes neighbourhoods.",
      ],
      correct_match: "B",
    },
    {
      id: 13,
      word: "confound",
      question: '"Might confound correlations" suggests an omitted variable might:',
      options: [
        "Clarify all results.",
        "Distort apparent cause‑effect.",
        "Guarantee truth.",
        "Delete parks.",
        "Remove stress.",
      ],
      correct_match: "B",
    },
    {
      id: 14,
      word: "canopy",
      question: '"Maximise canopy coverage" refers chiefly to:',
      options: [
        "Underground cables.",
        "The leafy umbrella formed by branches.",
        "Indoor gyms.",
        "Car lanes.",
        "Library loans.",
      ],
      correct_match: "B",
    },
    {
      id: 15,
      word: "sceptically",
      question: '"Describe sceptically" suggests residents view promises:',
      options: [
        "Without doubt.",
        "With doubt or questioning.",
        "With legal contracts.",
        "With silence only.",
        "With joy.",
      ],
      correct_match: "B",
    },
  ],
};

const EXAM_PARTS_A2 = {
  part1: [
    {
      id: 1,
      question: "The reading challenge is:",
      options: ["Mandatory.", "Voluntary with weekly reminders.", "Only online.", "Cancelled."],
      correct: "B",
    },
    {
      id: 2,
      question: "Band levels are described as:",
      options: [
        "Fixed forever.",
        "Advisory — may move up after a short talk.",
        "Illegal to change.",
        "Chosen by governors only.",
      ],
      correct: "B",
    },
    {
      id: 3,
      question: "About books vs tablets:",
      options: [
        "E‑readers for every class.",
        "Paper default partly because annotation suits many learners.",
        "No tablets exist.",
        "Devices banned entirely.",
      ],
      correct: "B",
    },
    {
      id: 4,
      question: "If a weekly task is missed:",
      options: [
        "Cannot rejoin.",
        "Group forfeits top prize.",
        "Fees apply.",
        "Certificate automatic.",
      ],
      correct: "B",
    },
    {
      id: 5,
      question: "Shelving volunteers should expect:",
      options: [
        "No guidance.",
        "Lengthy certifications first.",
        "Short on‑the‑job help.",
        "Payment per hour.",
      ],
      correct: "C",
    },
  ],
  part2: [
    {
      id: 6,
      question: "Individuals compete solo for ranking.",
      type: "T/F/NG",
      correct: "FALSE",
    },
    {
      id: 7,
      question: "Older students may start with band B or C texts.",
      type: "T/F/NG",
      correct: "TRUE",
    },
    {
      id: 8,
      question: "The library approved buying e‑readers for every classroom.",
      type: "T/F/NG",
      correct: "FALSE",
    },
    {
      id: 9,
      question: "Missing a week means permanent exclusion.",
      type: "T/F/NG",
      correct: "FALSE",
    },
    {
      id: 10,
      question: "The article states the square metres of shelving space.",
      type: "T/F/NG",
      correct: "NOT GIVEN",
    },
  ],
  part3: [
    {
      id: 11,
      word: "voluntary",
      question: '"Voluntary" describes participation as:',
      options: [
        "Required by law.",
        "Chosen freely.",
        "Secret.",
        "Paid.",
        "Banned.",
      ],
      correct_match: "B",
    },
    {
      id: 12,
      word: "reflective",
      question: '"Reflective sentence" implies writing that:',
      options: [
        "Copies Wikipedia.",
        "Thinks briefly about one's reading.",
        "Is only slang.",
        "Has no verbs.",
        "Is left blank.",
      ],
      correct_match: "B",
    },
    {
      id: 13,
      word: "accessibility",
      question: '"Accessibility" regarding tablets hints at:',
      options: [
        "Hiding cables.",
        "Helping learners with different needs use materials.",
        "Faster shelving.",
        "Only Year 13.",
        "Free pizza.",
      ],
      correct_match: "B",
    },
    {
      id: 14,
      word: "advisory",
      question: '"Advisory levels" suggests guidance is:',
      options: [
        "Non‑binding suggestion rather than rigid law.",
        "A police order.",
        "A fine.",
        "Invisible.",
        "Only German.",
      ],
      correct_match: "A",
    },
    {
      id: 15,
      word: "sceptically",
      question: '"Sceptically" in online debate suggests students respond:',
      options: [
        "With blind trust.",
        "With doubt questioning the rule.",
        "With silence.",
        "With songs.",
        "With grades only.",
      ],
      correct_match: "B",
    },
  ],
};

/**
 * @param {number} dayNum 1–30
 * @param {string} tier "A2" | "B1"
 */
export function getTimedReadingExamPayload(dayNum, tier) {
  void dayNum;
  void tier;
  throw new Error("Reading fallback o‘chirilgan: ma’lumot faqat `reading_tasks` jadvalidan olinadi.");
}
