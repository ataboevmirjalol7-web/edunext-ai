import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * Bitta MCQ savol shakli — Supabase `grammar_tasks.questions` JSON
 * ichida shu uchta maydon bo'lishi kutiladi:
 *   { stem, options: string[], correctIndex }
 * Bazada `correct` ("A"/"B"/...) yoki `correct_index` shaklida bo'lsa ham
 * normalizator harf->index ga keltiradi.
 */
type GrammarQuestion = {
  id: number;
  stem: string;
  options: string[];
  correctIndex: number;
};

type GrammarRow = {
  title?: string | null;
  pdf_url?: string | null;
  questions?: unknown;
};

/** Supabase'dan kelgan ixtiyoriy shakldagi savol massivini bir xil shaklga keltiradi. */
function normalizeQuestions(raw: unknown): GrammarQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: GrammarQuestion[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const stem = String(o.stem ?? o.question ?? o.prompt ?? "").trim();
    const opts = Array.isArray(o.options)
      ? (o.options as unknown[])
          .map((x) => String(x ?? "").trim())
          .filter(Boolean)
      : [];
    if (!stem || opts.length < 2) continue;
    let ci = Number(
      (o.correctIndex as unknown) ??
        (o.correct_index as unknown) ??
        (o.answerIndex as unknown) ??
        -1,
    );
    if (!Number.isFinite(ci) || ci < 0 || ci >= opts.length) {
      const letter = String(o.correct ?? o.answer ?? "")
        .trim()
        .toUpperCase()
        .charCodeAt(0);
      if (letter >= 65 && letter < 65 + opts.length) ci = letter - 65;
      else ci = 0;
    }
    out.push({
      id: i + 1,
      stem,
      options: opts,
      correctIndex: Math.min(opts.length - 1, Math.max(0, Math.floor(ci))),
    });
  }
  return out;
}

/**
 * Test natijasini Dashboard'ning «Joriy daraja» bo'limiga yozadi:
 *   1) DOM da `#dashboard-level-display` ni darhol yangilaydi (sahifada bo'lsa).
 *   2) localStorage `edunext_grammar_day1_score` — boshqa modullar (script.js)
 *      o'qib, refresh paytida ham qayta ko'rsata oladi.
 *   3) Custom event `grammar:level-update` — listenerlar uchun.
 */
function updateDashboardDarajaWithScore(correct: number, total: number) {
  const scoreLine = `${correct}/${total} · Grammar Day 1`;
  try {
    const el = document.getElementById("dashboard-level-display");
    if (el) {
      const prev = el.getAttribute("data-base-level") || el.textContent || "";
      if (!el.getAttribute("data-base-level")) {
        el.setAttribute("data-base-level", prev.trim());
      }
      el.innerHTML = `
        <span>${prev.replace(/\s*·\s*\d+\/\d+\s*·\s*Grammar.*$/i, "").trim()}</span>
        <span class="ml-2 inline-block rounded-md border border-fuchsia-400/45 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-bold tracking-wide text-fuchsia-200 align-middle">
          ${scoreLine}
        </span>
      `;
    }
  } catch (_) {
    /* ignore DOM access errors */
  }
  try {
    localStorage.setItem(
      "edunext_grammar_day1_score",
      JSON.stringify({ correct, total, savedAt: Date.now() }),
    );
  } catch (_) {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent("grammar:level-update", {
        detail: { correct, total, day: 1 },
      }),
    );
  } catch (_) {
    /* ignore */
  }
}

