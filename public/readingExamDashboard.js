/** @typedef {{ questionId:number, stem:string, userAnswerLabel:string, correctAnswerLabel:string, ok?:boolean }} ReadingMistakeRow */

import { getTimedReadingExamPayload } from "/readingExamContent.js";
import { handleCheck, isGroqRateLimitPayload } from "/aiGroqRetry.js";

/** Dashboard timed reading natijalari (localStorage kaliti) — bajarilgan kartada qayta ko‘rsatish uchun. */
export function getDashReadingExamStorageKey(dayNum, tier) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const t = String(tier || "A2").trim() === "B1" ? "B1" : "A2";
  return `edunext_dash_reading_exam_v1_${d}_${t}`;
}

function formatClockMs(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function normalizeTfng(s) {
  let u = String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (u === "T") u = "TRUE";
  if (u === "F") u = "FALSE";
  if (u === "NG" || u === "N/G") u = "NOT GIVEN";
  return u;
}

function labelOption(q, idx) {
  if (!Array.isArray(q.options) || !q.options[idx]) return String(idx);
  const L = ["A", "B", "C", "D", "E"][idx] ?? `${idx}`;
  return `${L}) ${q.options[idx]}`;
}

function labelCorrect(q) {
  if (q.kind === "mcq" || q.kind === "vocab_pick")
    return labelOption(q, Number(q.correctIndex ?? -1));
  if (q.kind === "tfng") return String(q.correct ?? "");
  return "";
}

function labelUser(q, stored) {
  if (stored == null || stored === "") return "— javob bermadingiz —";
  if (q.kind === "mcq" || q.kind === "vocab_pick") {
    const i = Number(stored);
    if (!Number.isFinite(i)) return String(stored);
    return labelOption(q, i);
  }
  if (q.kind === "tfng") return normalizeTfng(stored);
  return String(stored);
}

/** @returns {boolean} */
export function gradeOneQuestion(q, userVal) {
  if (!q) return false;
  if (q.kind === "mcq" || q.kind === "vocab_pick") {
    return Number(userVal) === Number(q.correctIndex);
  }
  if (q.kind === "tfng") {
    return normalizeTfng(userVal) === normalizeTfng(q.correct);
  }
  return false;
}

/**
 * @param {*} mount
 * @param {{
 *   tier: string,
 *   studyDay: number,
 *   apiUrlFn: (p:string)=>string,
 *   escapeHtml: (s:string)=>string,
 *   payload?: *,
 *   examSourceHint?: string,
 *   reviewMode?: boolean,
 *   prefilledAnswers?: Record<number, string|number>,
 *   supabase?: *,
 *   userId?: string|number|null,
 *   openVocabularyWindow?: ()=>void,
 *   onTimedReadingComplete?: () => void,
 * }} ctx
 * `payload` berilsa (masalan Supabase `reading_tasks`), shu ishlatiladi; aks holda `getTimedReadingExamPayload`.
 */
export function setupTimedReadingExam(mount, ctx) {
  const {
    tier,
    studyDay,
    apiUrlFn,
    escapeHtml,
    examSourceHint,
    supabase,
    userId,
    openVocabularyWindow,
    onTimedReadingComplete,
  } = ctx;
  /** Review: `reading_results` yoki yakunlangan kun — taymerlar va avto-o‘tish o‘chiriladi, bosqichlar paneli ochiladi. */
  const reviewMode = Boolean(ctx.reviewMode);
  if (!mount) return;

  if (mount._readingExamClearTimer && typeof mount._readingExamClearTimer === "function") {
    mount._readingExamClearTimer();
    mount._readingExamClearTimer = null;
  }

  let intervalId = null;
  /** @type {number | null} */
  let phaseDeadlineTs = null;
  /** `exam` — matn + part1/2/3 bitta scroll sahifada; `results` — natija. */
  let wizard = "exam";
  /** 4 bosqich: 1-matn, 2-Part1 (MCQ), 3-Part2 (T/F/NG), 4-Part3 (vocab). */
  let phase = 1;
  let attemptPassed = null;
  let aiAnalysisComplete = false;
  let part2ButtonReady = false;
  let part3ButtonReady = false;
  let userReflection = "";
  let readingSaveStatus = { savedToDb: null, errorMsg: null };
  let finishingInProgress = false;
  /** @type {Record<number, string|number>} */
  const userAnswers = {};
  /** @type {null | { q: *, ok:boolean, uLabel:string, cLabel:string }[]} */
  let gradedRows = null;

  let payload;
  try {
    payload = ctx.payload ?? getTimedReadingExamPayload(studyDay, tier);
  } catch (_) {
    mount.innerHTML = `<p class="text-sm text-red-300">Reading exam ma'lumoti yuklanmadi.</p>`;
    return;
  }

  const prefilled =
    ctx.prefilledAnswers && typeof ctx.prefilledAnswers === "object"
      ? ctx.prefilledAnswers
      : {};
  for (const [k, raw] of Object.entries(prefilled)) {
    const qid = Number(k);
    if (!Number.isFinite(qid)) continue;
    const qRow = payload.questions.find((x) => x.id === qid);
    if (qRow && (qRow.kind === "mcq" || qRow.kind === "vocab_pick")) {
      const n = Number(raw);
      userAnswers[qid] = Number.isFinite(n) ? n : raw;
    } else {
      userAnswers[qid] = raw;
    }
  }

  const RESULT_KEY = getDashReadingExamStorageKey(payload.dayNumber, payload.tierLabel);
  const EXAM_STATE_KEY = `${RESULT_KEY}__state`;
  /** @type {number | null} */
  let restoredPhaseDeadlineTs = null;

  function persistResultsSnapshot() {
    if (!gradedRows) return;
    try {
      const okN = gradedRows.filter((x) => x.ok).length;
      let prev = {};
      try {
        const raw = localStorage.getItem(RESULT_KEY);
        if (raw) prev = JSON.parse(raw);
      } catch {
        prev = {};
      }
      const next = {
        v: 1,
        savedAt: Date.now(),
        okN,
        total: gradedRows.length,
        rows: gradedRows.map((r) => ({
          id: r.q.id,
          ok: r.ok,
          stem: r.q.stem,
          uLabel: r.uLabel,
          cLabel: r.cLabel,
        })),
      };
      if (Array.isArray(prev.aiAnalyses)) next.aiAnalyses = prev.aiAnalyses;
      if (typeof prev.aiSavedAt === "number") next.aiSavedAt = prev.aiSavedAt;
      localStorage.setItem(RESULT_KEY, JSON.stringify(next));
    } catch (_) {
      /* ignore */
    }
  }

  function persistAiAnalyses(/** @type {unknown[]} */ analyses) {
    try {
      let prev = {};
      try {
        const raw = localStorage.getItem(RESULT_KEY);
        if (raw) prev = JSON.parse(raw);
      } catch {
        prev = {};
      }
      prev.aiAnalyses = analyses;
      prev.aiSavedAt = Date.now();
      localStorage.setItem(RESULT_KEY, JSON.stringify(prev));
    } catch (_) {
      /* ignore */
    }
  }

  function persistExamState() {
    if (reviewMode) return;
    try {
      const answers = {};
      for (const [k, v] of Object.entries(userAnswers || {})) {
        const qid = Number(k);
        if (!Number.isFinite(qid)) continue;
        answers[qid] = v;
      }
      const snap = {
        v: 1,
        savedAt: Date.now(),
        wizard,
        phase,
        userAnswers: answers,
        part2ButtonReady: Boolean(part2ButtonReady),
        part3ButtonReady: Boolean(part3ButtonReady),
        userReflection: String(userReflection || ""),
        attemptPassed,
        aiAnalysisComplete: Boolean(aiAnalysisComplete),
        passageBodyHtml: String(passageBodyHtml || ""),
        phaseDeadlineTs: Number.isFinite(phaseDeadlineTs) ? phaseDeadlineTs : null,
      };
      localStorage.setItem(EXAM_STATE_KEY, JSON.stringify(snap));
    } catch (_) {
      /* ignore */
    }
  }

  function restoreExamStateFromStorage() {
    if (reviewMode) return;
    try {
      const raw = localStorage.getItem(EXAM_STATE_KEY);
      if (!raw) return;
      const st = JSON.parse(raw);
      if (!st || typeof st !== "object") return;

      const nextPhase = Number(st.phase);
      if (Number.isFinite(nextPhase) && nextPhase >= 1 && nextPhase <= 4) {
        phase = nextPhase;
      }
      if (st.wizard === "exam" || st.wizard === "results" || st.wizard === "ai_review") {
        wizard = st.wizard;
      }
      part2ButtonReady = Boolean(st.part2ButtonReady);
      part3ButtonReady = Boolean(st.part3ButtonReady);
      aiAnalysisComplete = Boolean(st.aiAnalysisComplete);
      if (typeof st.userReflection === "string") userReflection = st.userReflection;
      if (typeof st.passageBodyHtml === "string" && st.passageBodyHtml.trim()) {
        passageBodyHtml = st.passageBodyHtml;
      }
      if (st.userAnswers && typeof st.userAnswers === "object") {
        for (const [k, rawV] of Object.entries(st.userAnswers)) {
          const qid = Number(k);
          if (!Number.isFinite(qid)) continue;
          const qRow = payload.questions.find((x) => x.id === qid);
          if (!qRow) continue;
          if (qRow.kind === "mcq" || qRow.kind === "vocab_pick") {
            const n = Number(rawV);
            userAnswers[qid] = Number.isFinite(n) ? n : rawV;
          } else {
            userAnswers[qid] = rawV;
          }
        }
      }
      const dl = Number(st.phaseDeadlineTs);
      if (Number.isFinite(dl) && dl > Date.now()) restoredPhaseDeadlineTs = dl;
    } catch (_) {
      /* ignore */
    }
  }

  const D = payload.phaseDurationsMs;
  const MAX_ERRORS_TO_PASS = 6;
  const esc = escapeHtml;
  const sourceHintHtml =
    typeof examSourceHint === "string" && examSourceHint.trim()
      ? `<p class="mb-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-snug text-slate-300">${esc(examSourceHint.trim())}</p>`
      : "";
  /** Matn + foydalanuvchi qo‘ygan highlight spanlari (innerHTML, xavfsiz boshlang‘ich: faqat esc matn). */
  let passageBodyHtml = esc(payload.passage);
  /** @type {HTMLElement | null} */
  let readingHlToolbarEl = null;
  /** @type {Range | null} */
  let pendingHighlightRange = null;

  const qsMcq = payload.questions.filter((q) => q.phase === "mcq");
  const qsTfng = payload.questions.filter((q) => q.phase === "tfng");
  const qsVocab = payload.questions.filter((q) => q.phase === "vocab");
  const rngPart1 =
    qsMcq.length === 0 ? "—" : qsMcq.length === 1 ? "1" : `1–${qsMcq.length}`;
  const p2Lo = qsMcq.length + 1;
  const p2Hi = qsMcq.length + qsTfng.length;
  const rngPart2 =
    qsTfng.length === 0 ? "—" : p2Lo === p2Hi ? `${p2Lo}` : `${p2Lo}–${p2Hi}`;
  const p3Lo = qsMcq.length + qsTfng.length + 1;
  const p3Hi = qsMcq.length + qsTfng.length + qsVocab.length;
  const rngPart3 =
    qsVocab.length === 0 ? "—" : p3Lo === p3Hi ? `${p3Lo}` : `${p3Lo}–${p3Hi}`;

  restoreExamStateFromStorage();

  function reviewPhaseNavHtml() {
    if (!reviewMode) return "";
    const tab = (w, lab) =>
      `<button type="button" data-reading-phase="${esc(w)}"
        class="rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
          wizard === w
            ? "border-sky-400/70 bg-sky-500/25 text-sky-100"
            : "border-white/15 bg-black/40 text-slate-300 hover:border-white/30"
        }">${esc(lab)}</button>`;
    return `
<div class="sticky top-0 z-10 mb-3 space-y-2 rounded-xl border border-sky-500/35 bg-sky-950/35 p-3 shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
  <p class="text-[10px] font-bold uppercase tracking-wider text-sky-200">Review mode — taymerlar o‘chirilgan; bosqichlarni tanlang.</p>
  <div class="flex flex-wrap gap-2">${tab("exam", "Imtihon")}${tab("results", "Natija")}</div>
</div>`;
  }

  const HIGHLIGHT_TAILWIND = [
    "bg-amber-400/38 text-inherit decoration-inherit shadow-[inset_0_-1px_0_rgba(251,191,36,0.45)]",
    "bg-emerald-400/32 text-inherit decoration-inherit shadow-[inset_0_-1px_0_rgba(52,211,153,0.4)]",
    "bg-violet-400/32 text-inherit decoration-inherit shadow-[inset_0_-1px_0_rgba(167,139,250,0.45)]",
    "bg-sky-400/32 text-inherit decoration-inherit shadow-[inset_0_-1px_0_rgba(56,189,248,0.45)]",
    "bg-rose-400/32 text-inherit decoration-inherit shadow-[inset_0_-1px_0_rgba(251,113,133,0.45)]",
  ];

  function passageHostInner() {
    return `<div data-reading-passage-host class="reading-passage-host whitespace-pre-wrap select-text cursor-text [text-indent:initial]">${passageBodyHtml}</div>`;
  }

  function removeReadingHlToolbar() {
    if (readingHlToolbarEl && readingHlToolbarEl.parentNode) {
      readingHlToolbarEl.parentNode.removeChild(readingHlToolbarEl);
    }
    readingHlToolbarEl = null;
    pendingHighlightRange = null;
  }

  function ensureReadingHlToolbar() {
    if (readingHlToolbarEl && document.body.contains(readingHlToolbarEl)) return readingHlToolbarEl;

    removeReadingHlToolbar();
    const bar = document.createElement("div");
    bar.dataset.readingHlToolbar = "";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Matnda rang bilan belgilash");
    bar.className =
      "z-[9810] hidden flex flex-wrap items-center gap-1 rounded-xl border border-white/25 bg-neutral-950/95 px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-md";
    bar.style.display = "none";
    bar.style.position = "fixed";

    const swatches = ["bg-amber-400/90", "bg-emerald-400/90", "bg-violet-400/90", "bg-sky-400/90", "bg-rose-400/85"];
    swatches.forEach((bg, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.readingHlPick = String(idx);
      b.title = `Rang ${idx + 1}`;
      b.className = `reading-hl-btn h-8 w-8 shrink-0 rounded-lg border border-white/25 ${bg} transition hover:scale-105 active:scale-95`;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      bar.appendChild(b);
    });

    const clr = document.createElement("button");
    clr.type = "button";
    clr.dataset.readingHlClearPassage = "";
    clr.textContent = "Tozalash";
    clr.className =
      "ml-1 shrink-0 rounded-lg border border-red-400/35 bg-red-950/55 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-100 transition hover:bg-red-900/65";
    clr.title = "Barcha rang belgilarini olib tashlash";
    clr.addEventListener("mousedown", (e) => e.preventDefault());
    bar.appendChild(clr);

    document.body.appendChild(bar);
    readingHlToolbarEl = bar;
    return bar;
  }

  function hideReadingHlToolbar() {
    if (!readingHlToolbarEl) return;
    readingHlToolbarEl.style.display = "none";
    readingHlToolbarEl.classList.add("hidden");
    pendingHighlightRange = null;
  }

  function positionReadingHlToolbar(range) {
    const bar = ensureReadingHlToolbar();
    const r = range.getBoundingClientRect();
    bar.classList.remove("hidden");
    bar.style.display = "flex";
    bar.style.visibility = "hidden";
    bar.style.left = "0";
    bar.style.top = "0";

    const bw = bar.offsetWidth || 220;
    const bh = bar.offsetHeight || 44;
    bar.style.visibility = "visible";

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(pad, Math.min(left, vw - bw - pad));

    let top = r.bottom + 8;
    if (top + bh > vh - pad) top = Math.max(pad, r.top - bh - 8);

    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  /**
   * @param {number} idx
   */
  function applyPendingHighlight(idx) {
    const host = mount.querySelector("[data-reading-passage-host]");
    const range = pendingHighlightRange;
    if (!host || !range) return;
    if (!Number.isFinite(idx) || idx < 0 || idx >= HIGHLIGHT_TAILWIND.length) return;
    try {
      if (!host.contains(range.commonAncestorContainer)) return;
      if (range.collapsed) return;

      const span = document.createElement("span");
      span.className = `rounded-sm px-[0.12rem] py-px ${HIGHLIGHT_TAILWIND[idx % HIGHLIGHT_TAILWIND.length]}`;
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
      passageBodyHtml = host.innerHTML;

      pendingHighlightRange = null;
      const sel = window.getSelection?.();
      if (sel) sel.removeAllRanges();
      hideReadingHlToolbar();
    } catch (_) {
      hideReadingHlToolbar();
    }
  }

  function clearPassageHighlights() {
    passageBodyHtml = esc(payload.passage);
    pendingHighlightRange = null;
    hideReadingHlToolbar();
    mount.querySelectorAll("[data-reading-passage-host]").forEach((node) => {
      /** @type {HTMLElement} */ (node).innerHTML = passageBodyHtml;
    });
  }

  function onReadingPassageMouseUp(ev) {
    const hostFromEvent = /** @type {HTMLElement} */ (ev.target)?.closest?.("[data-reading-passage-host]");
    if (!hostFromEvent || !mount.contains(hostFromEvent)) {
      hideReadingHlToolbar();
      return;
    }

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      pendingHighlightRange = null;
      hideReadingHlToolbar();
      return;
    }

    const range = sel.getRangeAt(0);
    const text = sel.toString().replace(/\u00a0/g, " ").trim();
    if (text.length < 1) {
      hideReadingHlToolbar();
      return;
    }

    try {
      if (!hostFromEvent.contains(range.commonAncestorContainer)) {
        hideReadingHlToolbar();
        return;
      }
      pendingHighlightRange = range.cloneRange();
      positionReadingHlToolbar(range);
    } catch (_) {
      hideReadingHlToolbar();
    }
  }

  /** @type {AbortController | null} */
  let readingHlUiAbort = null;

  function wireReadingHighlightUi() {
    if (readingHlUiAbort) readingHlUiAbort.abort();
    readingHlUiAbort = new AbortController();
    const opt = { signal: readingHlUiAbort.signal };
    mount.addEventListener("mouseup", onReadingPassageMouseUp, opt);
    document.addEventListener(
      "mousedown",
      (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest?.("[data-reading-hl-toolbar]")) return;
        hideReadingHlToolbar();
      },
      opt,
    );
    document.addEventListener(
      "click",
      (e) => {
        const pick = /** @type {HTMLElement} */ (e.target)?.closest?.("[data-reading-hl-pick]");
        if (pick) {
          const idx = Number(pick.getAttribute("data-reading-hl-pick"));
          if (Number.isFinite(idx)) {
            e.preventDefault();
            e.stopPropagation();
            applyPendingHighlight(idx);
          }
          return;
        }
        const clr = /** @type {HTMLElement} */ (e.target)?.closest?.("[data-reading-hl-clear-passage]");
        if (clr) {
          e.preventDefault();
          e.stopPropagation();
          clearPassageHighlights();
        }
      },
      opt,
    );
  }

  function clearTicker() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    phaseDeadlineTs = null;
  }

  function armTicker(endTs) {
    clearTicker();
    if (reviewMode) {
      const lab = mount.querySelector("[data-reading-timer-chip]");
      if (lab) {
        lab.textContent = "—";
        lab.classList.remove("text-emerald-100", "text-cyan-100", "text-amber-50");
        lab.classList.add("text-sky-300/95");
      }
      return;
    }
    phaseDeadlineTs = endTs;
    intervalId = setInterval(() => {
      const lab = mount.querySelector("[data-reading-timer-chip]");
      if (!lab || !phaseDeadlineTs) return;
      const left = phaseDeadlineTs - Date.now();
      lab.textContent = formatClockMs(left);
      if (left <= 0) {
        clearTicker();
        onTimerExpire();
      }
    }, 400);
    const lab = mount.querySelector("[data-reading-timer-chip]");
    if (lab && phaseDeadlineTs) lab.textContent = formatClockMs(phaseDeadlineTs - Date.now());
  }

  function onTimerExpire() {
    if (reviewMode) return;
    if (wizard !== "exam") return;

    if (phase === 1) {
      phase += 1;
      part2ButtonReady = false;
      render();
      return;
    }
    if (phase === 2) {
      part2ButtonReady = true;
      render();
      return;
    }
    if (phase === 3) {
      part3ButtonReady = true;
      render();
      return;
    }

    // Phase 4 tugasa — tekshirish + AI Mentor + textarea (saving keyinroq).
    void startFinishFlow({ source: "timer" });
  }

  /**
   * Bitta MCQ kartasi — `name="re-p1-${idx}"` har savol uchun noyob (bazada bir xil `id` bo‘lsa ham radios guruhlari aralashmaydi).
   */
  function mcqCardHtml(q, idx, displayNum, namePrefix, accentTitleClass) {
    const escH = escapeHtml;
    const groupName = `${namePrefix}-${idx}`;
    const opts = (q.options || []).map((opt, oi) => {
      const checked = Number(userAnswers[q.id]) === oi ? "checked" : "";
      const dis = reviewMode ? "disabled " : "";
      return `
<label class="mt-2 flex gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 hover:border-emerald-500/35 ${reviewMode ? "cursor-default opacity-90" : "cursor-pointer"}">
  <input type="radio" name="${esc(groupName)}" value="${oi}" ${checked} ${dis}data-reading-mcq-idx="${idx}" data-reading-mcq-phase="${esc(namePrefix)}" class="reading-mcq-inp mt-1 h-4 w-4 shrink-0 accent-emerald-500"/>
  <span class="text-sm text-slate-200">${escH(String.fromCharCode(65 + oi))}. ${escH(opt)}</span>
</label>`;
    });
    return `
<div class="rounded-xl border border-white/10 bg-black/25 p-4" data-reading-q-wrap="${q.id}" data-reading-part1-idx="${idx}">
  <p class="font-semibold ${accentTitleClass}">${displayNum}. ${escH(q.stem)}</p>
  <div class="mt-3 space-y-1">${opts.join("")}</div>
</div>`;
  }

  /** Matn + Part 1/2/3 — bitta scroll qutisi; har part `.map()` bilan ketma-ket. */
  function examAllPartsScrollHtml() {
    const totalMs = D.passage + D.mcqBlock + D.tfngBlock + D.vocabBlock;
    const escL = escapeHtml;

    const part1Blocks = qsMcq
      .map((q, idx) => mcqCardHtml(q, idx, idx + 1, "re-p1", "text-emerald-200/95"))
      .join("");

    const part2Blocks = qsTfng
      .map((q, idx) => {
        const num = qsMcq.length + idx + 1;
        return `
<div class="rounded-xl border border-white/10 bg-black/25 p-4" data-reading-tfng-wrap="${q.id}">
  <p class="font-semibold text-cyan-200/95">${num}. ${escL(q.stem)}</p>
  <div class="mt-3 flex flex-wrap gap-2">${tfButtons(q, escL)}</div>
</div>`;
      })
      .join("");

    const part3Blocks = qsVocab
      .map((q, idx) => {
        const num = qsMcq.length + qsTfng.length + idx + 1;
        const sel = `<select data-reading-select="${q.id}" class="mt-3 w-full rounded-lg border border-amber-500/35 bg-neutral-950 px-3 py-2 text-sm text-white"${
          reviewMode ? " disabled" : ""
        }>
<option value="">— variant tanlang —</option>
${(q.options || [])
  .map((opt, oi) => {
    const selected = Number(userAnswers[q.id]) === oi ? "selected" : "";
    return `<option value="${oi}" ${selected}>${escL(String.fromCharCode(65 + oi))}. ${escL(opt)}</option>`;
  })
  .join("")}
</select>`;
        return `
<div class="rounded-xl border border-amber-500/25 bg-amber-950/10 p-4">
  <p class="font-semibold text-amber-100">${num}. ${escL(q.stem)}</p>
  ${sel}
</div>`;
      })
      .join("");

    return `
<div class="space-y-4">
  ${reviewPhaseNavHtml()}
  ${sourceHintHtml}
  <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/40 px-4 py-3">
    <div class="min-w-0">
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-200">Reading — barcha qismlar (scroll)</span>
      <p class="mt-0.5 text-[10px] text-slate-500">Part 1 → Part 2 → Part 3 ketma-ket. Jami vaqt: ${formatClockMs(D.passage)} + ${formatClockMs(D.mcqBlock)} + ${formatClockMs(D.tfngBlock)} + ${formatClockMs(D.vocabBlock)}. Tugasa avtomatik tekshirish.</p>
    </div>
    <span data-reading-timer-chip class="shrink-0 font-mono text-xl font-black tabular-nums text-emerald-100">${formatClockMs(totalMs)}</span>
  </div>
  <div class="space-y-8 rounded-xl border border-white/10 bg-black/30 p-4 sm:p-5">
    <article class="rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-[1.75] text-slate-100 sm:p-5">
      <h4 class="mb-2 text-lg font-bold text-emerald-200/95">${esc(payload.title)}</h4>
      <p class="mb-3 text-[11px] leading-snug text-slate-400">Muhim joylarni sichqoncha bilan belgilang.</p>
      ${passageHostInner()}
    </article>
    <section class="space-y-3" data-reading-section="part1">
      <h5 class="text-[11px] font-bold uppercase tracking-wider text-emerald-200/95">Part 1 — multiple choice (${rngPart1})</h5>
      ${qsMcq.length === 0 ? `<p class="text-xs text-slate-500">Savollar yo‘q.</p>` : `<div class="space-y-4">${part1Blocks}</div>`}
    </section>
    <section class="space-y-3 border-t border-white/10 pt-6" data-reading-section="part2">
      <h5 class="text-[11px] font-bold uppercase tracking-wider text-cyan-200/95">Part 2 — True / False / Not Given (${rngPart2})</h5>
      ${qsTfng.length === 0 ? `<p class="text-xs text-slate-500">Savollar yo‘q.</p>` : `<div class="space-y-4">${part2Blocks}</div>`}
    </section>
    <section class="space-y-3 border-t border-white/10 pt-6" data-reading-section="part3">
      <h5 class="text-[11px] font-bold uppercase tracking-wider text-amber-200">Part 3 — vocabulary (${rngPart3})</h5>
      ${qsVocab.length === 0 ? `<p class="text-xs text-slate-500">Savollar yo‘q.</p>` : `<div class="space-y-4">${part3Blocks}</div>`}
    </section>
    ${
      reviewMode
        ? `<p class="text-center text-xs text-slate-500">Review mode</p>`
        : `<button type="button" data-reading-act="finish" class="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border-2 border-fuchsia-400/50 bg-gradient-to-b from-fuchsia-600/30 to-black/70 px-4 py-3 text-sm font-black uppercase tracking-[0.25em] text-white shadow-[0_0_24px_rgba(217,70,239,0.15)] hover:from-fuchsia-500/35">
      Finish — javoblarni tekshirish
    </button>`
    }
  </div>
</div>`;
  }

  /**
   * @param {*} q
   * @param {(s:string)=>string} esc
   * @returns { string }
   */
  function tfButtons(q, esc) {
    const vals = ["TRUE", "FALSE", "NOT GIVEN"];
    const cur = normalizeTfng(userAnswers[q.id] ?? "");
    return vals
      .map((v) => {
        const on = cur === v ? "ring-2 ring-cyan-400/80 bg-cyan-950/35" : "border-white/10 bg-black/30";
        const dis = reviewMode ? "disabled " : "";
        return `<button type="button" data-reading-tf="${q.id}" data-reading-val="${v}" ${dis}
           class="min-h-[40px] flex-1 rounded-lg border px-2 py-2 text-xs font-bold ${on}${reviewMode ? " cursor-default opacity-90" : ""}">${esc(v)}</button>`;
      })
      .join("");
  }

  function resultsHtml() {
    const esc = escapeHtml;
    if (!gradedRows)
      return `<p class="text-slate-400">Natija hali tayyor emas.</p>`;
    const lines = gradedRows.map((row) => {
      const ic = row.ok ? "✅" : "❌";
      const rowCls = row.ok
        ? "border-emerald-500/30 bg-emerald-950/15"
        : "border-rose-500/40 bg-rose-950/25";
      const titleCls = row.ok ? "text-emerald-200" : "text-rose-100";
      return `
<li class="rounded-lg border px-3 py-2 text-sm leading-snug ${rowCls}">
  <span class="mr-2 text-lg" aria-hidden="true">${ic}</span>
  <strong class="${titleCls}">#${row.q.id}</strong>
  ${row.ok ? "" : `<div class="mt-1 text-[12px] text-slate-300">Siz: ${esc(row.uLabel)}</div>`}
  <div class="mt-1 text-[12px] ${row.ok ? "text-slate-400" : "text-rose-200/90"}">Toʻgʻri javob: ${esc(row.cLabel)}</div>
</li>`;
    });
    const okN = gradedRows.filter((x) => x.ok).length;
    const totalN = gradedRows.length || 0;
    const fail = (totalN - okN) > MAX_ERRORS_TO_PASS;
    const xatoN = Math.max(0, totalN - okN);
    const statusTitle = fail ? "Yiqildi" : "Tabriklayman";
    const statusTopCls = fail
      ? "border-rose-500/45 bg-rose-950/20"
      : "border-emerald-500/30 bg-emerald-950/15";
    const statusTextCls = fail ? "text-rose-100" : "text-emerald-200";
    const saveNote =
      readingSaveStatus?.savedToDb === false
        ? `<p class="mt-2 text-[12px] text-amber-200">Ogohlantirish: natija DBga saqlanmadi. (UI ishlaydi, lekin prefill keyingi safar chiqmasligi mumkin.)</p>`
        : "";
    return `
<div class="space-y-5">
  ${reviewPhaseNavHtml()}
  <div class="rounded-xl border ${statusTopCls} p-4 text-center">
    <p class="text-[11px] font-bold uppercase tracking-wider ${statusTextCls}">${statusTitle}</p>
    <p class="mt-2 font-mono text-3xl font-black text-white">
      ${okN}<span class="${fail ? "text-rose-300/70" : "text-emerald-300/70"}">/</span>${totalN}
    </p>
    ${
      fail
        ? `<p class="mt-1 text-xs text-slate-400">${MAX_ERRORS_TO_PASS} tadan ko‘p xato (${xatoN} ta) — qayta topshirish kerak.</p>${saveNote}`
        : `<p class="mt-1 text-xs text-slate-400">Yashil ✅ — toʻgʻri javoblar. Natija saqlandi.</p>${saveNote}`
    }
  </div>
  <ul class="space-y-2">${lines.join("")}</ul>
  ${
    fail
      ? `<button type="button" data-reading-act="retry" class="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border-2 border-rose-400/45 bg-gradient-to-b from-rose-600/30 to-black/70 px-4 py-3 text-sm font-black uppercase tracking-[0.25em] text-white shadow-[0_0_24px_rgba(251,113,133,0.15)] hover:from-rose-500/35">Qayta topshirish</button>`
      : `<div class="text-center text-[12px] text-slate-400">Davom etishingiz mumkin.</div>`
  }
</div>`;
  }

  function collectInputs() {
    qsMcq.forEach((q, idx) => {
      const r = mount.querySelector(`input[name="re-p1-${idx}"]:checked`);
      if (r) userAnswers[q.id] = Number(/** @type {HTMLInputElement} */ (r).value);
    });
    mount.querySelectorAll("select[data-reading-select]").forEach((el) => {
      const sel = /** @type {HTMLSelectElement} */ (el);
      const qid = Number(sel.getAttribute("data-reading-select"));
      if (!Number.isFinite(qid)) return;
      if (sel.value === "") delete userAnswers[qid];
      else userAnswers[qid] = Number(sel.value);
    });
    persistExamState();
  }

  function runGrade() {
    collectInputs();
    gradedRows = payload.questions.map((q) => {
      const ua = userAnswers[q.id];
      const ok = gradeOneQuestion(q, ua);
      return {
        q,
        ok,
        uLabel: labelUser(q, ua),
        cLabel: labelCorrect(q),
      };
    });
  }

  function getPhaseDurationMs(ph) {
    if (ph === 1) return D.passage;
    if (ph === 2) return D.mcqBlock;
    if (ph === 3) return D.tfngBlock;
    return D.vocabBlock;
  }

  function resetExamForRetry() {
    phase = 1;
    attemptPassed = null;
    aiAnalysisComplete = false;
    part2ButtonReady = false;
    part3ButtonReady = false;
    userReflection = "";
    readingSaveStatus = { savedToDb: null, errorMsg: null };
    finishingInProgress = false;
    gradedRows = null;
    for (const k of Object.keys(userAnswers)) delete userAnswers[k];
    try {
      localStorage.removeItem(RESULT_KEY);
      localStorage.removeItem(EXAM_STATE_KEY);
    } catch (_) {
      /* ignore */
    }
    wizard = "exam";
  }

  function examPhaseHtml() {
    const escL = escapeHtml;
    const esc = escapeHtml;

    const phaseMs = getPhaseDurationMs(phase);
    const phaseName =
      phase === 1
        ? `Phase 1: Matn (${formatClockMs(D.passage)})`
        : phase === 2
          ? `Phase 2: Part 1 MCQ (${formatClockMs(D.mcqBlock)})`
          : phase === 3
            ? `Phase 3: Part 2 T/F/NG (${formatClockMs(D.tfngBlock)})`
            : `Phase 4: Part 3 Vocabulary (${formatClockMs(D.vocabBlock)})`;

    const phaseDesc =
      phase === 1
        ? "Faqat matn. Timer tugasa avtomatik keyingisiga o‘tasiz."
        : phase === 2
          ? "Part 1 savollari. Timer tugagach Part 2 tugmasi chiqadi."
          : phase === 3
            ? "Part 2 savollari (True / False / Not Given). Timer tugagach Part 3 tugmasi chiqadi."
            : "Part 3 savollari (Vocabulary match). Timer tugasa tekshiruv boshlanadi yoki «Tugatish»ni bosing.";

    const part1Blocks =
      phase >= 2
        ? qsMcq
            .map((q, idx) => mcqCardHtml(q, idx, idx + 1, "re-p1", "text-emerald-200/95"))
            .join("")
        : "";

    const part2Blocks =
      phase >= 3
        ? qsTfng
            .map((q, idx) => {
              const num = qsMcq.length + idx + 1;
              return `
<div class="rounded-xl border border-white/10 bg-black/25 p-4" data-reading-tfng-wrap="${q.id}">
  <p class="font-semibold text-cyan-200/95">${num}. ${escL(q.stem)}</p>
  <div class="mt-3 flex flex-wrap gap-2">${tfButtons(q, escL)}</div>
</div>`;
            })
            .join("")
        : "";

    const part3Blocks =
      phase >= 4
        ? qsVocab
            .map((q, idx) => {
              const num = qsMcq.length + qsTfng.length + idx + 1;
              const sel = `<select data-reading-select="${q.id}" class="mt-3 w-full rounded-lg border border-amber-500/35 bg-neutral-950 px-3 py-2 text-sm text-white"${
                reviewMode ? " disabled" : ""
              }">
<option value="">— variant tanlang —</option>
${(q.options || [])
  .map((opt, oi) => {
    const selected = Number(userAnswers[q.id]) === oi ? "selected" : "";
    return `<option value="${oi}" ${selected}>${escL(String.fromCharCode(65 + oi))}. ${escL(opt)}</option>`;
  })
  .join("")}
</select>`;
              return `
<div class="rounded-xl border border-amber-500/25 bg-amber-950/10 p-4">
  <p class="font-semibold text-amber-100">${num}. ${escL(q.stem)}</p>
  ${sel}
</div>`;
            })
            .join("")
        : "";

    return `
<div class="space-y-4">
  ${reviewPhaseNavHtml()}
  ${sourceHintHtml}
  <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/40 px-4 py-3">
    <div class="min-w-0">
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-200">${phaseName}</span>
      <p class="mt-0.5 text-[10px] text-slate-500">${escL(phaseDesc)}</p>
    </div>
    <span data-reading-timer-chip class="shrink-0 font-mono text-xl font-black tabular-nums text-emerald-100">${formatClockMs(phaseMs)}</span>
  </div>

  <div class="space-y-8 rounded-xl border border-white/10 bg-black/30 p-4 sm:p-5">
    <article class="rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-[1.75] text-slate-100 sm:p-5">
      <h4 class="mb-2 text-lg font-bold text-emerald-200/95">${esc(payload.title)}</h4>
      <p class="mb-3 text-[11px] leading-snug text-slate-400">Muhim joylarni sichqoncha bilan belgilang.</p>
      ${passageHostInner()}
    </article>

    ${phase === 1 ? "" : `
      ${phase === 2 ? `
      <section class="space-y-3" data-reading-section="part1">
        <h5 class="text-[11px] font-bold uppercase tracking-wider text-emerald-200/95">Part 1 — multiple choice (${rngPart1})</h5>
        ${qsMcq.length === 0 ? `<p class="text-xs text-slate-500">Savollar yo‘q.</p>` : `<div class="space-y-4">${part1Blocks}</div>`}
        ${
          part2ButtonReady
            ? `<button type="button" data-reading-act="goPart2" class="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-cyan-400/55 bg-cyan-600/20 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-600/35">
          PART 2
        </button>`
            : ""
        }
      </section>` : ""}
      ${phase === 3 ? `
      <section class="space-y-3 border-t border-white/10 pt-6" data-reading-section="part2">
        <h5 class="text-[11px] font-bold uppercase tracking-wider text-cyan-200/95">Part 2 — True / False / Not Given (${rngPart2})</h5>
        ${qsTfng.length === 0 ? `<p class="text-xs text-slate-500">Savollar yo‘q.</p>` : `<div class="space-y-4">${part2Blocks}</div>`}
        ${
          part3ButtonReady
            ? `<button type="button" data-reading-act="goPart3" class="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-amber-400/55 bg-amber-600/20 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-amber-100 transition hover:bg-amber-600/35">
          PART 3
        </button>`
            : ""
        }
      </section>` : ""}
      ${phase === 4 ? `
      <section class="space-y-3 border-t border-white/10 pt-6" data-reading-section="part3">
        <h5 class="text-[11px] font-bold uppercase tracking-wider text-amber-200">Part 3 — vocabulary (${rngPart3})</h5>
        ${qsVocab.length === 0 ? `<p class="text-xs text-slate-500">Savollar yo‘q.</p>` : `<div class="space-y-4">${part3Blocks}</div>`}
      </section>` : ""}
    `}

    ${
      phase === 4 && !reviewMode
        ? `<button type="button" data-reading-act="finish" class="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl border-2 border-fuchsia-400/50 bg-gradient-to-b from-fuchsia-600/30 to-black/70 px-4 py-3 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_0_24px_rgba(217,70,239,0.15)] hover:from-fuchsia-500/35">
  Tugatish — javoblarni tekshirish (AI+textarea)
</button>`
        : ""
    }
  </div>
</div>`;
  }

  function aiReviewHtml() {
    const okN = gradedRows ? gradedRows.filter((x) => x.ok).length : 0;
    const totalN = gradedRows ? gradedRows.length : 0;
    const fail = (totalN - okN) > MAX_ERRORS_TO_PASS;
    return `
<div class="space-y-4">
  ${reviewPhaseNavHtml()}
  <div class="rounded-xl border ${fail ? "border-rose-500/45 bg-rose-950/20" : "border-emerald-500/30 bg-emerald-950/15"} p-4 text-center">
    <p class="text-[11px] font-bold uppercase tracking-wider ${fail ? "text-rose-100" : "text-emerald-200"}">${fail ? "Yiqildi" : "Yutuq"}</p>
    <p class="mt-2 font-mono text-2xl font-black text-white">${okN}<span class="${fail ? "text-rose-300/70" : "text-emerald-300/70"}">/</span>${totalN}</p>
    <p class="mt-1 text-xs text-slate-400">AI Mentor xatolarni tushuntiradi. Keyin pastdagi textarea orqali fikringizni yozing.</p>
  </div>

  <div data-reading-ai-root class="hidden rounded-xl border border-violet-500/25 bg-black/40 p-4 text-sm text-slate-200">
    <p class="text-slate-400">AI yozilmoqda…</p>
  </div>

  <div class="rounded-xl border border-white/10 bg-black/25 p-4">
    <p class="text-[12px] font-bold uppercase tracking-wider text-slate-300">Fikringiz (qisqa)</p>
    <textarea data-reading-reflection rows="4" class="mt-2 w-full resize-y rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Nimani noto‘g‘ri tushundingiz? Qanday eslab qolmoqchisiz?"></textarea>
    <p class="mt-2 text-[11px] leading-snug text-slate-500">Vocabulary darhol ochiladi; natija bazaga fon rejimida saqlanadi (kutish shart emas).</p>
    <button type="button" data-reading-act="goVocabulary" class="mt-3 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border-2 border-emerald-400/35 bg-emerald-600/15 px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-emerald-100 hover:bg-emerald-600/35">
      Vocabulary bo‘limiga o‘tish
    </button>
  </div>
</div>`;
  }

  async function startFinishFlow({ source }) {
    if (reviewMode) return;
    if (finishingInProgress) return;
    if (phase !== 4) phase = 4;

    finishingInProgress = true;
    aiAnalysisComplete = false;
    readingSaveStatus = { savedToDb: null, errorMsg: null };

    collectInputs();
    runGrade();
    const okN = gradedRows.filter((x) => x.ok).length;
    const totalN = gradedRows.length || 0;
    attemptPassed = (totalN - okN) <= MAX_ERRORS_TO_PASS;

    wizard = "ai_review";
    render();

    try {
      await runAiAnalysis();
    } finally {
      aiAnalysisComplete = true;
      finishingInProgress = false;
    }
  }

  async function saveReadingResultsToSupabase(userReflectionText) {
    if (!supabase || !userId) {
      return { savedToDb: false, errorMsg: "Supabase yo‘q yoki userId yo‘q" };
    }
    if (!gradedRows) return { savedToDb: false, errorMsg: "Natija yo‘q" };

    const okN = gradedRows.filter((x) => x.ok).length;
    const totalN = gradedRows.length || 0;
    const pass = (totalN - okN) <= MAX_ERRORS_TO_PASS;

    const answers = {};
    payload.questions.forEach((q) => {
      const v = userAnswers[q.id];
      if (v !== undefined) answers[q.id] = v;
    });

    if (typeof userReflectionText === "string" && userReflectionText.trim()) {
      answers.reflection = userReflectionText.trim().slice(0, 2000);
    }
    answers.attemptPassed = pass;
    answers.scoreOk = okN;

    try {
      const { error } = await supabase
        .from("reading_results")
        .upsert(
          {
            user_id: userId,
            day_number: payload.dayNumber,
            level: payload.tierLabel,
            answers,
          },
          { onConflict: "user_id,day_number,level" },
        );
      if (error) return { savedToDb: false, errorMsg: String(error.message || error) };
      return { savedToDb: true, errorMsg: null };
    } catch (e) {
      return { savedToDb: false, errorMsg: String(e?.message || e) };
    }
  }

  async function saveResultsAndOpenVocabulary() {
    if (reviewMode) return;
    if (!aiAnalysisComplete) {
      try {
        await runAiAnalysis();
      } catch (_) {
        /* ignore */
      }
      aiAnalysisComplete = true;
    }

    const ta = mount.querySelector("textarea[data-reading-reflection]");
    userReflection = String(ta?.value ?? "").trim();

    try {
      if (typeof onTimedReadingComplete === "function") {
        onTimedReadingComplete();
      }
    } catch (_) {
      /* ignore */
    }

    void saveReadingResultsToSupabase(userReflection).then((status) => {
      readingSaveStatus = status;
      if (status.savedToDb === false && status.errorMsg) {
        console.warn("[reading_results] fon saqlash:", status.errorMsg);
      }
    });

    let navigated = false;
    try {
      if (typeof openVocabularyWindow === "function") {
        const r = openVocabularyWindow();
        navigated = r !== false;
      }
    } catch (_) {
      navigated = false;
    }
    if (!navigated) {
      try {
        sessionStorage.setItem("edunext_open_vocabulary_once", "1");
        window.location.assign("/dashboard");
        return;
      } catch (_) {
        /* ignore */
      }
      wizard = "results";
      render();
    }
  }

  function render() {
    clearTicker();
    if (wizard === "exam") {
      if (reviewMode) {
        const totalMs = D.passage + D.mcqBlock + D.tfngBlock + D.vocabBlock;
        mount.innerHTML = examAllPartsScrollHtml();
        armTicker(Date.now() + totalMs);
        return;
      }

      mount.innerHTML = examPhaseHtml();
      const phaseMs = phase === 1 ? D.passage : phase === 2 ? D.mcqBlock : phase === 3 ? D.tfngBlock : D.vocabBlock;
      const shouldRunTimer =
        !((phase === 2 && part2ButtonReady) || (phase === 3 && part3ButtonReady));
      if (shouldRunTimer) {
        const ts =
          Number.isFinite(restoredPhaseDeadlineTs) && restoredPhaseDeadlineTs > Date.now()
            ? restoredPhaseDeadlineTs
            : Date.now() + phaseMs;
        restoredPhaseDeadlineTs = null;
        armTicker(ts);
        const chip = mount.querySelector("[data-reading-timer-chip]");
        if (chip) chip.textContent = formatClockMs(ts - Date.now());
      } else {
        const chip = mount.querySelector("[data-reading-timer-chip]");
        if (chip) chip.textContent = "00:00";
      }
      persistExamState();
      return;
    }
    if (wizard === "results") {
      mount.innerHTML = resultsHtml();
      if (!reviewMode) persistResultsSnapshot();
      persistExamState();
      return;
    }
    if (wizard === "ai_review") {
      mount.innerHTML = aiReviewHtml();
      const ta = mount.querySelector("textarea[data-reading-reflection]");
      if (ta && userReflection) ta.value = userReflection;
      persistExamState();
      return;
    }
  }

  mount.onclick = async (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const phaseGo = t.closest("[data-reading-phase]");
    if (phaseGo && reviewMode) {
      const next = phaseGo.getAttribute("data-reading-phase");
      collectInputs();
      if (next === "results") {
        runGrade();
        wizard = "results";
      } else if (
        next === "exam" ||
        next === "readPart1" ||
        next === "part1" ||
        next === "part2" ||
        next === "part3" ||
        next === "passage"
      ) {
        wizard = "exam";
      }
      render();
      return;
    }
    const actBtn = t.closest("[data-reading-act]");
    const tfBt = t.closest("[data-reading-tf]");
    if (tfBt) {
      if (reviewMode) return;
      const qid = Number(tfBt.getAttribute("data-reading-tf"));
      const v = tfBt.getAttribute("data-reading-val") || "";
      userAnswers[qid] = v;
      const wrap = mount.querySelector(`[data-reading-tfng-wrap="${qid}"]`);
      if (wrap) {
        wrap.querySelectorAll("[data-reading-tf]").forEach((b) => {
          const el = /** @type {HTMLButtonElement} */ (b);
          const on = el.getAttribute("data-reading-val") === v;
          el.className = `min-h-[40px] flex-1 rounded-lg border px-2 py-2 text-xs font-bold ${
            on ? "ring-2 ring-cyan-400/80 bg-cyan-950/35" : "border-white/10 bg-black/30"
          }`;
        });
      }
      persistExamState();
      return;
    }

    const act = actBtn?.getAttribute("data-reading-act");
    if (act === "finish") {
      if (reviewMode) return;
      if (phase !== 4) return;
      await startFinishFlow({ source: "manual" });
      return;
    }
    if (act === "goPart2") {
      if (reviewMode) return;
      if (phase !== 2 || !part2ButtonReady) return;
      part2ButtonReady = false;
      phase = 3;
      render();
      return;
    }
    if (act === "goPart3") {
      if (reviewMode) return;
      if (phase !== 3 || !part3ButtonReady) return;
      part3ButtonReady = false;
      phase = 4;
      render();
      return;
    }
    if (act === "goVocabulary") {
      if (reviewMode) return;
      await saveResultsAndOpenVocabulary();
      return;
    }
    if (act === "retry") {
      if (reviewMode) return;
      resetExamForRetry();
      render();
      return;
    }
    if (act === "ai") {
      await runAiAnalysis();
      return;
    }
  };

  mount.onchange = (ev) => {
    if (reviewMode) return;
    /** @type {HTMLElement} */
    const el = ev.target;
    if (el.matches("select[data-reading-select]")) {
      collectInputs();
    }
    if (el.matches('input.reading-mcq-inp[type="radio"]')) {
      collectInputs();
    }
    if (el.matches("textarea[data-reading-reflection]")) {
      userReflection = String(/** @type {HTMLTextAreaElement} */ (el).value ?? "");
      persistExamState();
    }
  };

  mount.oninput = (ev) => {
    if (reviewMode) return;
    const el = /** @type {HTMLElement} */ (ev.target);
    if (el.matches("textarea[data-reading-reflection]")) {
      userReflection = String(/** @type {HTMLTextAreaElement} */ (el).value ?? "");
      persistExamState();
    }
  };

  async function runAiAnalysis() {
    runGrade();
    const root = mount.querySelector("[data-reading-ai-root]");
    if (!root) return;
    const mistakes /** @type {ReadingMistakeRow[]} */ = (gradedRows || [])
      .filter((r) => !r.ok)
      .map((r) => ({
        questionId: r.q.id,
        stem: r.q.stem,
        userAnswerLabel: r.uLabel,
        correctAnswerLabel: r.cLabel,
      }));
    root.classList.remove("hidden");
    root.innerHTML =
      mistakes.length === 0
        ? `<p class="text-emerald-200/95">Hammasi toʻgʻri — AI tahlil kerak emas.</p>`
        : `<p class="text-slate-400">AI yozilmoqda…</p>`;
    if (mistakes.length === 0) return;

    try {
      const { res, payload: data } = await handleCheck(
        async () => {
          const r = await fetch(apiUrlFn("/api/ai/reading-exam-feedback"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              passage: payload.passage,
              mistakes,
            }),
          });
          const p = await r.json().catch(() => ({}));
          return { res: r, payload: p };
        },
        { delayMs: 5000, maxAttempts: 12 },
      );
      if (!res.ok || !data.success) {
        const detail = String(data.error || data.message || `HTTP ${res.status}`);
        if (isGroqRateLimitPayload(res, data))
          root.innerHTML = `<p class="text-amber-200/95">AI serveri vaqtinchalik band (Groq rate limit); avtomatik qayta urinishlar tugagan — bir necha soniyadan keyin «AI tahlil»ni yana bosing.</p>`;
        else
          root.innerHTML = `<p class="text-red-300">${escapeHtml(detail)}</p>`;
        return;
      }
      const analyses = Array.isArray(data.analyses) ? data.analyses : [];
      if (!analyses.length) {
        root.innerHTML = `<p class="text-slate-400">${escapeHtml(String(data.noteUz || "Tahlil kelmadi."))}</p>`;
        return;
      }
      const blocks = analyses
        .map(
          (a) => `
<div class="border-b border-white/10 pb-4 last:border-0">
  <p class="font-bold text-violet-200">Savol #${escapeHtml(String(a.questionId))}</p>
  <blockquote class="mt-2 whitespace-pre-wrap border-l-2 border-violet-500/55 pl-3 text-[13px] text-slate-200">${escapeHtml(a.excerptFromPassage || "")}</blockquote>
  <p class="mt-2 text-[13px] text-slate-300"><span class="text-fuchsia-300/90 font-semibold">Nega xato:</span> ${escapeHtml(a.explanationUz || "")}</p>
  <p class="mt-2 text-[13px] text-slate-300"><span class="text-emerald-300/90 font-semibold">Toʻgʻri javob qayerdan:</span> ${escapeHtml(a.whereCorrectAnswerUz || "")}</p>
</div>`,
        )
        .join("");
      root.innerHTML = `<div class="space-y-6">${blocks}</div>`;
      persistAiAnalyses(analyses);
    } catch (e) {
      root.innerHTML = `<p class="text-red-300">${escapeHtml(String(e?.message || e))}</p>`;
    }
  }

  render();
  wireReadingHighlightUi();

  mount._readingExamClearTimer = () => {
    clearTicker();
    if (readingHlUiAbort) readingHlUiAbort.abort();
    readingHlUiAbort = null;
    removeReadingHlToolbar();
    mount.onclick = null;
    mount.onchange = null;
    mount.oninput = null;
  };
}
