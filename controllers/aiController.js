const { Groq, RateLimitError } = require("groq-sdk");

/** Groq uchun model (env orqali boshqariladi). */
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";

/** So'rov / token yukini kamaytirish: chat tarixidan faqat oxirgi N ta xabar. */
const CHAT_CONTEXT_MAX_MESSAGES = 4;
const CHAT_MAX_CHARS_PER_TURN = 1000;
const QUOTA_USER_MESSAGE_UZ = "AI Mentor biroz charchadi, 1 daqiqadan so'ng javob beradi";

let cachedGroq = null;

function isGroqApiKeyConfigured() {
    return Boolean(process.env.GROQ_API_KEY?.trim());
}

function getGroqSdk() {
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) throw new Error("GROQ_API_KEY .env faylida ko'rsatilmagan");
    if (!cachedGroq) cachedGroq = new Groq({ apiKey: key });
    return cachedGroq;
}

/** Frontend uchun aniq Groq/so'rov xabarlari (`success: false`). */
function mapWritingCheckFailure(err, res) {
    if (isQuotaOrRateLimitError(err)) {
        console.warn("[Groq rate-limit] check-dashboard-writing");
        return res.status(429).json(quotaJson({ success: false }));
    }
    const raw = String(err?.message ?? err ?? "");
    if (
        !isGroqApiKeyConfigured() ||
        /GROQ_API_KEY\s*\.?env|\bko'?rsatilmagan\b/i.test(raw) ||
        /GROQ_API_KEY.*missing|missing or empty/i.test(raw)
    ) {
        return res.status(503).json({
            success: false,
            errorCode: "MISSING_GROQ_API_KEY",
            error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY (Groq API kaliti) yo'q yoki noto'g'ri. Kalitni tekshiring va backendni qayta ishga tushiring.",
        });
    }
    const status =
        typeof err?.status === "number"
            ? err.status
            : typeof err?.statusCode === "number"
              ? err.statusCode
              : undefined;
    if (status === 401 || /401|unauthori/i.test(raw)) {
        return res.status(502).json({
            success: false,
            errorCode: "GROQ_AUTH",
            error: "AI bilan ulanib bo'lmadi — Groq API kaliti rad etildi. GROQ_API_KEY ni Groq konsolida yangilab tekshiring.",
        });
    }
    console.error("Check dashboard writing Error:", err);
    return res.status(502).json({
        success: false,
        errorCode: "GROQ_UNAVAILABLE",
        error: "AI bilan ulanib bo'lmadi. Internet aloqasi, Groq xizmati holati va server jurnalini tekshiring.",
    });
}

async function groqCompleteMessages(messages, { temperature = 0.35, max_tokens = 1024 } = {}) {
    const client = getGroqSdk();
    const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages,
        temperature,
        max_tokens,
    });
    return String(completion.choices?.[0]?.message?.content ?? "").trim();
}

function isQuotaOrRateLimitError(err) {
    try {
        if (err instanceof RateLimitError) return true;
        const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status);
        const msg = String(err?.message ?? err ?? "");
        if (status === 429) return true;
        if (/quota|QuotaFailure|rate.limit|Too Many Requests|429/i.test(msg)) return true;
    } catch (_) {
        /* ignore */
    }
    return false;
}

function sanitizeChatTurns(historyPayload) {
    if (!Array.isArray(historyPayload)) return [];
    return historyPayload
        .slice(-CHAT_CONTEXT_MAX_MESSAGES)
        .map((item) => {
            const rawRole = item?.role;
            const role =
                rawRole === "user"
                    ? "user"
                    : rawRole === "model" ||
                        rawRole === "assistant" ||
                        rawRole === "bot"
                      ? "assistant"
                      : null;
            if (!role) return null;
            const text = String(item?.text ?? "").trim();
            if (!text) return null;
            const clipped =
                text.length > CHAT_MAX_CHARS_PER_TURN
                    ? `${text.slice(0, CHAT_MAX_CHARS_PER_TURN - 3)}...`
                    : text;
            return { role, content: clipped };
        })
        .filter(Boolean);
}

/** Groq `messages` formatida: tarix + joriy foydalanuvchi gaplari bir `user` ichida transcript. */
function buildChatUserPrompt(historyTurns, currentMessage) {
    const chunks = [];
    historyTurns.forEach((turn) => {
        const label = turn.role === "user" ? "Talaba" : "Mentor";
        const text = typeof turn.content === "string" ? turn.content : "";
        chunks.push(`${label}: ${text}`);
    });
    const cur = String(currentMessage || "").trim().slice(0, 2500);
    let out = chunks.length ? `${chunks.join("\n\n")}\n\n———\n\n` : "";
    out += `Hozirgi talaba xabari:\n${cur}`;
    return out;
}

function quotaJson(extra = {}) {
    return {
        quotaExceeded: true,
        reply: QUOTA_USER_MESSAGE_UZ,
        error: QUOTA_USER_MESSAGE_UZ,
        ...extra,
    };
}

const systemInstruction = `
Siz Edu Next uchun A2–B1 ingliz tili AI Mentorisiz (Dashboard va umumiy suhbat).
Grammar, Reading, Listening, Writing, Vocabulary bo'yicha muloyim yordam bering.
Markdown: **qalin**, ro'yxatlar mumkin. Boshqa fanlarni ingliz mashg'ulotiga yo'naltiring.
`;

const onboardingMessage = `Assalomu alaykum! Men ingliz tili mentoringizman. Bugun nimada yordam kerak?`;

/** Dashboard AI Mentor — Writing faqat Supabase kunlik savolga; lug'at gaplari Vocabulary-da. */
const DASHBOARD_MENTOR_CORE = `
Siz Edu Next Dashboard AI Mentorisiz — A2/B1 ingliz tili.

• Grammar, Reading, Listening: qisqa, aniq tushuntirish yoki mashq yo'li.
• Writing: Dashboardda kunlik yozma boshqa — talaba har kuni \`writing_tasks\` dan kelgan MAVZU/SAVOL (masalan kofe yoki kunlik mazmun) bo'yicha yozadi. Uning yozmasiga grammatika va mazmun mosligi bo'yicha yordam bering. **Gap tuzish rejimi Writing-da emas** — lug'at bilan gap yozish tekshiruvi faqat **Vocabulary** kartasida; Writing mentorida "20 ta gap" yoki majburiy gap soni talab qilmang.
• Vocabulary: yangi so'zlar bo'yicha savol bo'lsa, qisqa eslatma; chuqur tekshiruv Vocabulary kartasidagi AI orqali.

Hech qachon "siz 5 ta gap yozishingiz kerak edi" kabi eski tanbeh uslubini ishlatmang.

Javoblar o'zbek yoki inglizcha aralash bo'lishi mumkin; kerakda inglizcha misollar.
`.trim();

/** Frontend `planTier` (A2 | B1 | B2). */
function normalizePlanTier(raw) {
    const t = String(raw ?? "")
        .trim()
        .toUpperCase();
    if (t === "A2" || t === "B1" || t === "B2") return t;
    return "B1";
}

function sanitizeMentorTodos(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 20).map((row) => ({
        task: String(row?.task ?? "").slice(0, 400),
        type: String(row?.type ?? "").slice(0, 80),
        done: Boolean(row?.done),
    }));
}

function buildStep11DashboardSystemPrompt(mentorContext) {
    const tier = normalizePlanTier(mentorContext?.planTier);
    const display = String(mentorContext?.displayBand ?? "").trim() || tier;
    const todos = sanitizeMentorTodos(mentorContext?.todos);
    const allDone = Boolean(mentorContext?.allTodosDone);
    let todoLines = todos
        .map((t, i) => `${i + 1}. [${t.done ? "bajarildi" : "oshirish kerak"}] (${t.type}) ${t.task}`)
        .join("\n");
    if (!todoLines) todoLines = "(vazifalar roʻyxati hali yoʻq)";
    const doneCount = todos.filter((x) => x.done).length;
    const total = todos.length;

    const externalPdfNote = mentorContext?.pdfLinksExternalOnly
        ? `
PDF: talaba "Kitobni ochish (PDF)" orqali faylni alohida oynada ochadi — kerak bo'lsa Page N formatida sahifa eslatishingiz mumkin.`
        : "";

    return `${DASHBOARD_MENTOR_CORE}

---

Platforma: Edu Next — Dashboard.
Reja darajasi: ${tier}. Ko'rsatish (test/CEFR): ${display}.
Bugungi vazifalar (${doneCount}/${total} bajarilgan):
${todoLines}
${externalPdfNote}

${allDone ? "Barcha kundalik vazifalar bajarilgan bo'lsa — qisqa tabrik qo'shing." : ""}`;
}

