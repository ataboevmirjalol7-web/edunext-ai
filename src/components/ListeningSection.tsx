import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * Day 1 Listening — Bright Neon Edition.
 *
 * Talab:
 *  • `listening_tasks` jadvalidan `day_number = 1` qatori, faqat
 *    `audio_url` va `transcript` ustunlari ishlatiladi.
 *  • Foydalanuvchi Listening bo'limiga kirishi bilan asosiy dars komponenti
 *    (Taymer + AudioPlayer + Diktant maydoni) DARHOL ishga tushadi —
 *    hech qanday «Boshlash» tugmasi, modal oynasi yoki PDF havolasi yo'q.
 *  • Sahifa yuklanganda audio avtomatik ijro etiladi, 20:00 taymer teskari
 *    sanashni boshlaydi, TextArea fokuslangan holda ochiq turadi.
 *  • 00:00 da audio pleer butunlay unmount qilinadi va TextArea read-only ga
 *    o'tadi.
 *  • Pastda «AI Tahlilni ko'rish» tugmasi paydo bo'ladi.
 *  • Tahlil tugmasi bosilganda foydalanuvchi matni Supabase `transcript`
 *    matn ustuni bilan taqqoslanadi (PDF havolasi emas — faqat text):
 *    to'g'ri so'zlar yashil, xato so'zlar neon qizil, qolib ketganlar
 *    qavs ichida kulrang ko'rinadi.
 */

const SESSION_DURATION_MS = 20 * 60 * 1000;
const LISTENING_TIMER_CACHE_KEY = "edunext_listening_day1_timer";
const LISTENING_COMPLETE_CACHE_KEY = "edunext_listening_day1_complete";

type ListeningRow = {
  day_number?: number | null;
  title?: string | null;
  audio_url?: string | null;
  transcript?: string | null;
};

type DiffOp =
  | { type: "equal"; user: string; transcript: string }
  | { type: "wrong"; user: string }
  | { type: "missing"; transcript: string };

