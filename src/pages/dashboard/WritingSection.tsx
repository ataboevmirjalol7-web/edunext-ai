import React, { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type WritingTaskRow = {
  day_number?: number | null;
  title?: string | null;
  context?: string | null;
  description?: string | null;
  task_1_1?: string | null;
  task_1_2?: string | null;
  part_2?: string | null;
};

const managerLetterFallback = `Dear Student,

We are planning to make some improvements to our school canteen, and we would like to hear your ideas.
Please share your suggestions about food quality, prices, and the overall environment.
Your opinion is important for creating a better canteen for everyone.

Best regards,
Canteen Manager`;

function getSupabaseConfig() {
  const w = globalThis as unknown as {
    APP_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string };
  };
  const url =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.VITE_SUPABASE_URL) ||
    w.APP_CONFIG?.supabaseUrl ||
    "";
  const key =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.VITE_SUPABASE_ANON_KEY) ||
    w.APP_CONFIG?.supabaseAnonKey ||
    "";
  return {
    url: String(url || "").trim(),
    key: String(key || "").trim(),
  };
}

export default function WritingSection() {
  const [row, setRow] = useState<WritingTaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [essay, setEssay] = useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { url, key } = getSupabaseConfig();
        if (!url || !key) throw new Error("Supabase config topilmadi.");
        const supabase = createClient(url, key);
        const { data, error: qErr } = await supabase
          .from("writing_tasks")
          .select(
            "day_number,title,context,description,task_1_1,task_1_2,part_2",
          )
          .eq("day_number", 1)
          .maybeSingle();
        if (qErr) throw qErr;
        if (!cancelled) setRow((data as WritingTaskRow) ?? null);
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
  }, []);

  const letterText = useMemo(() => {
    const t = String(row?.context ?? row?.description ?? "").trim();
    return t || managerLetterFallback;
  }, [row?.context, row?.description]);

  const wordCount = useMemo(() => {
    return String(essay || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }, [essay]);

  return (
    <div className="min-h-screen bg-[#070708] text-white">
      <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-10 sm:py-10 space-y-6">
        <header className="rounded-2xl border border-fuchsia-500/40 bg-black/40 px-6 py-5 shadow-[0_0_24px_rgba(168,85,247,0.18)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300/90">
            Dashboard Writing
          </p>
          <h1 className="mt-2 text-2xl font-black text-white sm:text-3xl">
            Day 1 - School Canteen
          </h1>
          <p className="mt-2 text-xs text-slate-400">
            Bright Neon yozish bo‘limi: contextni o‘qib, insho yozing va AI
            tekshiruvga yuboring.
          </p>
        </header>

        {loading && (
          <div className="rounded-2xl border border-fuchsia-500/30 bg-black/30 p-5 text-sm text-slate-300">
            Writing vazifa yuklanmoqda...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-rose-500/35 bg-rose-950/30 p-5 text-sm text-rose-200">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <section className="rounded-2xl border border-stone-300/60 bg-gradient-to-b from-stone-100 via-amber-50 to-stone-200 px-5 py-5 text-stone-900">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-700">
                Dear Student · Manager Letter
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {letterText}
              </p>
            </section>

            <section className="rounded-2xl border border-fuchsia-500/35 bg-black/45 p-5 shadow-[0_0_28px_rgba(168,85,247,0.16)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-300/90">
                  Writing Area
                </p>
                <span
                  className={`rounded-lg border px-3 py-1 text-xs font-bold ${
                    wordCount >= 50
                      ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                      : "border-rose-400/60 bg-rose-500/15 text-rose-200"
                  }`}
                >
                  {wordCount} so‘z
                </span>
              </div>
              <textarea
                value={essay}
                onChange={(e) => setEssay(e.target.value)}
                rows={14}
                placeholder="Inshoni shu yerda yozing..."
                className="min-h-[260px] w-full resize-y rounded-xl border border-fuchsia-500/40 bg-[#0d0314] px-4 py-3 text-base leading-relaxed text-white placeholder:text-fuchsia-300/35 focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30"
              />
              <button
                type="button"
                className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-fuchsia-400/55 bg-gradient-to-r from-fuchsia-600/35 to-violet-600/35 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-fuchsia-50 shadow-[0_0_26px_rgba(217,70,239,0.45)] transition hover:brightness-110"
              >
                AI Tekshiruv
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