function buildWorkplaceSystemPrompt(mentorContext) {
    const tier = normalizePlanTier(mentorContext?.planTier);
    const display = String(mentorContext?.displayBand ?? "").trim() || tier;
    const unit = String(mentorContext?.unit ?? "").trim() || "—";
    const book = String(mentorContext?.workplaceBook ?? "grammar").toLowerCase();
    const pdfLabel =
        book === "reading"
            ? "Oxford Bookworms Library (Level 2) — mahalliy PDF"
            : "English Grammar in Use (Murphy Red) — mahalliy PDF";
    const pageHint = String(mentorContext?.currentPage ?? "").trim();

    return `Siz Edu Next "Workplace" rejimidasiz: talaba chapda suhbatlashadi, o'ngda ochiq PDF (${pdfLabel}).
REJA DARAJASI: ${tier}. Ko'rsatish (test): ${display}.
BUGUNGI REJA KUNI / UNIT: ${unit}.
JORIY PDF SAHIFASI (client): ${pageHint || "noma'lum"}.

MAQSAD: Murphy yoki Oxford bo'yicha A2→B1 yo'l-yo'riq, qisqa va amaliy javob (o'zbek/ingliz aralash).

MUHIM — PDF SAHIFAGA O'TKAZISH:
Agar siz yoki talaba aniq sahifani ko'rsatmoqchi bo'lsa, matnda INGLIZCHA aniq formatda yozing: "Page 56" yoki "Page 12" (Page + probel + raqam).
Faqat shu format brauzer PDF ko'rigida sahifani avtomatik almashtiradi. Har bir mos javob oxirida kerak bo'lsa "Page N" qo'shing.
Boshqa kitoblarni uydirmang — faqat ushbu ochiq PDF mavzusi bo'yicha yordam bering.`;
}

function appendDashboardWorkplaceTeacherBlock(basePrompt, mentorContext) {
    if (!mentorContext?.workplaceEmbedded) return basePrompt;
    const subj = String(mentorContext?.activeSubject ?? "").trim() || "grammar";
    const pdfPath = String(mentorContext?.workplacePdfPath ?? "").trim();

    return `${basePrompt}

QO'SHIMCHA REJIM — Workplace (PDF darslik):
Sen PDF darslik bo'yicha o'qituvchisan. O'quvchiga darslikdagi sahifalarni ochishda yordam berasan.
Faol ko'nikma: ${subj}. Ochiq PDF (client yo'li): ${pdfPath || "—"}.

SAHIFAGA O'TKAZISH:
 • O'zbekcha gaplar bilan aniq raqam yozing: masalan "Keling, 12-betni ochamiz", "12-betni ko'ramiz", "15-bet".
 • Inglizcha: "Page 12" ham mos keladi.
Talaba sahifani ochmoqchi bo'lganida, javobingda shu raqamlarni aniq qoldiring — platforma PDFni shu sahifaga o'tkazadi.`;
}

function appendWritingReviewA2Block(basePrompt, mentorContext) {
    if (!mentorContext?.writingReviewA2) return basePrompt;
    return `${basePrompt}

[Writing rejimi] KEYINGI xabar — odatda \`writing_tasks\` savoliga javob yozmasi. Grammatika va savolga moslik bo'yicha yordam bering. Lug'at gaplari Vocabulary bo'limida tekshiriladi — Writing-da gap soni yoki lug'at ro'yxatini majburiy qilmang.`;
}

function appendOxfordBookwormsReadingBlock(basePrompt, mentorContext) {
    if (!mentorContext?.oxfordReadingAssistant) return basePrompt;
    return `${basePrompt}

[Reading] Oxford matni bo'yicha tushunmovchilik bo'lsa — A2-B1 uchun qisqa o'zbekcha izoh (asosiy mentor qoidalari ustun).`;
}

const getAIResponse = async (req, res) => {
    const rawMessage = req.body?.message;
    const historyPayload = req.body?.history;
    const mentorContext = req.body?.mentorContext;

    try {
        const message = String(rawMessage ?? "").trim();
        if (!message) {
            return res.status(400).json({ error: "Bo'sh xabar yuborib bo'lmaydi", reply: null });
        }

        const historyTurns = sanitizeChatTurns(historyPayload);
        const userContent = buildChatUserPrompt(historyTurns, message);

        const isStep11Dashboard =
            mentorContext &&
            typeof mentorContext === "object" &&
            mentorContext.source === "step11-dashboard";

        const isWorkplace =
            mentorContext &&
            typeof mentorContext === "object" &&
            mentorContext.source === "workplace";

        const systemCombined = isStep11Dashboard
            ? appendDashboardWorkplaceTeacherBlock(
                  appendOxfordBookwormsReadingBlock(
                      appendWritingReviewA2Block(
                          buildStep11DashboardSystemPrompt(mentorContext),
                          mentorContext,
                      ),
                      mentorContext,
                  ),
                  mentorContext,
              )
            : isWorkplace
              ? buildWorkplaceSystemPrompt(mentorContext)
              : systemInstruction.trim();

        const maxOut = isStep11Dashboard || isWorkplace ? 900 : 768;

        const reply = await groqCompleteMessages(
            [{ role: "system", content: systemCombined }, { role: "user", content: userContent }],
            { temperature: 0.3, max_tokens: maxOut },
        );

        if (!reply) {
            return res.status(502).json({ error: "AI bo'sh javob qaytardi", reply: null });
        }
        return res.status(200).json({ reply, model: GROQ_MODEL });
    } catch (error) {
        if (isQuotaOrRateLimitError(error)) {
            console.warn("[Groq rate-limit] chat");
            return res.status(429).json(quotaJson());
        }
        console.error("Groq chat xatosi:", error);
        res.status(500).json({
            error: "AI tizimiga ulanishda xatolik yuz berdi",
            reply: null,
        });
    }
};

const startOnboarding = async (req, res) => {
    try {
        res.status(200).json({ message: onboardingMessage });
    } catch (error) {
        console.error("startOnboarding:", error);
        res.status(500).json({ error: "Xabar yuklanmadi" });
    }
};

function extractWritingJson(raw) {
    let s = String(raw || "").trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/im.exec(s);
    if (fence) s = fence[1].trim();
    try {
        const j = JSON.parse(s);
        if (j && typeof j === "object") return j;
    } catch (_) {
        /* continue */
    }
    const lo = s.indexOf("{");
    const hi = s.lastIndexOf("}");
    if (lo >= 0 && hi > lo) {
        try {
            const j = JSON.parse(s.slice(lo, hi + 1));
            if (j && typeof j === "object") return j;
        } catch (_) {
            /* ignore */
        }
    }
    return null;
}

function formattedReplyFromWritingJson(j) {
    const gPct = typeof j.grammarScore === "number" ? `${j.grammarScore}%` : j.grammarScore ?? "—";
    const vPct =
        typeof j.vocabularyScore === "number" ? `${j.vocabularyScore}%` : j.vocabularyScore ?? "—";
    const cefr = j.cefrLevel != null ? String(j.cefrLevel) : "";
    const parts = [];
    parts.push(`1. Grammar (${gPct})\n${j.grammarFeedback || "—"}`.trim());
    parts.push(`2. Vocabulary (${vPct})\n${j.vocabularyFeedback || "—"}`.trim());
    parts.push(
        `3. CEFR / umumiy\n${cefr}${j.cefrFeedback ? `\n${j.cefrFeedback}` : ""}${j.overallSummary ? `\n${j.overallSummary}` : ""}`.trim()
    );
    return parts.join("\n\n");
}

/** Diagnostika / yangi forma: score 1–5 + uchta mezon haqidagi qisqa izohlar. */
function formattedReplyUnified(j) {
    const sc = typeof j.score === "number" ? j.score : "—";
    const parts = [];
    parts.push(`Baho (diagnostika): ${sc}/5`);
    parts.push(String(j.feedback || "—").trim());
    const errs = Array.isArray(j.errors) ? j.errors.map((x) => String(x).trim()).filter(Boolean) : [];
    if (errs.length) parts.push(`Xatolar:\n${errs.map((e) => `• ${e}`).join("\n")}`);
    parts.push(`Grammar & spelling: ${String(j.grammarSpellingNote || "—").trim()}`);
    parts.push(`Vocabulary range: ${String(j.vocabularyNote || "—").trim()}`);
    parts.push(`Task response: ${String(j.taskResponseNote || "—").trim()}`);
    return parts.filter(Boolean).join("\n\n");
}

