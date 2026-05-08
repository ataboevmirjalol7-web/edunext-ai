import React, { useMemo, useState } from "react";

/**
 * Dashboard Vocabulary — faqat gap tuzish bosqichi (matnli yo‘riqnoma kartalari yo‘q).
 * Talab: `react`, `react-dom`.
 *
 * Gap sanash: `public/script.js` dagi `countDashboardVocabularySentences` bilan bir xil qoida.
 */
function countVocabularySentences(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/\r\n/g, "\n");
  if (!s) return 0;
  return s
    .split(/\n+|(?<=[.!?])[ \t]*/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

const EXPECTED_SENTENCES = 20;

const VocabularySection = ({
  className = "",
  /** AI `/api/ai/validate-vocabulary` uchun checklist so‘zlari */
  words = [],
  onAnalyze,
}) => {
  const [sentences, setSentences] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const sentenceCount = useMemo(
    () => countVocabularySentences(sentences),
    [sentences],
  );

  const canSubmit =
    sentenceCount >= EXPECTED_SENTENCES && !isAnalyzing;

  const analyzeSentences = async () => {
    if (!canSubmit) return;
    setFeedback(null);
    setIsAnalyzing(true);
    try {
      if (typeof onAnalyze === "function") {
        const result = await onAnalyze({
          text: sentences,
          words: Array.isArray(words) ? words : [],
          sentenceCount,
        });
        setFeedback(
          typeof result === "string"
            ? result
            : result?.feedbackUz ?? JSON.stringify(result),
        );
      } else {
        await new Promise((r) => setTimeout(r, 1500));
        setFeedback(
          "Demo: `onAnalyze` ulanmagan — backendda validate-vocabulary ga ulang.",
        );
      }
    } catch (e) {
      setFeedback(String(e?.message ?? e ?? "Xato"));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className={`space-y-6 ${className}`.trim()}>
      {/* Sarlavha */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">
          Kunlik lug&apos;at: 20 ta yangi so&apos;zni yodlang
        </h2>
        <span className="rounded-md bg-slate-800 px-3 py-1 text-xs uppercase text-slate-400">
          Vocabulary
        </span>
      </div>

      {/* 2-bosqich: gap tuzish */}
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="space-y-2 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            2-Bosqich • Gap Tuzish
          </p>
          <h3 className="text-2xl font-bold text-white">
            Yodlangan so&apos;zlar bilan 20 ta gap tuzing
          </h3>
        </div>

        <div className="group relative">
          <textarea
            value={sentences}
            onChange={(e) => setSentences(e.target.value)}
            className="h-64 w-full rounded-xl border border-slate-800 bg-slate-950 p-5 text-slate-200 outline-none transition-all placeholder:text-slate-700 focus:ring-2 focus:ring-emerald-500/50"
            placeholder="Har bir gapni yangi qatordan yozing..."
            rows={12}
            aria-label="Ingliz tilida gaplar"
          />

          <div
            className={`pointer-events-none absolute bottom-4 right-4 rounded-lg border px-3 py-1 font-mono text-xs ${
              sentenceCount >= EXPECTED_SENTENCES
                ? "border-emerald-700/60 bg-slate-900 text-emerald-400"
                : "border-slate-800 bg-slate-900 text-slate-400"
            }`}
          >
            Gaplar: {sentenceCount} / {EXPECTED_SENTENCES}
          </div>
        </div>

        <button
          type="button"
          onClick={analyzeSentences}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-emerald-600 py-4 font-bold text-white shadow-lg shadow-emerald-900/20 transition-all hover:bg-emerald-500 disabled:opacity-50"
        >
          {isAnalyzing ? "Tahlil qilinmoqda..." : "AI MENTOR BILAN TEKSHIRISH"}
        </button>

        {feedback ? (
          <div
            className="rounded-xl border border-slate-700 bg-slate-950/80 p-4 text-sm whitespace-pre-wrap text-slate-200"
            role="status"
            aria-live="polite"
          >
            {feedback}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default VocabularySection;
