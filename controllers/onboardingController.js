const { GoogleGenerativeAI } = require("@google/generative-ai");

const SYSTEM_PROMPT =
  "Sen EduNext AI yordamchisisan. Maqsading o'quvchining o'rganish uslubini (vizual, audio, mantiq) va bilim darajasini aniqlash. Suhbat do'stona va motivatsion bo'lsin.";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL_CANDIDATES = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-2.0-flash",
  "gemini-1.5-pro-latest",
];

function isModelNotFoundError(err) {
  const msg = String(err?.message || "");
  return err?.status === 404 || /not found|not supported/i.test(msg);
}

const onboardingChat = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        error: "message matn ko'rinishida yuborilishi kerak",
      });
    }

    let aiReply = "";
    let usedModel = "";
    let lastError = null;
    for (const modelName of GEMINI_MODEL_CANDIDATES) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [{ text: `System Prompt: ${SYSTEM_PROMPT}\n\nUser: ${message}` }],
            },
          ],
        });
        aiReply = result.response.text();
        usedModel = modelName;
        break;
      } catch (err) {
        lastError = err;
        if (!isModelNotFoundError(err)) break;
      }
    }
    if (!aiReply) throw lastError || new Error("Gemini model topilmadi");

    return res.status(200).json({
      success: true,
      reply: aiReply,
      model: usedModel,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Gemini bilan onboarding suhbatida xatolik yuz berdi",
      details: error.message,
    });
  }
};

module.exports = {
  onboardingChat,
};