function coerceScoreOneToFive(parsed) {
    let score = Number(parsed?.score);
    if (Number.isFinite(score)) {
        return Math.min(5, Math.max(1, Math.round(score)));
    }
    const g = Number(parsed?.grammarScore);
    const v = Number(parsed?.vocabularyScore);
    if (Number.isFinite(g) && Number.isFinite(v)) {
        const avgPct = (g + v) / 2;
        score = Math.round(1 + (avgPct / 100) * 4);
        return Math.min(5, Math.max(1, score));
    }
    return 3;
}

function normalizeAnalyzeWritingStructured(parsed, rawFallback) {
    if (!parsed || typeof parsed !== "object") return null;
    const score = coerceScoreOneToFive(parsed);
    const feedback = String(parsed.feedback ?? parsed.overallSummary ?? "").trim() || rawFallback.slice(0, 400);
    const errors = Array.isArray(parsed.errors)
        ? parsed.errors.map((x) => String(x).trim()).filter(Boolean).slice(0, 24)
        : [];
    const grammarSpellingNote = String(parsed.grammarSpellingNote ?? parsed.grammarFeedback ?? "").trim();
    const vocabularyNote = String(parsed.vocabularyNote ?? parsed.vocabularyFeedback ?? "").trim();
    const taskResponseNote = String(parsed.taskResponseNote ?? parsed.cefrFeedback ?? "").trim();
    return {
        score,
        feedback: feedback || "—",
        errors,
        grammarSpellingNote: grammarSpellingNote || "—",
        vocabularyNote: vocabularyNote || "—",
        taskResponseNote: taskResponseNote || "—",
        legacyGrammarScore:
            parsed.grammarScore != null ? Number(parsed.grammarScore) : undefined,
        legacyVocabularyScore:
            parsed.vocabularyScore != null ? Number(parsed.vocabularyScore) : undefined,
        cefrLevel: parsed.cefrLevel != null ? String(parsed.cefrLevel) : undefined,
    };
}

