import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import {
  resetLocalStudyPlanProgress,
  setPlanStartDate,
  setCurrentStudyDayMarker,
} from "/studyPlan.js";
import {
  GRAMMAR_QUESTIONS,
  READING_PASSAGES,
  LISTENING_PARTS,
  LISTENING_TOTAL_ITEMS,
  listeningQuestionsCount,
  listeningPartQuestionIds,
  normalizeGapAnswer,
  diagnosticScoreMaxPoints,
  DIAGNOSTIC_WRITING_SCORE_MAX,
  DIAGNOSTIC_LISTENING_SCORE_MAX,
  GRAMMAR_TOTAL_QUESTIONS,
} from "/diagnosticData.mjs";

const DIAGNOSTIC_COMPLETE_KEY = "edunext_diagnostic_complete";
const DIAG_PROGRESS_KEY = "diagnostic_progress";
const DIAG_SESSION_KEY = "edunext_diagnostic_session_v2";
const DIAG_ACTIVE_FLAG = "edunext_diag_in_progress";
/** v7: Listening 3 qism (17 ta javob oynasi, max ball 16). */
const DIAG_FLOW_VERSION = 7;
const PHASE_FLOW = ["grammar", "reading", "listening", "writing"];

function qs(root, sel) {
  return root.querySelector(sel);
}

/** Diagnostika yozma: kerakli so‘z oralig‘i (server bilan mos). */
const DIAG_WRITING_WORDS_MIN = 50;
const DIAG_WRITING_WORDS_MAX = 100;

function diagnosticWordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Eski heuristic (faqat falbek sifatida ishlatilmasligi ma’qul). */
function scoreWritingWords(text) {
  const words = diagnosticWordCount(text);
  if (words >= 55) return 5;
  if (words >= 40) return 4;
  if (words >= 28) return 3;
  if (words >= 18) return 2;
  if (words >= 10) return 1;
  return 0;
}

function writingMeetsDiagWordRange(text) {
  const n = diagnosticWordCount(text);
  return n >= DIAG_WRITING_WORDS_MIN && n <= DIAG_WRITING_WORDS_MAX;
}

function diagnoseWritingUiHint(words) {
  if (words < DIAG_WRITING_WORDS_MIN) return `Kamida ${DIAG_WRITING_WORDS_MIN} ta so'z yozing (hozir: ${words}).`;
  if (words > DIAG_WRITING_WORDS_MAX)
    return `Eng ko'pi bilan ${DIAG_WRITING_WORDS_MAX} ta so'z yozing (hozir: ${words}).`;
  return "";
}

/** Yig‘ilgan ballni 0–20 shkalaga keltirib CEFR darajasi. */
function levelFromTotal20(total) {
  const t = Math.max(0, Math.min(20, Math.round(total)));
  if (t <= 4) return "A1";
  if (t <= 8) return "A2";
  if (t <= 12) return "B1";
  if (t <= 16) return "B2";
  return "C1";
}

/** Profilda va mantiqda faqat A1 | A2 | B1 saqlanadi. */
function normalizeProfileUserLevel(raw) {
  const s = String(raw || "").toUpperCase();
  if (s === "A1" || s === "A2" || s === "B1") return s;
  if (s === "B2" || s === "C1") return "B1";
  return "A2";
}

let sbSingleton = null;
function ensureSupabase() {
  if (sbSingleton) return sbSingleton;
  const url = String(globalThis.APP_CONFIG?.supabaseUrl ?? "").trim().replace(/\/+$/, "");
  const key = String(globalThis.APP_CONFIG?.supabaseAnonKey ?? "").trim();
  if (!url || !key) return null;
  sbSingleton = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return sbSingleton;
}

async function saveLevelWithProfileMerge(sb, uid, rawLevel) {
  const { data: prof, error: selErr } = await sb
    .from("profiles")
    .select("first_name,last_name,age")
    .eq("id", uid)
    .maybeSingle();
  if (selErr) console.warn("[diagnostic] profile select", selErr.message);

  const profileLevel = normalizeProfileUserLevel(rawLevel);
  const startDate = new Date().toISOString().slice(0, 10);
  const payload = {
    id: uid,
    level: profileLevel,
    first_name: prof?.first_name ?? null,
    last_name: prof?.last_name ?? null,
    age: prof?.age ?? null,
    study_plan_start_date: startDate,
    current_day: 1,
  };

  const { error } = await sb.from("profiles").upsert(payload, { onConflict: "id" });
  return error;
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(DIAG_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return typeof o === "object" && o ? o : null;
  } catch (_) {
    return null;
  }
}

function writeSession(obj) {
  try {
    sessionStorage.setItem(DIAG_SESSION_KEY, JSON.stringify(obj));
  } catch (_) {
    /* ignore */
  }
}

function patchSession(partial) {
  const cur = readSession() || {};
  writeSession({ ...cur, ...partial });
}

function clearSession() {
  try {
    sessionStorage.removeItem(DIAG_SESSION_KEY);
    sessionStorage.removeItem(DIAG_ACTIVE_FLAG);
  } catch (_) {
    /* ignore */
  }
}

/** Brauzer yopilish/yangilanishidan keyin diagnostikani davom ettirish uchun to‘liq holat */
function readDiagnosticProgress() {
  try {
    const raw = localStorage.getItem(DIAG_PROGRESS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || Number(o.flowVersion) !== DIAG_FLOW_VERSION) return null;
    const { savedAt: _savedAt, currentStep: _step, currentQuestionIndex: _qix, ...rest } = o;
    void _savedAt;
    void _step;
    void _qix;
    return rest;
  } catch (_) {
    return null;
  }
}

function clearDiagnosticProgress() {
  try {
    localStorage.removeItem(DIAG_PROGRESS_KEY);
  } catch (_) {
    /* ignore */
  }
}

/** Natijadan dashboardga o‘tishda: keyingi test yangidan boshlansin (progress qoldiqlari). */
function purgeDiagnosticFlowForDashboardExit() {
  try {
    localStorage.removeItem(DIAG_PROGRESS_KEY);
  } catch (_) {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(DIAG_SESSION_KEY);
    sessionStorage.removeItem(DIAG_ACTIVE_FLAG);
  } catch (_) {
    /* ignore */
  }
}

function setDiagActive(on) {
  try {
    if (on) sessionStorage.setItem(DIAG_ACTIVE_FLAG, "1");
    else sessionStorage.removeItem(DIAG_ACTIVE_FLAG);
  } catch (_) {
    /* ignore */
  }
}

function cefrBandLabel(level) {
  const L = String(level || "").toUpperCase();
  if (L === "A1") return "BEGINNER";
  if (L === "A2") return "ELEMENTARY";
  if (L === "B1") return "INTERMEDIATE";
  if (L === "B2") return "UPPER-INTERMEDIATE";
  if (L === "C1") return "ADVANCED";
  return "LEARNER";
}

/**
 * @param {HTMLElement} root
 * @param {{ embedded?: boolean }} options
 */
