/**
 * Diagnostika kontenti — eski onboarding / CEFR oqigidagi mazmun (Grammar 15 + Reading 10).
 * Loyihadagi analog: avvalgi `questions` massivi (`script.js`) va `readingData`.
 */

/** Eski diagnostika: 15 ta Grammar MCQ (+1 har to‘g‘ri javob). */
export const GRAMMAR_QUESTIONS = [
  {
    q: "I ___ a student at the local college.",
    a: ["is", "am", "are", "be"],
    correct: 1,
    grammarTopic: "Present Simple",
  },
  {
    q: "Look! It ___ raining outside.",
    a: ["starts", "is starting", "start", "has start"],
    correct: 1,
    grammarTopic: "Present Continuous",
  },
  {
    q: "How ___ money do you have in your pocket?",
    a: ["many", "much", "few", "any"],
    correct: 1,
    grammarTopic: "Countable / Uncountable (much vs many)",
  },
  {
    q: "We ___ to the cinema last night.",
    a: ["go", "goes", "went", "gone"],
    correct: 2,
    grammarTopic: "Past Simple",
  },
  {
    q: "___ you ever been to London?",
    a: ["Do", "Are", "Did", "Have"],
    correct: 3,
    grammarTopic: "Present Perfect",
  },
  {
    q: "I'll call you as soon as I ___ home.",
    a: ["get", "will get", "got", "am getting"],
    correct: 0,
    grammarTopic: "Time clauses (as soon as)",
  },
  {
    q: "She's the woman ___ husband is a famous doctor.",
    a: ["who", "which", "whose", "whom"],
    correct: 2,
    grammarTopic: "Relative clauses (whose)",
  },
  {
    q: "You ___ smoke here; it's strictly prohibited.",
    a: ["don't have to", "mustn't", "needn't", "shouldn't"],
    correct: 1,
    grammarTopic: "Modals (mustn't / prohibition)",
  },
  {
    q: "If I were you, I ___ that job offer.",
    a: ["will accept", "accepted", "would accept", "accept"],
    correct: 2,
    grammarTopic: "Second conditional",
  },
  {
    q: "I wish I ___ more time to study for the exam.",
    a: ["have", "had", "will have", "am having"],
    correct: 1,
    grammarTopic: "Subjunctive (I wish)",
  },
  {
    q: "Hardly ___ entered the room when the lights went out.",
    a: ["I had", "had I", "did I", "I did"],
    correct: 1,
    grammarTopic: "Inversion",
  },
  {
    q: "It's high time you ___ looking for a real job.",
    a: ["start", "started", "starting", "to start"],
    correct: 1,
    grammarTopic: "It's high time + past simple",
  },
  {
    q: "Little ___ know that he was actually a spy.",
    a: ["did they", "they did", "do they", "they do"],
    correct: 0,
    grammarTopic: "Negative inversion",
  },
  {
    q: "Were it not for your help, I ___ in time.",
    a: ["won't finish", "didn't finish", "wouldn't have finished", "haven't finished"],
    correct: 2,
    grammarTopic: "Mixed / third conditional",
  },
  {
    q: "The company is believed ___ millions last year.",
    a: ["to lose", "to have lost", "losing", "that it lost"],
    correct: 1,
    grammarTopic: "Perfect infinitive (passive reporting)",
  },
];