const analyzeWriting = async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !String(text).trim()) {
            return res.status(400).json({ success: false, error: "Matn kiritilmadi" });
        }
        const wordCount = String(text).trim().split(/\s+/).filter(Boolean).length;
        if (wordCount < 50 || wordCount > 100) {
            return res.status(400).json({ success: false, error: "Matn 50-100 so'z oralig'ida bo'lishi kerak" });
        }

        const prompt = `You are an English writing examiner for a concise diagnostic placement test.
Score the student's text on THREE criteria (Grammar & spelling; Vocabulary range; Task response).

STRICT RULES:
- Respond with VALID JSON only — no markdown fencing, no text outside JSON.

Required JSON keys (fill all strings; use Uzbek or Uzbek-English mix for human-facing text fields):
- "score": INTEGER from 1 to 5 ONLY (overall quality: 1 very weak … 5 very good)
- "feedback": Short overall encouragement + summary (about 3–5 sentences).
- "errors": ARRAY of SHORT strings listing concrete grammar/spelling issues (may be empty if none notable; max 8 items).
- "grammarSpellingNote": Brief diagnostic for grammar/spelling severity and clarity.
- "vocabularyNote": Brief diagnostic for lexical range vs level.
- "taskResponseNote": Brief diagnostic for relevance to typical "about yourself / hobbies / goals" prompts.

Essay (${wordCount} words, must stay within learner level):
---
${text}
---`;

        const rawOut = await groqCompleteMessages([{ role: "user", content: prompt }], {
            temperature: 0.35,
            max_tokens: 1536,
        });

        const parsed = extractWritingJson(rawOut);
        let reply = String(rawOut || "").trim();
        let structuredNorm = null;
        if (parsed && typeof parsed === "object") {
            structuredNorm = normalizeAnalyzeWritingStructured(parsed, reply);
            if (structuredNorm) {
                reply = formattedReplyUnified(structuredNorm);
            } else if (parsed.grammarScore != null || parsed.vocabularyScore != null) {
                reply = formattedReplyFromWritingJson(parsed);
            }
        }

        return res.json({
            success: true,
            reply,
            structured: structuredNorm || parsed || undefined,
            model: GROQ_MODEL,
        });
    } catch (error) {
        if (isQuotaOrRateLimitError(error)) {
            console.warn("[Groq rate-limit] analyze-writing");
            return res.status(429).json(quotaJson({ success: false }));
        }
        console.error("Analyze Writing Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

function extractVocabularyValidationJson(raw) {
    const s = String(raw ?? "").trim();
    const fence = s.match(/\{[\s\S]*\}/);
    const jsonStr = fence ? fence[0] : s;
    try {
        return JSON.parse(jsonStr);
    } catch (_) {
        return null;
    }
}

/**
 * Dashboard Vocabulary Step 2: gaplar soni (`public/script.js` — `countDashboardVocabularySentences` bilan sinxron).
 */
function countVocabularyStepSentences(text) {
    const s = String(text ?? '').trim().replace(/\r\n/g, '\n');
    if (!s) return 0;
    const chunks = s
        .split(/\n+|(?<=[.!?])[ \t]*/)
        .map((p) => p.trim())
        .filter(Boolean);
    return chunks.length;
}

const VOCAB_VALIDATION_EXPECTED_SENTENCES = 20;

/**
 * Dashboard Vocabulary: checklist so'zlari bilan 20 ta gap — akademik mentor.
 */
async function validateVocabulary(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY yo'q. Kalitni qo'shing va backendni qayta ishga tushiring.",
            });
        }
        const text = String(req.body?.text ?? "").trim();
        const words = Array.isArray(req.body?.words)
            ? req.body.words.map((w) => String(w ?? "").trim()).filter(Boolean)
            : [];
        const dayNumber = Math.min(30, Math.max(1, Math.floor(Number(req.body?.dayNumber)) || 1));

        const parserSentenceCount = countVocabularyStepSentences(text);

        if (!text || text.length < 40) {
            return res.status(400).json({
                success: false,
                error: "Biroz ko'proq yozing — inglizcha gaplar bilan yozma boshlang.",
            });
        }

        if (parserSentenceCount !== VOCAB_VALIDATION_EXPECTED_SENTENCES) {
            return res.status(400).json({
                success: false,
                error:
                    parserSentenceCount === 0
                        ? "Matn aniqlik bilan gap deb bo'lmadi — har bir gapni . ? yoki ! bilan tugating yoki har bir gapni yangi qatordan yozing."
                        : `Bizning sanash bo'yicha hozir ${parserSentenceCount} ta gap chiqdi. Dashboard Vocabulary vazifasi uchun aynan ${VOCAB_VALIDATION_EXPECTED_SENTENCES} ta gap kerak.`,
            });
        }

        const targetWords = words.length ? words.slice(0, 24) : [];
        const wordList =
            targetWords.length > 0 ? targetWords.join(", ") : "(lug'at ro'yxati kelmagan — bu holda lug'at yoritishini yumshoqroq yozing.)";

        const prompt = `You evaluate ONLY Dashboard Vocabulary «Sentence Building»: learner wrote sentences that MUST use checklist words meaningfully.

Target audience: Uzbek explanations (except quoting English learner errors).

REFERENCE — parser sentence count (${parserSentenceCount}) matches required ${VOCAB_VALIDATION_EXPECTED_SENTENCES} (trust this; learner task is locked to exactly ${VOCAB_VALIDATION_EXPECTED_SENTENCES} sentences).

Study day ${dayNumber}. Official checklist headwords (inflected/word forms count):
${wordList}

SUBMISSION (English):
---
${text}
---

You MUST analyse:
A) Exactly ${VOCAB_VALIDATION_EXPECTED_SENTENCES} distinct sentences satisfied? (Assume yes matching parser unless obvious merged run-ons that should be flagged as readability issue in grammar section — do NOT change approved solely for minor disagreement.)
B) Vocabulary checklist — which headwords appear in natural sentences? Populate usedWordsFromList + missingWordsFromList; learner should use most checklist words somewhere; briefly note glaring absence in sozlarNazorati (Uzbek).
C) Grammar / accuracy — grammatikTahlil Uzbek with wrong → corrected patterns.
D) Academic register — akademikMaslahat Uzbek: how to elevate tone (formality, linking, specificity) phrase-level.

modelApproved — true ONLY if grammar is not catastrophically broken, checklist words are used substantively in MOST expected items (a few missing omissions are tolerable), and the text reads as ${VOCAB_VALIDATION_EXPECTED_SENTENCES} separate ideas matching the parser split.

ONLY JSON (no fences):
{
  "modelApproved": boolean,
  "sentenceCount": number,
  "usedWordsCount": number,
  "usedWordsFromList": string[],
  "missingWordsFromList": string[],
  "sozlarNazorati": "",
  "grammatikTahlil": "",
  "akademikMaslahat": "",
  "correctedEnglish": "",
  "errors": string[],
  "feedbackUz": ""
}
errors ≤ 14. correctedEnglish optional; feedbackUz optional short summary Uzbek.`;


        const rawOut = await groqCompleteMessages([{ role: "user", content: prompt }], {
            temperature: 0.26,
            max_tokens: 2600,
        });

        let parsed = extractVocabularyValidationJson(rawOut);
        if (!parsed || typeof parsed !== "object") parsed = {};

        const sozRaw =
            String(parsed.sozlarNazorati ?? parsed.sozlarNazaroti ?? "").trim();
        const gram = String(parsed.grammatikTahlil ?? "").trim();
        const akad = String(parsed.akademikMaslahat ?? parsed.akademikMaslahati ?? "").trim();
        const legacy = String(parsed.feedbackUz ?? "").trim();

        let feedbackUz = legacy;
        if (sozRaw || gram || akad) {
            const parts = [];
            if (sozRaw) parts.push(`So'zlar nazorati: ${sozRaw}`);
            if (gram) parts.push(`Grammatik tahlil: ${gram}`);
            if (akad) parts.push(`Akademik maslahat: ${akad}`);
            feedbackUz = parts.join("\n\n");
        }
        if (!feedbackUz.trim()) feedbackUz = "Tekshiruv yakunlandi.";

        const modelApproved = Boolean(
            parsed?.modelApproved ??
                parsed?.approved ??
                false,
        );
        const approved =
            parserSentenceCount === VOCAB_VALIDATION_EXPECTED_SENTENCES && modelApproved;
        const correctedEnglish = String(parsed?.correctedEnglish ?? "").trim();
        const usedFrom = Array.isArray(parsed?.usedWordsFromList)
            ? parsed.usedWordsFromList.map((w) => String(w ?? "").trim()).filter(Boolean).slice(0, 28)
            : [];
        const missingFrom = Array.isArray(parsed?.missingWordsFromList)
            ? parsed.missingWordsFromList.map((w) => String(w ?? "").trim()).filter(Boolean).slice(0, 28)
            : [];
        const errsOut = Array.isArray(parsed?.errors)
            ? parsed.errors.map((e) => String(e ?? "").trim()).filter(Boolean).slice(0, 14)
            : [];

        return res.json({
            success: true,
            approved,
            feedbackUz,
            sozlarNazorati: sozRaw || null,
            grammatikTahlil: gram || null,
            akademikMaslahat: akad || null,
            correctedEnglish: correctedEnglish || undefined,
            errors: errsOut,
            sentenceCount: parserSentenceCount,
            parsedSentenceEstimate:
                typeof parsed?.sentenceCount === "number" ? parsed.sentenceCount : undefined,
            usedWordsCount:
                typeof parsed?.usedWordsCount === "number" ? parsed.usedWordsCount : undefined,
            usedWordsFromList: usedFrom,
            missingWordsFromList: missingFrom,
            model: GROQ_MODEL,
        });
    } catch (error) {
        if (isQuotaOrRateLimitError(error)) {
            console.warn("[Groq rate-limit] validate-vocabulary");
            return res.status(429).json(quotaJson({ success: false }));
        }
        console.error("Validate vocabulary Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}

function extractListeningSummaryJson(raw) {
    const s = String(raw ?? "").trim();
    const fence = s.match(/\{[\s\S]*\}/);
    const jsonStr = fence ? fence[0] : s;
    try {
        return JSON.parse(jsonStr);
    } catch (_) {
        return null;
    }
}

/** Mashhur BBC 6 Minute English epizodi uchun mazmun uchun eslatma (faqat tekshirish). */
function listeningContentAnchorsUz(podcastTopic) {
    const raw = String(podcastTopic ?? "").trim();
    if (/benefits\s+of\s+coffee/i.test(raw) || /\bcoffee\b.*benefits|\bbenefits\b.*coffee/i.test(raw)) {
        return `CONTENT CHECK (episode "The benefits of coffee"): Typical main ideas learners report: caffeine and alertness; antioxidants and possible health angles mentioned in episode; moderated consumption advice. Assess whether student reflects these themes without forcing every detail. If student invents unrelated "facts", note gently in Uzbek in mentorMaslahati.`;
    }
    return `CONTENT CHECK — episode title visible to learner: "${raw}". Decide if the student's English summary plausibly matches what they'd take from listening to an episode with this theme. Reward coherent summaries tied to title; politely flag inventions or drifting off-topic.`;
}

/**
 * Listening Phase 1: podcastdan keyingi 5 ta gap (inglizcha) — ball va strukturali mentor javobi.
 */
async function validateListeningSummary(req, res) {
    try {
        const text = String(req.body?.text ?? "").trim();
        const dayNumber = Math.min(30, Math.max(1, Math.floor(Number(req.body?.dayNumber)) || 1));
        const podcastTopic =
            String(req.body?.podcastTopic ?? "").trim().slice(0, 200) ||
            `BBC Learning English — Listening (kun ${dayNumber})`;

        if (!text || text.length < 40) {
            return res.status(400).json({
                success: false,
                error: "Kamida 5 ta to'liq gap yozing (inglizcha).",
            });
        }

        const contentHints = listeningContentAnchorsUz(podcastTopic);

        const prompt = `You are an A2 Listening Mentor. You are NOT the general chat tutor — ONLY evaluate this homework.

Today's podcast headline shown on the student's screen: "${podcastTopic}"

The student listened, then wrote English sentences summarising what they heard (expect ~5 clear sentences).

${contentHints}

Evaluate on THREE axes:
1) Content accuracy — grasp of main podcast ideas vs title (caffeine, alertness, antioxidants when title is coffee benefits; otherwise coherent match to TITLE).
2) Grammar & spelling — point out A2-level English errors in THEIR sentences ("wrong → right").
3) Feedback — If off-topic or claims unlikely from podcast, say so kindly in Uzbek in "mentorMaslahati".

Student summary (English):
---
${text}
---

Respond VALID JSON ONLY — no markdown, no prose outside JSON.

Keys:
- "sentenceCount": integer (target ~5 distinct sentences)
- "score": 0-100 blending relevance + English quality (no 5 good sentences usually < 65)
- "tushunishDarajasi": ONE line Uzbek, may include approximate % plus short explanation e.g. "80% — siz ..."
- "tuzatishlar": Uzbek, concrete grammar/spelling fixes (incorrect → corrected)
- "mentorMaslahati": Uzbek gentle advice ("keyingi safar ... ga e'tibor bering")
- "errors": max 10 short English/Uzbek strings summarising corrections (may repeat tuzatishlar bullets)

Fallback only if unsure: plain "feedbackUz" string in Uzbek (optional). Prefer filling tushunishDarajasi, tuzatishlar, mentorMaslahati.`;

        const rawOut = await groqCompleteMessages([{ role: "user", content: prompt }], {
            temperature: 0.28,
            max_tokens: 1200,
        });

        let parsed = extractListeningSummaryJson(rawOut);
        if (!parsed || typeof parsed !== "object") parsed = {};
        const score = Math.min(100, Math.max(0, Math.floor(Number(parsed?.score) || 0)));
        const t1 = String(parsed?.tushunishDarajasi ?? "").trim();
        const t2 = String(parsed?.tuzatishlar ?? "").trim();
        const t3 = String(parsed?.mentorMaslahati ?? "").trim();
        const legacy = String(parsed?.feedbackUz ?? "").trim();

        let feedbackUz = legacy;
        if (t1 || t2 || t3) {
            const parts = [];
            if (t1) parts.push(`Tushunish darajasi: ${t1}`);
            if (t2) parts.push(`Tuzatishlar: ${t2}`);
            if (t3) parts.push(`Mentor maslahati: ${t3}`);
            feedbackUz = parts.join("\n\n");
        }
        if (!feedbackUz) feedbackUz = "Tekshiruv yakunlandi.";

        const errors = Array.isArray(parsed?.errors)
            ? parsed.errors.map((e) => String(e ?? "").trim()).filter(Boolean).slice(0, 10)
            : [];
        const sentenceCount =
            typeof parsed?.sentenceCount === "number"
                ? Math.floor(parsed.sentenceCount)
                : undefined;

        return res.json({
            success: true,
            score,
            feedbackUz,
            tushunishDarajasi: t1 || null,
            tuzatishlar: t2 || null,
            mentorMaslahati: t3 || null,
            errors,
            sentenceCount,
            podcastTopic,
            model: GROQ_MODEL,
        });
    } catch (error) {
        if (isQuotaOrRateLimitError(error)) {
            console.warn("[Groq rate-limit] validate-listening-summary");
            return res.status(429).json(quotaJson({ success: false }));
        }
        console.error("Validate listening summary Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Dashboard A2: kamida 30 so'z, ball 1–10, xatolar ro'yxati.
 */
async function checkDashboardWriting(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY (Groq API kaliti) yo'q. Kalitni qo'shing va backendni qayta ishga tushiring.",
            });
        }

        const text = String(req.body?.text ?? "").trim();
        const dayNumber = Math.min(30, Math.max(1, Math.floor(Number(req.body?.dayNumber)) || 1));
        const topicTitle = String(req.body?.topicTitle ?? "").trim() || "Daily writing";

        const wordCount = String(text)
            .trim()
            .split(/\s+/)
            .filter(Boolean).length;
        if (wordCount < 30) {
            return res.status(400).json({
                success: false,
                error: "Kamida 30 ta so'z yozing — savolga to'liq javob uchun.",
            });
        }
        if (wordCount > 500) {
            return res.status(400).json({
                success: false,
                error: "Matn juda uzun (maksimum ~500 so'z).",
            });
        }

        const ctx = topicTitle.slice(0, 800);

        const system = [
            `Sen A2–B1 yozma tekshiruvchisisan.`,
            `FAQAT va FAQAT talaba yuborgan INGLIZCHA matnni tahlil qil.`,
            `Gaplar sonini sanash yoki «5 ta gap», «bir necha gap kerak edi» degan cheklovni qo'llamaysan — bunga oid baho yoki tanbeh yozmaysan.`,
            `Grammatika, so'z tanlovi, aniqlikni baholang; ixtiyoriy qisqa eslatma: yozma asosiy yozma topshirish konteksti (pastda bir qator) bilan ne darajada mos.`,
            `Muloqat o'zbek tilida. Faqat bitta JSON, markdown yo'q.`,
        ].join(" ");

        const userPayload = `
Ixtiyoriy kontekst (faqat yozma mazmuniga tegishliligini silliq tekshirish; bu qatordan qo'shimcha talab chiqarmaysan): 
${ctx}

So'zlar soni (ma'lumot): ${wordCount}

TALABA YOZGAN MATN — faqat SHUNI asosiy baholang:
---
${text}
---

FAQAT VALID JSON:
{
  "score": <1..10>,
  "feedbackUz": "<o'zbekcha: grammatika va ifoda, kuchli tomonlar, tuzatishlar; gap soni haqida hech narsa>",
  "errors": ["ixtiyoriy qisqa xato bandlari, max 10; bo'sh bo'lsa []"]
}`;

        const rawOut = await groqCompleteMessages(
            [
                { role: "system", content: system },
                { role: "user", content: userPayload },
            ],
            { temperature: 0.28, max_tokens: 1400 },
        );

        let parsed = extractListeningSummaryJson(rawOut);
        if (!parsed || typeof parsed !== "object") parsed = {};

        let score = Math.floor(Number(parsed?.score));
        if (!Number.isFinite(score)) score = 5;
        score = Math.min(10, Math.max(1, score));
        const feedbackUz = String(parsed?.feedbackUz ?? "").trim() || "Tekshiruv yakunlandi.";
        const errors = Array.isArray(parsed?.errors)
            ? parsed.errors.map((e) => String(e ?? "").trim()).filter(Boolean).slice(0, 10)
            : [];

        return res.json({
            success: true,
            score,
            feedbackUz,
            errors,
            wordCount,
            model: GROQ_MODEL,
        });
    } catch (error) {
        return mapWritingCheckFailure(error, res);
    }
}

/**
 * Dashboard Writing: 3 ta alohida javob (Task 1.1 ~50, 1.2 ~150, Part 2 ~200 so'z) — CEFR bo'yicha bitta hisobot.
 */
async function evaluateDashboardWritingThreeTasks(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY yo'q. Kalitni qo'shing va backendni qayta ishga tushiring.",
            });
        }

        const t1 = String(req.body?.task_1_1 ?? "").trim();
        const t2 = String(req.body?.task_1_2 ?? "").trim();
        const t3 = String(req.body?.part_2 ?? "").trim();
        const q1 = String(req.body?.promptTask_1_1 ?? "").trim().slice(0, 4000);
        const q2 = String(req.body?.promptTask_1_2 ?? "").trim().slice(0, 4000);
        const q3 = String(req.body?.promptPart_2 ?? "").trim().slice(0, 4000);
        const topicTitle = String(req.body?.topicTitle ?? "").trim().slice(0, 800) || "Daily writing";
        const level = String(req.body?.level ?? "A2").trim().toUpperCase().slice(0, 10) || "A2";

        const wc = (s) =>
            String(s || "")
                .trim()
                .split(/\s+/)
                .filter(Boolean).length;
        const w1 = wc(t1);
        const w2 = wc(t2);
        const w3 = wc(t3);

        if (!t1 || !t2 || !t3) {
            return res.status(400).json({
                success: false,
                error: "Uchta topshiriq matni ham bo'sh bo'lmasligi kerak.",
            });
        }
        if (w1 < 15 || w2 < 15 || w3 < 15) {
            return res.status(400).json({
                success: false,
                error: "Har bir topshiriqda kamida 15 so'z yozing — tekshirish uchun javoblar juda qisqa.",
            });
        }

        const system = [
            "You are an expert English examiner using CEFR criteria.",
            "You receive THREE separate learner submissions (Task 1.1, Task 1.2, Part 2) with suggested target lengths.",
            "Count words yourself for each submission (English words, whitespace-separated). Compare to targets: Task 1.1 ≈50, Task 1.2 ≈150, Part 2 ≈200 (±10% is OK unless clearly far under).",
            "For each task: list concrete grammar mistakes with brief corrections; comment on vocabulary appropriateness (short).",
            "Provide vocabularyLevelOverall (Uzbek), overallCefrBand as a single band label (e.g. A2, B1, B1+, B2, C1), overallFeedbackUz (Uzbek, 3–6 sentences).",
            "Respond with VALID JSON ONLY — no markdown fences, no prose outside JSON.",
        ].join(" ");

        const userPayload = `
LEVEL (course band): ${level}
TITLE / TOPIC CONTEXT: ${topicTitle}

TASK PROMPTS (reference only — grade the STUDENT TEXTS below):
--- Task 1.1 ---
${q1 || "(prompt not supplied)"}
--- Task 1.2 ---
${q2 || "(prompt not supplied)"}
--- Part 2 ---
${q3 || "(prompt not supplied)"}

Approximate learner word counts (sanity): task_1_1=${w1}, task_1_2=${w2}, part_2=${w3}

SUBMISSION — Task 1.1:
---
${t1}
---

SUBMISSION — Task 1.2:
---
${t2}
---

SUBMISSION — Part 2:
---
${t3}
---

Required JSON shape (fill every string/array; grammarIssues strings may mix English corrections with Uzbek hints):
{
  "tasks": {
    "task_1_1": {
      "wordCount": ${w1},
      "targetWords": 50,
      "meetsTarget": true,
      "grammarIssues": [],
      "vocabularyComment": ""
    },
    "task_1_2": {
      "wordCount": ${w2},
      "targetWords": 150,
      "meetsTarget": true,
      "grammarIssues": [],
      "vocabularyComment": ""
    },
    "part_2": {
      "wordCount": ${w3},
      "targetWords": 200,
      "meetsTarget": true,
      "grammarIssues": [],
      "vocabularyComment": ""
    }
  },
  "vocabularyLevelOverall": "",
  "overallCefrBand": "",
  "overallFeedbackUz": ""
}

Recompute wordCount fields in JSON to match your own counting (may differ slightly from sanity line).`;

        const rawOut = await groqCompleteMessages(
            [{ role: "system", content: system }, { role: "user", content: userPayload }],
            { temperature: 0.25, max_tokens: 4096 },
        );

        let parsed = extractWritingJson(rawOut);
        if (!parsed || typeof parsed !== "object" || !parsed.tasks || typeof parsed.tasks !== "object") {
            return res.status(502).json({
                success: false,
                error: "AI javobini tahlil qilib bo'lmadi. Qayta urinib ko'ring.",
                rawPreview: String(rawOut || "").slice(0, 800),
            });
        }

        return res.json({
            success: true,
            report: parsed,
            model: GROQ_MODEL,
        });
    } catch (error) {
        return mapWritingCheckFailure(error, res);
    }
}