export function mountDiagnostic(root, options = {}) {
  const embedded = options.embedded === true;

  root.style.position = "relative";

  root.innerHTML = `
    <div class="pointer-events-none fixed inset-0 bg-[#0f0a19]"></div>
    <div class="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_30%_0%,rgba(188,19,254,0.18),transparent_55%),radial-gradient(ellipse_at_70%_100%,rgba(0,242,255,0.08),transparent_48%)]"></div>
    <div class="dq-main-shell relative z-[1] mx-auto min-h-[100dvh] max-w-4xl px-4 py-8 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] text-white sm:py-10">
      <header class="mb-8 w-full max-w-4xl text-center">
        <div class="mb-4 inline-flex items-center gap-2 rounded-full border border-[#bc13fe] px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[#bc13fe]">
          <span aria-hidden="true">🩺</span> Diagnostika
        </div>
        <h1 class="dq-welcome text-3xl font-bold leading-tight text-white sm:text-4xl"></h1>
        <p class="dq-phase-label mt-2 text-sm font-mono tracking-wide text-[#00f2ff]"></p>
        <div class="dq-header-progress mx-auto mt-4 h-1 w-full max-w-xl overflow-hidden rounded-full bg-white/10">
          <div class="dq-header-prog-fill h-full rounded-full bg-gradient-to-r from-[#bc13fe] to-[#00f2ff] transition-[width] duration-500" style="width:25%"></div>
        </div>
      </header>

      <div class="relative mx-auto max-w-5xl rounded-[40px] border border-white/10 bg-[#1a1425]/80 p-[2px] shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div class="absolute inset-x-6 top-0 h-px rounded-full bg-gradient-to-r from-transparent via-[#bc13fe]/50 to-transparent pointer-events-none" aria-hidden="true"></div>
        <div class="relative rounded-[38px] p-6 sm:p-10">
          <style>@keyframes dq-neon{0%,100%{filter:brightness(1)}50%{filter:brightness(1.04)}}
          @keyframes dq-l-eqb{0%,100%{transform:scaleY(0.38);opacity:0.45}50%{transform:scaleY(1);opacity:1}}
          .dq-l-eq{display:flex;height:34px;align-items:flex-end;justify-content:center;gap:5px;margin:1rem auto 0}
          .dq-l-eq .dq-l-eqb{width:5px;height:100%;border-radius:9999px;background:linear-gradient(180deg,rgba(168,85,247,0.95),rgba(34,211,238,0.75));transform-origin:bottom center;animation:dq-l-eqb .55s ease-in-out infinite}
          .dq-l-eq .dq-l-eqb:nth-child(2){animation-delay:.1s}.dq-l-eq .dq-l-eqb:nth-child(3){animation-delay:.2s}.dq-l-eq .dq-l-eqb:nth-child(4){animation-delay:.3s}.dq-l-eq .dq-l-eqb:nth-child(5){animation-delay:.42s}
          @media (prefers-reduced-motion:reduce){.dq-l-eq .dq-l-eqb{animation:none!important;opacity:.88;transform:scaleY(.72)}}
          .dq-read-scrollbar{scrollbar-width:thin;scrollbar-color:rgba(217,70,239,0.55) rgba(255,255,255,0.06);}
          .dq-read-scrollbar::-webkit-scrollbar{width:5px;height:5px}
          .dq-read-scrollbar::-webkit-scrollbar-track{background:rgba(255,255,255,0.06);border-radius:9999px}
          .dq-read-scrollbar::-webkit-scrollbar-thumb{background:linear-gradient(180deg,rgba(217,70,239,0.75),rgba(124,58,237,0.55));border-radius:9999px;box-shadow:0 0 6px rgba(217,70,239,0.35)}
          .dq-read-scrollbar::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,rgba(232,121,249,0.85),rgba(168,85,247,0.65))}
          </style>

          <div class="dq-module-progress mb-8 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 sm:px-5">
            <div class="mb-2 flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.2em] text-white/90 sm:text-xs">
              <span class="dq-prog-fract text-[#bc13fe]">1 / 4</span>
              <span class="dq-prog-name font-mono text-[#00f2ff]">GRAMMAR</span>
            </div>
            <div class="h-1 overflow-hidden rounded-full bg-white/10">
              <div class="dq-prog-bar h-full rounded-full bg-gradient-to-r from-[#bc13fe] to-[#00f2ff] transition-[width] duration-500 ease-out" style="width:25%"></div>
            </div>
          </div>

          <section class="dq-grammar hidden"></section>
          <section class="dq-reading hidden"></section>
          <section class="dq-listening hidden"></section>
          <section class="dq-writing hidden"></section>
          <section class="dq-finalize hidden py-8 text-center"></section>

          <div class="dq-saving hidden py-12 text-center">
            <div class="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#bc13fe] border-t-transparent"></div>
            <p class="text-white/70">Daraja saqlanmoqda…</p>
          </div>
        </div>
      </div>
      <p class="dq-config-error mt-6 hidden text-center text-sm text-red-400"></p>
    </div>

    <section class="dq-results-screen hidden fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden" aria-hidden="true"></section>
  `;

  const defaults = {
    flowVersion: DIAG_FLOW_VERSION,
    phase: "grammar",
    gIdx: 0,
    gScore: 0,
    rIdx: 0,
    rScore: 0,
    writingText: "",
    wScore: 0,
    lScore: 0,
    listeningDone: false,
    listeningPartIndex: 0,
    listeningByPart: {},
    grammarMistakes: [],
    userAnswers: { grammar: {}, reading: {} },
    listeningDraft: null,
    /** AI Writing (Groq /api/ai/analyze-writing) */
    writingFeedbackAi: "",
    writingErrorsAi: [],
    writingStructuredSnapshot: null,
    writingAiModel: "",
    writingAiAt: "",
  };
  const fromDisk = readDiagnosticProgress();
  const rawSess = readSession();
  const rawResume =
    fromDisk && typeof fromDisk === "object"
      ? fromDisk
      : rawSess && typeof rawSess === "object" && Number(rawSess.flowVersion) === DIAG_FLOW_VERSION
        ? rawSess
        : null;
  let state = rawResume ? { ...defaults, ...rawResume } : { ...defaults };
  if (!state.listeningByPart || typeof state.listeningByPart !== "object") state.listeningByPart = {};
  if (typeof state.listeningPartIndex !== "number") state.listeningPartIndex = 0;
  if (!state.userAnswers || typeof state.userAnswers !== "object") state.userAnswers = { grammar: {}, reading: {} };
  if (!state.userAnswers.grammar || typeof state.userAnswers.grammar !== "object") state.userAnswers.grammar = {};
  if (!state.userAnswers.reading || typeof state.userAnswers.reading !== "object") state.userAnswers.reading = {};
  if (state.listeningDraft != null && typeof state.listeningDraft !== "object") state.listeningDraft = null;
  if (!Array.isArray(state.writingErrorsAi)) state.writingErrorsAi = [];
  if (state.writingStructuredSnapshot != null && typeof state.writingStructuredSnapshot !== "object") {
    state.writingStructuredSnapshot = null;
  }
  if (typeof state.writingFeedbackAi !== "string") state.writingFeedbackAi = "";
  if (typeof state.writingAiModel !== "string") state.writingAiModel = "";
  if (typeof state.writingAiAt !== "string") state.writingAiAt = "";
  function syncListeningScoreFromParts() {
    state.lScore = LISTENING_PARTS.reduce(
      (s, p) => s + (state.listeningByPart?.[p.key]?.correct ?? 0),
      0
    );
  }
  syncListeningScoreFromParts();
  {
    const curListenKey = LISTENING_PARTS[state.listeningPartIndex]?.key;
    if (
      state.phase === "listening" &&
      !state.listeningDone &&
      state.listeningDraft &&
      typeof state.listeningDraft === "object" &&
      state.listeningDraft.partKey &&
      curListenKey &&
      state.listeningDraft.partKey !== curListenKey
    ) {
      state.listeningDraft = null;
    }
  }
  setDiagActive(true);

  let gSelected = null;
  let rSelected = null;
  let listeningPrepInterval = null;
  let listeningAudio = null;
  /** `cleanupListeningTimers` dan tashqari pauza qilinsa — avto qayta `play()` (imtihon: foydalanuvchi toʻxtata olmaydi). */
  let allowListeningPause = false;
  let listeningPauseGuardHandler = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let listeningDraftPersistTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let writingAutosaveInterval = null;

  function deriveCurrentQuestionIndex() {
    if (state.phase === "grammar") return state.gIdx;
    if (state.phase === "reading") return state.rIdx;
    if (state.phase === "listening") return state.listeningPartIndex;
    return 0;
  }

  function persist() {
    writeSession(state);
    try {
      const pack = {
        ...state,
        savedAt: new Date().toISOString(),
        currentStep: state.phase,
        currentQuestionIndex: deriveCurrentQuestionIndex(),
        userAnswers: state.userAnswers || { grammar: {}, reading: {} },
      };
      localStorage.setItem(DIAG_PROGRESS_KEY, JSON.stringify(pack));
    } catch (_) {
      /* ignore quota / privacy mode */
    }
  }

  const QUOTA_AI_UZ = "AI Mentor biroz charchadi, 1 daqiqadan so'ng javob beradi";

  async function postDiagnosticWritingAnalyze(essayText) {
    const text = String(essayText || "").trim();
    const base =
      typeof globalThis.apiUrl === "function"
        ? globalThis.apiUrl("/api/ai/analyze-writing")
        : "/api/ai/analyze-writing";

    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }

    if (res.status === 429 || data.quotaExceeded) {
      return { ok: false, quota: true, error: QUOTA_AI_UZ };
    }

    if (!res.ok || data.success === false) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
      };
    }

    const st =
      data.structured != null && typeof data.structured === "object"
        ? data.structured
        : null;

    let score =
      st != null && Number.isFinite(Number(st.score))
        ? Math.round(Number(st.score))
        : null;
    if (score === null || !Number.isFinite(score)) {
      score = Math.min(DIAGNOSTIC_WRITING_SCORE_MAX, Math.max(1, scoreWritingWords(text)));
    } else {
      score = Math.min(DIAGNOSTIC_WRITING_SCORE_MAX, Math.max(1, score));
    }

    return {
      ok: true,
      score,
      feedback: String(st?.feedback ?? "").trim() || String(data.reply ?? "").slice(0, 3000),
      errors: Array.isArray(st?.errors) ? st.errors.map(String) : [],
      structured: st,
      reply: String(data.reply ?? ""),
      model: String(data.model ?? ""),
    };
  }

  function clearWritingAutosave() {
    if (writingAutosaveInterval != null) {
      clearInterval(writingAutosaveInterval);
      writingAutosaveInterval = null;
    }
  }

  function clearListeningDraftDebouncer() {
    if (listeningDraftPersistTimer != null) {
      clearTimeout(listeningDraftPersistTimer);
      listeningDraftPersistTimer = null;
    }
  }

  /** @param {HTMLElement} wrap @param {{type?:string,key?:string,speakerCount?:number}} part */
  function captureListeningDraft(wrap, part) {
    if (!wrap || !part || !part.type) return {};
    const data = {};
    if (part.type === "match") {
      const c = part.speakerCount || 5;
      for (let i = 1; i <= c; i++) {
        const id = `dq-l-m-${i}`;
        const el = wrap.querySelector(`#${id}`);
        if (el && el.value) data[id] = String(el.value);
      }
      return data;
    }
    if (part.type === "mcqLetters") {
      listeningPartQuestionIds(part).forEach((id) => {
        const idStr = `dq-l-mcq-${id}`;
        const el = wrap.querySelector(`#${idStr}`);
        if (el && String(el.value).trim()) data[idStr] = String(el.value);
      });
      return data;
    }
    if (part.type === "gapFill") {
      listeningPartQuestionIds(part).forEach((id) => {
        const idStr = `dq-l-gap-${id}`;
        const el = wrap.querySelector(`#${idStr}`);
        if (el && String(el.value).trim()) data[idStr] = String(el.value);
      });
      return data;
    }
    return data;
  }

  /** @param {HTMLElement} wrap @param {typeof LISTENING_PARTS[number]} part */
  function applyListeningDraftFields(wrap, part) {
    const d = state.listeningDraft;
    if (!d || typeof d !== "object" || d.partKey !== part.key || !d.data || typeof d.data !== "object") return;
    Object.entries(d.data).forEach(([fieldId, val]) => {
      const el = wrap.querySelector(`#${CSS.escape(fieldId)}`);
      if (!el || (el.tagName !== "INPUT" && el.tagName !== "SELECT")) return;
      el.value = String(val ?? "");
    });
  }

  /** @param {HTMLElement} wrap @param {typeof LISTENING_PARTS[number]} part */
  function scheduleListeningDraftSave(wrap, part) {
    clearListeningDraftDebouncer();
    listeningDraftPersistTimer = setTimeout(() => {
      listeningDraftPersistTimer = null;
      const partCur = LISTENING_PARTS[state.listeningPartIndex];
      if (!partCur || partCur.key !== part.key || state.phase !== "listening") return;
      state.listeningDraft = {
        partKey: part.key,
        data: captureListeningDraft(wrap, part),
      };
      persist();
    }, 280);
  }

  function setPhaseLabel(text) {
    const el = qs(root, ".dq-phase-label");
    if (el) el.textContent = text;
  }

  const PHASE_LABELS = {
    grammar: "GRAMMAR",
    reading: "READING",
    listening: "LISTENING",
    writing: "WRITING",
  };

  /** Progress: snippetdagi `{step}/4 • NAME` va gradient barlar. */
  function setModuleProgressFromPhase(phase) {
    const name = PHASE_LABELS[phase] || "";
    const idx = PHASE_FLOW.indexOf(String(phase || ""));
    const step = idx >= 0 ? idx + 1 : 1;
    const pct = (step / 4) * 100;
    const fract = qs(root, ".dq-prog-fract");
    if (fract) fract.textContent = `${step} / 4`;
    const pname = qs(root, ".dq-prog-name");
    if (pname) pname.textContent = name;
    const bar = qs(root, ".dq-prog-bar");
    if (bar) bar.style.width = `${pct}%`;
    const hdrFill = qs(root, ".dq-header-prog-fill");
    if (hdrFill) hdrFill.style.width = `${pct}%`;
    setPhaseLabel(`${step} / 4 • ${name}`);
  }

  function hideAllSections() {
    qs(root, ".dq-results-screen")?.classList.add("hidden");
    ["dq-grammar", "dq-reading", "dq-writing", "dq-listening", "dq-finalize"].forEach((c) => {
      qs(root, `.${c}`)?.classList.add("hidden");
    });
  }

  function showMainQuizShell() {
    qs(root, ".dq-main-shell")?.classList.remove("hidden");
  }

  function showDiagnosticResultsScreen(payload) {
    const { level, grammar, reading, writing, listening } = payload;
    const total = grammar + reading + writing + listening;
    const shell = qs(root, ".dq-main-shell");
    const screen = qs(root, ".dq-results-screen");
    if (!screen) return;
    if (shell) shell.classList.add("hidden");

    const maxG = GRAMMAR_QUESTIONS.length;
    const maxR = READING_PASSAGES.length;
    const maxW = DIAGNOSTIC_WRITING_SCORE_MAX;
    const maxL = DIAGNOSTIC_LISTENING_SCORE_MAX;
    const band = cefrBandLabel(level);
    const pG = Math.min(100, Math.round((grammar / maxG) * 100));
    const pR = Math.min(100, Math.round((reading / maxR) * 100));
    const pW = Math.min(100, Math.round((writing / maxW) * 100));
    const pL = Math.min(100, Math.round((listening / maxL) * 100));

    screen.setAttribute("aria-hidden", "false");
    screen.classList.remove("hidden");

    const escapeAttr = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");

    screen.innerHTML = `
      <div class="pointer-events-none fixed inset-0 overflow-hidden">
        <div class="absolute -left-[20%] top-[-10%] h-[min(85vh,620px)] w-[min(95vw,620px)] rounded-full bg-fuchsia-600/45 blur-[110px]"></div>
        <div class="absolute -right-[15%] bottom-[-15%] h-[min(75vh,520px)] w-[min(85vw,520px)] rounded-full bg-violet-700/40 blur-[100px]"></div>
        <div class="absolute left-[15%] top-[35%] h-72 w-72 rounded-full bg-cyan-400/25 blur-[90px]"></div>
        <div class="absolute right-[10%] top-[12%] h-48 w-48 rounded-full bg-purple-500/30 blur-[70px]"></div>
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(126,34,206,0.35),transparent_55%),radial-gradient(ellipse_at_80%_80%,rgba(217,70,239,0.15),transparent_50%)]"></div>
      </div>

      <div class="relative z-[1] mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-4 pb-20 pt-10 sm:px-8 sm:pb-24 sm:pt-14">
        <p class="text-center text-xs font-bold uppercase tracking-[0.35em] text-fuchsia-300/90">Diagnostika natijalari</p>

        <div class="mt-8 text-center">
          <p class="text-6xl font-black leading-none tracking-tighter text-transparent sm:text-8xl sm:leading-none"
             style="background:linear-gradient(135deg,#f0abfc 0%,#fff 45%,#67e8f9 100%);-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 0 28px rgba(217,70,239,0.75)) drop-shadow(0 0 48px rgba(124,58,237,0.45));">
            ${escapeAttr(level)}
          </p>
          <p class="mt-3 text-sm font-extrabold uppercase tracking-[0.45em] text-cyan-200"
             style="text-shadow:0 0 18px rgba(34,211,238,0.65),0 0 32px rgba(217,70,239,0.45);">
            ${escapeAttr(band)}
          </p>
        </div>

        <div class="mt-10 space-y-4">
          <h2 class="mb-2 text-sm font-bold uppercase tracking-wider text-white/90">Bo‘limlar bo‘yicha</h2>
          <div class="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
            <div class="mb-3 flex justify-between text-sm">
              <span class="font-semibold text-white">Grammar</span>
              <span class="font-mono text-fuchsia-200/90">${grammar}<span class="text-white/35">/${maxG}</span></span>
            </div>
            <div class="h-3 overflow-hidden rounded-full bg-black/45">
              <div class="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-purple-500 to-pink-400 shadow-[0_0_18px_rgba(217,70,239,0.5)] transition-all duration-700" style="width:${pG}%"></div>
            </div>
          </div>
          <div class="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
            <div class="mb-3 flex justify-between text-sm">
              <span class="font-semibold text-white">Reading</span>
              <span class="font-mono text-fuchsia-200/90">${reading}<span class="text-white/35">/${maxR}</span></span>
            </div>
            <div class="h-3 overflow-hidden rounded-full bg-black/45">
              <div class="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 shadow-[0_0_18px_rgba(139,92,246,0.45)] transition-all duration-700" style="width:${pR}%"></div>
            </div>
          </div>
          <div class="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
            <div class="mb-3 flex justify-between text-sm">
              <span class="font-semibold text-white">Listening</span>
              <span class="font-mono text-fuchsia-200/90">${listening}<span class="text-white/35">/${maxL}</span></span>
            </div>
            <div class="h-3 overflow-hidden rounded-full bg-black/45">
              <div class="h-full rounded-full bg-gradient-to-r from-purple-600 via-indigo-500 to-fuchsia-500 shadow-[0_0_18px_rgba(168,85,247,0.45)] transition-all duration-700" style="width:${pL}%"></div>
            </div>
          </div>
          <div class="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
            <div class="mb-3 flex justify-between text-sm">
              <span class="font-semibold text-white">Writing</span>
              <span class="font-mono text-fuchsia-200/90">${writing}<span class="text-white/35">/${maxW}</span></span>
            </div>
            <div class="h-3 overflow-hidden rounded-full bg-black/45">
              <div class="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 shadow-[0_0_18px_rgba(34,211,238,0.4)] transition-all duration-700" style="width:${pW}%"></div>
            </div>
          </div>
        </div>

        <div class="mt-10 flex justify-center px-1">
          <button type="button" id="dq-res-start-cefr-path"
            class="w-full max-w-md min-h-[56px] rounded-2xl border border-cyan-400/40 bg-gradient-to-r from-fuchsia-600 via-purple-600 to-cyan-600 px-6 py-3.5 text-base font-bold text-white shadow-[0_0_28px_rgba(217,70,239,0.35)] transition hover:brightness-110 active:scale-[0.99]">
            Darslarni boshlash <span class="text-xs font-semibold opacity-90">(CEFR Path)</span>
          </button>
        </div>
      </div>
    `;

    qs(root, "#dq-res-start-cefr-path")?.addEventListener("click", () => {
      purgeDiagnosticFlowForDashboardExit();
      if (embedded) {
        window.dispatchEvent(
          new CustomEvent("edunext-diagnostic-complete", {
            detail: { level, total, target: "dashboard" },
          })
        );
      }
      window.location.href = "/dashboard";
    });
  }

  function renderGrammar() {
    hideAllSections();
    clearWritingAutosave();
    clearListeningDraftDebouncer();
    showMainQuizShell();
    const wrap = qs(root, ".dq-grammar");
    if (!wrap) return;
    wrap.classList.remove("hidden");
    setModuleProgressFromPhase("grammar");
    setPhaseLabel(`1 / 4 • GRAMMAR · savol ${state.gIdx + 1} / ${GRAMMAR_TOTAL_QUESTIONS}`);

    const q = GRAMMAR_QUESTIONS[state.gIdx];
    if (!q) return;

    const isLastG = state.gIdx === GRAMMAR_QUESTIONS.length - 1;
    const nextLabel = isLastG ? "Reading bo'limiga o'tish" : "Keyingi";

    wrap.innerHTML = `
      <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
        <span class="font-mono text-xs font-bold uppercase tracking-widest text-[#bc13fe]">Grammar · ${state.gIdx + 1} / ${GRAMMAR_TOTAL_QUESTIONS}</span>
        <div class="h-1.5 w-full max-w-[220px] flex-1 overflow-hidden rounded-full bg-white/10 sm:w-auto">
          <div class="dq-grammar-microbar h-full rounded-full bg-gradient-to-r from-[#bc13fe] to-[#00f2ff] transition-all duration-300" style="width:${((state.gIdx + 1) / GRAMMAR_TOTAL_QUESTIONS) * 100}%"></div>
        </div>
      </div>
      <p class="mb-4 text-left text-xs font-semibold uppercase tracking-wider text-fuchsia-300/90">Grammar</p>
      <div class="mx-auto max-w-2xl rounded-2xl border border-fuchsia-500/30 bg-white/[0.06] p-6 shadow-[0_0_36px_rgba(217,70,239,0.18)] backdrop-blur-xl sm:p-8">
        <h2 class="dq-gq mb-6 text-lg font-semibold leading-relaxed text-white sm:text-xl"></h2>
        <div class="dq-gopts mb-8 flex flex-col gap-3"></div>
      </div>
      <button type="button" class="dq-gnext mx-auto mt-8 block w-full max-w-2xl min-h-[52px] rounded-2xl border border-fuchsia-400/45 bg-gradient-to-r from-fuchsia-600 to-purple-600 py-3.5 text-base font-bold text-white opacity-40 shadow-[0_0_24px_rgba(217,70,239,0.35)] transition hover:brightness-110 disabled:pointer-events-none sm:text-lg">
        ${nextLabel}
      </button>
    `;

    const titleEl = wrap.querySelector(".dq-gq");
    if (titleEl) titleEl.textContent = q.q;
    const box = wrap.querySelector(".dq-gopts");
    const nextBtn = wrap.querySelector(".dq-gnext");
    gSelected = null;
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.classList.add("opacity-40");
    }

    const optSel =
      "w-full rounded-xl border border-white/15 bg-white/5 px-5 py-4 text-left text-white outline-none ring-0 transition hover:border-fuchsia-400/45 hover:bg-fuchsia-500/10";
    const optOn =
      "!border-fuchsia-400 !bg-fuchsia-500/20 shadow-[0_0_22px_rgba(217,70,239,0.45)] ring-2 ring-fuchsia-400/55";

    q.a.forEach((label, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = optSel;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        gSelected = index;
        state.userAnswers.grammar[String(state.gIdx)] = index;
        box.querySelectorAll("button").forEach((b) => {
          b.className = optSel;
        });
        btn.className = `${optSel} ${optOn}`;
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.classList.remove("opacity-40");
        }
        persist();
      });
      box.appendChild(btn);
    });

    const savedG = state.userAnswers.grammar[String(state.gIdx)];
    if (typeof savedG === "number" && savedG >= 0 && savedG < q.a.length) {
      const buttons = box?.querySelectorAll("button") ?? [];
      const b = buttons[savedG];
      if (b) {
        gSelected = savedG;
        b.className = `${optSel} ${optOn}`;
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.classList.remove("opacity-40");
        }
      }
    }

    nextBtn?.addEventListener("click", () => {
      if (gSelected === null) return;
      if (gSelected === q.correct) {
        state.gScore += 1;
      } else {
        if (!Array.isArray(state.grammarMistakes)) state.grammarMistakes = [];
        state.grammarMistakes.push({
          index: state.gIdx,
          topic: q.grammarTopic || "Grammar",
        });
      }
      if (state.gIdx + 1 < GRAMMAR_QUESTIONS.length) {
        state.gIdx += 1;
        persist();
        renderGrammar();
        return;
      }
      state.phase = "reading";
      state.rIdx = 0;
      persist();
      renderReading();
    });
  }

  function renderReading() {
    hideAllSections();
    clearWritingAutosave();
    clearListeningDraftDebouncer();
    showMainQuizShell();
    const wrap = qs(root, ".dq-reading");
    if (!wrap) return;
    wrap.classList.remove("hidden");
    setModuleProgressFromPhase("reading");

    const nRead = READING_PASSAGES.length;
    const d = READING_PASSAGES[state.rIdx];
    if (!d) return;

    setPhaseLabel(`2 / 4 • READING · matn / savol ${state.rIdx + 1} / ${nRead}`);

    const isLast = state.rIdx === nRead - 1;
    const btnLabel = isLast ? "Listening bo'limiga o'tish" : "Keyingi savol";
    const readPct = Math.min(100, Math.round(((state.rIdx + 1) / nRead) * 100));

    wrap.innerHTML = `
      <p class="mb-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#bc13fe]/90">Reading</p>
      <div class="mb-5 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
        <div class="mb-2 flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-wider text-white/90">
          <span>Javoblar</span>
          <span class="font-mono text-[#00f2ff]">${state.rIdx + 1} / ${nRead}</span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-gradient-to-r from-[#bc13fe] to-[#00f2ff] shadow-[0_0_12px_rgba(217,70,239,0.45)] transition-[width] duration-[400ms] ease-out" style="width:${readPct}%"></div>
        </div>
      </div>

      <div class="dq-read-split mx-auto flex w-full flex-col gap-6 lg:min-h-0 lg:flex-row lg:items-stretch lg:gap-8">
        <div class="dq-read-left flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-fuchsia-500/25 bg-white/[0.06] p-5 shadow-[inset_0_0_0_1px_rgba(217,70,239,0.12),0_8px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-6">
          <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <span class="rounded-full border border-cyan-400/35 bg-cyan-500/12 px-3 py-1 text-xs font-bold text-cyan-100">${d.level}</span>
            <span class="text-[11px] font-semibold text-white/50">Matn</span>
          </div>
          <div class="dq-read-passage dq-read-scrollbar max-h-[500px] min-h-0 overflow-y-auto overscroll-contain pr-2 text-[16px] leading-[1.65] text-white/[0.92] [-webkit-overflow-scrolling:touch]"></div>
        </div>
        <div class="dq-read-right flex min-h-0 min-w-0 w-full shrink-0 flex-col rounded-2xl border border-fuchsia-400/35 bg-gradient-to-br from-[#2a1045]/55 to-[#0a0618]/90 p-5 shadow-[0_0_40px_rgba(217,70,239,0.22)] backdrop-blur-xl sm:p-6 lg:w-[min(100%,22rem)] lg:max-w-md">
          <p class="text-[10px] font-bold uppercase tracking-wider text-[#00f2ff]/80">Savol</p>
          <p class="dq-read-q mb-4 mt-1 text-[16px] font-semibold leading-snug text-white"></p>
          <div class="dq-ropts dq-read-scrollbar mb-4 flex min-h-0 max-h-[min(42vh,360px)] flex-col gap-2.5 overflow-y-auto pr-1 sm:gap-3"></div>
          <button type="button" class="dq-rnext mt-auto w-full min-h-[52px] rounded-xl border border-[#bc13fe]/50 bg-gradient-to-r from-[#bc13fe] to-purple-600 py-3.5 text-base font-bold text-white opacity-40 shadow-[0_0_24px_rgba(188,19,254,0.35)] transition hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40">${btnLabel}</button>
        </div>
      </div>
    `;

    const passageEl = wrap.querySelector(".dq-read-passage");
    if (passageEl) passageEl.textContent = d.text;
    const qEl = wrap.querySelector(".dq-read-q");
    if (qEl) qEl.textContent = d.q;

    const box = wrap.querySelector(".dq-ropts");
    const nextBtn = wrap.querySelector(".dq-rnext");
    rSelected = null;
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.classList.add("opacity-40");
    }

    const optR =
      "w-full rounded-xl border border-white/12 bg-black/25 px-4 py-3 text-left text-[16px] leading-snug text-white/95 backdrop-blur-sm transition hover:border-[#bc13fe]/40 hover:bg-fuchsia-500/10 sm:py-3.5";
    const optROn =
      "!border-fuchsia-400 !bg-fuchsia-500/15 shadow-[0_0_20px_rgba(217,70,239,0.5)] ring-2 ring-fuchsia-400/50";

    d.a.forEach((label, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = optR;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        rSelected = index;
        state.userAnswers.reading[String(state.rIdx)] = index;
        box.querySelectorAll("button").forEach((b) => {
          b.className = optR;
        });
        btn.className = `${optR} ${optROn}`;
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.classList.remove("opacity-40");
        }
        persist();
      });
      box.appendChild(btn);
    });

    const savedR = state.userAnswers.reading[String(state.rIdx)];
    if (typeof savedR === "number" && savedR >= 0 && savedR < d.a.length) {
      const btns = box?.querySelectorAll("button") ?? [];
      const b = btns[savedR];
      if (b) {
        rSelected = savedR;
        b.className = `${optR} ${optROn}`;
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.classList.remove("opacity-40");
        }
      }
    }

    nextBtn?.addEventListener("click", () => {
      if (rSelected === null) return;
      if (rSelected === d.correct) state.rScore += 1;
      if (state.rIdx + 1 < READING_PASSAGES.length) {
        state.rIdx += 1;
        persist();
        renderReading();
        return;
      }
      state.phase = "listening";
      state.listeningDone = false;
      persist();
      renderListening();
    });
  }

  function renderWriting() {
    hideAllSections();
    clearListeningDraftDebouncer();
    showMainQuizShell();
    clearWritingAutosave();
    const wrap = qs(root, ".dq-writing");
    if (!wrap) return;
    wrap.classList.remove("hidden");
    setModuleProgressFromPhase("writing");
    setPhaseLabel(`4 / 4 • WRITING`);

    wrap.innerHTML = `
      <p class="mb-4 text-left text-xs font-semibold uppercase tracking-wider text-fuchsia-300/90">Writing</p>
      <div class="rounded-2xl border border-fuchsia-500/30 bg-white/[0.06] p-6 shadow-[0_0_36px_rgba(217,70,239,0.15)] backdrop-blur-xl sm:p-8">
      <h2 class="mb-3 text-lg font-semibold leading-snug text-white sm:text-xl">
        O'zingiz, sevimli mashg'ulotlaringiz va kelajakdagi maqsadlaringiz haqida ingliz tilida yozing.
      </h2>
      <p class="mb-4 text-sm leading-relaxed text-white/65">
        <strong class="text-fuchsia-200/90">${DIAG_WRITING_WORDS_MIN}–${DIAG_WRITING_WORDS_MAX} ta so‘z</strong> yozing (chegaradan tashqari bo‘lsa, saqlash o‘chiqlanadi).
        Tugmani bosganingizda matn Groq AI orqali grammatika / lug‘at / topshiriqqa javob boʻyicha 1–5 ball bilan baholanadi.
      </p>
      <textarea id="dq-writing-ta" rows="9"
        class="mb-4 w-full rounded-xl border border-white/15 bg-black/45 p-4 text-white placeholder:text-slate-500 focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/35"
        placeholder="Bu yerda yozing...">${escapeHtml(state.writingText || "")}</textarea>
      <p class="dq-wc mb-2 text-sm text-slate-400"></p>
      <p id="dq-writing-msg" class="dq-writing-msg mb-4 min-h-[1.375rem] text-sm font-semibold text-amber-300/95"></p>
      <button type="button" class="dq-wsave w-full min-h-[52px] rounded-xl border border-[#bc13fe]/50 bg-gradient-to-r from-[#bc13fe] to-[#00f2ff]/90 py-3.5 text-base font-bold text-white opacity-40 shadow-[0_0_24px_rgba(188,19,254,0.35)] transition hover:brightness-110 disabled:pointer-events-none">
        Saqlash va natijani hisoblash
      </button>
      </div>
    `;

    const ta = qs(root, "#dq-writing-ta");
    const wc = qs(root, ".dq-wc");
    const wm = qs(root, "#dq-writing-msg");
    const saveBtn = qs(root, ".dq-wsave");

    function syncWritingFormUi() {
      const t = String(ta?.value ?? "");
      const words = diagnosticWordCount(t);
      const inRange = writingMeetsDiagWordRange(t);
      const hint = diagnoseWritingUiHint(words);
      if (wc)
        wc.textContent = `So'zlar: ${words} (kerakli: ${DIAG_WRITING_WORDS_MIN}–${DIAG_WRITING_WORDS_MAX})`;
      if (wm) {
        wm.textContent = hint || "";
        wm.classList.remove("text-amber-300/95", "text-red-400", "text-fuchsia-300/85", "text-transparent");
        if (!hint) wm.classList.add("text-transparent");
        else if (words > DIAG_WRITING_WORDS_MAX) wm.classList.add("text-red-400");
        else wm.classList.add("text-amber-300/95");
      }
      if (saveBtn) {
        saveBtn.disabled = !inRange;
        saveBtn.classList.toggle("opacity-40", !inRange);
      }
    }

    function upd() {
      const t = String(ta?.value ?? "");
      state.writingText = t;
      syncWritingFormUi();
      persist();
    }
    ta?.addEventListener("input", upd);
    upd();

    writingAutosaveInterval = setInterval(() => {
      const tEl = qs(root, "#dq-writing-ta");
      if (!tEl || state.phase !== "writing") return;
      state.writingText = String(tEl.value ?? "");
      persist();
    }, 5000);

    saveBtn?.addEventListener("click", async () => {
      const t = String(ta?.value ?? "").trim();
      if (!writingMeetsDiagWordRange(t)) {
        alert(diagnoseWritingUiHint(diagnosticWordCount(t)));
        return;
      }

      const sb = ensureSupabase();
      if (!sb) {
        alert("Supabase sozlanmagan.");
        return;
      }
      const {
        data: { session },
      } = await sb.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) {
        alert("Sessiya topilmadi.");
        return;
      }

      const btnLabel = saveBtn?.textContent || "";
      saveBtn.disabled = true;
      saveBtn.classList.add("opacity-60");
      saveBtn.textContent = "AI baholaydi…";

      const aiRes = await postDiagnosticWritingAnalyze(t).catch(() => ({
        ok: false,
        error: "Internet yoki AI xatoligi.",
      }));

      saveBtn.textContent = btnLabel;
      saveBtn.classList.remove("opacity-60");

      if (!aiRes.ok) {
        syncWritingFormUi();
        alert(aiRes.error || "Baholash muvaffaqiyatsiz.");
        return;
      }

      state.writingText = t;
      state.wScore = aiRes.score;
      state.writingFeedbackAi = aiRes.feedback || "";
      state.writingErrorsAi = Array.isArray(aiRes.errors) ? aiRes.errors.slice() : [];
      state.writingStructuredSnapshot =
        aiRes.structured != null && typeof aiRes.structured === "object" ? { ...aiRes.structured } : null;
      state.writingAiModel = aiRes.model || "";
      state.writingAiAt = new Date().toISOString();
      persist();

      saveBtn.disabled = true;
      saveBtn.classList.add("opacity-40");
      saveBtn.textContent = "Natija saqlanmoqda…";

      await finalizeDiagnostic(uid);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cleanupListeningTimers() {
    if (listeningPrepInterval) {
      clearInterval(listeningPrepInterval);
      listeningPrepInterval = null;
    }
    if (listeningAudio) {
      allowListeningPause = true;
      if (listeningPauseGuardHandler) {
        try {
          listeningAudio.removeEventListener("pause", listeningPauseGuardHandler);
        } catch (_) {
          /* ignore */
        }
        listeningPauseGuardHandler = null;
      }
      try {
        listeningAudio.pause();
      } catch (_) {
        /* ignore */
      }
      try {
        listeningAudio.removeAttribute("src");
        listeningAudio.load();
      } catch (_) {
        /* ignore */
      }
      allowListeningPause = false;
      listeningAudio = null;
    }
  }

  function listenCompletedSlots() {
    let n = 0;
    for (let i = 0; i < state.listeningPartIndex && i < LISTENING_PARTS.length; i++) {
      n += listeningQuestionsCount(LISTENING_PARTS[i]);
    }
    return n;
  }

  function countFilledInCurrentListeningPart(wrap) {
    const part = LISTENING_PARTS[state.listeningPartIndex];
    if (!wrap || !part) return 0;
    if (part.type === "match") {
      const c = part.speakerCount || 5;
      let n = 0;
      for (let i = 1; i <= c; i++) {
        if (qs(wrap, `#dq-l-m-${i}`)?.value) n += 1;
      }
      return n;
    }
    if (part.type === "mcqLetters") {
      return listeningPartQuestionIds(part).filter((id) => {
        const v = qs(wrap, `#dq-l-mcq-${id}`)?.value;
        return v && String(v).trim().length > 0;
      }).length;
    }
    if (part.type === "gapFill") {
      return listeningPartQuestionIds(part).filter((id) => {
        const v = qs(wrap, `#dq-l-gap-${id}`)?.value;
        return v && String(v).trim().length > 0;
      }).length;
    }
    return 0;
  }

  function listeningProgressFraction() {
    if (LISTENING_TOTAL_ITEMS <= 0) return 0;
    if (state.listeningDone) return 1;
    const wrap = qs(root, ".dq-listening");
    const done = listenCompletedSlots() + countFilledInCurrentListeningPart(wrap);
    return Math.min(1, done / LISTENING_TOTAL_ITEMS);
  }

  /** Tepadagi modul + header progress: Listening ichida 17 ta javob maydoni bo‘yicha 50%→75% oralig‘ida. */
  function updateListeningPhaseProgressBars() {
    const stepBase = (2 / 4) * 100;
    const listeningSpan = (1 / 4) * 100;
    const frac = listeningProgressFraction();
    const pct = Math.min(100, stepBase + listeningSpan * frac);
    const hdrFill = qs(root, ".dq-header-prog-fill");
    if (hdrFill) hdrFill.style.width = `${pct}%`;
    const bar = qs(root, ".dq-prog-bar");
    if (bar) bar.style.width = `${pct}%`;

    const micro = qs(root, ".dq-l-micro-fill");
    if (micro) micro.style.width = `${frac * 100}%`;
    const microCount = qs(root, ".dq-l-micro-count");
    if (microCount) {
      const answered = state.listeningDone
        ? LISTENING_TOTAL_ITEMS
        : listenCompletedSlots() + countFilledInCurrentListeningPart(qs(root, ".dq-listening"));
      microCount.textContent = ` · ${answered} / ${LISTENING_TOTAL_ITEMS}`;
    }
  }

  function currentPartActionLabel(part) {
    const last = state.listeningPartIndex >= LISTENING_PARTS.length - 1;
    return last ? "Natijani hisoblash" : "Keyingi qism";
  }

  function renderListeningRightColumnHtml(part) {
    if (part.type === "match") {
      const legendHtml = (part.optionLegend || [])
        .map(
          (o) =>
            `<div class="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-white/80 sm:text-sm"><strong class="text-fuchsia-200">${escapeHtml(o.id)}:</strong> ${escapeHtml(o.legend)}</div>`
        )
        .join("");
      const n = part.speakerCount || 5;
      const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
      const speakersHtml = Array.from({ length: n }, (_, i) => i + 1)
        .map(
          (num) => `
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fuchsia-500/20 bg-white/[0.05] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(217,70,239,0.08)] backdrop-blur-md">
        <span class="text-sm font-semibold text-white">Eshituvchi ${num}</span>
        <select id="dq-l-m-${num}" class="dq-l-input rounded-xl border border-fuchsia-500/35 bg-[#12081f]/90 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-fuchsia-500/30">
          <option value="">A–H</option>
          ${letters.map((l) => `<option value="${l}">${l}</option>`).join("")}
        </select>
      </div>`
        )
        .join("");
      return `
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">${legendHtml}</div>
        <div class="dq-read-scrollbar mt-4 max-h-[min(48vh,440px)] space-y-2 overflow-y-auto pr-1">${speakersHtml}</div>
      `;
    }

    if (part.type === "mcqLetters") {
      const qBlocks = [];
      part.sections.forEach((sec) => {
        sec.questions.forEach((q) => {
          qBlocks.push(
            `<div class="mb-5 rounded-xl border border-white/12 bg-black/30 p-4 sm:p-5 last:mb-0">
              <p class="mb-3 text-base font-medium leading-snug text-white/95">${escapeHtml(q.text)}</p>
              <div class="mb-4 ml-1 space-y-2 text-sm leading-relaxed text-white/70">${q.options.map((opt) => `<p>${escapeHtml(opt)}</p>`).join("")}</div>
              <div class="flex flex-wrap items-center gap-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-3">
                <span class="text-xs font-semibold uppercase tracking-wide text-fuchsia-300/90">Javob harfi</span>
                <input type="text" id="dq-l-mcq-${q.id}" maxlength="2" autocomplete="off" inputmode="text"
                  class="dq-l-input min-w-[5rem] rounded-lg border border-fuchsia-500/45 bg-[#12081f]/90 px-3 py-2 text-center text-lg font-black uppercase tracking-wider text-white outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-fuchsia-500/30" placeholder="?" />
              </div>
            </div>`
          );
        });
      });
      return `<div class="dq-read-scrollbar max-h-[min(56vh,520px)] space-y-6 overflow-y-auto pr-1">${qBlocks.join("")}</div>`;
    }

    if (part.type === "gapFill") {
      let html = `<div class="dq-read-scrollbar space-y-8 max-h-[min(56vh,520px)] overflow-y-auto pr-1">`;
      part.content.forEach((block) => {
        const hasGap = block.questionId != null;
        if (!hasGap && block.paragraph) {
          html += `<p class="text-[15px] font-medium leading-[1.9] tracking-wide text-white/85">${escapeHtml(block.paragraph)}</p>`;
          return;
        }
        if (hasGap) {
          const qId = block.questionId;
          html += `<p class="text-base font-medium leading-[2] tracking-wide text-white/90">${escapeHtml(block.paragraph)}
            <span class="mx-1 inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-2 rounded-xl border border-fuchsia-500/25 bg-black/35 px-3 py-2 align-middle">
              <span class="sr-only">Savol ${qId}</span>
              <input type="text" id="dq-l-gap-${qId}" autocomplete="off" spellcheck="false" aria-label="Savol ${qId}"
                class="dq-l-input min-w-[11rem] max-w-[13rem] flex-1 rounded-lg border border-white/35 bg-black/45 px-3 py-2 text-center text-[15px] font-semibold text-white outline-none placeholder:text-white/35 focus:border-cyan-400/55"
                placeholder="so‘z / raqam" />
            </span>${escapeHtml(block.suffix ?? "")}</p>`;
        }
      });
      html += `</div>`;
      return html;
    }

    return "";
  }

  function wireListeningPartInputListeners(wrap, part, onChange) {
    if (part.type === "match") {
      const c = part.speakerCount || 5;
      for (let i = 1; i <= c; i++) {
        qs(wrap, `#dq-l-m-${i}`)?.addEventListener("change", onChange);
      }
      return;
    }
    if (part.type === "mcqLetters") {
      listeningPartQuestionIds(part).forEach((id) => {
        qs(wrap, `#dq-l-mcq-${id}`)?.addEventListener("input", onChange);
      });
      return;
    }
    if (part.type === "gapFill") {
      listeningPartQuestionIds(part).forEach((id) => {
        qs(wrap, `#dq-l-gap-${id}`)?.addEventListener("input", onChange);
      });
    }
  }

  function currentPartAnswersComplete(wrap, part) {
    return listeningQuestionsCount(part) === countFilledInCurrentListeningPart(wrap);
  }

  function updateListeningActionBtn(wrap, part, btnEl) {
    if (!btnEl) return;
    const ok = currentPartAnswersComplete(wrap, part);
    btnEl.disabled = !ok;
    btnEl.classList.toggle("opacity-40", !ok);
    btnEl.textContent = currentPartActionLabel(part);
  }

  function renderListening() {
    hideAllSections();
    clearWritingAutosave();
    clearListeningDraftDebouncer();
    showMainQuizShell();
    cleanupListeningTimers();
    const wrap = qs(root, ".dq-listening");
    if (!wrap) return;
    wrap.classList.remove("hidden");

    const totalParts = LISTENING_PARTS.length;
    setModuleProgressFromPhase("listening");

    if (state.listeningDone) {
      setModuleProgressFromPhase("listening");
      updateListeningPhaseProgressBars();
      setPhaseLabel(`3 / 4 • LISTENING · yakunlandi · ${LISTENING_TOTAL_ITEMS} / ${LISTENING_TOTAL_ITEMS} javoblar`);
      wrap.innerHTML = listeningDoneHtml();
      wireListeningContinueToWriting();
      return;
    }

    if (typeof state.listeningPartIndex !== "number" || state.listeningPartIndex < 0) {
      state.listeningPartIndex = 0;
    }
    if (state.listeningPartIndex >= totalParts) {
      state.listeningPartIndex = totalParts - 1;
    }

    const part = LISTENING_PARTS[state.listeningPartIndex];
    if (!part) return;

    const prepSec = part.prepSeconds || 30;
    const isLastPart = state.listeningPartIndex >= totalParts - 1;
    const rightCol = renderListeningRightColumnHtml(part);

    wrap.innerHTML = `
      <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
        <span class="font-mono text-xs font-bold uppercase tracking-widest text-[#bc13fe]">
          Listening javoblari (${LISTENING_TOTAL_ITEMS})
          <span class="dq-l-micro-count ml-2 align-middle text-[#00f2ff]"> · 0 / ${LISTENING_TOTAL_ITEMS}</span>
        </span>
        <div class="h-1.5 w-full max-w-[220px] flex-1 overflow-hidden rounded-full bg-white/10 sm:w-auto">
          <div class="dq-l-micro-fill h-full rounded-full bg-gradient-to-r from-[#bc13fe] to-[#00f2ff] transition-[width] duration-[280ms]" style="width:0%"></div>
        </div>
      </div>

      <p class="mb-4 text-left text-xs font-semibold uppercase tracking-wider text-fuchsia-300/90">Listening</p>

      <div class="dq-l-inst mx-auto mb-6 max-w-2xl text-base font-medium leading-relaxed text-white/92 sm:text-[1.05rem]">${escapeHtml(part.instruction)}</div>

      <div class="mx-auto max-w-2xl rounded-2xl border border-fuchsia-500/30 bg-white/[0.06] p-6 shadow-[0_0_36px_rgba(217,70,239,0.18)] backdrop-blur-xl sm:p-8">
        <div class="flex flex-col items-center border-b border-white/10 pb-8 text-center">
          <div id="dq-l-status" class="mb-2 text-xs font-bold uppercase tracking-widest text-amber-300">Tayyorgarlik</div>
          <div id="dq-l-timer" class="dq-l-timer-glow mb-4 text-5xl font-black tabular-nums text-white sm:text-6xl"
            style="text-shadow:0 0 24px rgba(217,70,239,0.65),0 0 48px rgba(34,211,238,0.35)">${prepSec}</div>
          <p class="mx-auto max-w-md text-sm leading-relaxed text-white/50">
            Audio ${prepSec} soniyadan keyin <strong class="text-white/70">bir marta</strong> avtomatik ishga tushadi.
          </p>
          <div id="dq-l-eq-wrap" class="dq-l-eq invisible opacity-0 transition-opacity duration-300" aria-hidden="true">
            <span class="dq-l-eqb"></span><span class="dq-l-eqb"></span><span class="dq-l-eqb"></span><span class="dq-l-eqb"></span><span class="dq-l-eqb"></span>
          </div>
          <audio id="dq-l-player" preload="none" playsinline tabindex="-1" aria-hidden="true"
            class="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"></audio>
        </div>
        <div class="dq-listening-body pt-8">${rightCol}</div>
      </div>

      <button type="button" id="dq-l-action" disabled
        class="dq-l-action mx-auto mt-8 block w-full max-w-2xl min-h-[52px] rounded-2xl border border-fuchsia-400/45 bg-gradient-to-r from-fuchsia-600 to-purple-600 py-3.5 text-base font-bold text-white opacity-40 shadow-[0_0_24px_rgba(217,70,239,0.35)] transition hover:brightness-110 disabled:pointer-events-none sm:text-lg">
        ${currentPartActionLabel(part)}
      </button>
    `;

    const audioEl = wrap.querySelector("#dq-l-player");
    listeningAudio = audioEl;
    const st = qs(wrap, "#dq-l-status");
    const tm = qs(wrap, "#dq-l-timer");
    const eqWrap = qs(wrap, "#dq-l-eq-wrap");
    let prep = prepSec;
    let listeningClipPlayLock = false;

    function setListeningPlayingVisual(on) {
      if (eqWrap) {
        eqWrap.classList.toggle("invisible", !on);
        eqWrap.classList.toggle("opacity-0", !on);
      }
    }

    function onAnyInput() {
      updateListeningPhaseProgressBars();
      const answered =
        listenCompletedSlots() + countFilledInCurrentListeningPart(wrap);
      setPhaseLabel(`3 / 4 • LISTENING · javoblar ${answered} / ${LISTENING_TOTAL_ITEMS}`);
      updateListeningActionBtn(wrap, part, qs(wrap, "#dq-l-action"));
    }

    function listeningInputEffects() {
      onAnyInput();
      scheduleListeningDraftSave(wrap, part);
    }
    wireListeningPartInputListeners(wrap, part, listeningInputEffects);

    applyListeningDraftFields(wrap, part);

    listeningInputEffects();

    /** Toshqarti pleyer — qayta eshitish imkoniyatini bloklash uchun `src` ni olib tashlash. */
    function stripListeningAudioSourceOnly() {
      if (!audioEl) return;
      allowListeningPause = true;
      try {
        audioEl.pause();
        audioEl.removeAttribute("src");
        audioEl.load();
      } catch (_) {
        /* ignore */
      }
      allowListeningPause = false;
    }

    function playListeningOnce() {
      if (!audioEl || !part.audioSrc) return;
      if (listeningClipPlayLock) return;
      listeningClipPlayLock = true;

      if (listeningPauseGuardHandler) {
        try {
          audioEl.removeEventListener("pause", listeningPauseGuardHandler);
        } catch (_) {
          /* ignore */
        }
        listeningPauseGuardHandler = null;
      }

      listeningPauseGuardHandler = () => {
        if (allowListeningPause) return;
        if (!audioEl || audioEl.ended) return;
        void audioEl.play();
      };
      audioEl.addEventListener("pause", listeningPauseGuardHandler);

      audioEl.src = part.audioSrc;
      if (st) {
        st.textContent = "Audio ijro etilmoqda…";
        st.className = "mb-2 text-xs font-bold uppercase tracking-widest text-green-400";
      }
      setListeningPlayingVisual(true);

      audioEl.onended = () => {
        setListeningPlayingVisual(false);
        if (listeningPauseGuardHandler && audioEl) {
          try {
            audioEl.removeEventListener("pause", listeningPauseGuardHandler);
          } catch (_) {
            /* ignore */
          }
          listeningPauseGuardHandler = null;
        }
        stripListeningAudioSourceOnly();
        if (st) {
          st.textContent = "Audio tugadi — javoblarni to‘ldiring";
          st.className = "mb-2 text-xs font-bold uppercase tracking-widest text-cyan-400";
        }
      };

      audioEl.onerror = () => {
        setListeningPlayingVisual(false);
        listeningClipPlayLock = false;
        if (listeningPauseGuardHandler && audioEl) {
          try {
            audioEl.removeEventListener("pause", listeningPauseGuardHandler);
          } catch (_) {
            /* ignore */
          }
          listeningPauseGuardHandler = null;
        }
        if (st) {
          st.textContent = "Audio yuklanmadi — fayl yo‘lıni tekshiring";
          st.className = "mb-2 text-xs font-bold uppercase tracking-widest text-red-400";
        }
      };

      void audioEl.play().catch(() => {
        listeningClipPlayLock = false;
        setListeningPlayingVisual(false);
        if (listeningPauseGuardHandler && audioEl) {
          try {
            audioEl.removeEventListener("pause", listeningPauseGuardHandler);
          } catch (_) {
            /* ignore */
          }
          listeningPauseGuardHandler = null;
        }
        if (st) {
          st.textContent =
            "Brauzer avto-ijroni blokladi — sahifaga bir marta bosing, so‘ng sahifani yangilab qayta urinib ko‘ring.";
          st.className = "mb-2 text-xs font-bold uppercase tracking-widest text-amber-300";
        }
      });
    }

    listeningPrepInterval = window.setInterval(() => {
      prep -= 1;
      if (tm) tm.textContent = String(Math.max(prep, 0));
      if (prep <= 0 && listeningPrepInterval) {
        clearInterval(listeningPrepInterval);
        listeningPrepInterval = null;
        playListeningOnce();
      }
    }, 1000);

    function finalizeCurrentPartAnswers() {
      let correct = 0;
      const answers = {};
      let payloadTotal = 0;

      if (part.type === "match") {
        const cnt = part.speakerCount || 5;
        for (let num = 1; num <= cnt; num++) {
          const val = qs(wrap, `#dq-l-m-${num}`)?.value?.trim().toUpperCase() ?? "";
          answers[num] = val;
          const key = part.answerKeys[num - 1];
          if (key && val === String(key).toUpperCase()) correct += 1;
        }
        payloadTotal = cnt;
      } else if (part.type === "mcqLetters") {
        const ids = listeningPartQuestionIds(part);
        payloadTotal = ids.length;
        ids.forEach((id, idx) => {
          const val = qs(wrap, `#dq-l-mcq-${id}`)?.value?.trim().toUpperCase() ?? "";
          answers[id] = val;
          const keyRaw = part.answerKeys[idx] ?? "";
          const key = String(keyRaw).trim().toUpperCase();
          if (key && val === key) correct += 1;
        });
      } else if (part.type === "gapFill") {
        const ids = listeningPartQuestionIds(part);
        payloadTotal = ids.length;
        ids.forEach((id, idx) => {
          const raw = qs(wrap, `#dq-l-gap-${id}`)?.value ?? "";
          answers[id] = raw.trim();
          const normVal = normalizeGapAnswer(raw);
          const normKey = normalizeGapAnswer(part.answerKeys[idx] ?? "");
          if (normKey && normVal === normKey) correct += 1;
        });
      }

      const payload = {
        part: part.legacyPartId,
        uiKey: part.key,
        correct,
        total: payloadTotal,
        answers,
        completedAt: new Date().toISOString(),
      };

      state.listeningByPart[part.key] = payload;
      try {
        localStorage.setItem(part.legacyStorageKey, JSON.stringify(payload));
      } catch (_) {
        /* ignore */
      }
      syncListeningScoreFromParts();
      cleanupListeningTimers();

      if (isLastPart) {
        state.listeningDone = true;
        state.listeningPartIndex = totalParts;
      } else {
        state.listeningPartIndex += 1;
      }
      state.listeningDraft = null;
      clearListeningDraftDebouncer();
      persist();
      renderListening();
    }

    qs(wrap, "#dq-l-action")?.addEventListener("click", () => {
      if (!currentPartAnswersComplete(wrap, part)) return;
      finalizeCurrentPartAnswers();
    });
  }

  function listeningDoneHtml() {
    return `
      <div class="rounded-2xl border border-fuchsia-500/35 bg-white/[0.06] p-8 text-center shadow-[0_0_40px_rgba(217,70,239,0.22)] backdrop-blur-xl">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/20 text-fuchsia-200 shadow-[0_0_24px_rgba(217,70,239,0.35)]">
          <i class="fas fa-headphones text-2xl" aria-hidden="true"></i>
        </div>
        <h3 class="mb-2 text-xl font-bold text-white">Listening yakunlandi</h3>
        <p class="mb-6 text-sm text-slate-400">Oxirgi bosqich: yozma vazifa (Writing).</p>
        <button type="button" id="dq-go-writing" class="w-full min-h-[56px] rounded-xl border border-[#bc13fe]/55 bg-gradient-to-r from-[#bc13fe] via-purple-600 to-[#00f2ff] py-4 text-lg font-extrabold text-white shadow-[0_0_32px_rgba(188,19,254,0.4)] transition hover:brightness-110 active:scale-[0.99]">
          Writing bo'limiga o'tish →
        </button>
      </div>
    `;
  }

  async function finalizeDiagnostic(uid) {
    clearWritingAutosave();
    clearListeningDraftDebouncer();

    const maxPts = diagnosticScoreMaxPoints();
    const earned = state.gScore + state.rScore + state.wScore + state.lScore;
    const scaled20 = Math.round((earned / maxPts) * 20);
    const rawBand = levelFromTotal20(Math.min(20, Math.max(0, scaled20)));
    const profileLevel = normalizeProfileUserLevel(rawBand);
    const mistakeRows = Array.isArray(state.grammarMistakes) ? state.grammarMistakes : [];

    localStorage.setItem(
      "grammarLexisResults",
      JSON.stringify({
        score: state.gScore,
        total: GRAMMAR_QUESTIONS.length,
        level: `${profileLevel} (diag)`,
        grammarMistakes: mistakeRows.slice(),
        completedAt: new Date().toISOString(),
      })
    );
    localStorage.setItem(
      "readingResults",
      JSON.stringify({
        correct: state.rScore,
        total: READING_PASSAGES.length,
        levelResult: profileLevel,
      })
    );
    try {
      localStorage.setItem(
        "diagnosticWritingSnapshot",
        JSON.stringify({
          score: state.wScore,
          max: DIAGNOSTIC_WRITING_SCORE_MAX,
          words: diagnosticWordCount(state.writingText),
          essayText: state.writingText || "",
          feedbackAi: state.writingFeedbackAi || "",
          errorsAi: Array.isArray(state.writingErrorsAi) ? state.writingErrorsAi : [],
          structured: state.writingStructuredSnapshot || null,
          aiModel: state.writingAiModel || "",
          aiAt: state.writingAiAt || "",
          completedAt: new Date().toISOString(),
        })
      );
    } catch (_) {
      /* ignore */
    }

    try {
      let prevSubmission = {};
      try {
        prevSubmission = JSON.parse(localStorage.getItem("writingSubmission") || "{}") || {};
      } catch (_) {
        prevSubmission = {};
      }
      const mergedSubmission = {
        ...prevSubmission,
        diagnostic: true,
        essayText: state.writingText || "",
        words: diagnosticWordCount(state.writingText),
        score: state.wScore,
        aiScore: state.wScore,
        writingScoreMax: DIAGNOSTIC_WRITING_SCORE_MAX,
        aiReply: state.writingFeedbackAi || "",
        structured: state.writingStructuredSnapshot || null,
        errorsAi: Array.isArray(state.writingErrorsAi) ? state.writingErrorsAi : [],
        analyzedModel: state.writingAiModel || "",
        analyzedAt: state.writingAiAt || "",
        success: true,
      };
      mergedSubmission.reply =
        mergedSubmission.aiReply ||
        (mergedSubmission.structured &&
        typeof mergedSubmission.structured.feedback === "string"
          ? mergedSubmission.structured.feedback
          : "");
      mergedSubmission.submittedAt =
        prevSubmission.submittedAt ||
        mergedSubmission.analyzedAt ||
        new Date().toISOString();
      localStorage.setItem("writingSubmission", JSON.stringify(mergedSubmission));
      if (typeof globalThis !== "undefined" && globalThis.testResults) {
        globalThis.testResults.writing = mergedSubmission;
      }
      if (typeof globalThis.persistTestResults === "function") globalThis.persistTestResults();
    } catch (_) {
      /* ignore */
    }

    try {
      const partsMap = LISTENING_PARTS.reduce((acc, p) => {
        const r = state.listeningByPart?.[p.key];
        if (r) acc[p.legacyPartId] = r;
        return acc;
      }, {});
      localStorage.setItem(
        "diagnosticListeningMerged",
        JSON.stringify({
          correct: state.lScore,
          max: DIAGNOSTIC_LISTENING_SCORE_MAX,
          items: LISTENING_TOTAL_ITEMS,
          parts: partsMap,
          completedAt: new Date().toISOString(),
        })
      );
      LISTENING_PARTS.forEach((p) => {
        const r = state.listeningByPart?.[p.key];
        if (!r || typeof r !== "object") return;
        localStorage.setItem(p.legacyStorageKey, JSON.stringify(r));
      });
      if (globalThis.window != null && globalThis.window.testResults && typeof globalThis.window.testResults === "object") {
        globalThis.window.testResults.listening = {
          ...(globalThis.window.testResults.listening || {}),
          ...partsMap,
        };
      }
    } catch (_) {
      /* ignore */
    }

    qs(root, ".dq-saving")?.classList.remove("hidden");
    hideAllSections();

    const sb = ensureSupabase();
    if (!sb) {
      alert("Supabase sozlanmagan.");
      qs(root, ".dq-saving")?.classList.add("hidden");
      return;
    }
    const err = await saveLevelWithProfileMerge(sb, uid, rawBand);
    if (err) {
      alert(err.message || "Level saqlanmadi.");
      qs(root, ".dq-saving")?.classList.add("hidden");
      qs(root, ".dq-finalize")?.classList.remove("hidden");
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    resetLocalStudyPlanProgress();
    setPlanStartDate(todayIso);
    setCurrentStudyDayMarker(1);

    localStorage.setItem(DIAGNOSTIC_COMPLETE_KEY, "1");
    clearSession();
    clearDiagnosticProgress();
    clearWritingAutosave();
    clearListeningDraftDebouncer();

    qs(root, ".dq-saving")?.classList.add("hidden");

    showDiagnosticResultsScreen({
      level: profileLevel,
      grammar: state.gScore,
      reading: state.rScore,
      writing: state.wScore,
      listening: state.lScore,
    });
  }

  function wireListeningContinueToWriting() {
    qs(root, "#dq-go-writing")?.addEventListener("click", () => {
      state.phase = "writing";
      persist();
      renderWriting();
    });
  }

  async function boot() {
    const errEl = qs(root, ".dq-config-error");
    const welcome = qs(root, ".dq-welcome");

    const sb = ensureSupabase();
    if (!sb) {
      if (errEl) {
        errEl.textContent = "Supabase sozlanmagan (config.client.js).";
        errEl.classList.remove("hidden");
      }
      return;
    }

    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session?.user) {
      window.location.href = "/";
      return;
    }

    const paintBootUi = () => {
      if (state.listeningDone && state.phase === "listening") {
        hideAllSections();
        showMainQuizShell();
        const fin = qs(root, ".dq-listening");
        if (fin) {
          fin.classList.remove("hidden");
          fin.innerHTML = listeningDoneHtml();
          setModuleProgressFromPhase("listening");
          updateListeningPhaseProgressBars();
          wireListeningContinueToWriting();
        }
        return;
      }

      switch (state.phase) {
        case "grammar":
          renderGrammar();
          break;
        case "reading":
          renderReading();
          break;
        case "listening":
          renderListening();
          break;
        case "writing":
          renderWriting();
          break;
        default:
          state.phase = "grammar";
          persist();
          renderGrammar();
      }
    };

    paintBootUi();

    const { data: profile } = await sb.from("profiles").select("first_name").eq("id", session.user.id).maybeSingle();

    const first =
      String(profile?.first_name ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)[0] || "do'st";
    if (welcome) welcome.textContent = `Salom ${first}! Diagnostika bosqichlari`;
  }

  void boot();
}