/** `script.js` dagi `readingData` bilan mos 10 ta matn + savol. */
export const READING_PASSAGES = [
  {
    level: "A1",
    text: "Akmal is a student in Tashkent. He wakes up at 7:00 AM every day. He has a small breakfast and goes to university by bus. He loves studying English because he wants to travel to London in the future. In the evening, he meets his friends in the park.",
    q: "What is Akmal's main reason for learning English?",
    a: ["To find a job in Tashkent", "To travel to London", "To meet friends in the park", "To wake up early"],
    correct: 1,
  },
  {
    level: "A1",
    text: "My city is very beautiful in spring. There are many flowers and green trees everywhere. People like to walk outside and take photos. The weather is usually warm, but sometimes it rains. I feel very happy when the sun shines brightly.",
    q: "Choose the best word for the city in spring:",
    a: ["Cold", "Quiet", "Beautiful", "Dark"],
    correct: 2,
  },
  {
    level: "A2",
    text: "Many people think that healthy food is expensive. However, buying fresh vegetables and fruits from local markets can be cheap. Cooking at home is better than eating fast food. It helps you save money and stay fit. If you practice every day, you will become a great cook.",
    q: "According to the text, how can you save money?",
    a: ["By eating fast food", "By going to expensive restaurants", "By cooking at home", "By buying only fruits"],
    correct: 2,
  },
  {
    level: "A2",
    text: "Technology is changing our lives very fast. Nowadays, most students use tablets instead of heavy books. Online lessons are very popular because you can learn from home. But, it is important to take breaks and rest your eyes after using a computer for a long time.",
    q: "Why are online lessons popular?",
    a: ["Because books are heavy", "Because you can learn from home", "Because tablets are expensive", "Because eyes need rest"],
    correct: 1,
  },
  {
    level: "B1",
    text: "The internet has transformed the way we communicate, but it has also created new challenges. While social media allows us to stay connected with relatives, it can sometimes lead to a lack of real-life interaction. People often spend hours scrolling through newsfeeds instead of having meaningful conversations with those around them.",
    q: "What is the main concern mentioned about social media?",
    a: ["It is difficult to stay connected", "It costs too much money", "It reduces real-life interaction", "It provides too much news"],
    correct: 2,
  },
  {
    level: "B1",
    text: "Working in a team requires flexibility and patience. Each member has different skills and opinions. When a conflict arises, it is essential to listen to everyone before making a decision. Successful teams are those that value collaboration over individual success.",
    q: "Which word best describes the requirement for a successful team?",
    a: ["Competition", "Collaboration", "Patience only", "Individualism"],
    correct: 1,
  },
  {
    level: "B2",
    text: "Environmental conservation is no longer an option; it is a necessity. Global temperatures are rising due to increased carbon emissions, leading to extreme weather patterns. Governments must implement stricter regulations on factories, but individuals also play a crucial role by reducing waste and adopting sustainable habits.",
    q: "What does the author suggest about environmental protection?",
    a: ["Only governments are responsible", "Individual actions do not matter", "Both governments and individuals must act", "Factories should not be regulated"],
    correct: 2,
  },
  {
    level: "B2",
    text: "The architectural style of the 21st century emphasizes functionality and minimalism. Modern buildings often feature large glass windows to maximize natural light, reducing the need for artificial heating. This shift reflects a broader trend towards eco-friendly urban planning and aesthetic simplicity.",
    q: "What is the primary goal of using large glass windows in modern architecture?",
    a: ["To make buildings look more expensive", "To maximize natural light and save energy", "To hide the interior of the building", "To replace traditional art"],
    correct: 1,
  },
  {
    level: "C1",
    text: "The psychological phenomenon known as 'cognitive dissonance' occurs when an individual holds two conflicting beliefs simultaneously. This mental discomfort often motivates people to alter their perceptions or justify their actions to restore internal consistency. Understanding this concept is pivotal for analyzing consumer behavior and decision-making processes in high-pressure environments.",
    q: "In this context, what is the typical result of cognitive dissonance?",
    a: ["A permanent state of mental confusion", "A complete loss of belief systems", "An effort to change perceptions to achieve consistency", "A refusal to make any future decisions"],
    correct: 2,
  },
  {
    level: "C1",
    text: "The rapid evolution of artificial intelligence has sparked an intense debate regarding ethical boundaries. Proponents argue that AI can solve complex global issues, from climate change to disease eradication. Conversely, skeptics warn of potential job displacement and the loss of human agency. Striking a balance between innovation and regulation remains the most significant challenge for policymakers today.",
    q: "Which phrase best summarizes the central theme of the passage?",
    a: ["The technical process of AI development", "The economic benefits of automation", "The ethical dilemma between AI progress and risks", "The history of climate change solutions"],
    correct: 2,
  },
];

export const GRAMMAR_TOTAL_QUESTIONS = GRAMMAR_QUESTIONS.length;

/** Maks ball: Grammar (15) + Reading (10) + Writing (5) + Listening — `levelFromTotal20` uchun masshtab. */
export const DIAGNOSTIC_WRITING_SCORE_MAX = 5;

export const PART3_OPTION_ROWS = [
  { id: "A", legend: "Disappointed about earnings" },
  { id: "B", legend: "Routine was boring" },
  { id: "C", legend: "Rude people / rude treatment" },
  { id: "D", legend: "Work was easy / light workload" },
  { id: "E", legend: "Demanding boss" },
  { id: "F", legend: "Needed to be sociable" },
  { id: "G", legend: "Friendly colleagues" },
  { id: "H", legend: "Prepared for surprises" },
];