/**
 * Dashboard Writing (bitta textarea): grammatika/imlo, lug‘at, IELTS + CEFR taxminiy ball — JSON.
 */
async function feedbackDashboardWriting(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY yo'q.",
            });
        }

        const userText = String(req.body?.userText ?? "").trim();
        const level = String(req.body?.level ?? "A2").trim().toUpperCase().slice(0, 10) || "A2";
        const dayNumber = Math.min(30, Math.max(1, Math.floor(Number(req.body?.dayNumber)) || 1));
        const title = String(req.body?.title ?? "").trim().slice(0, 800) || "Daily writing";
        const context = String(req.body?.context ?? "").trim().slice(0, 4000);
        const q1 = String(req.body?.promptTask_1_1 ?? "").trim().slice(0, 4000);
        const q2 = String(req.body?.promptTask_1_2 ?? "").trim().slice(0, 4000);
        const q3 = String(req.body?.promptPart_2 ?? "").trim().slice(0, 4000);

        const wc = String(userText || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean).length;
        if (wc < 15) {
            return res.status(400).json({
                success: false,
                error: "Kamida 15 ta so'z yozing — tekshirish uchun javob juda qisqa.",
            });
        }
        if (wc > 5500) {
            return res.status(400).json({
                success: false,
                error: "Matn juda uzun (maksimum ~5500 so'z).",
            });
        }

        const system = [
            "You are an expert English writing examiner (IELTS Writing + CEFR).",
            "The learner is working on a three-part daily assignment but submits ONE combined response — assess it as a whole against the prompts and context.",
            "Grammar & spelling: list concrete issues with corrections (brief).",
            "Vocabulary: suggest richer alternatives where helpful (not for every word).",
            "Band score: give ONE estimated IELTS Writing band (half-bands ok, e.g. 6.5) AND ONE CEFR label (A2, B1, B1+, B2, etc.) consistent with the text.",
            "All explanatory prose for the teacher card MUST be in Uzbek (noteUz, summaryUz, shortRationaleUz).",
            "Respond with VALID JSON ONLY — no markdown fences, no text outside JSON.",
        ].join(" ");

        const userPayload = `
COURSE LEVEL (band): ${level}
DAY: ${dayNumber}
TITLE: ${title}

CONTEXT / SITUATION (may be empty):
${context || "(none)"}

TASK PROMPTS (what the student should address):
--- Task 1.1 ---
${q1 || "(not set)"}
--- Task 1.2 ---
${q2 || "(not set)"}
--- Part 2 ---
${q3 || "(not set)"}

WORD COUNT (informational): ${wc}

LEARNER TEXT (English only — this is what you grade):
---
${userText}
---

Return exactly this JSON shape (fill all strings; arrays may be empty but prefer 3–8 grammar items and 3–6 vocabulary suggestions when issues exist):
{
  "grammarAndSpelling": {
    "summaryUz": "",
    "fixes": [
      { "snippet": "", "correction": "", "noteUz": "" }
    ]
  },
  "vocabulary": {
    "summaryUz": "",
    "upgradeSuggestions": [
      { "from": "", "to": "", "noteUz": "" }
    ]
  },
  "bandScore": {
    "ieltsWriting": "",
    "cefr": "",
    "shortRationaleUz": ""
  }
}`;

        const rawOut = await groqCompleteMessages(
            [{ role: "system", content: system }, { role: "user", content: userPayload }],
            { temperature: 0.28, max_tokens: 3500 },
        );

        let parsed = extractWritingJson(rawOut);
        if (
            !parsed ||
            typeof parsed !== "object" ||
            !parsed.grammarAndSpelling ||
            !parsed.vocabulary ||
            !parsed.bandScore
        ) {
            return res.status(502).json({
                success: false,
                error: "AI javobini tahlil qilib bo'lmadi. Qayta urinib ko'ring.",
                rawPreview: String(rawOut || "").slice(0, 600),
            });
        }

        return res.json({
            success: true,
            feedback: parsed,
            wordCount: wc,
            model: GROQ_MODEL,
        });
    } catch (error) {
        return mapWritingCheckFailure(error, res);
    }
}

