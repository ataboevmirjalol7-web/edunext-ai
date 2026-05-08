import { buildGrammarQuiz20 } from "/grammarPhasedContent.js";
import { handleCheck, isGroqRateLimitPayload } from "/aiGroqRetry.js";

function formatClockMs(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function labelOpt(q, oi) {
  const L = String.fromCharCode(65 + oi);
  return `${L}) ${q.options[oi]}`;
}

/**
 * @param {*} mount
 * @param {{
 *   studyDay: number,
 *   tier: string,
 *   pdfHref: string,
 *   grammarLabel: string,
 *   grammarDescription?: string,
 *   questions: { id:number, stem:string, options:string[], correctIndex:number }[],
 *   openPdf: (href: string) => void,
 *   apiUrlFn: (p: string) => string,
 *   escapeHtml: (s: string) => string,
 *   onGoListening?: () => void,
 * }} ctx
 */
export function setupGrammarPhasedDashboard(mount, ctx) {
  if (!mount) return;

  if (mount._grammarPhasedClear && typeof mount._grammarPhasedClear === "function") {
    mount._grammarPhasedClear();
    mount._grammarPhasedClear = null;
  }

  const READ_MS = 30 * 60 * 1000;
  const stateKey = `grammar_timer_state_v2:${String(ctx.tier || "A2").trim()}:${Math.min(
    30,
    Math.max(1, Math.floor(Number(ctx.studyDay)) || 1),
  )}`;
  const { pdfHref, grammarLabel, openPdf, apiUrlFn, escapeHtml, onGoListening } = ctx;
  const esc = escapeHtml;
  const grammarDescription = String(ctx.grammarDescription || "").trim();
  const quiz = buildGrammarQuiz20(ctx.questions);
  const quizSig = quiz.map((q) => q.id).join(",");

  /** @type {'read' | 'test' | 'results'} */
  let phase = "read";
  let prepDeadlineTs = null;
  let readDeadlineTs = null;
  let intervalId = null;
  /** @type {Record<number, number>} */
  const userAnswers = {};
  /** @type {{ q: (typeof quiz)[0], ok: boolean, uLabel: string, cLabel: string }[] | null} */
  let graded = null;
  let currentQuestionIndex = 0;
  let readingTimerStarted = false;
  let autoTestNotice = "";

  function snapshotAnswersPayload() {
    /** @type {Record<string, number>} */
    const out = {};
    for (const [k, v] of Object.entries(userAnswers)) {
      const qid = Number(k);
      if (!Number.isFinite(qid) || !Number.isFinite(Number(v))) continue;
      out[String(qid)] = Number(v);
    }
    return out;
  }

  /** Payloaddan kelgan javoblar shu kun savollariga mos bo‘lsa `userAnswers`ga yoziladi. */
  function mergeStoredAnswers(rawAnswers) {
    if (!rawAnswers || typeof rawAnswers !== "object") return;
    /** @type {Record<number, typeof quiz[0]>} */
    const byId = {};
    quiz.forEach((q) => {
      byId[q.id] = q;
    });
    for (const [key, val] of Object.entries(rawAnswers)) {
      const qid = Number(key);
      const oi = Number(val);
      const row = byId[qid];
      if (!row || !Number.isFinite(oi)) continue;
      if (oi < 0 || oi >= (row.options || []).length) continue;
      userAnswers[qid] = oi;
    }
  }

  function savePhaseState() {
    try {
      const answersIncluded = phase === "test" || phase === "results" ? snapshotAnswersPayload() : {};
      const payload = {
        phase,
        readDeadlineTs: Number(readDeadlineTs || 0),
        savedAt: Date.now(),
        quizSig,
        currentQuestionIndex,
        answers: answersIncluded,
      };
      localStorage.setItem(stateKey, JSON.stringify(payload));
    } catch (_) {
      /* ignore storage errors */
    }
  }

  function restorePhaseState() {
    try {
      const raw = localStorage.getItem(stateKey);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object") return false;
      const ph = String(s.phase || "").trim();
      const dl = Number(s.readDeadlineTs || 0);
      const answersOk = typeof s.quizSig === "string" && s.quizSig === quizSig;

      if (ph === "read" && Number.isFinite(dl) && dl > Date.now()) {
        phase = "read";
        readingTimerStarted = true;
        readDeadlineTs = dl;
        return true;
      }

      // Agar read bosqichi muddati o‘tib ketgan bo‘lsa, testga o‘tamiz.
      if (ph === "read" && Number.isFinite(dl) && dl <= Date.now()) {
        phase = "test";
        readDeadlineTs = null;
        readingTimerStarted = false;
        autoTestNotice = "Vaqt tugadi! Endi bilimingizni sinab ko‘ring.";
        if (answersOk) mergeStoredAnswers(s.answers);
        return true;
      }

      if (ph === "test") {
        phase = "test";
        readDeadlineTs = null;
        readingTimerStarted = false;
        if (answersOk) mergeStoredAnswers(s.answers);
        currentQuestionIndex = Math.min(
          quiz.length - 1,
          Math.max(0, Math.floor(Number(s.currentQuestionIndex)) || 0),
        );
        return true;
      }

      if (ph === "results") {
        phase = "results";
        readDeadlineTs = null;
        readingTimerStarted = false;
        if (answersOk) mergeStoredAnswers(s.answers);
        else {
          for (const k of Object.keys(userAnswers)) delete userAnswers[Number(k)];
        }
        gradeAll();
        const okRes = graded ? graded.filter((x) => x.ok).length : 0;
        const passedRes = okRes >= 15;
        mount.setAttribute("data-grammar-pass", passedRes ? "1" : "0");
        return true;
      }
    } catch (_) {
      /* ignore bad payload */
    }
    return false;
  }

  function onAnswersInputChange(ev) {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!el.hasAttribute("data-gq-choice")) return;
    if (phase !== "test") return;
    collectTestInputs();
    savePhaseState();
  }

  function getActiveTimeLeftMs() {
    if (phase === "read" && readDeadlineTs) return readDeadlineTs - Date.now();
    return 0;
  }

  function setStrictLock(locked) {
    mount.dispatchEvent(
      new CustomEvent("grammar:strict-lock", {
        bubbles: true,
        detail: { locked: Boolean(locked), phase },
      }),
    );
  }

  function clearTicker(resetDeadlines = false) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (resetDeadlines) {
      prepDeadlineTs = null;
      readDeadlineTs = null;
    }
  }

  function armReadTicker() {
    clearTicker();
    if (
      (phase === "read" && (!readDeadlineTs || !readingTimerStarted || getActiveTimeLeftMs() <= 0))
    ) {
      return;
    }
    intervalId = setInterval(() => {
      const lab = mount.querySelector("[data-grammar-read-chip]");
      if (!lab) return;
      const left = getActiveTimeLeftMs();
      lab.textContent = formatClockMs(left);
      if (left > 0) return;
      clearTicker();
      if (phase === "read") {
        readingTimerStarted = false;
        phase = "test";
        autoTestNotice = "Vaqt tugadi! Endi bilimingizni sinab ko‘ring.";
        savePhaseState();
        render();
        mount.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 400);
    const lab = mount.querySelector("[data-grammar-read-chip]");
    if (lab) lab.textContent = formatClockMs(getActiveTimeLeftMs());
  }

  function gradeAll() {
    graded = quiz.map((q) => {
      const ua = userAnswers[q.id];
      const ok = Number(ua) === Number(q.correctIndex);
      return {
        q,
        ok,
        uLabel: Number.isFinite(ua) ? labelOpt(q, ua) : "— javob yo‘q —",
        cLabel: labelOpt(q, q.correctIndex),
      };
    });
  }

  function readPhaseHtml() {
    const chip = formatClockMs(getActiveTimeLeftMs());
    return `
<div class="space-y-5">
  <div class="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-fuchsia-500/35 bg-black/35 p-5 sm:p-6">
    <div class="min-w-0">
      <p class="text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-300/95">Day ${esc(String(ctx.studyDay || 1))} — Grammar Section</p>
      <h4 class="mt-1 text-xl font-black leading-tight text-white sm:text-2xl">${esc(grammarLabel || "Grammar")}</h4>
      ${
        grammarDescription
          ? `<p class="mt-2 text-sm leading-relaxed text-slate-300">${esc(grammarDescription)}</p>`
          : ""
      }
      <button type="button" data-grammar-act="open-book" class="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-xl border border-cyan-500/45 bg-cyan-600/20 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-600/35">
        PDF kitobini ochish
      </button>
    </div>
    <div class="shrink-0 rounded-2xl border-2 border-fuchsia-500/70 bg-black px-5 py-2 shadow-[0_0_20px_rgba(168,85,247,0.25)]">
      <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Qolgan vaqt</p>
      <p data-grammar-read-chip class="font-mono text-2xl font-black tabular-nums text-fuchsia-300 sm:text-3xl">${chip}</p>
    </div>
  </div>
  <div class="rounded-2xl border border-white/10 bg-black/35 p-6 sm:p-8 min-h-[44vh]">
    <h5 class="text-2xl font-black text-fuchsia-200">Mavzuni o‘rganish bosqichi</h5>
    <p class="mt-3 max-w-4xl text-base leading-relaxed text-slate-300">
      30 daqiqalik taymer avtomatik ishga tushdi. Vaqt tugagach Day ${esc(String(ctx.studyDay || 1))} uchun grammar testlari shu yerda avtomatik ochiladi.
    </p>
    <p class="mt-3 text-sm text-slate-400">Hozircha PDF materialni o‘qing va o‘ng tomondagi AI mentorga savol bering.</p>
  </div>
</div>`;
  }

  function testPhaseHtml() {
    const safeIndex = Math.min(quiz.length - 1, Math.max(0, currentQuestionIndex));
    const q = quiz[safeIndex];
    const selected = userAnswers[q.id];
    const hasAnswer = Number.isFinite(Number(selected));
    const progressPct = ((safeIndex + 1) / Math.max(1, quiz.length)) * 100;
    const opts = (q.options || [])
      .map((opt, oi) => {
        const active = Number(selected) === oi;
        const letter = String.fromCharCode(65 + oi);
        return `
<button type="button"
  data-grammar-act="choose-option"
  data-gq-choice="${q.id}"
  data-gq-option="${oi}"
  class="group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-300 ease-out ${
    active
      ? "border-fuchsia-300 bg-fuchsia-500/25 text-white shadow-[0_0_24px_rgba(217,70,239,0.35)]"
      : "border-white/10 bg-black/35 text-slate-200 hover:border-fuchsia-400/45 hover:bg-fuchsia-500/10"
  }">
  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-black transition duration-300 ${
    active
      ? "border-fuchsia-200 bg-fuchsia-400 text-black shadow-[0_0_18px_rgba(217,70,239,0.55)]"
      : "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 group-hover:border-fuchsia-300"
  }">${esc(letter)}</span>
  <span class="text-sm font-semibold leading-snug sm:text-base">${esc(opt)}</span>
</button>`;
      })
      .join("");
    return `
<div class="space-y-5">
  <div class="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-950/20 px-4 py-4 shadow-[0_0_24px_rgba(217,70,239,0.08)]">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <span class="text-[11px] font-bold uppercase tracking-wider text-fuchsia-200/95">Phase 2 — Present Simple vs Present Continuous</span>
        <p class="mt-1 text-[10px] text-slate-500">${esc(grammarLabel)}</p>
      </div>
      <span class="rounded-full border border-fuchsia-400/45 bg-black/40 px-4 py-2 font-mono text-sm font-black tabular-nums text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,0.18)]">
        ${safeIndex + 1}/${quiz.length}
      </span>
    </div>
    <div class="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
      <div class="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-400 to-cyan-300 transition-[width] duration-500" style="width:${progressPct}%"></div>
    </div>
    ${
      autoTestNotice
        ? `<p class="mt-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-100">${esc(autoTestNotice)}</p>`
        : ""
    }
  </div>
  <div class="rounded-[1.4rem] border border-fuchsia-500/25 bg-[radial-gradient(ellipse_at_top,rgba(217,70,239,0.16),rgba(0,0,0,0.34)_60%)] p-5 shadow-[0_0_30px_rgba(124,58,237,0.12)] sm:p-7">
    <div class="mb-5 flex items-center justify-between gap-3">
      <p class="text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/90">Savol ${safeIndex + 1}</p>
      <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">20 ta savol</p>
    </div>
    <p class="text-xl font-black leading-snug text-white sm:text-2xl">${esc(q.stem)}</p>
    <div class="mt-6 grid gap-3">${opts}</div>
  </div>
  ${
    hasAnswer
      ? safeIndex + 1 >= quiz.length
        ? `<button type="button" data-grammar-act="submit-test" class="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-fuchsia-400/60 bg-fuchsia-600/35 px-4 py-3 text-sm font-black uppercase tracking-[0.22em] text-white shadow-[0_0_24px_rgba(217,70,239,0.24)] transition hover:bg-fuchsia-600/50">
            NATIJANI KO'RISH
          </button>`
        : `<button type="button" data-grammar-act="next-question" class="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-cyan-400/50 bg-cyan-600/20 px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.16)] transition hover:bg-cyan-600/32">
            Keyingi savol
          </button>`
      : `<p class="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-center text-xs font-semibold text-slate-400">Variantlardan birini tanlang — keyin davom etish tugmasi chiqadi.</p>`
  }
</div>`;
  }

  function resultsPhaseHtml() {
    if (!graded) return `<p class="text-slate-400">Natija yo‘q.</p>`;
    const okN = graded.filter((x) => x.ok).length;
    const passed = okN >= 15;
    const lines = graded.map((row) => {
      const ic = row.ok ? "✅" : "❌";
      const rowCls = row.ok ? "border-emerald-500/30 bg-emerald-950/15" : "border-rose-500/40 bg-rose-950/25";
      const tCls = row.ok ? "text-emerald-200" : "text-rose-100";
      return `
<li class="rounded-lg border px-3 py-2 text-sm leading-snug ${rowCls}">
  <span class="mr-2 text-lg" aria-hidden="true">${ic}</span>
  <strong class="${tCls}">#${row.q.id}</strong>
  ${row.ok ? "" : `<div class="mt-1 text-[12px] text-slate-300">Siz: ${esc(row.uLabel)}</div>`}
  <div class="mt-1 text-[12px] ${row.ok ? "text-slate-400" : "text-rose-200/90"}">To‘g‘ri: ${esc(row.cLabel)}</div>
</li>`;
    });
    return `
<div class="space-y-5">
  <div class="rounded-xl border ${passed ? "border-emerald-500/35 bg-emerald-950/25" : "border-rose-500/45 bg-rose-950/25"} p-4 text-center">
    <p class="text-[11px] font-bold uppercase tracking-wider text-fuchsia-200">Natija</p>
    <p class="mt-2 font-mono text-3xl font-black text-white">${okN}<span class="text-fuchsia-300/70">/</span>${graded.length}</p>
    <p class="mt-1 text-xs ${passed ? "text-emerald-200/95" : "text-rose-200/95"}">${
      passed
        ? "Tabriklaymiz! Siz 15+ natija bilan keyingi bo‘limga o‘tishingiz mumkin."
        : "Siz B1-B2 darajasi talablariga javob bera olmadingiz. Mavzuni qayta o‘qing."
    }</p>
  </div>
  <ul class="max-h-[min(50vh,24rem)] space-y-2 overflow-y-auto">${lines.join("")}</ul>
  <button type="button" data-grammar-act="ai" class="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-violet-500/45 bg-violet-600/20 px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-violet-100 transition hover:bg-violet-600/35">
    AI mentor (xatolar)
  </button>
  <div data-grammar-ai-root class="hidden rounded-xl border border-violet-500/25 bg-black/40 p-4 text-sm text-slate-200"></div>
</div>`;
  }

  function collectTestInputs() {
    mount.querySelectorAll("input[data-gq-choice]").forEach((inp) => {
      const r = /** @type {HTMLInputElement} */ (inp);
      if (!r.checked) return;
      const qid = Number(r.getAttribute("data-gq-choice"));
      if (Number.isFinite(qid)) userAnswers[qid] = Number(r.value);
    });
  }

  function layoutHtml(contentHtml) {
    // Tayyorgarlik (PDF + taymer) yoki natijalar: Listeningga o‘tish mumkin. Test yozilayotganda — yo‘q.
    const listeningEnabled = phase === "read" || phase === "results";
    return `
<div class="space-y-4">
  <div class="w-full">
    <section class="rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-6 min-h-[62vh] w-full">
      ${contentHtml}
      <div class="mt-5 flex justify-end border-t border-white/10 pt-4">
        <button type="button" data-grammar-act="go-listening" ${listeningEnabled ? "" : "disabled"} class="inline-flex min-h-[48px] items-center justify-center rounded-xl border px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] transition ${
          listeningEnabled
            ? "border-amber-400/50 bg-amber-600/25 text-amber-100 hover:bg-amber-600/35"
            : "border-white/15 bg-white/5 text-slate-500 cursor-not-allowed opacity-70"
        }">
          Listening bo‘limiga o‘tish
        </button>
      </div>
    </section>
  </div>
</div>`;
  }

  function render() {
    clearTicker();
    if (phase === "read") {
      mount.innerHTML = layoutHtml(readPhaseHtml());
      if (readingTimerStarted && readDeadlineTs) armReadTicker();
      return;
    }
    if (phase === "test") {
      mount.innerHTML = layoutHtml(testPhaseHtml());
      return;
    }
    mount.innerHTML = layoutHtml(resultsPhaseHtml());
  }

  mount.onclick = async (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const btn = t.closest("[data-grammar-act]");
    const act = btn?.getAttribute("data-grammar-act");
    if (act === "open-book") {
      if (phase !== "read") return;
      setTimeout(() => {
        openPdf(pdfHref);
      }, 100);
      return;
    }
    if (act === "choose-option") {
      if (phase !== "test") return;
      const qid = Number(btn?.getAttribute("data-gq-choice"));
      const oi = Number(btn?.getAttribute("data-gq-option"));
      if (!Number.isFinite(qid) || !Number.isFinite(oi)) return;
      userAnswers[qid] = oi;
      savePhaseState();
      render();
      return;
    }
    if (act === "next-question") {
      if (phase !== "test") return;
      const q = quiz[currentQuestionIndex];
      if (!q || !Number.isFinite(Number(userAnswers[q.id]))) return;
      currentQuestionIndex = Math.min(quiz.length - 1, currentQuestionIndex + 1);
      savePhaseState();
      render();
      mount.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (act === "submit-test") {
      collectTestInputs();
      gradeAll();
      const okN = graded ? graded.filter((x) => x.ok).length : 0;
      const passed = okN >= 15;
      mount.setAttribute("data-grammar-pass", passed ? "1" : "0");
      if (passed) {
        mount.dispatchEvent(
          new CustomEvent("grammar:passed", {
            bubbles: true,
            detail: { score: okN, total: graded ? graded.length : 0 },
          }),
        );
      }
      phase = "results";
      savePhaseState();
      render();
      return;
    }
    if (act === "go-listening") {
      if (phase !== "read" && phase !== "results") return;
      if (typeof onGoListening === "function") {
        onGoListening();
      } else {
        mount.dispatchEvent(new CustomEvent("grammar:go-listening", { bubbles: true }));
      }
      return;
    }
    if (act === "ai") {
      await runAiMentor();
    }
  };

  mount.addEventListener("change", onAnswersInputChange);

  async function runAiMentor() {
    if (!graded) return;
    const root = mount.querySelector("[data-grammar-ai-root]");
    if (!root) return;
    const mistakes = graded
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
        ? `<p class="text-emerald-200/95">Barcha javoblar to‘g‘ri — AI tahlil kerak emas.</p>`
        : `<p class="text-slate-400">AI yozilmoqda…</p>`;
    if (mistakes.length === 0) return;
    try {
      const { res, payload: data } = await handleCheck(
        async () => {
          const r = await fetch(apiUrlFn("/api/ai/grammar-quiz-feedback"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              grammarLabel,
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
          root.innerHTML = `<p class="text-amber-200/95">AI serveri vaqtinchalik band — qayta urinish tugadi; biroz kutib «AI»ni yana bosing.</p>`;
        else root.innerHTML = `<p class="text-red-300">${esc(detail)}</p>`;
        return;
      }
      const analyses = Array.isArray(data.analyses) ? data.analyses : [];
      if (!analyses.length) {
        root.innerHTML = `<p class="text-slate-400">${esc(String(data.noteUz || "Tahlil kelmadi."))}</p>`;
        return;
      }
      const blocks = analyses
        .map(
          (a) => `
<div class="border-b border-white/10 pb-4 last:border-0">
  <p class="font-bold text-violet-200">Savol #${esc(String(a.questionId))}</p>
  <p class="mt-2 text-[13px] text-slate-300">${esc(a.explanationUz || "")}</p>
</div>`,
        )
        .join("");
      root.innerHTML = `<div class="space-y-6">${blocks}</div>`;
    } catch (e) {
      root.innerHTML = `<p class="text-red-300">${esc(String(e?.message || e))}</p>`;
    }
  }

  const restored = restorePhaseState();
  if (!restored) {
    const nowTs = Date.now();
    readingTimerStarted = true;
    readDeadlineTs = nowTs + READ_MS;
    phase = "read";
    savePhaseState();
  }
  render();
  setStrictLock(false);

  if (phase === "results" && graded?.length) {
    const okR = graded.filter((x) => x.ok).length;
    if (okR >= 15) {
      queueMicrotask(() => {
        mount.dispatchEvent(
          new CustomEvent("grammar:passed", {
            bubbles: true,
            detail: { score: okR, total: graded.length },
          }),
        );
      });
    }
  }

  mount._grammarPhasedClear = () => {
    clearTicker(true);
    mount.removeEventListener("change", onAnswersInputChange);
    mount.onclick = null;
    mount.removeAttribute("data-grammar-pass");
    setStrictLock(false);
  };
}
