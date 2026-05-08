import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchGrammarTaskTargetPage,
  fetchSignedBooksPdfUrl,
  getPublicBooksPdfUrl,
  type FetchTargetPageArgs,
} from "../lib/fetchGrammarPdfFromSupabase";

export type GrammarPdfViewerProps = {
  supabase: SupabaseClient;
  /** Current planner day (1-based), same value you use when querying `grammar_tasks`. */
  studyDay: number;
  /** Object path inside the `books` bucket, e.g. `macmillan/destination-b2.pdf`. */
  bookStoragePath: string;
  /** If true, use getPublicUrl instead of signed URLs (public bucket). */
  usePublicUrl?: boolean;
  /** Signed URL lifetime in seconds when usePublicUrl is false. */
  signedUrlExpiresIn?: number;
  /** Passed through to `fetchGrammarTaskTargetPage` (table, day column, extraEq, fallback). */
  taskQuery?: Omit<FetchTargetPageArgs, "studyDay">;
  className?: string;
  /** Fixed viewer height in CSS pixels (default 600). */
  viewerHeightPx?: number;
  /** Suggested download file name. */
  downloadFileName?: string;
};

function pickFilenameFromPath(path: string, fallback: string) {
  const base = path.split("/").pop()?.trim();
  if (base && /\.pdf$/i.test(base)) return base;
  return fallback;
}

async function downloadUrlAsFile(url: string, filename: string) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * B1–B2 grammar book viewer: loads `target_page` for the active study day from
 * `grammar_tasks`, resolves the PDF from Supabase Storage bucket `books`, and
 * embeds it in an iframe with `#page=` so the browser PDF plugin opens on that page.
 */
export function GrammarPdfViewer({
  supabase,
  studyDay,
  bookStoragePath,
  usePublicUrl = false,
  signedUrlExpiresIn = 3600,
  taskQuery,
  className = "",
  viewerHeightPx = 600,
  downloadFileName = "grammar-book.pdf",
}: GrammarPdfViewerProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [targetPage, setTargetPage] = useState(1);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const effectiveDownloadName = useMemo(
    () => pickFilenameFromPath(bookStoragePath, downloadFileName),
    [bookStoragePath, downloadFileName],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { targetPage: page } = await fetchGrammarTaskTargetPage(supabase, {
        studyDay,
        ...taskQuery,
      });
      setTargetPage(page);

      const base = usePublicUrl
        ? getPublicBooksPdfUrl(supabase, bookStoragePath).publicUrl
        : (await fetchSignedBooksPdfUrl(supabase, bookStoragePath, signedUrlExpiresIn))
            .signedUrl;

      setPdfUrl(base);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPdfUrl(null);
    } finally {
      setLoading(false);
    }
  }, [bookStoragePath, signedUrlExpiresIn, studyDay, supabase, taskQuery, usePublicUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const iframeSrc = pdfUrl
    ? `${pdfUrl}#page=${encodeURIComponent(String(targetPage))}`
    : "";

  const requestFullScreen = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      await el.requestFullscreen({ navigationUI: "hide" });
    } catch {
      /* Safari / older browsers */
      const anyEl = el as unknown as { webkitRequestFullscreen?: () => Promise<void> };
      if (typeof anyEl.webkitRequestFullscreen === "function") {
        await anyEl.webkitRequestFullscreen();
      }
    }
  };

  const onDownload = async () => {
    if (!pdfUrl) return;
    try {
      await downloadUrlAsFile(pdfUrl, effectiveDownloadName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={`grammar-pdf-viewer w-full ${className}`.trim()}>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void requestFullScreen()}
          disabled={!pdfUrl}
          className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-600/25 px-3 py-2 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-600/35 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Full screen
        </button>
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={!pdfUrl}
          className="rounded-lg border border-emerald-500/40 bg-emerald-600/25 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/35 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Download
        </button>
      </div>

      {loading && (
        <p className="text-sm text-white/60" role="status">
          Loading grammar PDF…
        </p>
      )}
      {error && (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <div
        ref={shellRef}
        className="w-full overflow-hidden rounded-xl border border-white/10 bg-black/30"
        style={{
          width: "100%",
          height: `min(${viewerHeightPx}px, 85vh)`,
          minHeight: 280,
        }}
      >
        {iframeSrc ? (
          <iframe
            key={`${iframeSrc}`}
            title="Grammar textbook PDF"
            src={iframeSrc}
            className="h-full w-full border-0 bg-neutral-950"
          />
        ) : (
          !loading &&
          !error && (
            <div className="flex h-full w-full items-center justify-center text-sm text-white/50">
              No PDF URL yet
            </div>
          )
        )}
      </div>

      {!loading && !error && (
        <p className="mt-2 text-xs text-white/45">
          Page {targetPage} (from <code className="text-white/55">grammar_tasks.target_page</code>
          ).
        </p>
      )}
    </div>
  );
}

export default GrammarPdfViewer;