export const PART3_ANSWER_KEYS = ["B", "H", "F", "D", "C"];

/** Exercise 9 (eski script.js `listeningPart5Data`). 6-savol kaliti keyin qoʻshiladi — ball berilmaydi. */
export const LISTENING_PART2_SECTIONS = [
  {
    title: "Extract One",
    questions: [
      {
        id: 1,
        text: "1. How does the man feel about the work?",
        options: [
          "A) He finds the creativity stimulating",
          "B) He would like to use his academic training more",
          "C) He gets most satisfaction from being part of a team",
        ],
      },
      {
        id: 2,
        text: "2. What do they both think about the job?",
        options: [
          "A) It's a difficult career to get started in",
          "B) It's important to be able to work flexible hours",
          "C) It's a poorly paid job for the amount of work involved",
        ],
      },
    ],
  },
  {
    title: "Extract Two",
    questions: [
      {
        id: 3,
        text: "3. The man thinks his success as a cyclist is due to",
        options: [
          "A) his complete dedication",
          "B) the age at which he started",
          "C) a series of great role models",
        ],
      },
      {
        id: 4,
        text: "4. When talking about cycling in a velodrome, the woman reveals her",
        options: [
          "A) fear of dangerous sports",
          "B) inability to follow instructions",
          "C) willingness to accept a challenge",
        ],
      },
    ],
  },
  {
    title: "Extract Three",
    questions: [
      {
        id: 5,
        text: "5. Why has he phoned the programme?",
        options: [
          "A) to raise issues not previously discussed",
          "B) to challenge the opinions of other contributors",
          "C) to lend his support to a view that's been expressed",
        ],
      },
      {
        id: 6,
        text: "6. When talking about gardens, he is",
        options: [
          "A) describing what he does in his own",
          "B) encouraging people to grow certain things",
          "C) suggesting that people keep bees themselves",
        ],
      },
    ],
  },
];

/** 1.F, 2.G, 3.D, 4.H, 5.C — 6-indeks boʻsh. */
export const LISTENING_PART2_ANSWER_KEYS = ["F", "G", "D", "H", "C", ""];

/** Museum tour gap-fill (`listeningPart6Data`). */
export const LISTENING_PART3_GAP_CONTENT = [
  {
    paragraph: "This museum houses objects collected by the cultural society based in the city.",
  },
  {
    paragraph: "It has one of the country's best galleries containing (1) ",
    questionId: 1,
    suffix: " science exhibits.",
  },
  {
    paragraph: "The museum's displays of butterflies and birds are closed to visitors at present.",
  },
  {
    paragraph: "The section called Let's (2) ",
    questionId: 2,
    suffix: " is popular with young people.",
  },
  {
    paragraph: "The picture galleries contain works on various themes by German (3) ",
    questionId: 3,
    suffix: ".",
  },
  {
    paragraph: "The museum's (4) ",
    questionId: 4,
    suffix: " needs modernising.",
  },
  {
    paragraph: "The guide uses the word (5) ",
    questionId: 5,
    suffix: " to describe the Rutland Dinosaur's effect on people.",
  },
  {
    paragraph: "Polystyrene was used to reconstruct most of the Rutland Dinosaur's (6) ",
    questionId: 6,
    suffix: ".",
  },
];

export const LISTENING_PART3_GAP_ANSWER_KEYS = [
  "natural",
  "interact",
  "artists",
  "heating",
  "intimidating",
  "tail",
];

/**
 * Eski onboarding listening: Exercise 15 (match) → Exercise 9 (MCQ harflar) → Exercise 17 (gap).
 * UI: Part 1 / 2 / 3. Savollar jami: 17; maksimal to‘gʻri javob: 16 (Part 2 da 6-savol uchun kalit yo‘q).
 */
