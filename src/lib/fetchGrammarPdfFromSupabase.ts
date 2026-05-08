import type { SupabaseClient } from "@supabase/supabase-js";

export const BOOKS_STORAGE_BUCKET = "books" as const;

export type GrammarTaskTargetRow = {
  target_page: number | null;
};

export type FetchTargetPageArgs = {
  /** 1-based study day shown in your dashboard planner. */
  studyDay: number;
  /** Table name (default grammar_tasks). */
  table?: string;
  /** Column storing the planner day number (default day_number). */
  dayColumn?: string;
  /** Optional equality filters (e.g. `{ tier: "b1-b2" }`). */
  extraEq?: Record<string, string | number | boolean>;
  /** Fallback when no row matches (default 1). */
  fallbackPage?: number;
};

/**
 * Loads `target_page` for today’s planner day from Supabase Postgres.
 *
 * Expected row shape includes `target_page` (integer, 1-based printed page index).
 * Adjust `dayColumn` / `extraEq` to match your real `grammar_tasks` schema.
 *
 * Requires RLS policies that allow the signed-in learner to SELECT this row.
 */
export async function fetchGrammarTaskTargetPage(
  supabase: SupabaseClient,
  args: FetchTargetPageArgs,
): Promise<{ targetPage: number; raw: GrammarTaskTargetRow | null }> {
  const {
    studyDay,
    table = "grammar_tasks",
    dayColumn = "day_number",
    extraEq,
    fallbackPage = 1,
  } = args;

  const d = Math.floor(Number(studyDay));
  const safeDay = Number.isFinite(d) && d > 0 ? d : 1;

  let q = supabase.from(table).select("target_page").eq(dayColumn, safeDay).limit(1);

  if (extraEq && typeof extraEq === "object") {
    for (const [key, val] of Object.entries(extraEq)) {
      if (val === undefined) continue;
      q = q.eq(key, val);
    }
  }

  const { data, error } = await q.maybeSingle();

  if (error) throw error;

  const row = (data ?? null) as GrammarTaskTargetRow | null;
  const rawPage = row?.target_page;
  const n = Math.floor(Number(rawPage));
  const targetPage =
    Number.isFinite(n) && n >= 1 ? n : Math.max(1, Math.floor(fallbackPage));

  return { targetPage, raw: row };
}

export type SignedPdfUrlResult = {
  signedUrl: string;
  path: string;
  expiresIn: number;
};

/**
 * Returns a time-limited URL suitable for <iframe src> and fetch(blob) download.
 * For public buckets you can use `getPublicUrl` instead and skip signing.
 */
export async function fetchSignedBooksPdfUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<SignedPdfUrlResult> {
  const path = String(storagePath ?? "").replace(/^\/+/, "");
  if (!path) throw new Error("storagePath is required (e.g. destination-b2/book.pdf)");

  const { data, error } = await supabase.storage
    .from(BOOKS_STORAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("No signedUrl returned from Supabase Storage");

  return { signedUrl: data.signedUrl, path, expiresIn: expiresInSeconds };
}

/**
 * Optional helper: public bucket URL (no expiry). Use when the `books` bucket is public.
 */
export function getPublicBooksPdfUrl(
  supabase: SupabaseClient,
  storagePath: string,
): { publicUrl: string; path: string } {
  const path = String(storagePath ?? "").replace(/^\/+/, "");
  if (!path) throw new Error("storagePath is required");

  const { data } = supabase.storage.from(BOOKS_STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("No publicUrl returned");
  return { publicUrl: data.publicUrl, path };
}