/**
 * Dashboard Writing: 3 ta alohida javob — har biri uchun IELTS band, tavsiyalar (UZ),
 * grammatikani ko‘rsatish uchun ketma-ket segmentlar (displaySegments).
 */
async function feedbackWritingThreeTasks(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY yo'q.",
            });
        }

        const t1 = String(req.body?.task_1_1 ?? "").trim();
        const t2 = String(req.body?.task_1_2 ?? "").trim();
        const t3 = String(req.body?.part_2 ?? "").trim();
        const level = String(req.body?.level ?? "A2").trim().toUpperCase().slice(0, 10) || "A2";
        const dayNumber = Math.min(30, Math.max(1, Math.floor(Number(req.body?.dayNumber)) || 1));
        const title = String(req.body?.title ?? "").trim().slice(0, 800) || "Daily writing";
        const context = String(req.body?.context ?? "").trim().slice(0, 4000);
        const q1 = String(req.body?.promptTask_1_1 ?? "").trim().slice(0, 4000);
        const q2 = String(req.body?.promptTask_1_2 ?? "").trim().slice(0, 4000);
        const q3 = String(req.body?.promptPart_2 ?? "").trim().slice(0, 4000);

        const wc = (s) =>
            String(s || "")
                .trim()
                .split(/\s+/)
                .filter(Boolean).length;
        const w1 = wc(t1);
        const w2 = wc(t2);
        const w3 = wc(t3);

        if (w1 < 50) {
            return res.status(400).json({
                success: false,
                error: `Task 1.1: kamida 50 ta so'z bo'lishi kerak (hozir ${w1}).`,
            });
        }
        if (w2 < 120 || w2 > 160) {
            return res.status(400).json({
                success: false,
                error: `Task 1.2: taxminan 120–150 so'z (qo'yilgan oralik: 120–160; hozir ${w2}).`,
            });
        }
        if (w3 < 175 || w3 > 215) {
            return res.status(400).json({
                success: false,
                error: `Part 2: taxminan 180–200 so'z (qo'yilgan oralik: 175–215; hozir ${w3}).`,
            });
        }

        const system = [
            "You are a professional Writing Examiner (IELTS Writing-style assessment).",
            "You review three SEPARATE learner submissions (Task 1.1, Task 1.2, Part 2) against their prompts.",
            "",
            "FEEDBACK SHAPE (Uzbek for all explanatory text):",
            "- Task 1.1: ieltsWritingBand (e.g. 6.5) + recommendationsUz = ONLY a short, practical tip (qisqa maslahat). 2–4 sentences max.",
            "- Task 1.2: ieltsWritingBand + recommendationsUz = grammar AND word choice analysis (Grammatika va Word Choice tahlili). Substantive but clear.",
            "- Part 2: ieltsWritingBand + recommendationsUz = logical coherence and cohesion of ideas (mantiqiy izchillik tahlili): paragraph flow, linking, relevance to the prompt.",
            "",
            "GRAMMAR FIXES — for EACH task, grammarFixes: array of up to 8 objects: { mistake, correction, noteUz }.",
            "  mistake = exact learner substring that is wrong (short phrase); correction = corrected English; noteUz = short rule hint in Uzbek.",
            "  Include tense, article, preposition, subject-verb, spelling, word order issues. If none, use empty array [].",
            "",
            "ROOT SCORES (integers 1–10):",
            "- vocabularyScoreOutOfTen: how appropriate and varied the vocabulary is across ALL three tasks (range, collocations, formal/informal fit).",
            "- overallHolisticScoreOutOfTen: overall writing quality (task response + grammar + vocabulary + coherence) as ONE holistic score.",
            "- scoreRationaleUz: one short paragraph in Uzbek explaining both scores (2–4 sentences).",
            "",
            "ALSO at JSON root:",
            "- overallSummaryUz: umumiy xulosa (Uzbek, 3–6 sentences).",
            "- nextLessonRecommendationUz: keyingi dars uchun bitta aniq tavsiya (Uzbek).",
            "",
            "TECHNICAL — displaySegments: for each task, ORDERED array of { text, isGrammarError? } that CONCATENATE to the learner's EXACT text (same characters).",
            "Mark isGrammarError: true only on grammar/spelling spans. If no issues, one segment with full text, isGrammarError false.",
            "Respond with VALID JSON ONLY — no markdown, no text outside JSON.",
        ].join("\n");

        const userPayload = `
LEVEL: ${level}
DAY: ${dayNumber}
TITLE: ${title}

CONTEXT:
${context || "(none)"}

--- PROMPT Task 1.1 ---
${q1 || "(not set)"}
--- LEARNER Task 1.1 (${w1} words) ---
${t1}

--- PROMPT Task 1.2 ---
${q2 || "(not set)"}
--- LEARNER Task 1.2 (${w2} words) ---
${t2}

--- PROMPT Part 2 ---
${q3 || "(not set)"}
--- LEARNER Part 2 (${w3} words) ---
${t3}

Return this JSON shape exactly:
{
  "vocabularyScoreOutOfTen": 7,
  "overallHolisticScoreOutOfTen": 7,
  "scoreRationaleUz": "",
  "overallSummaryUz": "",
  "nextLessonRecommendationUz": "",
  "tasks": {
    "task_1_1": {
      "ieltsWritingBand": "",
      "recommendationsUz": "",
      "grammarFixes": [ { "mistake": "", "correction": "", "noteUz": "" } ],
      "displaySegments": [ { "text": "", "isGrammarError": false } ]
    },
    "task_1_2": {
      "ieltsWritingBand": "",
      "recommendationsUz": "",
      "grammarFixes": [ { "mistake": "", "correction": "", "noteUz": "" } ],
      "displaySegments": [ { "text": "", "isGrammarError": false } ]
    },
    "part_2": {
      "ieltsWritingBand": "",
      "recommendationsUz": "",
      "grammarFixes": [ { "mistake": "", "correction": "", "noteUz": "" } ],
      "displaySegments": [ { "text": "", "isGrammarError": false } ]
    }
  }
}`;

        const rawOut = await groqCompleteMessages(
            [{ role: "system", content: system }, { role: "user", content: userPayload }],
            { temperature: 0.22, max_tokens: 6000 },
        );

        let parsed = extractWritingJson(rawOut);
        if (
            !parsed ||
            typeof parsed !== "object" ||
            !parsed.tasks ||
            typeof parsed.tasks !== "object"
        ) {
            return res.status(502).json({
                success: false,
                error: "AI javobini tahlil qilib bo'lmadi. Qayta urinib ko'ring.",
                rawPreview: String(rawOut || "").slice(0, 600),
            });
        }

        const keys = ["task_1_1", "task_1_2", "part_2"];
        const originals = { task_1_1: t1, task_1_2: t2, part_2: t3 };
        for (const k of keys) {
            const tk = parsed.tasks[k];
            if (!tk || typeof tk !== "object") {
                return res.status(502).json({
                    success: false,
                    error: `AI javobida '${k}' bloki yetishmayapti.`,
                });
            }
            const segs = Array.isArray(tk.displaySegments) ? tk.displaySegments : [];
            const joined = segs.map((s) => String(s?.text ?? "")).join("");
            if (joined !== originals[k]) {
                tk.displaySegments = [{ text: originals[k], isGrammarError: false }];
                tk._highlightMismatch = true;
            }
            if (!Array.isArray(tk.grammarFixes)) tk.grammarFixes = [];
            tk.grammarFixes = tk.grammarFixes
                .filter((x) => x && typeof x === "object")
                .slice(0, 12)
                .map((x) => ({
                    mistake: String(x.mistake ?? x.original ?? "").trim(),
                    correction: String(x.correction ?? x.corrected ?? "").trim(),
                    noteUz: String(x.noteUz ?? x.ruleUz ?? "").trim(),
                }))
                .filter((x) => x.mistake || x.correction || x.noteUz);
        }

        let vS = Math.round(Number(parsed.vocabularyScoreOutOfTen));
        let hS = Math.round(Number(parsed.overallHolisticScoreOutOfTen));
        if (Number.isFinite(vS) && vS >= 1 && vS <= 10) parsed.vocabularyScoreOutOfTen = vS;
        else delete parsed.vocabularyScoreOutOfTen;
        if (Number.isFinite(hS) && hS >= 1 && hS <= 10) parsed.overallHolisticScoreOutOfTen = hS;
        else delete parsed.overallHolisticScoreOutOfTen;

        return res.json({
            success: true,
            report: parsed,
            wordCounts: { task_1_1: w1, task_1_2: w2, part_2: w3 },
            model: GROQ_MODEL,
        });
    } catch (error) {
        return mapWritingCheckFailure(error, res);
    }
}

