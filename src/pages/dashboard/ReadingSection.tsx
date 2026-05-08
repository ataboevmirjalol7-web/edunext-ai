import React, { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type ReadingRow = {
  day_number?: number | null;
  title?: string | null;
  passage?: string | null;
  reading_passage?: string | null;
  reading_text?: string | null;
  questions?: unknown;
};

type McqQuestion = {
  id: string;
  question: string;
  options: string[];
};

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
  return { url: String(url || "").trim(), key: String(key || "").trim() };
}

function pickPassage(row: ReadingRow | null) {
  if (!row) return "";
  return String(row.passage ?? row.reading_passage ?? row.reading_text ?? "").trim();
}

function normalizeQuestions(raw: unknown): McqQuestion[] {
  if (!raw || typeof raw !== "object") return [];
  const src = raw as Record<string, unknown>;
  const parts: unknown[] = [];
  if (Array.isArray(src.part1)) parts.push(...src.part1);
  if (Array.isArray(src.part2)) parts.push(...src.part2);
  if (Array.isArray(src.part3)) parts.push(...src.part3);
  if (!parts.length && Array.isArray(src.questions)) parts.push(...(src.questions as unknown[]));

  const out: McqQuestion[] = [];
  parts.forEach((item, i) => {
    const q = item as Record<string, unknown>;
    const question = String(q.question ?? q.q ?? "").trim();
    const optionsRaw = Array.isArray(q.options)
      ? q.options
      : Array.isArray(q.choices)
        ? q.choices
        : [];
    const options = optionsRaw.map((o) => String(o ?? "").trim()).filter(Boolean);
    if (!question || options.length < 2) return;
    out.push({
      id: String(q.id ?? q.qid ?? `q${i + 1}`),
      question,
      options: options.slice(0, 4),
    });
  });
  return out.slice(0, 10);
}

export default function ReadingSection() {
  const [row, setRow] = useState<ReadingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

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
          .from("reading_tasks")
          .select("*")
          .eq("day_number", 1)
          .maybeSingle();
        if (qErr) throw qErr;
        if (!cancelled) setRow((data as ReadingRow) ?? null);
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

  const passage = useMemo(() => pickPassage(row), [row]);
  const questions = useMemo(() => normalizeQuestions(row?.questions), [row?.questions]);

  return (
    <div className="min-h-screen bg-[#070708] text-white">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8 sm:px-10 sm:py-10">
        <header className="rounded-2xl border border-fuchsia-500/40 bg-black/40 px-6 py-5 shadow-[0_0_24px_rgba(168,85,247,0.18)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300/90">
            Dashboard Reading
          </p>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl">Day 1 Reading</h1>
        </header>

        {loading && (
          <div className="rounded-2xl border border-fuchsia-500/30 bg-black/30 p-5 text-sm text-slate-300">
            Reading yuklanmoqda...
          </div>
        )}
        {!loading && error && (
          <div className="rounded-2xl border border-rose-500/35 bg-rose-950/30 p-5 text-sm text-rose-200">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-fuchsia-500/30 bg-black/45 p-5 shadow-[0_0_24px_rgba(168,85,247,0.14)]">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-300/90">
                Text
              </p>
              <h2 className="mt-2 text-lg font-bold text-white">
                {String(row?.title ?? "Reading Passage").trim() || "Reading Passage"}
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                {passage || "Day 1 reading matni topilmadi."}
              </p>
            </section>

            <section className="rounded-2xl border border-cyan-500/30 bg-black/45 p-5 shadow-[0_0_24px_rgba(34,211,238,0.12)]">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300/90">
                Questions (MCQ)
              </p>
              <div className="mt-3 space-y-4">
                {questions.length ? (
                  questions.map((q, idx) => (
                    <article key={q.id} className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <p className="text-sm font-semibold text-white">
                        {idx + 1}. {q.question}
                      </p>
                      <div className="mt-2 space-y-2">
                        {q.options.map((opt, oi) => {
                          const selected = answers[q.id] === opt;
                          return (
                            <button
                              key={`${q.id}-${oi}`}
                              type="button"
                              onClick={() =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: opt,
                                }))
                              }
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                                selected
                                  ? "border-fuchsia-400/65 bg-fuchsia-500/20 text-fuchsia-100"
                                  : "border-white/10 bg-black/30 text-slate-200 hover:border-fuchsia-500/35"
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Day 1 uchun test savollari topilmadi.</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