const GrammarSection: React.FC = () => {
  const [timeLeft, setTimeLeft] = useState(30 * 60);
  const [phase, setPhase] = useState<"reading" | "test" | "result">("reading");
  const [grammarData, setGrammarData] = useState<GrammarRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<GrammarQuestion[]>([]);

  /** Joriy savol indeksi (test bosqichida). */
  const [currentIndex, setCurrentIndex] = useState(0);
  /** Hozirgi tanlangan variant (null = hali bosilmagan). */
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  /** Oldingi javoblar (correct/total ni hisoblash uchun). */
  const [answers, setAnswers] = useState<{ correct: boolean }[]>([]);
  /** Fade-in animatsiyani har bir savol ko'rsatilganda qayta tetiklash uchun. */
  const [fadeKey, setFadeKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("grammar_tasks")
          .select("title,pdf_url,questions")
          .eq("day_number", 1)
          .single();
        if (cancelled) return;
        const row = (data as GrammarRow | null) || null;
        setGrammarData(row);
        const qs = normalizeQuestions(
          row?.questions != null
            ? Array.isArray(row.questions)
              ? row.questions
              : (row.questions as { questions?: unknown }).questions
            : null,
        );
        setQuestions(qs);
      } catch (_) {
        if (!cancelled) setQuestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "reading") return;
    if (timeLeft <= 0) {
      setPhase("test");
      return;
    }
    const t = window.setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [timeLeft, phase]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const totalQuestions = questions.length;
  const progressPct = useMemo(() => {
    if (!totalQuestions) return 0;
    if (phase === "result") return 100;
    return ((currentIndex + 1) / totalQuestions) * 100;
  }, [currentIndex, totalQuestions, phase]);

  const correctCount = useMemo(
    () => answers.filter((a) => a.correct).length,
    [answers],
  );

  /**
   * Variantni tanlash: tanlovni belgilab qo'yamiz, javobni log qilamiz va
   * 520ms keyin keyingi savolga silliq o'tamiz (`fadeKey` o'zgarishi
   * `animate-grammar-fade-in` ni qaytadan ishga tushiradi).
   */
  const handleSelect = (oi: number) => {
    if (phase !== "test") return;
    if (selectedIndex !== null) return;
    const q = questions[currentIndex];
    if (!q) return;
    setSelectedIndex(oi);
    const ok = oi === q.correctIndex;
    const nextAnswers = [...answers, { correct: ok }];
    setAnswers(nextAnswers);
    window.setTimeout(() => {
      const nextIdx = currentIndex + 1;
      if (nextIdx >= totalQuestions) {
        setPhase("result");
        const finalCorrect = nextAnswers.filter((a) => a.correct).length;
        updateDashboardDarajaWithScore(finalCorrect, totalQuestions);
      } else {
        setCurrentIndex(nextIdx);
        setSelectedIndex(null);
        setFadeKey((k) => k + 1);
      }
    }, 520);
  };

  const restartTest = () => {
    setAnswers([]);
    setCurrentIndex(0);
    setSelectedIndex(null);
    setFadeKey((k) => k + 1);
    setPhase("test");
  };

  const currentQuestion = questions[currentIndex];

  return (
    <div className="h-screen bg-[#070708] text-white flex flex-col overflow-hidden">
      {/* ── HEADER: Mavzu sarlavhasi + PDF + 30 daqiqalik taymer ── */}
      <div className="w-full border-b border-[#a855f7]/50 bg-[#0a0a0c] px-8 py-4 flex justify-between items-center shadow-[0_4px_20px_rgba(168,85,247,0.1)]">
        <div className="flex flex-col">
          <span className="text-[#a855f7] text-xs font-bold tracking-[0.2em] uppercase">
            Day 1 - Grammar Section
          </span>
          <h1 className="text-2xl font-black text-white mt-1">
            {loading ? "Yuklanmoqda..." : grammarData?.title || "Grammar Day 1"}
          </h1>
        </div>

        <div className="flex items-center gap-8">
          {grammarData?.pdf_url ? (
            <a
              href={grammarData.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-white/5 hover:bg-[#a855f7]/20 border border-white/10 px-6 py-2.5 rounded-xl transition-all font-bold text-sm tracking-wide"
            >
              <span className="text-xl">📚</span> PDF KITOBNI O'QISH
            </a>
          ) : null}

          <div className="flex flex-col items-end">
            <span className="text-[10px] text-gray-500 font-bold uppercase mb-1">
              Qolgan vaqt:
            </span>
            <div className="bg-black border-2 border-[#a855f7] px-8 py-2 rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.3)]">
              <span className="text-[#a855f7] font-mono text-3xl font-black italic tabular-nums">
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN: Chap test paneli + O'ng AI Mentor ── */}
      <div className="flex flex-1 w-full overflow-hidden">
        <div className="flex-[0.72] p-10 overflow-y-auto border-r border-white/5 custom-scrollbar">
          {phase === "reading" && (
            <div className="max-w-4xl mx-auto space-y-8 animate-grammar-fade-in">
              <div className="bg-[#121216] p-10 rounded-[30px] border border-white/5 shadow-2xl">
                <h2 className="text-3xl font-bold text-[#a855f7] mb-6">
                  Mavzuni o'rganish bosqichi
                </h2>
                <p className="text-gray-400 text-lg leading-relaxed">
                  Taymer tugagunga qadar PDF kitobni o'qing va AI mentordan
                  tushunmagan joylaringizni so'rang. 30 daqiqadan so'ng testlar
                  avtomatik ravishda shu yerda paydo bo'ladi.
                </p>
                <div className="mt-10 p-6 bg-black/40 rounded-2xl border border-dashed border-white/10 text-center">
                  <span className="text-gray-500 italic">
                    Testlar {formatTime(timeLeft)} dan keyin ochiladi...
                  </span>
                </div>
              </div>
            </div>
          )}

          {phase === "test" && (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Progress */}
              <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-950/20 px-5 py-4 shadow-[0_0_24px_rgba(217,70,239,0.08)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-200/95">
                      Phase 2 — Day 1 Tests
                    </span>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Present Simple vs Present Continuous
                    </p>
                  </div>
                  <span className="rounded-full border border-fuchsia-400/45 bg-black/40 px-4 py-2 font-mono text-sm font-black tabular-nums text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,0.18)]">
                    {Math.min(currentIndex + 1, totalQuestions || 1)}/
                    {totalQuestions || 0}
                  </span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-400 to-cyan-300 transition-[width] duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Savol kartasi (Vocabulary uslubidagi keng binafsha neon karta) */}
              {currentQuestion ? (
                <div
                  key={fadeKey}
                  className="animate-grammar-fade-in rounded-[1.6rem] border border-[#a855f7]/35 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.18),rgba(0,0,0,0.4)_60%)] p-6 shadow-[0_0_40px_rgba(168,85,247,0.18)] sm:p-9"
                >
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/90">
                      Savol {currentIndex + 1}
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {totalQuestions} ta savol
                    </p>
                  </div>
                  <p className="text-2xl font-black leading-snug text-white sm:text-3xl">
                    {currentQuestion.stem}
                  </p>

                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    {currentQuestion.options.map((opt, oi) => {
                      const isSelected = selectedIndex === oi;
                      const isCorrect = oi === currentQuestion.correctIndex;
                      const showFeedback = selectedIndex !== null;
                      let style =
                        "border-white/10 bg-black/40 text-slate-200 hover:border-fuchsia-400/60 hover:bg-fuchsia-500/10";
                      if (showFeedback && isSelected && isCorrect) {
                        style =
                          "border-emerald-300 bg-emerald-500/25 text-white shadow-[0_0_24px_rgba(16,185,129,0.4)]";
                      } else if (showFeedback && isSelected && !isCorrect) {
                        style =
                          "border-rose-400 bg-rose-500/25 text-white shadow-[0_0_24px_rgba(244,63,94,0.4)]";
                      } else if (showFeedback && !isSelected && isCorrect) {
                        style =
                          "border-emerald-400/60 bg-emerald-500/10 text-emerald-100";
                      } else if (isSelected) {
                        style =
                          "border-fuchsia-300 bg-fuchsia-500/25 text-white shadow-[0_0_24px_rgba(217,70,239,0.35)]";
                      }
                      return (
                        <button
                          key={oi}
                          type="button"
                          disabled={selectedIndex !== null}
                          onClick={() => handleSelect(oi)}
                          className={`group flex w-full items-center gap-3 rounded-2xl border px-5 py-4 text-left transition-all duration-300 ease-out disabled:cursor-default ${style}`}
                        >
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-base font-black transition-all duration-300 ${
                              isSelected
                                ? "border-white/80 bg-white text-black shadow-[0_0_18px_rgba(255,255,255,0.45)]"
                                : "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 group-hover:border-fuchsia-300"
                            }`}
                          >
                            {String.fromCharCode(65 + oi)}
                          </span>
                          <span className="text-base font-semibold leading-snug sm:text-lg">
                            {opt}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-rose-500/35 bg-rose-950/30 p-6 text-center text-sm text-rose-100">
                  Savollar topilmadi — Supabase{" "}
                  <code className="rounded bg-black/40 px-1">grammar_tasks</code>{" "}
                  jadvalida{" "}
                  <code className="rounded bg-black/40 px-1">day_number=1</code>{" "}
                  qatori va <code className="rounded bg-black/40 px-1">questions</code>{" "}
                  massivini tekshiring.
                </div>
              )}
            </div>
          )}

          {phase === "result" && (
            <div className="max-w-4xl mx-auto animate-grammar-fade-in">
              <div className="rounded-[2rem] border border-[#a855f7]/45 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.22),rgba(0,0,0,0.45)_70%)] p-10 text-center shadow-[0_0_40px_rgba(168,85,247,0.2)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-fuchsia-300/90">
                  Day 1 — Grammar natijasi
                </p>
                <p className="mt-4 font-mono text-6xl font-black tabular-nums text-white sm:text-7xl">
                  {correctCount}
                  <span className="text-fuchsia-400/70">/</span>
                  {totalQuestions || 0}
                </p>
                <p className="mt-3 text-sm font-semibold text-slate-300">
                  {totalQuestions
                    ? `${Math.round((correctCount / totalQuestions) * 100)}% to'g'ri`
                    : "Savollar topilmadi"}
                </p>
                <p className="mt-2 text-[11px] uppercase tracking-widest text-fuchsia-200/80">
                  Dashboard «Joriy daraja» bo'limi yangilandi ✦
                </p>

                <button
                  type="button"
                  onClick={restartTest}
                  className="mt-8 inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-fuchsia-400/55 bg-fuchsia-600/30 px-8 py-3 text-sm font-black uppercase tracking-[0.22em] text-white shadow-[0_0_24px_rgba(217,70,239,0.3)] transition hover:bg-fuchsia-600/50"
                >
                  Qayta urinish
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── O'NG PANEL: AI MENTOR ── */}
        <div className="flex-[0.28] bg-[#0a0a0c] flex flex-col border-l border-white/10">
          <div className="p-6 border-b border-white/5 bg-gradient-to-r from-transparent to-[#a855f7]/5">
            <h3 className="font-black text-[#a855f7] tracking-widest text-sm uppercase flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full" /> AI Mentor
              Online
            </h3>
          </div>

          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <div className="bg-[#16161d] p-5 rounded-2xl border border-white/5 text-sm leading-relaxed text-gray-300 shadow-lg">
              Assalomu alaykum! Men sizning shaxsiy AI mentoringizman.{" "}
              {grammarData?.title || "Grammar"} mavzusi bo'yicha har qanday
              savolingizga javob beraman. 🚀
            </div>
          </div>

          <div className="p-6 border-t border-white/5">
            <div className="relative">
              <input
                type="text"
                placeholder="Savol so'rash..."
                className="w-full bg-[#121216] border border-white/10 rounded-2xl p-5 pr-14 outline-none focus:border-[#a855f7] focus:ring-4 focus:ring-[#a855f7]/10 transition-all"
              />
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#a855f7] text-2xl hover:scale-110 transition-all"
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1e; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #a855f7; }

        @keyframes grammarFadeIn {
          0% {
            opacity: 0;
            transform: translateY(14px) scale(0.985);
            filter: blur(2px);
          }
          60% { filter: blur(0); }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
        .animate-grammar-fade-in {
          animation: grammarFadeIn 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: opacity, transform, filter;
        }
      `}</style>
    </div>
  );
};

export default GrammarSection;