export const LISTENING_PARTS = [
  {
    key: "part1",
    legacyStorageKey: "listeningPart3Results",
    legacyPartId: "part3",
    label: "",
    title: "",
    instruction:
      "Beshta qisqa audio eshitasiz: odamlar ta’til ishlari haqida gapirishadi. Har bir eshituvchi uchun ro‘yxatdan (A–H) mos keladigan bittasini tanlang.",
    audioSrc: `/audio/${encodeURIComponent("part 3.mp3")}?v=3`,
    prepSeconds: 30,
    type: "match",
    optionLegend: PART3_OPTION_ROWS,
    speakerCount: 5,
    answerKeys: [...PART3_ANSWER_KEYS],
  },
  {
    key: "part2",
    legacyStorageKey: "listeningPart5Results",
    legacyPartId: "part5",
    label: "",
    title: "",
    instruction:
      "Uchta qisqa audiokesma eshitasiz. Har bir savol uchun tekstda berilgan A, B va C javoblardan biriga mos keladigan harfni yozing.",
    audioSrc: `/audio/${encodeURIComponent("part 5.mp3")}?v=10`,
    prepSeconds: 30,
    type: "mcqLetters",
    sections: LISTENING_PART2_SECTIONS,
    answerKeys: [...LISTENING_PART2_ANSWER_KEYS],
  },
  {
    key: "part3",
    legacyStorageKey: "listeningPart6Results",
    legacyPartId: "part6",
    label: "",
    title: "",
    instruction:
      "Matndagi boʻsh joylarga tinglab bitta SOʻZ va/yoki RAQAM yozing (faqat ingliz tilida).",
    audioSrc: `/audio/${encodeURIComponent("part 6.mp3")}?v=11`,
    prepSeconds: 30,
    type: "gapFill",
    content: LISTENING_PART3_GAP_CONTENT,
    answerKeys: [...LISTENING_PART3_GAP_ANSWER_KEYS],
  },
];

export function listeningPartQuestionIds(part) {
  if (!part || part.type === "match") return [];
  if (part.type === "mcqLetters") {
    return part.sections.flatMap((s) => s.questions.map((q) => q.id));
  }
  if (part.type === "gapFill") {
    return part.content.filter((b) => b.questionId != null).map((b) => b.questionId);
  }
  return [];
}

export function listeningQuestionsCount(part) {
  if (!part) return 0;
  if (part.type === "match") return part.speakerCount || 5;
  return listeningPartQuestionIds(part).length;
}

export const LISTENING_TOTAL_ITEMS = LISTENING_PARTS.reduce((n, p) => n + listeningQuestionsCount(p), 0);

/** Ball: gap/match/MCQ uchun to‘gʻri javoblar yig‘indisi (maks ~16). */
export const DIAGNOSTIC_LISTENING_SCORE_MAX = LISTENING_PARTS.reduce((n, part) => {
  const keys =
    part.type === "match"
      ? part.answerKeys || []
      : part.type === "mcqLetters"
        ? part.answerKeys || []
        : part.type === "gapFill"
          ? part.answerKeys || []
          : [];
  return n + keys.filter((k) => String(k || "").trim().length > 0).length;
}, 0);

export function diagnosticScoreMaxPoints() {
  return (
    GRAMMAR_QUESTIONS.length +
    READING_PASSAGES.length +
    DIAGNOSTIC_WRITING_SCORE_MAX +
    DIAGNOSTIC_LISTENING_SCORE_MAX
  );
}

/** Flat indekslash (progress uchun): `[{ partIndex, slotInPart, globalIndex }]` */
export function buildListeningQuestionsIndex() {
  const out = [];
  let g = 0;
  LISTENING_PARTS.forEach((part, partIndex) => {
    const m = listeningQuestionsCount(part);
    for (let s = 0; s < m; s++) {
      out.push({ partIndex, slotInPart: s, globalIndex: g });
      g += 1;
    }
  });
  return out;
}

/** Eski onboardingdagi Listening savollari uchun global indeks (`script.js` part3/5/6). */
export const listeningQuestions = buildListeningQuestionsIndex();

export function listeningGlobalQuestionOffset(partIndex) {
  let o = 0;
  for (let i = 0; i < partIndex && i < LISTENING_PARTS.length; i++) {
    o += listeningQuestionsCount(LISTENING_PARTS[i]);
  }
  return o;
}

export function normalizeGapAnswer(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export const LISTENING_AUDIO_URL = LISTENING_PARTS[0].audioSrc;
export const LISTENING_TITLE = "Listening";
export const LISTENING_INSTRUCTION = LISTENING_PARTS[0].instruction;
export const LISTENING_PREP_SECONDS = 25;
