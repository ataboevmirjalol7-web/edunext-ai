/**
 * Grammar fazali test: 20 ta MCQ (Supabase `grammar_tasks.questions` yoki zaxira).
 * Har bir savol: { id, stem, options: string[], correctIndex: 0..3 }
 */

/**
 * @param {unknown} raw
 * @returns {{ id:number, stem:string, options:string[], correctIndex:number }[]}
 */
export function normalizeGrammarQuizQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (row);
    const stem = String(o.stem ?? o.question ?? o.prompt ?? "").trim();
    const opts = Array.isArray(o.options) ? o.options.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    if (!stem || opts.length < 2) continue;
    let ci = Number(o.correctIndex ?? o.correct_index ?? o.answerIndex ?? -1);
    if (!Number.isFinite(ci) || ci < 0 || ci >= opts.length) {
      const L = String(o.correct ?? o.answer ?? "")
        .trim()
        .toUpperCase()
        .charCodeAt(0);
      if (L >= 65 && L < 65 + opts.length) ci = L - 65;
      else ci = 0;
    }
    const id = Number.isFinite(Number(o.id)) ? Math.floor(Number(o.id)) : out.length + 1;
    out.push({ id, stem, options: opts, correctIndex: Math.min(opts.length - 1, Math.max(0, Math.floor(ci))) });
  }
  return out;
}

/** Zaxira: 20 ta Present Simple vs Present Continuous MCQ. */
export function getFallbackGrammarQuiz20() {
  return [
    { id: 1, stem: "Choose the correct form: She ___ to school every day.", options: ["walk", "walks", "is walking", "walking"], correctIndex: 1 },
    { id: 2, stem: "Choose the correct form: Look! The children ___ in the garden.", options: ["play", "plays", "are playing", "played"], correctIndex: 2 },
    { id: 3, stem: "Choose the correct form: I usually ___ coffee in the morning.", options: ["drink", "am drinking", "drinks", "drinking"], correctIndex: 0 },
    { id: 4, stem: "Choose the correct form: Please be quiet. I ___ my homework now.", options: ["do", "does", "am doing", "doing"], correctIndex: 2 },
    { id: 5, stem: "Choose the correct form: My father ___ TV every evening.", options: ["watch", "watches", "is watching", "watching"], correctIndex: 1 },
    { id: 6, stem: "Choose the correct form: We ___ English at the moment.", options: ["study", "studies", "are studying", "studied"], correctIndex: 2 },
    { id: 7, stem: "Choose the correct form: Water ___ at 100°C.", options: ["boil", "boils", "is boiling", "boiling"], correctIndex: 1 },
    { id: 8, stem: "Choose the correct form: Why ___ you ___ your coat? It is warm inside.", options: ["do / wear", "are / wearing", "does / wear", "is / wearing"], correctIndex: 1 },
    { id: 9, stem: "Choose the correct form: He ___ his teeth twice a day.", options: ["brush", "brushes", "is brushing", "brushing"], correctIndex: 1 },
    { id: 10, stem: "Choose the correct form: They ___ dinner right now.", options: ["have", "has", "are having", "having"], correctIndex: 2 },
    { id: 11, stem: "Choose the correct form: The bus ___ at 8:30 every morning.", options: ["leave", "leaves", "is leaving", "leaving"], correctIndex: 1 },
    { id: 12, stem: "Choose the correct form: I can't talk now. I ___ to my teacher.", options: ["talk", "talks", "am talking", "talked"], correctIndex: 2 },
    { id: 13, stem: "Choose the correct form: Sarah ___ in a bank.", options: ["work", "works", "is working", "working"], correctIndex: 1 },
    { id: 14, stem: "Choose the correct form: This week, Sarah ___ from home.", options: ["work", "works", "is working", "working"], correctIndex: 2 },
    { id: 15, stem: "Choose the correct form: Cats usually ___ a lot during the day.", options: ["sleep", "sleeps", "are sleeping", "sleeping"], correctIndex: 0 },
    { id: 16, stem: "Choose the correct form: The baby ___ now, so don't make noise.", options: ["sleep", "sleeps", "is sleeping", "sleeping"], correctIndex: 2 },
    { id: 17, stem: "Choose the correct form: ___ your brother ___ football on Sundays?", options: ["Do / play", "Does / play", "Is / playing", "Are / playing"], correctIndex: 1 },
    { id: 18, stem: "Choose the correct form: ___ you ___ for your keys?", options: ["Do / look", "Does / look", "Are / looking", "Is / looking"], correctIndex: 2 },
    { id: 19, stem: "Choose the correct form: I ___ this song. It is my favourite.", options: ["love", "am loving", "loves", "loving"], correctIndex: 0 },
    { id: 20, stem: "Choose the correct form: She ___ Spanish very well.", options: ["speak", "speaks", "is speaking", "speaking"], correctIndex: 1 },
  ];
}

/**
 * @param {unknown} dbQuestions
 * @returns {{ id:number, stem:string, options:string[], correctIndex:number }[]}
 */
export function buildGrammarQuiz20(dbQuestions) {
  // Ushbu bosqich hozir faqat Present Simple vs Present Continuous farqlarini
  // tekshiradi; Supabase'dan kelgan umumiy grammar savollari aralashtirilmaydi.
  const fromDb = [];
  const fb = getFallbackGrammarQuiz20();
  if (fromDb.length >= 20) return fromDb.slice(0, 20).map((q, i) => ({ ...q, id: i + 1 }));
  const pool = [...fromDb, ...fb];
  const seen = new Set();
  const out = [];
  for (const q of pool) {
    if (out.length >= 20) break;
    const key = q.stem.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...q, id: out.length + 1 });
  }
  let k = 0;
  while (out.length < 20) {
    const q = fb[k % fb.length];
    out.push({ ...q, id: out.length + 1, stem: `${q.stem}` });
    k++;
  }
  return out.slice(0, 20).map((q, i) => ({ ...q, id: i + 1 }));
}
