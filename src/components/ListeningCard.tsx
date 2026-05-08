import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const LISTEN_THRESHOLD = 0.8;

export type ListeningTaskRow = {
  id: string;
  week_number: number;
  day_number: number;
  youtube_id: string | null;
  title: string | null;
  audio_url: string | null;
  transcript: string | null;
  vocab_list: unknown;
};

export type ListeningCardProps = {
  supabase: SupabaseClient;
  /** Joriy o‘quv kuni (1–30), `listening_tasks.day_number` bilan mos. */
  dayNumber: number;
  weekNumber?: number;
  className?: string;
  /** AI Mentor panel (dashboard). */
  mentorPanelId?: string;
  /** Tinglashning kamida 80% qismi tinglanganda chaqiriladi. */
  onEightyPercentReached?: () => void;
  /** "Vazifani bajardim" o‘zgarganda (true faqat threshold dan keyin). */
  onCompleteChange?: (done: boolean) => void;
  /** Boshlang‘ich checkbox holati (masalan, allaqachon bajarilgan). */
  initialComplete?: boolean;
};

function clampDay(d: number) {
  const n = Math.floor(Number(d));
  if (!Number.isFinite(n)) return 1;
  return Math.min(30, Math.max(1, n));
}

function normalizeVocabList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const j = JSON.parse(t) as unknown;
      if (Array.isArray(j)) return normalizeVocabList(j);
    } catch {
      /* ignore */
    }
    return t
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function ListeningCard({
  supabase,
  dayNumber,
  weekNumber = 1,
  className = "",
  mentorPanelId = "dashboard-mentor-panel",
  onEightyPercentReached,
  onCompleteChange,
  initialComplete = false,
}: ListeningCardProps) {
  const day = clampDay(dayNumber);
  const week = Math.max(1, Math.floor(Number(weekNumber)) || 1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [row, setRow] = useState<ListeningTaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  /** Tinglangan qismning maksimal foizi (0–1). */
  const [maxProgressRatio, setMaxProgressRatio] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [vocabChecks, setVocabChecks] = useState<Record<string, boolean>>({});
  const [complete, setComplete] = useState(initialComplete);
  const thresholdHitRef = useRef(false);

  const canMarkDone = complete || maxProgressRatio >= LISTEN_THRESHOLD - 1e-6;

  const vocabWords = useMemo(() => {
    const w = normalizeVocabList(row?.vocab_list);
    return [...new Set(w)];
  }, [row?.vocab_list]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: qErr } = await supabase
          .from("listening_tasks")
          .select(
            "id,week_number,day_number,youtube_id,title,audio_url,transcript,vocab_list",
          )
          .eq("week_number", week)
          .eq("day_number", day)
          .maybeSingle();

        if (qErr) throw qErr;
        if (cancelled) return;
        setRow((data as ListeningTaskRow) ?? null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
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

  useEffect(() => {
    setVocabChecks((prev) => {
      const next: Record<string, boolean> = {};
      vocabWords.forEach((w) => {
        next[w] = prev[w] ?? false;
      });
      return next;
    });
  }, [vocabWords]);

  const audioSrc = String(row?.audio_url ?? "").trim();

  const updateProgressFromAudio = useCallback(() => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const ratio = el.currentTime / el.duration;
    setCurrentTime(el.currentTime);
    setDuration(el.duration);
    setMaxProgressRatio((prev) => {
      const next = Math.max(prev, ratio);
      if (
        !thresholdHitRef.current &&
        next >= LISTEN_THRESHOLD - 1e-6
      ) {
        thresholdHitRef.current = true;
        onEightyPercentReached?.();
      }
      return next;
    });
  }, [onEightyPercentReached]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      void el.pause();
    } else {
      void el.play().catch(() => {
        /* autoplay / decode */
      });
    }
  }, [playing]);

  const onSeek = useCallback(
    (nextRatio: number) => {
      const el = audioRef.current;
      if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
      const r = Math.min(1, Math.max(0, nextRatio));
      el.currentTime = r * el.duration;
      setCurrentTime(el.currentTime);
      setMaxProgressRatio((prev) => Math.max(prev, r));
      if (!thresholdHitRef.current && r >= LISTEN_THRESHOLD - 1e-6) {
        thresholdHitRef.current = true;
        onEightyPercentReached?.();
      }
    },
    [onEightyPercentReached],
  );

  const scrollToMentor = useCallback(() => {
    const el = document.getElementById(mentorPanelId);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [mentorPanelId]);

  const progressPct = useMemo(() => {
    if (!duration || !Number.isFinite(duration)) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  const onCompleteToggle = useCallback(
    (checked: boolean) => {
      if (!canMarkDone && checked) return;
      setComplete(checked);
      onCompleteChange?.(checked);
    },
    [canMarkDone, onCompleteChange],
  );

  if (loading) {
    return (
      <div
        className={`rounded-2xl border border-amber-500/25 bg-black/35 p-6 text-sm text-slate-300 ${className}`.trim()}
      >
        Listening yuklanmoqda…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`rounded-2xl border border-red-400/35 bg-red-950/30 p-6 text-sm text-red-200 ${className}`.trim()}
      >
        {error}
      </div>
    );
  }

  if (!row) {
    return (
      <div
        className={`rounded-2xl border border-amber-500/25 bg-black/35 p-6 text-sm text-amber-100/90 ${className}`.trim()}
      >
        Bu kun uchun <code className="text-fuchsia-200/90">listening_tasks</code>{" "}
        yozuvi topilmadi (kun {day}, hafta {week}).
      </div>
    );
  }

  if (!audioSrc) {
    return (
      <div
        className={`rounded-2xl border border-amber-500/25 bg-black/35 p-6 text-sm text-amber-100/90 ${className}`.trim()}
      >
        <p className="font-medium text-white">
          {row.title || `Listening · kun ${day}`}
        </p>
        <p className="mt-2 text-slate-400">
          <code className="text-fuchsia-200/90">audio_url</code> yoki tinglash
          fayli kiritilmagan. Supabase migratsiyasi va{" "}
          <code className="text-fuchsia-200/90">listening_tasks.audio_url</code>{" "}
          ustunini to‘ldiring.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`listening-card space-y-5 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-zinc-950/95 via-black/90 to-zinc-950/95 p-5 shadow-[0_0_28px_rgba(251,191,36,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300/90">
            Listening · kun {day}
          </p>
          <h3 className="mt-1 text-lg font-bold leading-snug text-white sm:text-xl">
            {row.title?.trim() || `Hafta ${week} — Listening`}
          </h3>
          {!canMarkDone && (
            <p className="mt-2 text-xs text-amber-200/80">
              Vazifani belgilash uchun audio kamida{" "}
              {Math.round(LISTEN_THRESHOLD * 100)}% tinglang.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={scrollToMentor}
          className="shrink-0 rounded-xl border border-fuchsia-500/40 bg-fuchsia-600/20 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-fuchsia-100 transition hover:bg-fuchsia-600/35"
        >
          Edu Next AI Mentor
        </button>
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        src={audioSrc}
        preload="metadata"
        onLoadedMetadata={updateProgressFromAudio}
        onTimeUpdate={updateProgressFromAudio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          updateProgressFromAudio();
        }}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-12 min-w-[7rem] items-center justify-center rounded-xl border border-amber-400/45 bg-amber-500/15 px-5 text-sm font-bold text-amber-50 transition hover:bg-amber-500/25"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <div className="flex flex-1 flex-wrap items-center gap-2 text-xs tabular-nums text-slate-400">
            <span>{formatTime(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span>{formatTime(duration)}</span>
            <span className="ml-auto text-amber-200/90">
              Tinglangan: {Math.min(100, Math.round(maxProgressRatio * 100))}%
            </span>
          </div>
        </div>

        <div className="relative">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={
              duration > 0 ? Math.min(1, currentTime / duration) : 0
            }
            onChange={(e) => onSeek(Number(e.target.value))}
            className="h-2 w-full cursor-pointer accent-amber-400"
            aria-label="Audio progress"
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <button
          type="button"
          onClick={() => setTranscriptOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-100 transition hover:bg-white/5"
          aria-expanded={transcriptOpen}
        >
          <span>Show transcript</span>
          <span className="text-slate-500" aria-hidden>
            {transcriptOpen ? "▲" : "▼"}
          </span>
        </button>
        {transcriptOpen && (
          <div className="border-t border-white/10 px-4 py-3">
            {row.transcript?.trim() ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200/95">
                {row.transcript.trim()}
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Transkript hali qo‘shilmagan (
                <code className="text-fuchsia-300/90">transcript</code>).
              </p>
            )}
          </div>
        )}
      </div>

      {vocabWords.length > 0 && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/90">
            Vocabulary checklist
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {vocabWords.map((w) => (
              <li key={w} className="flex items-start gap-2">
                <input
                  id={`vocab-${day}-${w}`}
                  type="checkbox"
                  checked={Boolean(vocabChecks[w])}
                  onChange={(e) =>
                    setVocabChecks((prev) => ({
                      ...prev,
                      [w]: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent accent-emerald-500"
                />
                <label
                  htmlFor={`vocab-${day}-${w}`}
                  className="cursor-pointer text-sm text-slate-100/95"
                >
                  {w}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label
        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
          canMarkDone
            ? "border-fuchsia-500/35 bg-fuchsia-500/10 hover:bg-fuchsia-500/15"
            : "cursor-not-allowed border-white/10 bg-black/20 opacity-60"
        }`}
      >
        <input
          type="checkbox"
          checked={complete}
          disabled={!canMarkDone}
          onChange={(e) => onCompleteToggle(e.target.checked)}
          className="h-5 w-5 shrink-0 rounded border-white/25 bg-transparent accent-fuchsia-500 disabled:cursor-not-allowed"
        />
        <span className="text-sm font-medium text-slate-200">
          Vazifani bajardim
        </span>
      </label>
    </div>
  );
}

export default ListeningCard;
