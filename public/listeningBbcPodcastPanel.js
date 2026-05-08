import { resolveBbcSixMinuteForStudyDay } from "/listeningBbcSixMinuteCatalog.js";

/**
 * Grammar fazali kartochkaga o‘xshash BBC 6 Minute English podcast paneli.
 * @param {number} studyDay
 * @param {(s: string) => string} esc
 * @param {{ bannerTimerPreview?: string, bannerHintUz?: string, hideBannerHint?: boolean }} [opts]
 */
export function listeningBbcPodcastBannerHtml(studyDay, esc, opts = {}) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
  const ep = resolveBbcSixMinuteForStudyDay(d);
  const hintText = opts.bannerHintUz ?? '«BOSHLASH»ni bosing — 20 daqiqa shundan boshlanadi';
  const hintBlk =
    opts.hideBannerHint === true
      ? ""
      : `<p data-listening-banner-timer-hint class="mt-1 max-w-[11rem] pl-8 text-[9px] leading-tight text-slate-500 sm:pl-0">${esc(hintText)}</p>`;
  return `
<div class="mb-6 space-y-5" data-bbc-podcast-mount>
  <div class="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-fuchsia-500/35 bg-black/35 p-5 sm:p-6">
    <div class="min-w-0">
      <p class="text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-300/95">Day ${esc(String(d))} — Listening Section</p>
      <h4 class="mt-1 text-xl font-black leading-tight text-white sm:text-2xl">BBC Learning English · 6 Minute English</h4>
      <p class="mt-2 text-sm font-semibold text-slate-200">${esc(ep.titleEn)}</p>
      <p class="mt-2 max-w-prose text-sm leading-relaxed text-slate-300">
        Podcastni brauzerda tinglash uchun ostidagi havolani oching (bu sahifada pleer yo‘q). «BOSHLASH»dan keyin esa faqat diktant audosi bo‘ladi.
      </p>
      <a href="${esc(ep.programmeUrl)}" target="_blank" rel="noopener noreferrer"
        class="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-xl border border-cyan-500/45 bg-cyan-600/20 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-600/35">
        BBC sahifasi (episode)
      </a>
    </div>
    <div class="shrink-0 rounded-2xl border-2 border-fuchsia-500/70 bg-black px-4 py-3 text-right shadow-[0_0_20px_rgba(168,85,247,0.22)] sm:px-5 sm:py-2.5">
      <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Qolgan vaqt</p>
      <p data-listening-banner-timer class="font-mono text-2xl font-black tabular-nums text-fuchsia-300 sm:text-3xl">${esc(String(opts.bannerTimerPreview || "20:00"))}</p>
      ${hintBlk}
    </div>
  </div>
</div>`;
}