/** Matnni so'zlarga ajratadi; tinish belgilarini umumiy bo'shliqqa aylantirib tashlaydi. */
function tokenizeText(text: string): { original: string[]; lower: string[] } {
  const cleaned = String(text || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^A-Za-z0-9'\s-]/g, " ");
  const original = cleaned.split(/\s+/).filter(Boolean);
  const lower = original.map((w) => w.toLowerCase());
  return { original, lower };
}

/** LCS (Longest Common Subsequence) jadvali. */
function lcsLengths(a: string[], b: string[]): number[][] {
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp.push(new Array(b.length + 1).fill(0));
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/**
 * Foydalanuvchi tokenlari va transcript tokenlarini taqqoslab, har bir
 * pozitsiya uchun «equal | wrong | missing» operatsiyasini qaytaradi.
 */
function buildDiff(
  userOriginal: string[],
  userLower: string[],
  transcriptOriginal: string[],
  transcriptLower: string[],
): DiffOp[] {
  const dp = lcsLengths(userLower, transcriptLower);
  const ops: DiffOp[] = [];
  let i = userLower.length;
  let j = transcriptLower.length;
  while (i > 0 && j > 0) {
    if (userLower[i - 1] === transcriptLower[j - 1]) {
      ops.push({
        type: "equal",
        user: userOriginal[i - 1],
        transcript: transcriptOriginal[j - 1],
      });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "wrong", user: userOriginal[i - 1] });
      i--;
    } else {
      ops.push({ type: "missing", transcript: transcriptOriginal[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "wrong", user: userOriginal[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "missing", transcript: transcriptOriginal[j - 1] });
    j--;
  }
  return ops.reverse();
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const r = total % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const ListeningSection: React.FC = () => {
  const [row, setRow] = useState<ListeningRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [timeLeftMs, setTimeLeftMs] = useState(SESSION_DURATION_MS);
  const [expired, setExpired] = useState(false);
  const [userText, setUserText] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [lessonCompleted, setLessonCompleted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const audioStartedRef = useRef(false);

  const clearTimerCacheIfIncomplete = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const completed =
      window.localStorage.getItem(LISTENING_COMPLETE_CACHE_KEY) === "1";
    if (!completed) {
      window.localStorage.removeItem(LISTENING_TIMER_CACHE_KEY);
    }
  }, []);

  const restartListeningSession = React.useCallback(() => {
    clearTimerCacheIfIncomplete();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LISTENING_COMPLETE_CACHE_KEY);
    }
    audioStartedRef.current = false;
    setExpired(false);
    setAnalysisOpen(false);
    setLessonCompleted(false);
    setTimeLeftMs(SESSION_DURATION_MS);
  }, [clearTimerCacheIfIncomplete]);

  // ── Supabase fetch (faqat audio_url va transcript) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("listening_tasks")
          .select("day_number,title,audio_url,transcript")
          .eq("day_number", 1)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setFetchError(error.message || String(error));
          setRow(null);
        } else {
          setRow((data as ListeningRow) ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : String(e));
          setRow(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    clearTimerCacheIfIncomplete();
    setExpired(false);
    setTimeLeftMs(SESSION_DURATION_MS);
  }, [loading, clearTimerCacheIfIncomplete]);

  // ── 20 daqiqalik teskari sanoq: ma'lumot yuklangach DARHOL ishga tushadi ──
  useEffect(() => {
    if (loading) return;
    if (expired) return;
    if (timeLeftMs <= 0) {
      setExpired(true);
      return;
    }
    const id = window.setInterval(() => {
      setTimeLeftMs((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          setExpired(true);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [loading, expired, timeLeftMs]);

  useEffect(() => {
    if (typeof window === "undefined" || loading) return;
    window.localStorage.setItem(
      LISTENING_TIMER_CACHE_KEY,
      JSON.stringify({
        timeLeftMs,
        expired,
        savedAt: Date.now(),
      }),
    );
  }, [loading, timeLeftMs, expired]);

  // ── AudioPlayer ma'lumot yuklangach AVTOMATIK ijro etiladi ──
  useEffect(() => {
    if (loading || expired) return;
    if (audioStartedRef.current) return;
    const el = audioRef.current;
    const src = String(row?.audio_url ?? "").trim();
    if (!el || !src) return;
    audioStartedRef.current = true;
    const tryPlay = () => {
      el.play().catch(() => {
        // Brauzer autoplay bloklasa — foydalanuvchi controls orqali boshlaydi.
      });
    };
    if (el.readyState >= 2) tryPlay();
    else {
      el.addEventListener("canplay", tryPlay, { once: true });
    }
  }, [loading, expired, row?.audio_url]);

  // ── TextArea sahifa yuklangach DARHOL fokusda bo'lsin ──
  useEffect(() => {
    if (loading || expired) return;
    const ta = textareaRef.current;
    if (!ta) return;
    // Brauzer audio autoplay bilan birgalikda fokus berishni qabul qilishi
    // uchun keyingi tick'da fokuslaymiz.
    const id = window.setTimeout(() => {
      try {
        ta.focus({ preventScroll: true });
      } catch {
        ta.focus();
      }
    }, 100);
    return () => window.clearTimeout(id);
  }, [loading, expired]);

  // ── Vaqt tugagach audio elementni butunlay to'xtatamiz; element render
  //    daraxtidan ham olib tashlanadi (`{!expired && <audio ... />}`). ──
  useEffect(() => {
    if (!expired) return;
    const el = audioRef.current;
    if (el) {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch {
        /* ignore */
      }
    }
  }, [expired]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (analysisOpen) {
      setLessonCompleted(true);
      window.localStorage.setItem(LISTENING_COMPLETE_CACHE_KEY, "1");
      return;
    }
    if (!lessonCompleted) {
      clearTimerCacheIfIncomplete();
    }
  }, [analysisOpen, lessonCompleted, clearTimerCacheIfIncomplete]);

  const audioSrc = String(row?.audio_url ?? "").trim();
  const transcript = String(row?.transcript ?? "").trim();
  const timerLabel = useMemo(() => formatCountdown(timeLeftMs), [timeLeftMs]);

  const diffOps = useMemo(() => {
    if (!analysisOpen) return null;
    const u = tokenizeText(userText);
    const t = tokenizeText(transcript);
    if (!u.original.length && !t.original.length) return [] as DiffOp[];
    return buildDiff(u.original, u.lower, t.original, t.lower);
  }, [analysisOpen, userText, transcript]);

  const stats = useMemo(() => {
    if (!diffOps) return null;
    let correct = 0;
    let wrong = 0;
    let missing = 0;
    diffOps.forEach((op) => {
      if (op.type === "equal") correct++;
      else if (op.type === "wrong") wrong++;
      else missing++;
    });
    return { correct, wrong, missing, total: correct + wrong + missing };
  }, [diffOps]);

  // ── Yuklanmoqda holati ──
  if (loading) {
    return (
      <div className="min-h-[60vh] bg-[#070708] text-white flex items-center justify-center p-8">
        <div className="rounded-2xl border border-fuchsia-500/30 bg-black/40 px-8 py-6 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-fuchsia-300/90">
            Listening
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Day 1 ma'lumotlari yuklanmoqda…
          </p>
        </div>
      </div>
    );
  }

  if (fetchError || !row || (row.day_number != null && row.day_number !== 1)) {
    return (
      <div className="min-h-[60vh] bg-[#070708] text-white flex items-center justify-center p-8">
        <div className="rounded-2xl border border-rose-500/35 bg-rose-950/30 px-6 py-5 text-sm text-rose-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300">
            Xato
          </p>
          <p className="mt-2">
            {fetchError ||
              "listening_tasks jadvalida day_number=1 qatori topilmadi."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070708] text-white flex flex-col">
      {/* ── HEADER (taymer + sarlavha, neon binafsha) ── */}
      <div className="w-full border-b border-[#a855f7]/50 bg-[#0a0a0c] px-8 py-4 flex flex-wrap items-center justify-between gap-4 shadow-[0_4px_20px_rgba(168,85,247,0.12)]">
        <div className="flex flex-col">
          <span className="text-[#a855f7] text-xs font-bold tracking-[0.2em] uppercase">
            Day 1 — Listening Section
          </span>
          <h1 className="text-2xl font-black text-white mt-1">
            Bright Neon Listening Dictation
          </h1>
          <p className="mt-1 text-xs text-fuchsia-200/80">
            Mavzu: {row.title?.trim() || "Halloween (Day 1)"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Audio tinglab eshitganingizni pastdagi maydonga yozing. 20:00
            tugagach AI tahlili ochiladi.
          </p>
        </div>

        <div className="flex flex-col items-end">
          <span className="text-[10px] text-gray-500 font-bold uppercase mb-1">
            Qolgan vaqt
          </span>
          <div
            className={`bg-black border-2 px-8 py-2 rounded-2xl transition-shadow duration-500 ${
              expired
                ? "border-rose-400 shadow-[0_0_24px_rgba(244,63,94,0.4)]"
                : "border-[#a855f7] shadow-[0_0_24px_rgba(168,85,247,0.4)]"
            }`}
          >
            <span
              className={`font-mono text-3xl font-black italic tabular-nums ${
                expired ? "text-rose-300" : "text-[#a855f7]"
              }`}
            >
              {timerLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={restartListeningSession}
            className="mt-2 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-500/30"
          >
            Qayta boshlash
          </button>
        </div>
      </div>

      {/* ── MAIN: AudioPlayer (auto-start) + TextArea (auto-focus) ── */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 sm:px-10 sm:py-10 space-y-6">
        {/* AudioPlayer — sahifa yuklangach DARHOL mount bo'ladi va vaqt
            tugagach butunlay unmount qilinadi. Hech qanday «Boshlash» modal
            yoki PDF havolasi yo'q. */}
        {!expired && (
          <div className="rounded-[1.6rem] border border-[#a855f7]/35 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.18),rgba(0,0,0,0.4)_60%)] p-6 shadow-[0_0_30px_rgba(168,85,247,0.18)] sm:p-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/90">
                Audio · Avtomatik boshlandi
              </p>
              <span className="rounded-full border border-fuchsia-400/45 bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">
                Live
              </span>
            </div>
            {audioSrc ? (
              <audio
                ref={audioRef}
                src={audioSrc}
                controls
                autoPlay
                preload="auto"
                className="w-full max-w-full rounded-xl"
              >
                Brauzeringiz audio elementini qo'llab-quvvatlamaydi.
              </audio>
            ) : (
              <p className="text-sm text-rose-200">
                <code className="rounded bg-black/40 px-1">audio_url</code> bo'sh
                — Supabase qatorini tekshiring.
              </p>
            )}
          </div>
        )}

        {/* Vaqt tugagach pleer joyiga «O'chirilgan» neon panel */}
        {expired && (
          <div className="rounded-[1.6rem] border border-rose-500/40 bg-[radial-gradient(ellipse_at_top,rgba(244,63,94,0.18),rgba(0,0,0,0.5)_60%)] p-6 text-center shadow-[0_0_24px_rgba(244,63,94,0.18)] sm:p-8">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-rose-300">
              Audio o'chirildi
            </p>
            <p className="mt-2 text-sm text-rose-100/90">
              20:00 tugadi — pleer to'liq o'chirildi va matn maydoni qulflandi.
            </p>
          </div>
        )}

        {/* TextArea — diktat maydoni: sahifa yuklangach AVTOMATIK fokuslanadi
            va yozish ochiq, 00:00 da read-only ga o'tadi. */}
        <div className="rounded-[1.6rem] border border-[#a855f7]/30 bg-black/55 p-5 shadow-[0_0_24px_rgba(168,85,247,0.08)] sm:p-7">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/90">
              Eshitganingizni yozing
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {expired ? "Read-only" : "Yozish ochiq"}
            </p>
          </div>
          <textarea
            ref={textareaRef}
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            readOnly={expired}
            disabled={expired}
            autoFocus
            rows={12}
            placeholder={
              expired
                ? "Vaqt tugadi — matningiz qulflandi."
                : "Audio orqali eshitayotgan gaplaringizni shu yerga yozing..."
            }
            className={`min-h-[260px] w-full resize-y rounded-2xl border bg-zinc-950/90 px-5 py-4 text-base leading-relaxed text-white placeholder:text-slate-600 transition focus:outline-none ${
              expired
                ? "border-rose-500/40 cursor-not-allowed opacity-80"
                : "border-[#a855f7]/40 focus:border-[#a855f7] focus:ring-4 focus:ring-[#a855f7]/15"
            }`}
            aria-label="Dictation text area"
          />
        </div>

        {/* AI tahlil tugmasi — faqat vaqt tugagach */}
        {expired && !analysisOpen && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setAnalysisOpen(true)}
              className="inline-flex min-h-[56px] items-center justify-center rounded-2xl border border-[#a855f7]/55 bg-[#a855f7]/25 px-10 py-3 text-sm font-black uppercase tracking-[0.22em] text-white shadow-[0_0_28px_rgba(168,85,247,0.4)] transition hover:bg-[#a855f7]/40 hover:scale-[1.02]"
            >
              ✦ AI Tahlilni ko'rish
            </button>
          </div>
        )}

        {/* AI Analysis natijasi */}
        {expired && analysisOpen && (
          <div className="space-y-4 rounded-[1.6rem] border border-[#a855f7]/40 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.16),rgba(0,0,0,0.5)_70%)] p-6 shadow-[0_0_30px_rgba(168,85,247,0.2)] sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-fuchsia-300/95">
                AI Tahlil — Diktat taqqoslash
              </p>
              {stats ? (
                <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider">
                  <span className="rounded-md border border-emerald-400/55 bg-emerald-500/15 px-2 py-1 text-emerald-200">
                    To'g'ri: {stats.correct}
                  </span>
                  <span className="rounded-md border border-rose-400/55 bg-rose-500/15 px-2 py-1 text-rose-200">
                    Xato: {stats.wrong}
                  </span>
                  <span className="rounded-md border border-slate-500/55 bg-slate-700/15 px-2 py-1 text-slate-200">
                    Qolgan: {stats.missing}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/60 p-5 leading-relaxed">
              {!diffOps || diffOps.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Matn yoki transcript bo'sh — taqqoslash uchun matn kiriting.
                </p>
              ) : (
                <p className="text-base sm:text-lg">
                  {diffOps.map((op, i) => {
                    if (op.type === "equal") {
                      return (
                        <span
                          key={i}
                          className="text-emerald-300 font-semibold drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]"
                        >
                          {op.user}{" "}
                        </span>
                      );
                    }
                    if (op.type === "wrong") {
                      return (
                        <span
                          key={i}
                          className="text-rose-400 font-bold underline decoration-rose-400/70 underline-offset-4 drop-shadow-[0_0_8px_rgba(244,63,94,0.55)]"
                        >
                          {op.user}{" "}
                        </span>
                      );
                    }
                    return (
                      <span key={i} className="text-slate-400 italic">
                        ({op.transcript}){" "}
                      </span>
                    );
                  })}
                </p>
              )}
            </div>

            {/* Asl transcript ham ko'rsatiladi (ma'lumot uchun) */}
            <details className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-200">
                Asl transcript
              </summary>
              <p className="mt-3 whitespace-pre-wrap leading-relaxed text-slate-200">
                {transcript || "Transcript bazada hali yo'q."}
              </p>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[11px] text-slate-400">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                yashil — to'g'ri so'z
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-400 align-middle shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
                qizil — xato so'z
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" />
                (qavs) — qolib ketgan so'z
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ListeningSection;