/**
 * Dashboard Reading exam: faqat NOTO'G'RI javoblar uchun AI tahlil (passage asosida).
 */
async function analyzeReadingExamMistakes(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY yo'q.",
            });
        }

        const passage = String(req.body?.passage ?? "").trim().slice(0, 14000);
        /** @type {unknown[]} */
        const rawItems = Array.isArray(req.body?.mistakes) ? req.body.mistakes : [];

        if (!passage || passage.length < 80) {
            return res.status(400).json({
                success: false,
                error: "Reading matni yetarli uzunlikda kelmadi.",
            });
        }

        const mistakes = rawItems
            .filter((m) => m && typeof m === "object")
            .map((m) => ({
                questionId: Number((/** @type {Record<string, unknown>} */ (m)).questionId),
                stem: String((/** @type {Record<string, unknown>} */ (m)).stem ?? "").slice(0, 800),
                userAnswerLabel: String(
                    (/** @type {Record<string, unknown>} */ (m)).userAnswerLabel ?? "",
                ).slice(0, 200),
                correctAnswerLabel: String(
                    (/** @type {Record<string, unknown>} */ (m)).correctAnswerLabel ?? "",
                ).slice(0, 200),
            }))
            .filter((row) => Number.isFinite(row.questionId));

        if (mistakes.length === 0) {
            return res.json({
                success: true,
                analyses: [],
                noteUz: "Barcha javoblar toʻgʻri — alohida tahlil yoʻq.",
            });
        }

        const system = [
            "Sen Reading Mentorisan. Faqat NOTO'G'RI qilingan javoblarni alohida tahlil qilasan.",
            "",
            "HAR BIR XATO uchun asosiy yozilish qolibi (o‘zbekcha, yakuniy foydalanuvchi ko‘rinishi uchun shu tuzilishga yaqin yoz):",
            "«Siz [X] deb javob berdingiz, lekin matnning [P] paragrafida shunday deyilgan …, shuning uchun javob [Y] bo'ladi.»",
            "Bu yerda [X]=o‘quvchini tanlagan javob (so‘zlari bilan), [P]=paragraf raqomi (PASSAGEdagi blok bo‘yicha: 1, 2, 3…), tekstdan INGLIZCHA iqtibos excerptFromPassage maydoniga, [Y]=to‘g‘ri javob.",
            "",
            "explanationUz: yuqoridagi qolib bo‘yicha 2–5 jumla; albatta paragraf raqami va X, Y aniqligi bo‘lsin.",
            "whereCorrectAnswerUz: qisqa ravishda to‘g‘ri javob matn qaysi joyda aks etganini yoz (paragraf + g‘oya).",
            "",
            "TECH (faqat JSON, markdown yo'q): { \"analyses\": [ ... ] }",
            'Har bir element: "questionId" (raqam), "excerptFromPassage" (majburiy: ANIQ inglizcha qisqa iqtibos — PASSAGEdan), ',
            '"explanationUz" (o‘zbekcha, qolibga mos), ',
            '"whereCorrectAnswerUz" (o‘zbekcha, qisqa).',
            "",
            "MULTIPLE CHOICE va VOCAB uchun ham bir xil mantiqqa amal qil: asosiy faktni inglizcha iqtibos bilan ko‘rsat.",
            "Faqat berilgan PASSAGE; iqtibosni uydirmang.",
        ].join("\n");

        const userBlob = mistakes
            .map(
                (m) =>
                    `ID ${m.questionId}\nQ: ${m.stem}\nLearner answered: ${m.userAnswerLabel}\nCorrect: ${m.correctAnswerLabel}`,
            )
            .join("\n\n---\n\n");

        const userPayload = `READING PASSAGE (ground truth):\n---\n${passage}\n---\n\nMISTAKEN ITEMS:\n${userBlob}\n\nReturn: { \"analyses\": [ ... ] }`;

        const rawOut = await groqCompleteMessages(
            [{ role: "system", content: system }, { role: "user", content: userPayload }],
            { temperature: 0.22, max_tokens: 3500 },
        );

        let parsed = extractWritingJson(rawOut);
        /** @type {unknown[]} */
        let analyses = parsed && typeof parsed === "object" && Array.isArray(parsed.analyses) ? parsed.analyses : [];

        analyses = analyses
            .map((row) => {
                if (!row || typeof row !== "object") return null;
                const r = /** @type {Record<string, unknown>} */ (row);
                const qid = Math.floor(Number(r.questionId));
                if (!Number.isFinite(qid)) return null;
                return {
                    questionId: qid,
                    excerptFromPassage: String(r.excerptFromPassage ?? r.excerpt ?? "").trim(),
                    explanationUz: String(r.explanationUz ?? "").trim(),
                    whereCorrectAnswerUz: String(r.whereCorrectAnswerUz ?? "").trim(),
                };
            })
            .filter(Boolean)
            .slice(0, 20);

        return res.json({
            success: true,
            analyses,
            model: GROQ_MODEL,
        });
    } catch (error) {
        return mapWritingCheckFailure(error, res);
    }
}

