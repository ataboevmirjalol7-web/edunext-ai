import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListeningTaskRow } from "./ListeningCard";

const DICTATION_DURATION_MS = 20 * 60 * 1000;

export type DictationListeningProps = {
  supabase: SupabaseClient;
  dayNumber: number;
  weekNumber?: number;
  className?: string;
  /** «Vazifani bajarib bo'ldim» o‘zgarganda. */
  onCompleteChange?: (done: boolean) => void;
  /** Boshlang‘ich tugallangan holati. */
  initialComplete?: boolean;
};

function clampDay(d: number) {
  const n = Math.floor(Number(d));
  if (!Number.isFinite(n)) return 1;
  return Math.min(30, Math.max(1, n));
}

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Qisqa bildirish tinglovi (faylsiz, Web Audio). */
function playTimerNotificationSound() {
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (
        window as unknown as {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
    osc.frequency.setValueAtTime(659, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.14);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    void ctx.resume();
    window.setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    }, 450);
  } catch {
    /* ignore */
  }
}

/**
 * B1–B2 Listening: `listening_tasks` dan audio + transcript, 20 daqiqa taymer
 * («Darsni boshlash»), diktat maydoni, vaqt tugagach taqqoslash va bildirish ovozi.
 */
export function DictationListening({
  supabase,
  dayNumber,
  weekNumber = 1,
  className = "",
  onCompleteChange,
  initialComplete = false,
}: DictationListeningProps) {
  const day = clampDay(dayNumber);
  const week = Math.max(1, Math.floor(Number(weekNumber)) || 1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifiedRef = useRef(false);

  const [row, setRow] = useState<ListeningTaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [sessionStarted, setSessionStarted] = useState(false);
  const [timeLeftMs, setTimeLeftMs] = useState(DICTATION_DURATION_MS);
  const [expired, setExpired] = useState(false);

  const [userText, setUserText] = useState("");
  const [taskDone, setTaskDone] = useState(initialComplete);

  const audioSrc = String(row?.audio_url ?? "").trim();
  const originalTranscript = String(row?.transcript ?? "").trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const { data, error } = await supabase
          .from("listening_tasks")
          .select(
            "id,week_number,day_number,youtube_id,title,audio_url,transcript,vocab_list",
          )
          .eq("week_number", week)
          .eq("day_number", day)
          .maybeSingle();

        if (error) throw error;
        if (!cancelled) setRow((data as ListeningTaskRow) ?? null);
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
  }, [supabase, week, day]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  useEffect(() => {
    if (!expired) {
      notifiedRef.current = false;
      return;
    }
    clearTimer();
    const el = audioRef.current;
    if (el) void el.pause();
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      playTimerNotificationSound();
    }
  }, [expired, clearTimer]);

  const tick = useCallback(() => {
    setTimeLeftMs((prev) => {
      const next = prev - 1000;
      if (next <= 0) {
        clearTimer();
        setExpired(true);
        return 0;
      }
      return next;
    });
  }, [clearTimer]);

  const startSession = useCallback(() => {
    if (sessionStarted || expired) return;
    setSessionStarted(true);
    setTimeLeftMs(DICTATION_DURATION_MS);
    clearTimer();
    timerRef.current = setInterval(tick, 1000);
  }, [sessionStarted, expired, clearTimer, tick]);

  const timerLabel = useMemo(() => formatCountdown(timeLeftMs), [timeLeftMs]);

  const textareaDisabled = !sessionStarted || expired;

  const onCheckbox = useCallback(
    (checked: boolean) => {
      if (!expired) return;
      setTaskDone(checked);
      onCompleteChange?.(checked);
    },
    [expired, onCompleteChange],
  );

  if (loading) {
    return (
      <div
        className={`rounded-2xl border border-cyan-500/25 bg-black/35 p-6 text-sm text-slate-300 ${className}`.trim()}
      >
        Listening yuklanmoqda…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div
        className={`rounded-2xl border border-red-400/35 bg-red-950/30 p-6 text-sm text-red-200 ${className}`.trim()}
      >
        {fetchError}
      </div>
    );
  }

  if (!row || !audioSrc) {
    return (
      <div
        className={`rounded-2xl border border-amber-500/25 bg-black/35 p-6 text-sm text-amber-100/90 ${className}`.trim()}
      >
        <p className="font-medium text-white">Listening · B1/B2</p>
        <p className="mt-2 text-slate-400">
          Bu kun uchun <code className="text-fuchsia-200/90">audio_url</code> topilmadi (
          kun {day}).{" "}
          <code className="text-fuchsia-200/90">listening_tasks</code> jadvalini tekshiring.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`dictation-listening space-y-5 rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-zinc-950/95 via-black/90 to-zinc-950/95 p-5 shadow-[0_0_28px_rgba(34,211,238,0.1),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300/90">
            Listening · Dictation
          </p>
          <h3 className="mt-1 text-lg font-bold text-white sm:text-xl">
            {row.title?.trim() || `Kun ${day}`}
          </h3>
          <p className="mt-2 max-w-xl text-xs text-slate-400">
            <span className="font-semibold text-slate-300">Darsni boshlash</span> ni
            bosing — 20 daqiqalik taymer ishga tushadi. Audio tinglang va eshitganingizni
            yozing. Vaqt tugagach transcript ochiladi va bildirish chalinadi.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div
            className={`rounded-xl border px-4 py-2 font-mono text-2xl font-black tabular-nums ${
              expired
                ? "border-red-400/40 bg-red-950/40 text-red-200"
                : sessionStarted
                  ? "border-amber-400/45 bg-amber-500/15 text-amber-100"
                  : "border-white/15 bg-black/30 text-slate-400"
            }`}
            aria-live="polite"
          >
            {timerLabel}
          </div>
          {!sessionStarted && !expired && (
            <button
              type="button"
              onClick={startSession}
              className="rounded-xl border border-emerald-500/45 bg-emerald-600/25 px-4 py-2.5 text-sm font-bold text-emerald-100 transition hover:bg-emerald-600/40"
            >
              Darsni boshlash
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/50 p-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Audio
        </p>
        <audio
          ref={audioRef}
          controls
          src={audioSrc}
          preload="metadata"
          className="w-full max-w-full rounded-lg"
        >
          Brauzeringiz audio elementini qo‘llab-quvvatlamaydi.
        </audio>
      </div>

      <div>
        <label
          htmlFor={`dictation-text-${day}`}
          className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400"
        >
          Diktat (eshitganingizni yozing)
        </label>
        <textarea
          id={`dictation-text-${day}`}
          value={userText}
          onChange={(e) => setUserText(e.target.value)}
          disabled={textareaDisabled}
          rows={12}
          placeholder={
            !sessionStarted
              ? "Avval «Darsni boshlash» ni bosing."
              : expired
                ? "Vaqt tugadi — matn yuqorida saqlanadi."
                : "Eshitganingizni yozing..."
          }
          className="min-h-[220px] w-full resize-y rounded-xl border border-white/10 bg-zinc-950/90 px-4 py-3 text-base leading-relaxed text-white placeholder:text-slate-600 focus:border-cyan-400/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {expired && (
        <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-950/10 p-4 sm:p-5">
          <p className="mb-4 text-center text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300/95">
            Comparison
          </p>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-sky-300/95">
                Sizning matningiz
              </p>
              <div className="max-h-48 overflow-auto rounded-lg border border-sky-500/20 bg-black/40 p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100/95">
                  {userText.trim() || "—"}
                </p>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-fuchsia-300/95">
                Asl transcript
              </p>
              <div className="max-h-48 overflow-auto rounded-lg border border-fuchsia-500/20 bg-black/40 p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100/95">
                  {originalTranscript || "Transcript bazada hali yo‘q."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!expired && sessionStarted && (
        <p className="text-center text-xs text-slate-500">
          Transcript va taqqoslash 20:00 tugagach paydo bo‘ladi.
        </p>
      )}

      {expired && (
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-fuchsia-500/35 bg-fuchsia-500/10 px-4 py-3 transition hover:bg-fuchsia-500/15">
          <input
            type="checkbox"
            checked={taskDone}
            onChange={(e) => onCheckbox(e.target.checked)}
            className="h-5 w-5 shrink-0 rounded border-white/25 bg-transparent accent-fuchsia-500"
          />
          <span className="text-sm font-medium text-slate-200">
            Vazifani bajarib bo&apos;ldim
          </span>
        </label>
      )}
    </div>
  );
}

export default DictationListening;