/** Dashboard Grammar 20-savol testi: xatolar uchun qisqa AI mentor (o‘zbekcha). */
async function analyzeGrammarQuizMistakes(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY yo'q.",
            });
        }

        const grammarLabel = String(req.body?.grammarLabel ?? "").trim().slice(0, 400);
        /** @type {unknown[]} */
        const rawItems = Array.isArray(req.body?.mistakes) ? req.body.mistakes : [];

        const mistakes = rawItems
            .filter((m) => m && typeof m === "object")
            .map((m) => ({
                questionId: Number((/** @type {Record<string, unknown>} */ (m)).questionId),
                stem: String((/** @type {Record<string, unknown>} */ (m)).stem ?? "").slice(0, 600),
                userAnswerLabel: String(
                    (/** @type {Record<string, unknown>} */ (m)).userAnswerLabel ?? "",
                ).slice(0, 220),
                correctAnswerLabel: String(
                    (/** @type {Record<string, unknown>} */ (m)).correctAnswerLabel ?? "",
                ).slice(0, 220),
            }))
            .filter((row) => Number.isFinite(row.questionId));

        if (mistakes.length === 0) {
            return res.json({
                success: true,
                analyses: [],
                noteUz: "Barcha javoblar toʻgʻri — alohida tahlil yoʻq.",
            });
        }

        const system = [
            "Sen Grammar mentorisan. Foydalanuvchi inglizcha MCQ testida xato qilgan savollarni qisqa, aniq o‘zbekcha bilan tushuntiras.",
            "Har bir xato uchun: nima uchun to‘g‘ri variant boshqa ekanini (grammatik qoida bilan) 2–4 jumla.",
            "",
            "Javob: faqat JSON, markdown yo'q: { \"analyses\": [ { \"questionId\": number, \"explanationUz\": string } ] }",
            "Faqat berilgan savol matni va javob variantlariga tayangan holda yoz; ixtiro qilma.",
        ].join("\n");

        const userBlob = mistakes
            .map(
                (m) =>
                    `ID ${m.questionId}\nSavol: ${m.stem}\nTalaba: ${m.userAnswerLabel}\nTo'g'ri: ${m.correctAnswerLabel}`,
            )
            .join("\n\n---\n\n");

        const ctxLine = grammarLabel ? `Kontekst (bo'lim): ${grammarLabel}\n\n` : "";
        const userPayload = `${ctxLine}XATO SAVOLLAR:\n${userBlob}\n\nReturn: { \"analyses\": [ ... ] }`;

        const rawOut = await groqCompleteMessages(
            [{ role: "system", content: system }, { role: "user", content: userPayload }],
            { temperature: 0.25, max_tokens: 2800 },
        );

        let parsed = extractWritingJson(rawOut);
        /** @type {unknown[]} */
        let analyses =
            parsed && typeof parsed === "object" && Array.isArray(parsed.analyses) ? parsed.analyses : [];

        analyses = analyses
            .map((row) => {
                if (!row || typeof row !== "object") return null;
                const r = /** @type {Record<string, unknown>} */ (row);
                const qid = Math.floor(Number(r.questionId));
                if (!Number.isFinite(qid)) return null;
                return {
                    questionId: qid,
                    explanationUz: String(r.explanationUz ?? "").trim().slice(0, 2000),
                };
            })
            .filter(Boolean)
            .slice(0, 25);

        return res.json({
            success: true,
            analyses,
            model: GROQ_MODEL,
        });
    } catch (error) {
        return mapWritingCheckFailure(error, res);
    }
}

/** Dashboard diktat: talaba yozuvi vs rasmiy transcript — aniqlik %, imlo, yo‘qlik. */
async function validateDictationAgainstTranscript(req, res) {
    try {
        if (!isGroqApiKeyConfigured()) {
            return res.status(503).json({
                success: false,
                errorCode: "MISSING_GROQ_API_KEY",
                error: "AI bilan ulanib bo'lmadi — server `.env` faylida GROQ_API_KEY yo'q.",
            });
        }

        const userText =
            typeof req.body?.userText === "string"
                ? req.body.userText.trim()
                : String(req.body?.userText ?? "").trim();
        const reference =
            typeof req.body?.referenceTranscript === "string"
                ? req.body.referenceTranscript.trim()
                : String(req.body?.referenceTranscript ?? "").trim();
        const dayNumber = Math.min(30, Math.max(1, Math.floor(Number(req.body?.dayNumber)) || 1));

        if (!reference || reference.length < 10) {
            return res.status(400).json({
                success: false,
                error: "Taqqoslash uchun transcript juda qisqa yoki mavjud emas.",
            });
        }
        if (!userText || userText.length < 10) {
            return res.status(400).json({
                success: false,
                error: "Dikat matni uchun kamida 10 ta belgi yozing.",
            });
        }

        const ut = userText.slice(0, 7500);
        const ref = reference.slice(0, 7500);

        const prompt = `You evaluate an English listening dictation. Compare the STUDENT transcription to the REFERENCE transcript (ground truth).

Reference is the authoritative text the student heard. Student text may omit words, spell wrong, or add extras.

Respond VALID JSON ONLY (no markdown fences). Keys:
- "accuracyPercent": integer 0-100 reflecting overall match (semantic + spelling weighted; heavy penalties for missed key words).
- "spellingMistakes": array of objects { "studentWrote": "", "correct": "", "noteUz": "short Uzbek optional" } listing clear spelling/word errors vs reference (may be partial words).
- "missingWordsOrPhrases": array of strings — important chunks present in REFERENCE missing or badly mangled in student text (short phrases).
- "extraIncorrectBits": optional array — student added wrong bits not supported by audio context (may be empty).
- "feedbackUz": 3–6 sentences in Uzbek summarizing performance and encouragement.

REFERENCE TRANSCRIPT (${dayNumber}-kun):\n---
${ref}
---

STUDENT DICTATION:\n---
${ut}
---

Be fair: minor punctuation/capitalization differences may be noted but should not dominate the percentage.`;

        const rawOut = await groqCompleteMessages([{ role: "user", content: prompt }], {
            temperature: 0.22,
            max_tokens: 2800,
        });

        let parsed = extractWritingJson(rawOut);
        if (!parsed || typeof parsed !== "object") parsed = {};

        let accuracyPercent = Math.round(Number(parsed.accuracyPercent));
        if (!Number.isFinite(accuracyPercent)) accuracyPercent = 50;
        accuracyPercent = Math.min(100, Math.max(0, accuracyPercent));

        const spellingMistakes = Array.isArray(parsed.spellingMistakes)
            ? parsed.spellingMistakes
                  .map((row) => {
                      if (typeof row === "string") {
                          return {
                              studentWrote: row.trim(),
                              correct: "",
                              noteUz: "",
                          };
                      }
                      if (row && typeof row === "object") {
                          return {
                              studentWrote: String(
                                  row.studentWrote ?? row.wrong ?? row.from ?? "",
                              ).trim(),
                              correct: String(
                                  row.correct ?? row.right ?? row.to ?? "",
                              ).trim(),
                              noteUz: String(row.noteUz ?? row.note ?? "").trim(),
                          };
                      }
                      return null;
                  })
                  .filter((x) => x && (x.studentWrote || x.correct))
                  .slice(0, 24)
            : [];

        const missingWordsOrPhrases = Array.isArray(parsed.missingWordsOrPhrases)
            ? parsed.missingWordsOrPhrases.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 24)
            : [];

        const extraIncorrectBits = Array.isArray(parsed.extraIncorrectBits)
            ? parsed.extraIncorrectBits.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 16)
            : [];

        const feedbackUz =
            typeof parsed.feedbackUz === "string" && parsed.feedbackUz.trim()
                ? parsed.feedbackUz.trim()
                : "Tekshiruv yakunlandi.";

        return res.json({
            success: true,
            accuracyPercent,
            spellingMistakes,
            missingWordsOrPhrases,
            extraIncorrectBits,
            feedbackUz,
            model: GROQ_MODEL,
        });
    } catch (error) {
        return mapWritingCheckFailure(error, res);
    }
}

module.exports = {
    getAIResponse,
    chat: getAIResponse,
    startOnboarding,
    analyzeWriting,
    validateVocabulary,
    validateListeningSummary,
    checkDashboardWriting,
    evaluateDashboardWritingThreeTasks,
    feedbackDashboardWriting,
    feedbackWritingThreeTasks,
    validateDictationAgainstTranscript,
    analyzeReadingExamMistakes,
    analyzeGrammarQuizMistakes,
};
