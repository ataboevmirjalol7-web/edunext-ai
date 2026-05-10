import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import {
  A2_B1_STUDY_META,
  dashboardTasksFromStudyDay,
  dashboardGrammarReadingTasksForTier,
  getCurrentStudyDayIndex,
  get30DayProgress,
  getDaySectionCompletion,
  markDaySectionComplete,
  setPlanStartDate,
  setCurrentStudyDayMarker,
  resetLocalStudyPlanProgress,
  getA2DayOutlineLabel,
  CURRENT_STUDY_DAY_KEY,
  finalizeStudyDayViaDailyAssessment,
} from "/studyPlan.js";

import { setupTimedReadingExam } from "/readingExamDashboard.js";
import { setupGrammarPhasedDashboard } from "/grammarPhasedDashboard.js";
import { buildTimedReadingPayloadFromSources, normalizeReadingExamParts } from "/readingExamContent.js";
import { listeningBbcPodcastBannerHtml } from "/listeningBbcPodcastPanel.js";
import { handleCheck, isGroqRateLimitPayload } from "/aiGroqRetry.js";

/** Brauzerdagi Supabase mijoz (window.APP_CONFIG: supabaseUrl, supabaseAnonKey). */
let __supabaseClient = null;
let __sbUser = null;
let __edunextProfile = null;
const DAILY_LOCK_PREFIX = "edunext_daily_lock";
const DAILY_METRICS_PREFIX = "edunext_daily_metrics_v1";
let __chartJsLibPromise = null;
let __growthChartInstance = null;
let __userProgressRealtimeChannel = null;
const PROFILE_AVATAR_CACHE_PREFIX = "edunext_profile_avatar_url";

function formatTodayUzDate() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function dailyLockKey(uid, dateStr) {
  const userPart = String(uid || "guest").trim() || "guest";
  const dayPart = String(dateStr || formatTodayUzDate()).trim();
  return `${DAILY_LOCK_PREFIX}:${userPart}:${dayPart}`;
}

function isTodayLockedForUser(uid) {
  const key = dailyLockKey(uid, formatTodayUzDate());
  try {
    return localStorage.getItem(key) === "1";
  } catch (_) {
    return false;
  }
}

function setTodayLockedForUser(uid) {
  const key = dailyLockKey(uid, formatTodayUzDate());
  try {
    localStorage.setItem(key, "1");
  } catch (_) {
    /* ignore */
  }
}

function metricsHistoryKey(uid) {
  const userPart = String(uid || "guest").trim() || "guest";
  return `${DAILY_METRICS_PREFIX}:${userPart}`;
}

function avatarCacheKey(uid) {
  const userPart = String(uid || "guest").trim() || "guest";
  return `${PROFILE_AVATAR_CACHE_PREFIX}:${userPart}`;
}

function resolveAvatarUrl(uid) {
  const fromProfile = String(__edunextProfile?.avatar_url || "").trim();
  if (fromProfile) return fromProfile;
  try {
    return String(localStorage.getItem(avatarCacheKey(uid)) || "").trim();
  } catch (_) {
    return "";
  }
}

function applyAvatarVisual(el, fullName, avatarUrl) {
  if (!el) return;
  const initials = (String(fullName || "U")
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() || "")
    .join("") || "U");
  const safeUrl = String(avatarUrl || "").trim();
  if (safeUrl) {
    el.textContent = "";
    el.style.backgroundImage = `url("${safeUrl}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
  } else {
    el.style.backgroundImage = "";
    el.textContent = initials;
  }
}

async function updateProfileRow(uid, payload) {
  const sb = ensureSupabase();
  if (!sb || !uid) throw new Error("Supabase yoki user yo'q");
  const { data: sessWrap, error: sessErr } = await sb.auth.getSession();
  if (sessErr) throw sessErr;
  const authUid = String(sessWrap?.session?.user?.id || "").trim();
  if (!authUid) throw new Error("Sessiya topilmadi. Qayta login qiling.");
  if (authUid !== String(uid)) {
    throw new Error("Xavfsizlik xatosi: auth.uid() va profile id mos emas.");
  }
  let res = await sb.from("profiles").update(payload).eq("id", authUid);
  if (!res.error) return;
  if (String(res.error?.message || "").toLowerCase().includes("avatar_url")) {
    const { avatar_url: _omit, ...safePayload } = payload;
    res = await sb.from("profiles").update(safePayload).eq("id", authUid);
  }
  if (res.error) throw res.error;
}

function showProfileSettingsModal() {
  const uid = __sbUser?.id;
  if (!uid) return;
  const old = document.getElementById("profile-settings-modal");
  if (old) old.remove();
  const fullName = `${String(__edunextProfile?.first_name || "").trim()} ${String(__edunextProfile?.last_name || "").trim()}`.trim();
  const avatarUrl = resolveAvatarUrl(uid);
  const modal = document.createElement("div");
  modal.id = "profile-settings-modal";
  modal.className =
    "fixed inset-0 z-[2600] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4";
  modal.innerHTML = `
    <div class="relative w-full max-w-md rounded-2xl border border-fuchsia-500/40 bg-[linear-gradient(160deg,rgba(30,10,50,0.95),rgba(6,4,15,0.95))] p-5 text-white shadow-[0_0_44px_rgba(168,85,247,0.35)]">
      <button type="button" data-ps-close class="absolute right-3 top-3 rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">Yopish</button>
      <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-300/90">Profile Settings</p>
      <div class="mt-4 flex items-center gap-3">
        <div id="ps-avatar-preview" class="h-16 w-16 rounded-full border border-fuchsia-400/50 bg-black/40"></div>
        <div>
          <input id="ps-avatar-input" type="file" accept="image/*" class="hidden" />
          <button type="button" id="ps-avatar-btn" class="dashboard-primary-btn rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/20 px-3 py-2 text-xs font-bold uppercase tracking-wide text-fuchsia-100 hover:bg-fuchsia-600/32">Avatar tanlash</button>
        </div>
      </div>
      <div class="mt-4 space-y-3">
        <div>
          <label for="ps-first-name" class="mb-1 block text-xs text-slate-300">First Name</label>
          <input id="ps-first-name" type="text" class="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white focus:border-fuchsia-500/55 focus:outline-none" value="${String(__edunextProfile?.first_name || "").replace(/"/g, "&quot;")}" />
        </div>
        <div>
          <label for="ps-last-name" class="mb-1 block text-xs text-slate-300">Last Name</label>
          <input id="ps-last-name" type="text" class="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white focus:border-fuchsia-500/55 focus:outline-none" value="${String(__edunextProfile?.last_name || "").replace(/"/g, "&quot;")}" />
        </div>
      </div>
      <p id="ps-feedback" class="mt-3 hidden text-xs font-semibold"></p>
      <button type="button" id="ps-save-btn" class="dashboard-primary-btn mt-4 w-full rounded-xl border border-fuchsia-400/60 bg-fuchsia-600/30 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_0_20px_rgba(168,85,247,0.35)] transition hover:brightness-110">Saqlash</button>
    </div>
  `;
  document.body.appendChild(modal);

  const previewEl = modal.querySelector("#ps-avatar-preview");
  const firstNameEl = modal.querySelector("#ps-first-name");
  const lastNameEl = modal.querySelector("#ps-last-name");
  const inputEl = modal.querySelector("#ps-avatar-input");
  const feedbackEl = modal.querySelector("#ps-feedback");
  const saveBtn = modal.querySelector("#ps-save-btn");
  let selectedFile = null;
  let objectUrl = "";
  applyAvatarVisual(previewEl, fullName || "U", avatarUrl);

  modal.querySelector("#ps-avatar-btn")?.addEventListener("click", () => inputEl?.click());
  inputEl?.addEventListener("change", () => {
    const f = inputEl.files?.[0];
    if (!f) return;
    selectedFile = f;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(f);
    applyAvatarVisual(previewEl, fullName || "U", objectUrl);
  });
  modal.querySelector("[data-ps-close]")?.addEventListener("click", () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    modal.remove();
  });
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      modal.remove();
    }
  });

  saveBtn?.addEventListener("click", async () => {
    const firstName = String(firstNameEl?.value || "").trim();
    const lastName = String(lastNameEl?.value || "").trim();
    if (!firstName || !lastName) {
      if (feedbackEl) {
        feedbackEl.textContent = "Ism va familiya kiritilishi shart.";
        feedbackEl.className = "mt-3 text-xs font-semibold text-amber-300";
      }
      return;
    }
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saqlanmoqda...";
    }
    try {
      const sb = ensureSupabase();
      if (!sb) throw new Error("Supabase konfiguratsiyasi topilmadi.");
      let avatarUrlNext = resolveAvatarUrl(uid);
      if (selectedFile && sb) {
        const ext = String(selectedFile.name || "png").split(".").pop() || "png";
        const path = `${uid}/avatar-${Date.now()}.${ext}`;
        // 1) Avatar uploadni to'liq kutamiz
        const up = await sb.storage.from("avatars").upload(path, selectedFile, {
          upsert: true,
          cacheControl: "3600",
        });
        if (up.error) throw up.error;
        const pub = sb.storage.from("avatars").getPublicUrl(path);
        avatarUrlNext = String(pub?.data?.publicUrl || "").trim();
      }
      // 2) Upload tugagandan keyingina profiles update ishlaydi
      await updateProfileRow(uid, {
        first_name: firstName,
        last_name: lastName,
        avatar_url: avatarUrlNext || null,
      });
      if (!__edunextProfile || typeof __edunextProfile !== "object") __edunextProfile = {};
      __edunextProfile.first_name = firstName;
      __edunextProfile.last_name = lastName;
      if (avatarUrlNext) __edunextProfile.avatar_url = avatarUrlNext;
      try {
        if (avatarUrlNext) localStorage.setItem(avatarCacheKey(uid), avatarUrlNext);
      } catch (_) {
        /* ignore */
      }
      await renderProgressProfilePanel();
      hydrateDashboardGreetingFromProfile();
      if (feedbackEl) {
        feedbackEl.textContent = "Muvaffaqiyatli yangilandi";
        feedbackEl.className = "mt-3 text-xs font-semibold text-emerald-300";
      }
      window.setTimeout(() => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        modal.remove();
      }, 900);
    } catch (err) {
      const msg = String(err?.message || "Saqlashda noma'lum xatolik yuz berdi.");
      if (feedbackEl) {
        feedbackEl.textContent = `Xatolik: ${msg}`;
        feedbackEl.className = "mt-3 text-xs font-semibold text-rose-300";
      }
      console.error("[profile settings]", msg, err);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Saqlash";
      }
    }
  });
}

function readDailyMetricsHistory(uid) {
  try {
    const raw = localStorage.getItem(metricsHistoryKey(uid));
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function writeDailyMetricsHistory(uid, rows) {
  try {
    localStorage.setItem(metricsHistoryKey(uid), JSON.stringify(rows));
  } catch (_) {
    /* ignore */
  }
}

function saveDailyMetricsSnapshot(uid, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  const todayIso = new Date().toISOString().split("T")[0];
  const xp = Math.max(0, Math.round(Number(snapshot.overallPct || 0) * 10));
  const row = {
    date: todayIso,
    overallPct: Math.max(0, Math.min(100, Math.round(Number(snapshot.overallPct || 0)))),
    skills: {
      reading: Math.max(0, Math.min(100, Math.round(Number(snapshot.reading?.pct || 0)))),
      listening: Math.max(0, Math.min(100, Math.round(Number(snapshot.listening?.pct || 0)))),
      writing: Math.max(0, Math.min(100, Math.round(Number(snapshot.writing?.pct || 0)))),
      vocabulary: Math.max(0, Math.min(100, Math.round(Number(snapshot.vocab?.pct || 0)))),
    },
    xp,
  };
  const rows = readDailyMetricsHistory(uid).filter((x) => x?.date !== todayIso);
  rows.push(row);
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeDailyMetricsHistory(uid, rows.slice(-30));
}

async function ensureChartJsLib() {
  if (globalThis.Chart) return globalThis.Chart;
  if (__chartJsLibPromise) return __chartJsLibPromise;
  __chartJsLibPromise = import("https://cdn.jsdelivr.net/npm/chart.js@4.4.3/+esm")
    .then((m) => m?.default || m?.Chart || globalThis.Chart || null)
    .catch(() => null);
  return __chartJsLibPromise;
}

async function fetchLast7OverallGrades(uid) {
  const sb = ensureSupabase();
  if (!sb || !uid) return [];
  // User so‘ragan asosiy query:
  // .select('day_number, overall_grade')
  // .eq('user_id', currentUser.id)
  // .order('day_number', { ascending: true })
  // .limit(7)
  let res = await sb
    .from("user_progress")
    .select("day_number,overall_grade")
    .eq("user_id", uid)
    .order("day_number", { ascending: true })
    .limit(7);
  if (!res.error && Array.isArray(res.data)) {
    return res.data.map((r) => ({
      d: `D${Number(r?.day_number || 0)}`,
      g: Number(r?.overall_grade || 0),
    }));
  }
  const sortDesc = (arr) =>
    [...arr].sort((a, b) => String(b?.d || "").localeCompare(String(a?.d || "")));

  res = await sb
    .from("user_progress")
    .select("day_date,overall_grade")
    .eq("user_id", uid)
    .order("day_date", { ascending: false })
    .limit(7);
  if (!res.error && Array.isArray(res.data)) {
    return sortDesc(
      res.data.map((r) => ({ d: String(r?.day_date || ""), g: Number(r?.overall_grade || 0) })),
    ).slice(0, 7);
  }

  res = await sb
    .from("user_progress")
    .select("progress_date,overall_grade")
    .eq("user_id", uid)
    .order("progress_date", { ascending: false })
    .limit(7);
  if (!res.error && Array.isArray(res.data)) {
    return sortDesc(
      res.data.map((r) => ({ d: String(r?.progress_date || ""), g: Number(r?.overall_grade || 0) })),
    ).slice(0, 7);
  }

  const localRows = readDailyMetricsHistory(uid)
    .slice(-7)
    .map((x) => ({ d: String(x?.date || ""), g: Number(x?.overallPct || 0) }));
  return sortDesc(localRows).slice(0, 7);
}

async function fetchTodayOverallGrade(uid) {
  const sb = ensureSupabase();
  if (!sb || !uid) return null;
  const iso = new Date().toISOString().split("T")[0];
  const uz = formatTodayUzDate();
  let res = await sb
    .from("user_progress")
    .select("day_date,overall_grade")
    .eq("user_id", uid)
    .eq("day_date", iso)
    .limit(1)
    .maybeSingle();
  if (!res.error && res.data && Number.isFinite(Number(res.data?.overall_grade))) {
    return {
      dateLabel: `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.${String(iso).slice(0, 4)}`,
      grade: Math.round(Number(res.data.overall_grade)),
    };
  }
  res = await sb
    .from("user_progress")
    .select("progress_date,overall_grade")
    .eq("user_id", uid)
    .eq("progress_date", uz)
    .limit(1)
    .maybeSingle();
  if (!res.error && res.data && Number.isFinite(Number(res.data?.overall_grade))) {
    return {
      dateLabel: uz,
      grade: Math.round(Number(res.data.overall_grade)),
    };
  }
  return null;
}

async function fetchDailyStatsForSidebar(uid) {
  const sb = ensureSupabase();
  if (!sb || !uid) return [];
  const res = await sb
    .from("user_progress")
    .select("day_date,overall_grade")
    .eq("user_id", uid)
    .order("day_date", { ascending: true })
    .limit(7);
  if (res.error || !Array.isArray(res.data)) return [];
  return res.data.map((x) => ({
    day_date: String(x?.day_date || ""),
    overall_grade: Math.max(0, Math.min(100, Math.round(Number(x?.overall_grade || 0)))),
  }));
}

function ensureUserProgressRealtimeSync() {
  const sb = ensureSupabase();
  const uid = __sbUser?.id;
  if (!sb || !uid || __userProgressRealtimeChannel) return;
  __userProgressRealtimeChannel = sb
    .channel(`user-progress-${uid}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "user_progress",
        filter: `user_id=eq.${uid}`,
      },
      () => {
        void renderProgressProfilePanel();
      },
    )
    .subscribe();
}

async function renderGrowthAreaChart(labels, values) {
  const canvas = document.getElementById("pp-growth-chart");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const Chart = await ensureChartJsLib();
  if (!Chart) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (__growthChartInstance) {
    __growthChartInstance.destroy();
    __growthChartInstance = null;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 200);
  gradient.addColorStop(0, "rgba(168,85,247,0.45)");
  gradient.addColorStop(1, "rgba(168,85,247,0)");

  __growthChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: "#A855F7",
          backgroundColor: gradient,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.35,
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      animations: {
        x: {
          type: "number",
          easing: "linear",
          duration: 420,
          from: NaN,
          delay(context) {
            if (context.type !== "data" || context.xStarted) return 0;
            context.xStarted = true;
            return context.dataIndex * 110;
          },
        },
        y: {
          type: "number",
          easing: "easeOutQuad",
          duration: 500,
          from: (ctx2) => {
            if (ctx2.type === "data") return 0;
            return 0;
          },
          delay(context) {
            if (context.type !== "data" || context.yStarted) return 0;
            context.yStarted = true;
            return context.dataIndex * 110;
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            label(tt) {
              return `${Math.round(Number(tt.parsed?.y || 0))}%`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false, drawBorder: false }, ticks: { color: "rgba(148,163,184,0.85)", font: { size: 9 } } },
        y: { min: 0, max: 100, grid: { display: false, drawBorder: false }, ticks: { display: false } },
      },
    },
  });
}

function computeCurrentStreak(rows) {
  const dates = new Set(
    rows
      .map((x) => String(x?.date || "").trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  );
  let streak = 0;
  const d = new Date();
  while (true) {
    const iso = d.toISOString().split("T")[0];
    if (!dates.has(iso)) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function buildSkillSnapshotFromLocal() {
  let reading = null;
  let writing = null;
  let grammar = null;
  let lp3 = null;
  let lp5 = null;
  let lp6 = null;
  try {
    reading = JSON.parse(localStorage.getItem("readingResults") || "null");
    writing = JSON.parse(localStorage.getItem("writingSubmission") || "null");
    grammar = JSON.parse(localStorage.getItem("grammarLexisResults") || "null");
    lp3 = JSON.parse(localStorage.getItem("listeningPart3Results") || "null");
    lp5 = JSON.parse(localStorage.getItem("listeningPart5Results") || "null");
    lp6 = JSON.parse(localStorage.getItem("listeningPart6Results") || "null");
  } catch (_) {
    /* ignore */
  }
  const readCorrect = Number(reading?.correct ?? 0);
  const readTotal = Number(reading?.total ?? 0);
  const readingPct = readTotal > 0 ? Math.round((readCorrect / readTotal) * 100) : 0;
  const listeningScore = [lp3?.score, lp5?.score, lp6?.score]
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
  const listeningTotal = [lp3?.total, lp5?.total, lp6?.total]
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
  const listeningPct = listeningTotal > 0 ? Math.round((listeningScore / listeningTotal) * 100) : 0;
  const writingRaw = Number(writing?.writingScore ?? writing?.aiScore ?? writing?.score ?? 0);
  const writingPct = Number.isFinite(writingRaw) ? Math.max(0, Math.min(100, Math.round(writingRaw * 10))) : 0;
  const vocabularyPct = 0;
  const grammarScore = Number(grammar?.score ?? 0);
  const grammarTotal = Number(grammar?.total ?? 0);
  const grammarPct = grammarTotal > 0 ? Math.round((grammarScore / grammarTotal) * 100) : 0;
  const values = [grammarPct, readingPct, listeningPct, writingPct, vocabularyPct].filter((n) => n > 0);
  return {
    overallPct: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    readingPct,
    listeningPct,
    writingPct,
    vocabularyPct,
  };
}

async function renderProgressProfilePanel() {
  const nameEl = document.getElementById("pp-name");
  const levelEl = document.getElementById("pp-level");
  const avatarEl = document.getElementById("pp-avatar");
  const feedbackEl = document.getElementById("pp-growth-feedback");
  const currentDayDateEl = document.getElementById("pp-current-day-date");
  const currentDayGradeEl = document.getElementById("pp-current-day-grade");
  const growthBadgeEl = document.getElementById("pp-growth-badge");
  const growthMicrocopyEl = document.getElementById("pp-growth-microcopy");
  const skillsEl = document.getElementById("pp-skill-breakdown");
  const streakEl = document.getElementById("pp-streak");
  const xpEl = document.getElementById("pp-xp");
  if (!nameEl || !levelEl || !avatarEl || !skillsEl || !streakEl || !xpEl) return;

  const first = String(__edunextProfile?.first_name || "").trim();
  const last = String(__edunextProfile?.last_name || "").trim();
  const fullName = [first, last].filter(Boolean).join(" ").trim() || "Foydalanuvchi";
  nameEl.textContent = fullName;
  const levelRaw = String(__edunextProfile?.level || "").trim() || "B1";
  levelEl.textContent = `${levelRaw} ${shortCefrLabelFromBand(levelRaw)}`;
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() || "")
    .join("") || "U";
  applyAvatarVisual(avatarEl, initials, resolveAvatarUrl(__sbUser?.id));

  const history = readDailyMetricsHistory(__sbUser?.id);
  const latest7 = history.slice(-7);
  const dbSeries = await fetchLast7OverallGrades(__sbUser?.id);
  const chartSeries = (dbSeries.length
    ? dbSeries
    : latest7.map((x) => ({ d: x?.date, g: x?.overallPct }))).slice(-7);
  const values = chartSeries.map((x) =>
    Math.max(0, Math.min(100, Math.round(Number(x?.g || 0)))),
  );
  const labels = values.map((_, i) => `D${i + 1}`);
  await renderGrowthAreaChart(labels, values);
  const cur = Number(values[values.length - 1] || 0);
  const prev = Number(values[values.length - 2] || 0);
  const growth = values.length >= 2 ? cur - prev : 0;
  if (feedbackEl) {
    if (growth > 0) {
      feedbackEl.textContent = `Kechagidan +${growth}% yaxshilanish`;
      feedbackEl.className = "mt-2 text-xs font-semibold text-emerald-300";
    } else if (growth === 0) {
      feedbackEl.textContent = "Natija barqaror turibdi";
      feedbackEl.className = "mt-2 text-xs font-semibold text-amber-300";
    } else {
      feedbackEl.textContent = "Siz buni qila olasiz! 🦾";
      feedbackEl.className = "mt-2 text-xs font-semibold text-amber-300";
    }
  }
  if (growthBadgeEl) {
    if (growth > 0) {
      growthBadgeEl.textContent = `+${growth}% O'sish 🚀`;
      growthBadgeEl.className =
        "rounded-full border border-emerald-400/45 bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.25)]";
    } else if (growth === 0) {
      growthBadgeEl.textContent = "Barqaror 📈";
      growthBadgeEl.className =
        "rounded-full border border-amber-400/45 bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300";
    } else {
      growthBadgeEl.textContent = "Siz buni qila olasiz! 🦾";
      growthBadgeEl.className =
        "rounded-full border border-amber-400/45 bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300";
    }
  }
  if (growthMicrocopyEl) {
    const firstName = String(__edunextProfile?.first_name || "Eldorbek").trim() || "Eldorbek";
    if (growth > 0) {
      growthMicrocopyEl.textContent = `Barakalla, ${firstName}! Kechagidan ${growth}% yaxshiroq natija ko'rsatdingiz. Shunday davom eting!`;
    } else if (growth === 0) {
      growthMicrocopyEl.textContent = `${firstName}, bugun barqaror natija ko'rsatdingiz. Endi kichik qadam bilan yuqoriga chiqamiz!`;
    } else {
      growthMicrocopyEl.textContent = `${firstName}, bugun biroz pasayish bo'ldi, lekin siz buni albatta qoplaysiz!`;
    }
  }
  const dailyStats = await fetchDailyStatsForSidebar(__sbUser?.id);
  const latestProgress = dailyStats[dailyStats.length - 1] || null;
  if (currentDayDateEl) {
    currentDayDateEl.textContent = latestProgress ? latestProgress.day_date : "08.05.2026";
  }
  if (currentDayGradeEl) {
    currentDayGradeEl.textContent = latestProgress
      ? `${latestProgress.overall_grade}%`
      : "51%";
  }
  if (latestProgress && feedbackEl) {
    const grade = latestProgress.overall_grade;
    feedbackEl.textContent = `${grade}% — bugungi yakuniy natija`;
    feedbackEl.className = "mt-2 text-xs font-semibold text-fuchsia-200";
  }

  const fallback = buildSkillSnapshotFromLocal();
  const avgFromHistory = (k) => {
    if (latest7.length === 0) return 0;
    return Math.round(
      latest7.map((x) => Number(x?.skills?.[k] || 0)).reduce((a, b) => a + b, 0) / latest7.length,
    );
  };
  const skills = [
    { key: "reading", label: "Reading", color: "from-cyan-500 to-cyan-300", value: latest7.length ? avgFromHistory("reading") : fallback.readingPct },
    { key: "listening", label: "Listening", color: "from-amber-500 to-amber-300", value: latest7.length ? avgFromHistory("listening") : fallback.listeningPct },
    { key: "writing", label: "Writing", color: "from-fuchsia-500 to-purple-300", value: latest7.length ? avgFromHistory("writing") : fallback.writingPct },
    { key: "vocabulary", label: "Vocabulary", color: "from-emerald-500 to-emerald-300", value: latest7.length ? avgFromHistory("vocabulary") : fallback.vocabularyPct },
  ];
  skillsEl.replaceChildren();
  skills.forEach((s) => {
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="mb-1 flex items-center justify-between text-[11px] text-slate-200"><span>${s.label}</span><span>${s.value}%</span></div>
      <div class="h-2 rounded-full bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-gradient-to-r ${s.color}" style="width:${Math.max(2, Math.min(100, s.value))}%"></div></div>
    `;
    skillsEl.appendChild(row);
  });

  const streak = computeCurrentStreak(history);
  const totalXp = history.reduce((a, b) => a + Math.max(0, Number(b?.xp || 0)), 0);
  streakEl.textContent = `${streak} kun`;
  xpEl.textContent = `${totalXp} XP`;
}

async function persistDailyCompletionToSupabase(dayNum) {
  const sb = ensureSupabase();
  const uid = __sbUser?.id;
  if (!sb || !uid) throw new Error("Supabase yoki foydalanuvchi mavjud emas");
  const safeDay = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const isoDay = new Date().toISOString().split("T")[0];
  const payloadTsxLike = {
    user_id: uid,
    day_date: isoDay,
    day_number: safeDay,
    is_completed: true,
  };
  let res = await sb.from("user_progress").upsert(payloadTsxLike, {
    onConflict: "user_id,day_date",
  });
  if (!res.error) return;

  // Ba'zi sxemalarda `progress_date` / `completed_at` ishlatiladi — fallback.
  const todayUz = formatTodayUzDate();
  const payloadFallback = {
    user_id: uid,
    progress_date: todayUz,
    day_number: safeDay,
    is_completed: true,
    completed_at: new Date().toISOString(),
  };
  res = await sb.from("user_progress").upsert(payloadFallback, {
    onConflict: "user_id,progress_date",
  });
  if (res.error) throw res.error;
}

function showDayCompletedFullscreenOverlay(dayNum) {
  const old = document.getElementById("daily-complete-overlay");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.id = "daily-complete-overlay";
  overlay.className =
    "fixed inset-0 z-[2400] flex items-center justify-center bg-black/85 backdrop-blur-md p-4";
  overlay.innerHTML = `
    <div class="w-full max-w-2xl rounded-3xl border border-emerald-400/45 bg-[linear-gradient(155deg,rgba(16,185,129,0.18),rgba(2,6,23,0.88))] p-7 text-center text-white shadow-[0_0_60px_rgba(16,185,129,0.45)] sm:p-10">
      <p class="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">Bugungi mavzular muvaffaqiyatli tugallandi!</p>
      <p class="mt-5 text-5xl font-black text-emerald-200 drop-shadow-[0_0_16px_rgba(16,185,129,0.8)] sm:text-6xl">DONE ✅</p>
      <p class="mt-3 text-base font-semibold text-emerald-100/95">Day ${Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1))} — Completed</p>
      <p class="mt-4 text-sm text-slate-200">Ertaga yangi mavzular soat 08:00 da ochiladi.</p>
      <p class="mt-2 text-xs text-slate-400">5 soniyadan so‘ng dashboardga qaytasiz.</p>
      <button type="button" data-complete-go-dashboard
        class="dashboard-primary-btn mt-7 inline-flex min-h-[48px] items-center justify-center rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-6 py-3 text-sm font-black uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-500/35">
        Dashboardga qaytish
      </button>
    </div>`;
  document.body.appendChild(overlay);
  const goDashboard = () => window.location.assign("/dashboard");
  overlay.querySelector("[data-complete-go-dashboard]")?.addEventListener("click", goDashboard);
  window.setTimeout(goDashboard, 5000);
}

function ensureSupabase() {
  if (__supabaseClient) return __supabaseClient;
  const url = String(globalThis.APP_CONFIG?.supabaseUrl ?? "").trim().replace(/\/+$/, "");
  const key = String(globalThis.APP_CONFIG?.supabaseAnonKey ?? "").trim();
  if (!url || !key) return null;
  __supabaseClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return __supabaseClient;
}

async function refreshProfileCache(userId) {
  const sb = ensureSupabase();
  if (!sb || !userId) {
    __edunextProfile = null;
    return null;
  }
  const { data, error } = await sb
    .from("profiles")
    .select("first_name,last_name,age,level,study_plan_start_date,current_day")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[profiles]", error.message);
    __edunextProfile = null;
    return null;
  }
  __edunextProfile = data;
  if (String(data?.study_plan_start_date || "").trim()) {
    setPlanStartDate(data.study_plan_start_date);
  }
  try {
    const hasMarker = localStorage.getItem(CURRENT_STUDY_DAY_KEY);
    if (
      (hasMarker == null || String(hasMarker).trim() === "") &&
      data?.current_day != null &&
      data.current_day !== ""
    ) {
      const n = Math.min(30, Math.max(1, Math.floor(Number(data.current_day)) || 1));
      setCurrentStudyDayMarker(n);
    }
  } catch (_) {
    /* ignore */
  }
  return __edunextProfile;
}

/** `profiles.current_day` — joriy kun (yangilash). */
async function persistCurrentStudyDayToSupabase(dayNum) {
  const sb = ensureSupabase();
  const uid = __sbUser?.id;
  if (!sb || !uid) return;
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const { error } = await sb.from("profiles").update({ current_day: d }).eq("id", uid);
  if (error) console.warn("[profiles] current_day", error.message);
  else if (__edunextProfile && typeof __edunextProfile === "object")
    __edunextProfile.current_day = d;
}
globalThis.__edunextPersistCurrentDay = persistCurrentStudyDayToSupabase;

function isProfileComplete(profileRow) {
  if (!profileRow) return false;
  const fn = String(profileRow.first_name ?? "").trim();
  const ln = String(profileRow.last_name ?? "").trim();
  const age = Number(profileRow.age);
  return Boolean(fn && ln && Number.isFinite(age) && age >= 1 && age <= 120);
}

const DIAGNOSTIC_COMPLETE_KEY = "edunext_diagnostic_complete";

function setDiagnosticComplete() {
  localStorage.setItem(DIAGNOSTIC_COMPLETE_KEY, "1");
}

/** profiles.level bo‘sh bo‘lmasa — diagnostika / placement yakunlangan. */
function placementLevelResolved() {
  return Boolean(String(__edunextProfile?.level ?? "").trim());
}

function diagnosticPathMatches() {
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  return p === "/diagnostic";
}

function dashboardWritingPathMatches() {
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  return p === "/dashboard/writing";
}

function dashboardReadingPathMatches() {
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  return p === "/dashboard/reading";
}

function dashboardVocabularyPathMatches() {
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  return p === "/dashboard/vocabulary";
}

let __diagnosticNavGuardInstalled = false;

function syncDiagnosticUrlIfNeeded() {
  if (placementLevelResolved()) return;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/dashboard") {
    window.history.replaceState({ edunextSpa: "diagnostic" }, "", "/diagnostic");
    return;
  }
  if (path !== "/diagnostic") {
    window.history.replaceState({ edunextSpa: "diagnostic" }, "", "/diagnostic");
  }
}

function installDiagnosticNavGuard() {
  if (__diagnosticNavGuardInstalled) return;
  __diagnosticNavGuardInstalled = true;
  window.addEventListener("popstate", () => {
    queueMicrotask(syncDiagnosticUrlIfNeeded);
  });
  document.addEventListener(
    "click",
    (e) => {
      if (placementLevelResolved()) return;
      const a = e.target?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url;
      try {
        url = new URL(href, window.location.origin);
      } catch (_) {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (path !== "/diagnostic") {
        e.preventDefault();
        e.stopPropagation();
        window.history.replaceState({ edunextSpa: "diagnostic" }, "", "/diagnostic");
      }
    },
    true
  );
  syncDiagnosticUrlIfNeeded();
}

/** Yangi diagnostika: eski natijalar + profil (level, reja sanasi) tozalanadi. */
async function resetDiagnosticStateForNewRun() {
  const { resetDiagnosticClientState } = await import("/diagnosticReset.mjs");
  await resetDiagnosticClientState();
  const sb = ensureSupabase();
  const {
    data: { session },
  } = await sb?.auth.getSession() ?? { data: {} };
  if (sb && session?.user?.id) await refreshProfileCache(session.user.id);
}

/** Diagnostika — `/diagnostic` sahifasi (Reading → Writing → Listening → Grammar). */
function beginDiagnosticTestFlow() {
  installDiagnosticNavGuard();
  syncDiagnosticUrlIfNeeded();
  void (async () => {
    try {
      await resetDiagnosticStateForNewRun();
    } catch (e) {
      console.warn("[diagnostic reset]", e);
    }
    window.location.assign("/diagnostic");
  })();
}

function openProfileCompletionModal(user) {
  const modal = document.getElementById("profile-completion-modal");
  if (!modal) return;

  const row = __edunextProfile;
  const metaName = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "").trim();

  const fnEl = document.getElementById("profile-first-name");
  const lnEl = document.getElementById("profile-last-name");
  const agEl = document.getElementById("profile-age");
  const errEl = document.getElementById("pc-form-error");

  if (fnEl) {
    fnEl.value = String(row?.first_name ?? "").trim() || (metaName ? metaName.split(/\s+/)[0] : "");
  }
  if (lnEl) {
    const parts = metaName.split(/\s+/).filter(Boolean);
    lnEl.value = String(row?.last_name ?? "").trim() || (parts.length > 1 ? parts.slice(1).join(" ") : "");
  }
  if (agEl) {
    agEl.value = row?.age != null && Number.isFinite(Number(row.age)) ? String(row.age) : "";
  }
  if (errEl) errEl.textContent = "";

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeProfileCompletionModal() {
  const modal = document.getElementById("profile-completion-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function showPostProfileWelcomeOverlay() {
  const el = document.getElementById("post-profile-welcome-overlay");
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function hidePostProfileWelcomeOverlay() {
  const el = document.getElementById("post-profile-welcome-overlay");
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

const PAYMENT_MODAL_DISMISS_KEY = "edunext_payment_modal_dismiss_session_v1";

function closePaymentModal() {
  const overlay = document.getElementById("payment-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
}

function dismissPaymentModalForSession() {
  try {
    sessionStorage.setItem(PAYMENT_MODAL_DISMISS_KEY, "1");
  } catch (_) {
    /* ignore */
  }
  closePaymentModal();
}

/** `userId` — yashirin maydonda (bot / chek bog‘lashi uchun). */
function showPaymentModal(userId) {
  try {
    if (sessionStorage.getItem(PAYMENT_MODAL_DISMISS_KEY)) return;
  } catch (_) {
    /* ignore */
  }
  const overlay = document.getElementById("payment-overlay");
  if (!overlay) return;
  const uidEl = document.getElementById("payment-modal-user-id");
  if (uidEl) uidEl.value = String(userId ?? "");
  overlay.style.display = "block";
  overlay.setAttribute("aria-hidden", "false");
}

let __paymentModalListenersBound = false;
function setupPaymentModalUIOnce() {
  if (__paymentModalListenersBound) return;
  __paymentModalListenersBound = true;

  const overlay = document.getElementById("payment-overlay");
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) dismissPaymentModalForSession();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const o = document.getElementById("payment-overlay");
    if (!o || o.style.display === "none") return;
    dismissPaymentModalForSession();
  });
}
setupPaymentModalUIOnce();

/** 24 soat + premium tekshiruvi (to‘lov overlay). Tekshirishni boshqa joydan ham chaqirish mumkin. */
const checkAccess = async () => {
  const sb = ensureSupabase();
  if (!sb) return;

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return;

  const { data: profile, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("[checkAccess]", error.message);
    return;
  }
  if (!profile) return;

  if (profile.is_premium) return;

  const regDate = new Date(profile.created_at);
  if (!profile.created_at || Number.isNaN(regDate.getTime())) return;

  const hoursPassed = (Date.now() - regDate.getTime()) / (1000 * 60 * 60);

  if (hoursPassed > 24) {
    showPaymentModal(user.id);
  }
};

function shortCefrLabelFromBand(bandRaw) {
  const t = String(bandRaw ?? "")
    .toUpperCase()
    .match(/\b([ABC][12]|C1)\b/);
  const band = t ? t[1] : "";
  if (band === "A1" || band === "A2") return "Beginner";
  if (band === "B1" || band === "B2") return "Intermediate";
  if (band === "C1") return "Advanced";
  return "Learner";
}

function planTierFromCefrBandString(rawBand) {
  const m = String(rawBand ?? "").match(/\b([ABC][12])\b/i);
  if (!m) return null;
  const band = m[1].toUpperCase();
  if (/^A/.test(band)) return "A2";
  if (band === "B2") return "B2";
  if (/^B/.test(band)) return "B1";
  return "B2";
}

/** Diagnostika AI Writing ballini dashboardda ko‘rsatadi. */
function hydrateDashboardDiagnosticWritingStat() {
  const el = document.getElementById("dashboard-diag-writing-stat");
  if (!el) return;

  let w = null;
  try {
    w = JSON.parse(localStorage.getItem("writingSubmission") || "null");
  } catch (_) {
    w = null;
  }

  let tr = typeof window !== "undefined" ? window.testResults?.writing : null;
  if (tr && typeof tr === "object" && tr.diagnostic) w = tr;
  else if (!w?.diagnostic && tr?.diagnostic) w = tr;

  if (!w || typeof w !== "object" || !w.diagnostic) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }

  const raw = Number(w.aiScore ?? w.score ?? w.structured?.score);
  const maxScore = Number(w.writingScoreMax ?? 5);
  const maxOk = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 5;
  if (!Number.isFinite(raw)) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  const s = Math.min(maxOk, Math.max(1, Math.round(raw)));
  el.textContent = `Oxirgi diagnostika — Writing (AI): ${s}/${maxOk}`;
  el.classList.remove("hidden");
}

function hydrateDashboardGreetingFromProfile() {
  const line = document.getElementById("dashboard-greeting-line");
  if (!line) return;
  const day = getCurrentStudyDayIndex();
  const todayLocked = isTodayLockedForUser(__sbUser?.id);
  const raw = String(__edunextProfile?.first_name ?? "").trim();
  if (raw) {
    const first = raw.split(/\s+/)[0];
    line.textContent = todayLocked
      ? `${first}! Bugun ${day}-o'quv kuni — ✅ Completed`
      : `${first}! Bugun ${day}-o'quv kuni.`;
  } else {
    line.textContent = todayLocked
      ? `Salom! Bugun ${day}-o'quv kuni — ✅ Completed`
      : `Salom! Bugun ${day}-o'quv kuni.`;
  }

  const levelEl = document.getElementById("dashboard-level-display");
  if (levelEl) {
    const lv = String(__edunextProfile?.level ?? "").trim();
    if (lv) {
      levelEl.textContent = `${lv} ${shortCefrLabelFromBand(lv)}`;
    } else {
      levelEl.textContent = "—";
    }
  }

  hydrateDashboardDiagnosticWritingStat();
  renderProgressProfilePanel();
}

function closeDashboardDrawer() {
  const drawer = document.getElementById("dashboard-drawer");
  const backdrop = document.getElementById("dashboard-drawer-backdrop");
  const toggle = document.getElementById("dashboard-nav-toggle");
  drawer?.classList.add("translate-x-full");
  backdrop?.classList.add("hidden", "pointer-events-none", "opacity-0");
  backdrop?.classList.remove("opacity-100");
  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
  }
}

function openDashboardDrawer() {
  const drawer = document.getElementById("dashboard-drawer");
  const backdrop = document.getElementById("dashboard-drawer-backdrop");
  const toggle = document.getElementById("dashboard-nav-toggle");
  drawer?.classList.remove("translate-x-full");
  backdrop?.classList.remove("hidden", "pointer-events-none", "opacity-0");
  backdrop?.classList.add("opacity-100");
  backdrop?.classList.remove("opacity-0");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  void renderProgressProfilePanel();
}

function wireDashboardNavigation() {
  const root = document.getElementById("step-11");
  if (!root || root.dataset.navWired === "1") return;
  root.dataset.navWired = "1";

  document.getElementById("dashboard-nav-toggle")?.addEventListener("click", () => {
    const drawer = document.getElementById("dashboard-drawer");
    if (!drawer?.classList.contains("translate-x-full")) closeDashboardDrawer();
    else openDashboardDrawer();
  });

  document.getElementById("dashboard-drawer-close")?.addEventListener("click", closeDashboardDrawer);

  document.getElementById("dashboard-drawer-backdrop")?.addEventListener("click", closeDashboardDrawer);

  document.getElementById("dashboard-logout-btn")?.addEventListener("click", () => {
    void handleDashboardLogout();
  });
  ensureUserProgressRealtimeSync();

  document.getElementById("dashboard-settings-btn")?.addEventListener("click", () => {
    showProfileSettingsModal();
  });

  document.getElementById("pp-avatar")?.addEventListener("click", () => {
    showProfileSettingsModal();
  });

  document.querySelectorAll("[data-dash-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-dash-nav");
      navigateDashboardLesson(kind);
    });
  });

  document.querySelector(".dashboard-brand-el")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    closeDashboardDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const d = document.getElementById("dashboard-drawer");
    if (d && !d.classList.contains("translate-x-full")) closeDashboardDrawer();
  });
}

/** Grammar testidan keyingi Listening ochilishi uchun (ketma-ket rejim UX). */
function grammarListeningUnlockStorageKey(levelBand, studyDayNum) {
  const lv = String(levelBand || "A2").trim() || "A2";
  const d = Math.min(30, Math.max(1, Math.floor(Number(studyDayNum)) || 1));
  return `edunext_grammar_listening_unlocked:${lv}:${d}`;
}

/** `listening` / `listening_bb_dict` — ListeningDictation kartasi matnli kalitlardan tashqari. */
function findDashboardLessonCard(kind) {
  const k = String(kind || "").trim().toLowerCase();
  const todos = document.getElementById("todo-list");
  if (!todos) return null;
  if (k === "listening" || k === "listening_bb_dict") {
    return (
      todos.querySelector(`[data-task-card-for="listening_bb_dict"]`) ||
      todos.querySelector(`[data-task-card-for="listening"]`)
    );
  }
  if (k === "reading" || k === "timed_reading" || k === "reading_exam") {
    const byKey =
      todos.querySelector(`[data-task-card-for="reading"]`) ||
      todos.querySelector(`[data-task-card-for="timed_reading"]`) ||
      todos.querySelector(`[data-task-card-for="reading_exam"]`);
    if (byKey) return byKey;
    const byMount = todos.querySelector("[data-reading-exam-mount]");
    if (byMount) return byMount.closest(".task-plan-card");
    const byType = Array.from(todos.querySelectorAll(".task-plan-card")).find((card) =>
      String(card?.dataset?.taskType || "")
        .trim()
        .toLowerCase()
        .includes("reading"),
    );
    if (byType) return byType;
    return null;
  }
  if (!/^[a-z0-9_]+$/i.test(k)) return null;
  return todos.querySelector(`[data-task-card-for="${k}"]`);
}

/** Sidebar: «Bugungi reja» jadvalidagi tegishli kartaga skroll + AI Mentor (eski `/diagnostic` testi yo‘q). */
function navigateDashboardLesson(kind) {
  closeDashboardDrawer();
  const k = String(kind || "").trim().toLowerCase();
  if (k === "reading" || k === "timed_reading" || k === "reading_exam") {
    try {
      sessionStorage.setItem("edunext_force_open_reading", "1");
    } catch (_) {
      /* ignore */
    }
  }
  try {
    const section = document.getElementById("dashboard-bugungi-reja-section");
    const todos = document.getElementById("todo-list");
    (section || todos)?.scrollIntoView({ behavior: "smooth", block: "start" });

    window.requestAnimationFrame(() => {
      if (k === "reading" || k === "timed_reading" || k === "reading_exam") {
        document
          .querySelectorAll(
            '#todo-list [data-task-card-for="reading"], #todo-list [data-task-card-for="timed_reading"], #todo-list [data-task-card-for="reading_exam"]',
          )
          .forEach((el) => el.classList.remove("hidden"));
        document
          .querySelectorAll("#todo-list .task-plan-card")
          .forEach((card) => {
            if (
              card.querySelector("[data-reading-exam-mount]") ||
              String(card?.dataset?.taskType || "")
                .trim()
                .toLowerCase()
                .includes("reading")
            ) {
              card.classList.remove("hidden");
            }
          });
      }
      const card = findDashboardLessonCard(k);
      if (card) {
        card.classList.remove("hidden");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("ring-2", "ring-fuchsia-500/40");
        window.setTimeout(() => card.classList.remove("ring-2", "ring-fuchsia-500/40"), 1600);
      } else if (todos) {
        if (k === "reading" || k === "timed_reading" || k === "reading_exam") {
          try {
            generatePersonalPlan(inferEducationPlanTier());
          } catch (_) {
            /* ignore */
          }
        }
        todos.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      focusDashboardMentorForSubject(
        k === "listening" || k === "listening_bb_dict" ? "listening_bb_dict" : k,
      );
    });
  } catch (err) {
    console.warn("[dashboard-nav]", err);
  }
}

function shouldAutoOpenReadingFromUrl() {
  try {
    const u = new URL(window.location.href);
    const v = String(
      u.searchParams.get("openReading") ||
        u.searchParams.get("lesson") ||
        "",
    )
      .trim()
      .toLowerCase();
    return v === "1" || v === "true" || v === "reading";
  } catch (_) {
    return false;
  }
}

function shouldAutoOpenVocabularyFromUrl() {
  try {
    const u = new URL(window.location.href);
    const v = String(
      u.searchParams.get("openVocabulary") ||
        u.searchParams.get("lesson") ||
        "",
    )
      .trim()
      .toLowerCase();
    return v === "1" || v === "true" || v === "vocabulary";
  } catch (_) {
    return false;
  }
}

function shouldAutoOpenVocabularyFromSession() {
  try {
    return sessionStorage.getItem("edunext_open_vocabulary_once") === "1";
  } catch (_) {
    return false;
  }
}

/** Reading yangi tabda emas — shu oynada, shu origin (URL parametri SPA uchun). */
function openReadingInNewWindow() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("openReading", "1");
    u.searchParams.delete("openVocabulary");
    window.history.replaceState({}, "", u.toString());
  } catch (_) {
    /* ignore */
  }
  try {
    sessionStorage.setItem("edunext_force_open_reading", "1");
  } catch (_) {
    /* ignore */
  }
  const step11 = document.getElementById("step-11");
  const dashVisible = Boolean(step11 && !step11.classList.contains("hidden"));
  if (dashVisible) {
    navigateDashboardLesson("reading");
    return;
  }
  try {
    void goToStep11();
  } catch (_) {
    navigateDashboardLesson("reading");
  }
}

function openVocabularyInNewWindow() {
  try {
    sessionStorage.setItem("edunext_open_vocabulary_once", "1");
    window.location.assign("/dashboard/vocabulary");
    return true;
  } catch (_) {
    navigateDashboardLesson("vocabulary");
    return false;
  }
}

function triggerReadingDeepLinkOpenIfNeeded() {
  if (!shouldAutoOpenReadingFromUrl()) return;
  try {
    if (sessionStorage.getItem("edunext_open_reading_handled") === "1") return;
    sessionStorage.setItem("edunext_open_reading_handled", "1");
    sessionStorage.setItem("edunext_force_open_reading", "1");
  } catch (_) {
    /* ignore */
  }
  // Avval dashboardni ko'rsatamiz, keyin reading kartani fokuslaymiz.
  try {
    goToStep11();
  } catch (_) {
    /* ignore */
  }
  setTimeout(() => navigateDashboardLesson("reading"), 260);
  setTimeout(() => navigateDashboardLesson("reading"), 900);
}

function triggerVocabularyDeepLinkOpenIfNeeded() {
  if (!shouldAutoOpenVocabularyFromUrl() && !shouldAutoOpenVocabularyFromSession()) return;

  // Strict 5-bosqichli ketma-ketlik tekshiruvi: Vocabulary eng oxiri.
  // Oldingi bo‘limlar (Grammar → Listening → Writing → Reading) tugamasdan
  // turib Vocabulary deep-link ni hech qachon ochmaymiz — yangi foydalanuvchida
  // eski session/URL flagi tasodifan ishlamasligi uchun darrov tozalaymiz.
  try {
    const day = getCurrentStudyDayIndex();
    const completion = getDaySectionCompletion(day);
    const reachedVocab =
      Boolean(completion.grammar) &&
      (Boolean(completion.listening) || Boolean(completion.listening_bb_dict)) &&
      Boolean(completion.writing) &&
      Boolean(completion.reading);
    if (!reachedVocab) {
      try {
        sessionStorage.removeItem("edunext_open_vocabulary_once");
        sessionStorage.removeItem("edunext_open_vocabulary_handled");
        const u = new URL(window.location.href);
        if (u.searchParams.has("openVocabulary")) {
          u.searchParams.delete("openVocabulary");
          window.history.replaceState({}, "", u.toString());
        }
      } catch (_) {
        /* ignore */
      }
      return;
    }
  } catch (_) {
    /* fallthrough: dastur muvaffaqiyatsiz tekshirsa, eski mantiqdan foydalanamiz */
  }

  try {
    if (sessionStorage.getItem("edunext_open_vocabulary_handled") === "1") return;
    sessionStorage.setItem("edunext_open_vocabulary_handled", "1");
    sessionStorage.removeItem("edunext_open_vocabulary_once");
  } catch (_) {
    /* ignore */
  }
  try {
    goToStep11();
  } catch (_) {
    /* ignore */
  }
  setTimeout(() => navigateDashboardLesson("vocabulary"), 260);
  setTimeout(() => navigateDashboardLesson("vocabulary"), 900);
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Dashboard «Skeleton Loading» va «Init Overlay» — refresh paytida UI sakrab
 * ketmasligi va Supabase ma'lumotlari yuklanguncha qoidaga mos shimmer
 * bloklar ko'rinishi uchun. framer-motion API o'rniga vanilla CSS keyframes
 * (cubic-bezier(.22,1,.36,1)) ishlatamiz — natija visual jihatdan bir xil.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Boshlang'ich overlay'ni silliq yashiradi (ilk render tayyor bo'lganida). */
function hideDashboardInitOverlay() {
  const ov = document.getElementById("dashboard-init-overlay");
  if (!ov) return;
  if (ov.classList.contains("is-hidden")) return;
  ov.classList.add("is-hidden");
  // CSS opacity tugagach DOMdan tezda olib tashlaymiz, foydalanuvchi
  // boshqaruv elementlarini bloklamasligi uchun.
  window.setTimeout(() => {
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }, 600);
}

function showDashboardInitOverlay() {
  const ov = document.getElementById("dashboard-init-overlay");
  if (!ov) return;
  ov.classList.remove("is-hidden");
}

/**
 * localStorage'dan foydalanuvchining hozirgi qadamini sinxron o'qiydi.
 * Sahifa refresh bo'lganda darrov to'g'ri bo'limni («Grammar» yangi
 * foydalanuvchida) tanlash va Vocabulary'ni adashib ochmaslik uchun.
 */
function readDashboardActiveStageFromStorage() {
  try {
    const tier = inferEducationPlanTier();
    if (tier !== "A2" && tier !== "B1") return "grammar";
    const day = getCurrentStudyDayIndex();
    const completion = getDaySectionCompletion(day);
    const grammarUnlocked =
      localStorage.getItem(grammarListeningUnlockStorageKey(tier, day)) === "1";
    if (!completion.grammar && !grammarUnlocked) return "grammar";
    if (!completion.listening_bb_dict && !completion.listening) return "listening";
    if (!completion.writing) return "writing";
    if (!completion.reading) return "reading";
    if (!completion.vocabulary) return "vocabulary";
    return "done";
  } catch (_) {
    return "grammar";
  }
}

const DASHBOARD_SKELETON_STAGE_META = {
  grammar: {
    tagText: "GRAMMAR",
    tagColor: "text-slate-300/90",
    badgeColor: "border-fuchsia-400/45 bg-fuchsia-500/10 text-fuchsia-200",
    height: "min-h-[420px]",
  },
  listening: {
    tagText: "LISTENING",
    tagColor: "text-amber-400/90",
    badgeColor: "border-amber-400/45 bg-amber-500/10 text-amber-200",
    height: "min-h-[360px]",
  },
  writing: {
    tagText: "WRITING",
    tagColor: "text-sky-400/90",
    badgeColor: "border-sky-400/45 bg-sky-500/10 text-sky-200",
    height: "min-h-[420px]",
  },
  reading: {
    tagText: "READING",
    tagColor: "text-emerald-400/90",
    badgeColor: "border-emerald-400/45 bg-emerald-500/10 text-emerald-200",
    height: "min-h-[420px]",
  },
  vocabulary: {
    tagText: "VOCABULARY",
    tagColor: "text-fuchsia-400/90",
    badgeColor: "border-fuchsia-400/45 bg-fuchsia-500/10 text-fuchsia-200",
    height: "min-h-[460px]",
  },
};

/**
 * `#todo-list` ichiga shimmer-skeleton kartochka(lar) joylaydi.
 * Strict 5-bosqichli ketma-ketlikdan kelib chiqib FAQAT joriy bosqich
 * uchun skeleton ko'rsatamiz (chunki keyingi kartalar baribir yashirin).
 * `done` holatida 5 ta skelet birga ko'rinadi.
 */
function renderDashboardLoadingSkeleton() {
  const todoContainer = document.getElementById("todo-list");
  if (!todoContainer) return;
  const stage = readDashboardActiveStageFromStorage();
  const stagesToShow =
    stage === "done"
      ? ["grammar", "listening", "writing", "reading", "vocabulary"]
      : [stage];

  todoContainer.replaceChildren();
  todoContainer.setAttribute("data-skeleton-active", "1");

  stagesToShow.forEach((stKey) => {
    const meta =
      DASHBOARD_SKELETON_STAGE_META[stKey] ||
      DASHBOARD_SKELETON_STAGE_META.grammar;
    const card = document.createElement("div");
    card.className = `dashboard-skeleton-card ${meta.height}`;
    card.setAttribute("data-skeleton-card", stKey);
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-2">
          <span class="text-[10px] font-bold uppercase tracking-widest ${meta.tagColor}">
            ${meta.tagText}
          </span>
          <div class="dashboard-skeleton-shimmer h-5 w-48 sm:w-64"></div>
        </div>
        <span class="shrink-0 rounded-md border ${meta.badgeColor} px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em]">
          Yuklanmoqda…
        </span>
      </div>
      <div class="dashboard-skeleton-shimmer h-3 w-3/4"></div>
      <div class="dashboard-skeleton-shimmer h-3 w-2/3"></div>
      <div class="mt-2 grid gap-3 sm:grid-cols-2">
        <div class="dashboard-skeleton-shimmer h-20"></div>
        <div class="dashboard-skeleton-shimmer h-20"></div>
      </div>
      <div class="dashboard-skeleton-shimmer h-32 w-full rounded-xl"></div>
      <div class="mt-2 flex items-center justify-between gap-3">
        <div class="dashboard-skeleton-shimmer h-3 w-1/2"></div>
        <div class="dashboard-skeleton-shimmer h-8 w-32 rounded-lg"></div>
      </div>
    `;
    todoContainer.appendChild(card);
  });
}

/**
 * `generatePersonalPlan` qayta render qilinishidan oldin skeleton flagini
 * tozalaydi — keyin yangi kartalar fade-in animatsiyasi bilan paydo bo'ladi.
 */
function clearDashboardSkeletonFlag() {
  const todoContainer = document.getElementById("todo-list");
  if (todoContainer) todoContainer.removeAttribute("data-skeleton-active");
}

function focusDashboardMentorForSubject(kind) {
  const k = String(kind || "").toLowerCase();
  document.getElementById("dashboard-mentor-panel")?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
  const input = document.getElementById("step11-ai-input");
  if (k === "writing" && inferEducationPlanTier() === "A2") {
    activateMentorA2WritingAssist();
    return;
  }
  globalThis.__edunextWritingReviewA2 = false;
  if (input) {
    if (k === "listening_bb_dict" || k === "listening") {
      input.placeholder =
        "BBC Listening / diktat bo‘yicha ingliz tilida savol yuboring...";
    } else input.placeholder = "Savol so'rash...";
    input.focus();
  }
}

const DAY1_MENTOR_KICKOFF_UZ =
  "Salom! Bugun 1-kun — Writing savoli va boshqa bo'limlar bo'yicha ingliz tilida yordam beraman.";

/** Mentor suhbati birinchi model xabari (Dashboard). */
const STEP11_MENTOR_OPENING_GREETING =
  "Assalomu alaykum! Men Dashboard AI mentoringizman — Writing, Grammar va boshqa bo'limlar bo'yicha savollaringizga yordam beraman.";

/** A2, 1-kun: birinchi "AI Mentor" bosishida avtomatik boshlash xabari. */
async function maybeSendDayOneMentorKickoff() {
  if (inferEducationPlanTier() !== "A2") return;
  if (getCurrentStudyDayIndex() !== 1) return;
  if (sessionStorage.getItem("edunext_day1_mentor_kickoff") === "1") return;
  sessionStorage.setItem("edunext_day1_mentor_kickoff", "1");
  await postStep11MentorMessage(DAY1_MENTOR_KICKOFF_UZ);
}

/** PDF faqat yangi oynada — mahalliy yo‘l (studyPlan). */
function resolvePdfLinkForTaskType(typeStr) {
  const t = String(typeStr || "").trim().toLowerCase();
  if (t === "grammar") return A2_B1_STUDY_META.workplacePdfPath || "/pdfs/grammar_a1_a2.pdf.pdf";
  if (t === "reading") return A2_B1_STUDY_META.readingPdfPath || "/pdfs/reading_a2.pdf";
  return "";
}

function pdfDownloadBasename(href) {
  try {
    const clean = String(href || "").split("#")[0];
    const seg = clean.split("/").filter(Boolean).pop() || "document.pdf";
    return seg.endsWith(".pdf") ? seg : `${seg}.pdf`;
  } catch (_) {
    return "document.pdf";
  }
}

/** Telefon: yuklab olish; kompyuter: yangi tab. */
function userPrefersMobilePdfFlow() {
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(max-width: 768px)").matches) return true;
    if (window.matchMedia("(pointer: coarse)").matches) return true;
  }
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || ""
  );
}

function openKitobPdfSmart(href, options = {}) {
  const url = String(href || "").trim();
  if (!url) return;
  const name = String(options.downloadName || pdfDownloadBasename(url));
  if (userPrefersMobilePdfFlow()) {
    const go = window.confirm(
      "Mobil qurilma: PDF faylni yuklab olish tavsiya etiladi. \"OK\" — yuklab olish, \"Bekor qilish\" — brauzerda ochish."
    );
    if (go) {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function render30DayOutline(level) {
  const wrap = document.getElementById("dashboard-30day-outline");
  const ol = document.getElementById("dashboard-30day-ol");
  if (!wrap || !ol) return;
  if (level !== "A2") {
    wrap.classList.add("hidden");
    ol.replaceChildren();
    return;
  }
  wrap.classList.remove("hidden");
  ol.replaceChildren();
  const current = getCurrentStudyDayIndex();
  const todayLocked = isTodayLockedForUser(__sbUser?.id);
  for (let d = 1; d <= 30; d++) {
    const li = document.createElement("li");
    li.className = d === current ? "font-semibold text-fuchsia-300" : "text-slate-500";
    const summary = getA2DayOutlineLabel(d);
    const suffix = d === current ? " · bugun" : "";
    const completeSuffix = d === current && todayLocked ? " · ✅ Completed" : "";
    if (d === current && todayLocked) li.className = "font-semibold text-emerald-300";
    li.textContent = `Kun ${d} — ${summary}${suffix}${completeSuffix}`;
    ol.appendChild(li);
  }
}

window.closeDashboardDrawer = closeDashboardDrawer;
window.navigateDashboardLesson = navigateDashboardLesson;

function showAuthGate() {
  const g = document.getElementById("auth-gate");
  if (g) {
    g.classList.remove("hidden");
    g.setAttribute("aria-hidden", "false");
  }
  // Auth ekrani ko'rinsa, ilk yuklash overlay'ini darrov yashiramiz
  // (foydalanuvchi login formasini ko'rishi kerak).
  if (typeof hideDashboardInitOverlay === "function") {
    hideDashboardInitOverlay();
  }
}

function hideAuthGate() {
  const g = document.getElementById("auth-gate");
  if (g) {
    g.classList.add("hidden");
    g.setAttribute("aria-hidden", "true");
  }
}

/** Chiqish: Supabase sessiyasi, localStorage tozalash, bosh sahifa (onboarding kirish yo‘li). */
async function handleDashboardLogout() {
  closeDashboardDrawer();
  const sb = ensureSupabase();
  try {
    if (sb) await sb.auth.signOut();
  } catch (e) {
    console.warn("[logout]", e);
  }
  try {
    localStorage.clear();
  } catch (_) {
    /* ignore */
  }
  window.location.assign("/");
}

window.handleDashboardLogout = handleDashboardLogout;

function setAuthGateConfigError(message) {
  const el = document.getElementById("auth-config-error");
  if (!el) return;
  const m = String(message ?? "").trim();
  if (!m) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = m;
  el.classList.remove("hidden");
}

/** Login / Ro‘yxatdan o‘tish tablari */
function setAuthTab(mode) {
  const loginTab = document.getElementById("auth-tab-login");
  const signupTab = document.getElementById("auth-tab-signup");
  const loginForm = document.getElementById("auth-form-login");
  const signupForm = document.getElementById("auth-form-signup");
  const err = document.getElementById("auth-form-error");
  if (err) err.textContent = "";

  const active =
    "rounded-lg py-2 text-[0.8125rem] font-bold text-white transition sm:rounded-xl sm:py-2.5 sm:text-sm md:py-3 bg-gradient-to-r from-fuchsia-600 to-purple-600 shadow-lg shadow-fuchsia-500/20";
  const idle =
    "rounded-lg py-2 text-[0.8125rem] font-bold text-slate-400 transition hover:text-white sm:rounded-xl sm:py-2.5 sm:text-sm md:py-3";

  if (mode === "signup") {
    loginTab?.setAttribute("aria-selected", "false");
    signupTab?.setAttribute("aria-selected", "true");
    if (loginTab) loginTab.className = `auth-tab flex-1 ${idle}`;
    if (signupTab) signupTab.className = `auth-tab flex-1 ${active}`;
    loginForm?.classList.add("hidden");
    signupForm?.classList.remove("hidden");
  } else {
    loginTab?.setAttribute("aria-selected", "true");
    signupTab?.setAttribute("aria-selected", "false");
    if (loginTab) loginTab.className = `auth-tab flex-1 ${active}`;
    if (signupTab) signupTab.className = `auth-tab flex-1 ${idle}`;
    signupForm?.classList.add("hidden");
    loginForm?.classList.remove("hidden");
  }
}

/** Backend manzili (.env PUBLIC_API_BASE_URL va /config.client.js — deployment). */
function apiUrl(pathStr) {
  let p = String(pathStr ?? "").trim();
  if (!p.startsWith("/")) p = "/" + p;
  const raw =
    typeof globalThis.APP_CONFIG?.apiBase === "string"
      ? globalThis.APP_CONFIG.apiBase.trim().replace(/\/+$/, "")
      : "";
  if (!raw) return p;
  /* PUBLIC_API_BASE_URL ba'zan `http://localhost:5000/dashboard` bo‘lib qoladi → /dashboard/api/... 404 */
  const FRONT_PATHS = new Set([
    "/",
    "/dashboard",
    "/dashboard/writing",
    "/dashboard/reading",
    "/dashboard/vocabulary",
    "/app",
    "/login",
    "/register",
  ]);
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withProto);
    const pn = (u.pathname || "").replace(/\/+$/, "") || "/";
    const isSpaPath = FRONT_PATHS.has(pn) || /\.html$/i.test(pn);
    const apiPrefix = isSpaPath ? "" : pn;
    return `${u.origin}${apiPrefix}${p}`;
  } catch (_) {
    return `${raw}${p}`;
  }
}
if (typeof window !== "undefined" && typeof window.apiUrl !== "function") {
  window.apiUrl = apiUrl;
}

/** Har safar bosqich o'zgarganda chaqirish — qayta kirganda tiklash uchun */
function saveCurrentStep(stepId) {
  localStorage.setItem("edunext_current_step", stepId);
  localStorage.setItem("activeStep", String(stepId));
}

window.saveCurrentStep = saveCurrentStep;

/** Imtihon bo'limlari yig'ilmasi (localStorage bilan sinxron). */
window.testResults = {
  grammar: null,
  reading: null,
  writing: null,
  listening: { part3: null, part5: null, part6: null },
};

const LISTENING_SCORE_MAX = 18;

function persistTestResults() {
  try {
    localStorage.setItem("edunext_test_results", JSON.stringify(window.testResults));
  } catch (_) {
    /* ignore */
  }
}

function loadTestResultsFromStorage() {
  try {
    const raw = localStorage.getItem("edunext_test_results");
    if (!raw) return;
    const j = JSON.parse(raw);
    if (j && typeof j === "object") {
      if (j.grammar) window.testResults.grammar = j.grammar;
      if (j.reading) window.testResults.reading = j.reading;
      if (j.writing) window.testResults.writing = j.writing;
      if (j.listening && typeof j.listening === "object")
        window.testResults.listening = { ...window.testResults.listening, ...j.listening };
    }
  } catch (_) {
    /* ignore */
  }
}

function restartTest() {
  localStorage.removeItem("edunext_current_step");
  localStorage.removeItem("activeStep");
  localStorage.removeItem("edunext_test_results");
  localStorage.removeItem(DIAGNOSTIC_COMPLETE_KEY);
  clearAllInputDraftKeysFromLocalStorage();
  window.location.reload();
}

window.restartTest = restartTest;

const INPUT_DRAFT_PREFIX = "input_";

function draftStorageKeyForElementId(id) {
  return `${INPUT_DRAFT_PREFIX}${id}`;
}

function clearAllInputDraftKeysFromLocalStorage() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(INPUT_DRAFT_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch (_) {
    /* ignore */
  }
}

function persistDraftFromField(el) {
  if (!el || !el.id) return;
  const key = draftStorageKeyForElementId(el.id);
  const tag = el.tagName;
  if (tag === "TEXTAREA") {
    localStorage.setItem(key, el.value);
    return;
  }
  if (tag === "SELECT") {
    localStorage.setItem(key, el.value);
    return;
  }
  if (tag !== "INPUT") return;
  const t = String(el.type || "text").toLowerCase();
  if (t === "password" || t === "file" || t === "hidden" || t === "button" || t === "submit" || t === "reset") return;
  if (t === "checkbox" || t === "radio") {
    localStorage.setItem(key, el.checked ? "1" : "");
    return;
  }
  localStorage.setItem(key, el.value);
}

function restoreDraftInputsFromLocalStorage(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("input[id], textarea[id], select[id]").forEach((el) => {
    const raw = localStorage.getItem(draftStorageKeyForElementId(el.id));
    if (raw == null) return;
    if (el.tagName === "INPUT") {
      const t = String(el.type || "text").toLowerCase();
      if (t === "password" || t === "file" || t === "hidden") return;
      if (t === "checkbox" || t === "radio") el.checked = raw === "1" || raw === "true";
      else el.value = raw;
    } else if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      el.value = raw;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

document.addEventListener(
  "input",
  (e) => {
    const el = e.target;
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return;
    persistDraftFromField(el);
  },
  true
);

document.addEventListener(
  "change",
  (e) => {
    const el = e.target;
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "SELECT")) return;
    persistDraftFromField(el);
  },
  true
);

document.addEventListener("DOMContentLoaded", () => {
  restoreDraftInputsFromLocalStorage(document);
  triggerReadingDeepLinkOpenIfNeeded();
  triggerVocabularyDeepLinkOpenIfNeeded();
  // Xavfsizlik chorasi: agar biron-bir flow `hideDashboardInitOverlay`
  // chaqira olmasa, 6 soniyadan keyin overlay baribir yashirinadi —
  // foydalanuvchi spinner ostida muzlab qolmasin.
  window.setTimeout(() => {
    try {
      hideDashboardInitOverlay();
    } catch (_) {
      /* ignore */
    }
  }, 6000);
});

/** Barcha step-section bloklarini yashirish */
function hideAllStepSections() {
  document.querySelectorAll(".step-section").forEach((section) => {
    section.classList.add("hidden");
  });
}

function hideOnboardingFlow() {
  const ob = document.getElementById("onboarding");
  if (!ob) return;
  ob.classList.add("hidden");
  ob.style.display = "none";
}

function showOnboardingFlow() {
  const ob = document.getElementById("onboarding");
  if (!ob) return;
  ob.classList.remove("hidden");
  ob.style.display = "flex";
  // Onboarding (intro / placement) ko'rinsa init overlay'ni yashiramiz.
  if (typeof hideDashboardInitOverlay === "function") {
    hideDashboardInitOverlay();
  }
}

function resetOnboardingInnerStyles() {
  ["step-1", "step-2"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("opacity-0", "pointer-events-none");
  });
}

function normalizeSavedStepId(rawStep) {
  if (rawStep == null) return null;
  const v = String(rawStep).trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return `step-${v}`;
  return v;
}

/** Index.html ichidagi eski Reading/Writing/Listening oqimi — tiklanmaydi. */
const LEGACY_INLINE_TEST_STEPS = new Set([
  "step-6",
  "step-7",
  "step-8",
  "step-9",
  "step-9-final-dashboard",
  "step-10",
  "writing-section",
  "reading-result-screen",
  "step-8-p3",
  "step-8-p5",
  "step-8-part6",
]);

/** Eski test bosqichi saqlangan bo‘lsa — joyni tozalab, diagnostika/UI aralashuvini oldini oladi. */
function clearLegacyInlineTestStepPointers() {
  try {
    const savedStep = normalizeSavedStepId(
      localStorage.getItem("edunext_current_step") ?? localStorage.getItem("activeStep")
    );
    if (!savedStep) return;
    const legacy =
      LEGACY_INLINE_TEST_STEPS.has(savedStep) ||
      savedStep.startsWith("step-9") ||
      savedStep.startsWith("step-9-");
    if (!legacy) return;
    localStorage.removeItem("edunext_current_step");
    localStorage.removeItem("activeStep");
  } catch (_) {
    /* ignore */
  }
}

function deriveReadingResultColor(levelResultStr) {
  const s = String(levelResultStr || "").toLowerCase();
  if (s.includes("advanced")) return "text-green-400";
  if (s.includes("intermediate")) return "text-fuchsia-400";
  return "text-blue-400";
}

/**
 * localStorage dagi bosqichga qaytadi. Sessiya bor: kirgan bo'lsa va saqlangan step step-1 bo'lsa
 * onboardingni tiklamaymiz — keyingi qadamga o‘tkaziladi.
 */
function tryRestoreSavedStepFromLocalStorage(hasSessionUser) {
  clearLegacyInlineTestStepPointers();

  const savedStep = normalizeSavedStepId(
    localStorage.getItem("edunext_current_step") ?? localStorage.getItem("activeStep")
  );
  if (!savedStep) return false;

  if (["step-3", "step-4", "step-5"].includes(savedStep)) {
    if (hasSessionUser) queueMicrotask(() => window.location.assign("/diagnostic"));
    return false;
  }

  if (hasSessionUser && savedStep === "step-11" && !placementLevelResolved()) {
    return false;
  }

  if (hasSessionUser && savedStep === "step-1") {
    return false;
  }

  const sbGate = ensureSupabase();
  if (!hasSessionUser && sbGate && savedStep === "step-11") {
    return false;
  }

  hideAllStepSections();
  resetOnboardingInnerStyles();

  const onboardingStepIds = new Set(["step-1", "step-2"]);

  const targetId = savedStep;
  const currentSection = document.getElementById(targetId);

  if (onboardingStepIds.has(savedStep)) {
    showOnboardingFlow();
  } else {
    hideOnboardingFlow();
  }

  if (!currentSection) return false;

  currentSection.classList.remove("hidden");
  currentSection.classList.add("flex");

  if (savedStep === "step-11") {
    hideOnboardingFlow();
    // localStorage'dan joriy bosqich darrov o'qiladi va mos skeleton joylanadi
    // — refresh paytida UI sakramaydi va Vocabulary adashib ochilmaydi.
    renderDashboardLoadingSkeleton();
    requestAnimationFrame(() => {
      void (async () => {
        await syncWeek1ListeningProgressFromSupabase();
        hydrateDashboardGreetingFromProfile();
        generatePersonalPlan(inferEducationPlanTier());
        hideDashboardInitOverlay();
        initStep11Todos();
        void bootstrapStep11ChatIfNeeded();
      })();
    });
  } else {
    // Boshqa step (onboarding, results va h.k.) tiklangan: overlay'ni darrov yashiramiz.
    hideDashboardInitOverlay();
  }

  return true;
}

async function applyAuthRouting(session) {
  const user = session?.user ?? null;
  if (!user) {
    __sbUser = null;
    __edunextProfile = null;
    closePaymentModal();
    closeProfileCompletionModal();
    document.body.style.overflow = "";
    document.getElementById("step-11")?.classList.add("hidden");
    showAuthGate();
    hideOnboardingFlow();
    setAuthGateConfigError("");
    return;
  }

  hideAuthGate();
  setAuthGateConfigError("");
  const authErr = document.getElementById("auth-form-error");
  if (authErr) authErr.textContent = "";

  __sbUser = user;
  await refreshProfileCache(user.id);
  hydrateDashboardGreetingFromProfile();

  if (!isProfileComplete(__edunextProfile)) {
    hideDashboardInitOverlay();
    openProfileCompletionModal(user);
    return;
  }

  closeProfileCompletionModal();

  if (!placementLevelResolved()) {
    hideDashboardInitOverlay();
    installDiagnosticNavGuard();
    syncDiagnosticUrlIfNeeded();
    beginDiagnosticTestFlow();
    return;
  }

  const restored = tryRestoreSavedStepFromLocalStorage(true);
  if (!restored) {
    goToStep11();
  }
  void checkAccess();
}

async function bootstrapSupabaseAuth() {
  const sb = ensureSupabase();
  if (!sb) {
    showAuthGate();
    hideOnboardingFlow();
    setAuthGateConfigError(
      "Supabase sozlanmagan. server .env faylida SUPABASE_URL va SUPABASE_ANON_KEY ni to‘ldiring va serverni qayta ishga tushiring."
    );
    return;
  }
  setAuthGateConfigError("");
  const {
    data: { session },
  } = await sb.auth.getSession();
  await applyAuthRouting(session);

  sb.auth.onAuthStateChange(async (_evt, sess) => {
    await applyAuthRouting(sess);
  });
}

window.addEventListener("load", () => {
  clearLegacyInlineTestStepPointers();
  loadTestResultsFromStorage();
  restoreDraftInputsFromLocalStorage(document);
});

window.tryRestoreSavedStepFromLocalStorage = tryRestoreSavedStepFromLocalStorage;

// Elementlarni olish
const finishOnboardingBtn = document.getElementById("finish-onboarding");
const skillBtn = document.getElementById("skill-btn");

// Step 1 dan Step 2 ga o'tish
function showStep2() {
  showOnboardingFlow();
  const s1 = document.getElementById("step-1");
  const s2 = document.getElementById("step-2");
  if (!s1 || !s2) return;

  s1.classList.add("opacity-0", "pointer-events-none");
  
  setTimeout(() => {
    s1.classList.add("hidden");
    s2.classList.remove("hidden");
    s2.classList.add("flex");
    saveCurrentStep("step-2");
  }, 500);
}

purgeLegacyStandaloneChatStorage();
bootstrapSupabaseAuth();
wireDashboardNavigation();

document.getElementById("auth-tab-login")?.addEventListener("click", () => setAuthTab("login"));
document.getElementById("auth-tab-signup")?.addEventListener("click", () => setAuthTab("signup"));

document.getElementById("auth-form-login")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("auth-form-error");
  if (errEl) errEl.textContent = "";
  const sb = ensureSupabase();
  if (!sb) {
    if (errEl) errEl.textContent = "Supabase sozlanmagan.";
    return;
  }
  const email = String(document.getElementById("auth-email-login")?.value ?? "").trim();
  const password = String(document.getElementById("auth-password-login")?.value ?? "");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (errEl) errEl.textContent = error.message || "Kirish muvaffaqiyatsiz.";
    return;
  }
});

document.getElementById("auth-form-signup")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("auth-form-error");
  if (errEl) errEl.textContent = "";
  const sb = ensureSupabase();
  if (!sb) {
    if (errEl) errEl.textContent = "Supabase sozlanmagan.";
    return;
  }
  const email = String(document.getElementById("auth-email-signup")?.value ?? "").trim();
  const password = String(document.getElementById("auth-password-signup")?.value ?? "");
  const password2 = String(document.getElementById("auth-password-signup-2")?.value ?? "");
  if (password.length < 6) {
    if (errEl) errEl.textContent = "Parol kamida 6 belgi bo‘lsin.";
    return;
  }
  if (password !== password2) {
    if (errEl) errEl.textContent = "Parollar mos kelmayapti.";
    return;
  }
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) {
    if (errEl) errEl.textContent = error.message || "Ro‘yxatdan o‘tishda xato.";
    return;
  }
  if (data.session) {
    /* Sessiya darhol — onAuthStateChange marshrutni yangilaydi. */
    return;
  }
  if (errEl) {
    errEl.textContent =
      "Hisob yaratildi. Agar email tasdiqlash yoqilgan bo‘lsa, pochtangizdagi havolani bosing, so‘ng qayta kiring.";
  }
});

document.getElementById("profile-completion-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("pc-form-error");
  if (errEl) errEl.textContent = "";
  const sb = ensureSupabase();
  if (!sb) {
    if (errEl) errEl.textContent = "Supabase sozlanmagan.";
    return;
  }
  const { data: wrap } = await sb.auth.getSession();
  const uid = wrap?.session?.user?.id;
  if (!uid) {
    if (errEl) errEl.textContent = "Sessiya topilmadi.";
    return;
  }
  const first_name = String(document.getElementById("profile-first-name")?.value ?? "").trim();
  const last_name = String(document.getElementById("profile-last-name")?.value ?? "").trim();
  const age = Number(String(document.getElementById("profile-age")?.value ?? "").trim());
  if (!first_name || !last_name) {
    if (errEl) errEl.textContent = "Ism va familiyani kiriting.";
    return;
  }
  if (!Number.isFinite(age) || age < 1 || age > 120) {
    if (errEl) errEl.textContent = "Yosh 1–120 orasida bo'lishi kerak.";
    return;
  }

  const data = {
    id: uid,
    first_name,
    last_name,
    age,
    current_day: getCurrentStudyDayIndex(),
  };

  const { error } = await sb.from("profiles").upsert(data, { onConflict: "id" });
  if (error) {
    const msg = error.message || "Saqlashda xato.";
    if (errEl) errEl.textContent = msg;
    alert(msg);
    return;
  }

  await refreshProfileCache(uid);
  closeProfileCompletionModal();
  try {
    sessionStorage.removeItem("edunext_diagnostic_session_v2");
    sessionStorage.removeItem("edunext_diag_in_progress");
  } catch (_) {
    /* ignore */
  }
  showPostProfileWelcomeOverlay();
});

document.getElementById("post-profile-continue-btn")?.addEventListener("click", () => {
  hidePostProfileWelcomeOverlay();
  installDiagnosticNavGuard();
  beginDiagnosticTestFlow();
});

/** Eski onboarding: diagnostika endi faqat /diagnostic sahifasida. */
if (finishOnboardingBtn) {
  finishOnboardingBtn.onclick = () => {
    window.location.assign("/diagnostic");
  };
}

// Skill tanlash effekti
if (skillBtn) {
  skillBtn.onclick = function () {
    this.classList.toggle("bg-fuchsia-500");
    this.classList.toggle("border-fuchsia-400");
    this.classList.toggle("text-white");
  };
}

// Reading uchun test ma'lumotlari
const readingData = [
  // --- LEVEL A1 (Beginner) ---
  {
    level: "A1",
    text: "Akmal is a student in Tashkent. He wakes up at 7:00 AM every day. He has a small breakfast and goes to university by bus. He loves studying English because he wants to travel to London in the future. In the evening, he meets his friends in the park.",
    q: "What is Akmal's main reason for learning English?",
    a: ["To find a job in Tashkent", "To travel to London", "To meet friends in the park", "To wake up early"],
    correct: 1
  },
  {
    level: "A1",
    text: "My city is very beautiful in spring. There are many flowers and green trees everywhere. People like to walk outside and take photos. The weather is usually warm, but sometimes it rains. I feel very happy when the sun shines brightly.",
    q: "Choose the best word for the city in spring:",
    a: ["Cold", "Quiet", "Beautiful", "Dark"],
    correct: 2
  },

  // --- LEVEL A2 (Elementary) ---
  {
    level: "A2",
    text: "Many people think that healthy food is expensive. However, buying fresh vegetables and fruits from local markets can be cheap. Cooking at home is better than eating fast food. It helps you save money and stay fit. If you practice every day, you will become a great cook.",
    q: "According to the text, how can you save money?",
    a: ["By eating fast food", "By going to expensive restaurants", "By cooking at home", "By buying only fruits"],
    correct: 2
  },
  {
    level: "A2",
    text: "Technology is changing our lives very fast. Nowadays, most students use tablets instead of heavy books. Online lessons are very popular because you can learn from home. But, it is important to take breaks and rest your eyes after using a computer for a long time.",
    q: "Why are online lessons popular?",
    a: ["Because books are heavy", "Because you can learn from home", "Because tablets are expensive", "Because eyes need rest"],
    correct: 1
  },

  // --- LEVEL B1 (Intermediate) ---
  {
    level: "B1",
    text: "The internet has transformed the way we communicate, but it has also created new challenges. While social media allows us to stay connected with relatives, it can sometimes lead to a lack of real-life interaction. People often spend hours scrolling through newsfeeds instead of having meaningful conversations with those around them.",
    q: "What is the main concern mentioned about social media?",
    a: ["It is difficult to stay connected", "It costs too much money", "It reduces real-life interaction", "It provides too much news"],
    correct: 2
  },
  {
    level: "B1",
    text: "Working in a team requires flexibility and patience. Each member has different skills and opinions. When a conflict arises, it is essential to listen to everyone before making a decision. Successful teams are those that value collaboration over individual success.",
    q: "Which word best describes the requirement for a successful team?",
    a: ["Competition", "Collaboration", "Patience only", "Individualism"],
    correct: 1
  },

  // --- LEVEL B2 (Upper-Intermediate) ---
  {
    level: "B2",
    text: "Environmental conservation is no longer an option; it is a necessity. Global temperatures are rising due to increased carbon emissions, leading to extreme weather patterns. Governments must implement stricter regulations on factories, but individuals also play a crucial role by reducing waste and adopting sustainable habits.",
    q: "What does the author suggest about environmental protection?",
    a: ["Only governments are responsible", "Individual actions do not matter", "Both governments and individuals must act", "Factories should not be regulated"],
    correct: 2
  },
  {
    level: "B2",
    text: "The architectural style of the 21st century emphasizes functionality and minimalism. Modern buildings often feature large glass windows to maximize natural light, reducing the need for artificial heating. This shift reflects a broader trend towards eco-friendly urban planning and aesthetic simplicity.",
    q: "What is the primary goal of using large glass windows in modern architecture?",
    a: ["To make buildings look more expensive", "To maximize natural light and save energy", "To hide the interior of the building", "To replace traditional art"],
    correct: 1
  },

  // --- LEVEL C1 (Advanced) ---
  {
    level: "C1",
    text: "The psychological phenomenon known as 'cognitive dissonance' occurs when an individual holds two conflicting beliefs simultaneously. This mental discomfort often motivates people to alter their perceptions or justify their actions to restore internal consistency. Understanding this concept is pivotal for analyzing consumer behavior and decision-making processes in high-pressure environments.",
    q: "In this context, what is the typical result of cognitive dissonance?",
    a: ["A permanent state of mental confusion", "A complete loss of belief systems", "An effort to change perceptions to achieve consistency", "A refusal to make any future decisions"],
    correct: 2
  },
  {
    level: "C1",
    text: "The rapid evolution of artificial intelligence has sparked an intense debate regarding ethical boundaries. Proponents argue that AI can solve complex global issues, from climate change to disease eradication. Conversely, skeptics warn of potential job displacement and the loss of human agency. Striking a balance between innovation and regulation remains the most significant challenge for policymakers today.",
    q: "Which phrase best summarizes the central theme of the passage?",
    a: ["The technical process of AI development", "The economic benefits of automation", "The ethical dilemma between AI progress and risks", "The history of climate change solutions"],
    correct: 2
  }
];

let currentReadingIdx = 0;
let readingTime = 600; // 10 daqiqa
let readingScore = 0;
let selectedReadingOption = null;
let readingTimerInterval = null;

function startReadingSection() {
  const ob = document.getElementById("onboarding");
  if (ob) {
    ob.classList.add("hidden");
    ob.style.display = "none";
  }

  ["step-1", "step-2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });

  const step6 = document.getElementById("step-6");
  if (!step6) return;
  step6.classList.remove("hidden");
  step6.classList.add("flex");
  saveCurrentStep("step-6");
  const resultScreen = document.getElementById("reading-result-screen");
  if (resultScreen) resultScreen.classList.add("hidden");

  currentReadingIdx = 0;
  readingScore = 0;
  selectedReadingOption = null;
  readingTime = 600;

  loadReadingContent();
  startReadingTimer();
}

function loadReadingContent() {
  const data = readingData[currentReadingIdx];
  if (!data) return;

  document.getElementById('passage-title').innerText = `Level: ${data.level}`;
  document.getElementById('passage-text').innerText = data.text;
  document.getElementById('reading-question').innerText = data.q;
  document.getElementById('q-counter').innerText = `Savol: ${currentReadingIdx + 1}/${readingData.length}`;

  const optionsContainer = document.getElementById('reading-options');
  optionsContainer.innerHTML = '';
  selectedReadingOption = null;
  const nextBtn = document.getElementById("next-reading-btn");
  if (nextBtn) {
    nextBtn.disabled = true;
    const isLast = currentReadingIdx === readingData.length - 1;
    nextBtn.innerHTML = isLast
      ? 'Finish Reading <i class="fas fa-flag-checkered ml-2"></i>'
      : 'Keyingi Savol <i class="fas fa-chevron-right ml-2"></i>';
  }

  data.a.forEach((opt, index) => {
      const btn = document.createElement('button');
      btn.className = "w-full p-4 rounded-xl bg-white/5 border border-white/10 text-white text-left hover:bg-white/10 transition-all duration-300";
      btn.innerText = opt;
      btn.onclick = () => {
          document.querySelectorAll('#reading-options button').forEach((b) => {
            b.classList.remove("bg-fuchsia-500", "border-fuchsia-400");
            b.classList.add("bg-white/5", "border-white/10");
          });

          btn.classList.remove("bg-white/5", "border-white/10");
          btn.classList.add("bg-fuchsia-500", "border-fuchsia-400");
          selectedReadingOption = index;
          if (nextBtn) nextBtn.disabled = false;
      };
      optionsContainer.appendChild(btn);
  });
}

function startReadingTimer() {
  const timerEl = document.getElementById('reading-timer');
  if (!timerEl) return;

  if (readingTimerInterval) {
    clearInterval(readingTimerInterval);
  }

  timerEl.innerText = "10:00";
  readingTimerInterval = setInterval(() => {
      readingTime--;
      let m = Math.floor(readingTime / 60);
      let s = readingTime % 60;
      timerEl.innerText = `${m}:${s < 10 ? '0' + s : s}`;
      if(readingTime <= 0) {
          clearInterval(readingTimerInterval);
          readingTimerInterval = null;
          finishReading();
      }
  }, 1000);
}

function finishReading() {
  if (readingTimerInterval) {
    clearInterval(readingTimerInterval);
    readingTimerInterval = null;
  }

  document.getElementById("step-6")?.classList.add("hidden");

  let levelResult = "";
  let colorClass = "";

  if (readingScore <= 3) {
    levelResult = "A1 / A2 (Beginner)";
    colorClass = "text-blue-400";
  } else if (readingScore <= 7) {
    levelResult = "B1 / B2 (Intermediate)";
    colorClass = "text-fuchsia-400";
  } else {
    levelResult = "C1 (Advanced)";
    colorClass = "text-green-400";
  }

  const readingResults = {
    total: readingData.length,
    correct: readingScore,
    percent: Math.round((readingScore / readingData.length) * 100),
    levelResult,
    completedAt: new Date().toISOString(),
  };

  localStorage.setItem("readingResults", JSON.stringify(readingResults));

  window.testResults.reading = {
    correct: readingScore,
    total: readingData.length,
    cefr: levelResult,
    levelResult,
    percent: readingResults.percent,
  };
  persistTestResults();

  goToWritingSection(readingResults);
}

function showReadingResult(score, level, color) {
  const screen = document.getElementById("reading-result-screen");
  const scoreEl = document.getElementById("display-score");
  const levelEl = document.getElementById("display-level");
  if (!screen || !scoreEl || !levelEl) return;

  scoreEl.innerText = `${score}/10`;
  levelEl.innerText = level;
  levelEl.className = `mt-4 text-2xl font-bold uppercase tracking-tighter ${color}`;

  screen.classList.remove("hidden");
  saveCurrentStep("reading-result-screen");
}

function goToWritingSection(results) {
  document.getElementById("reading-result-screen")?.classList.add("hidden");

  const onboarding = document.getElementById("onboarding");
  if (onboarding) onboarding.classList.add("hidden");

  const step7 = document.getElementById("step-7");
  const writingSection = document.getElementById("writing-section");
  const writingStartBtn = document.getElementById("start-writing-btn");

  if (step7) {
    step7.classList.remove("hidden");
    step7.classList.add("flex");
    saveCurrentStep("step-7");
  } else if (writingSection) {
    writingSection.classList.remove("hidden");
    saveCurrentStep("writing-section");
  } else if (writingStartBtn) {
    writingStartBtn.click();
  } else {
    alert(`Reading tugadi: ${results.correct}/${results.total}. Navbat: Writing bo'limi.`);
  }
}

function startWritingSection() {
  const readingResults = JSON.parse(localStorage.getItem("readingResults") || "{}");
  const resultScreen = document.getElementById("reading-result-screen");
  if (resultScreen) resultScreen.classList.add("hidden");
  goToWritingSection(readingResults);

  const writingInput = document.getElementById("writing-input");
  if (writingInput) {
    restoreDraftInputsFromLocalStorage(document.getElementById("step-7") ?? document);
    updateWordCount();
    writingInput.focus();
  }
}

window.startWritingSection = startWritingSection;

function getWordCount(text) {
  const cleaned = (text || "").trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/** Insho matnini Writing natijalari bilan birga saqlaydi — natijalar sahifasida Gemini qayta chaqirish uchun */
function mergeEssayIntoWritingSubmission(rawText) {
  const plain = String(rawText || "").trim();
  if (!plain) return;
  let prev = {};
  try {
    const j = JSON.parse(localStorage.getItem("writingSubmission") || "{}");
    if (j && typeof j === "object") prev = j;
  } catch (_) {
    prev = {};
  }
  const merged = {
    ...prev,
    essayText: plain,
    words: getWordCount(plain),
  };
  localStorage.setItem("writingSubmission", JSON.stringify(merged));
  window.testResults.writing = merged;
  persistTestResults();
}

function syncWritingEssayFromTextareaIfAny() {
  const el = document.getElementById("writing-input");
  if (!el) return;
  const t = String(el.value || "").trim();
  if (getWordCount(t) < 50) return;
  mergeEssayIntoWritingSubmission(t);
}

const QUOTA_REPLY_UZ = "AI Mentor biroz charchadi, 1 daqiqadan so'ng javob beradi";

async function analyzeWritingWithGemini(essayText) {
  const text = String(essayText || "").trim();
  if (!text) return { ok: false, error: "Insho matni mavjud emas" };

  const { res: response, payload: data } = await handleCheck(
    async () => {
      const res = await fetch(apiUrl("/api/ai/analyze-writing"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      let payload = {};
      try {
        payload = await res.json();
      } catch (_) {
        payload = {};
      }
      return { res, payload };
    },
    { delayMs: 5000, maxAttempts: 12 },
  );

  if (response.status === 429 || data.quotaExceeded) {
    return {
      ok: false,
      quota: true,
      error: QUOTA_REPLY_UZ,
    };
  }

  const replyTrim = String(data.reply ?? "").trim();
  if (!response.ok) {
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : `HTTP ${response.status}`,
    };
  }

  let prev = {};
  try {
    const j = JSON.parse(localStorage.getItem("writingSubmission") || "{}");
    if (j && typeof j === "object") prev = j;
  } catch (_) {
    prev = {};
  }

  const wc = getWordCount(text);
  const writingPayload = {
    ...prev,
    essayText: text,
    words: wc,
    aiReply: replyTrim || String(data.reply || ""),
    success: !!(data.success !== false && replyTrim),
    analyzedModel: data.model,
    analyzedAt: new Date().toISOString(),
    submittedAt: prev.submittedAt || new Date().toISOString(),
  };
  localStorage.setItem("writingSubmission", JSON.stringify(writingPayload));
  window.testResults.writing = writingPayload;
  persistTestResults();

  if (!replyTrim) return { ok: false, error: data.error || "Gemini javob bermadi" };
  return { ok: true };
}

function showResultsLoadingUI(container) {
  if (!container) return;
  container.innerHTML = `
        <div class="flex min-h-[75vh] flex-col items-center justify-center gap-6 px-6 text-center">
            <div class="relative h-20 w-20">
              <div class="absolute inset-0 rounded-full border-4 border-white/10"></div>
              <div class="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-fuchsia-500 border-r-purple-400"></div>
            </div>
            <div>
              <p class="text-xl font-black italic uppercase tracking-wide text-white">AI tahlil qilmoqda...</p>
              <p class="mt-3 max-w-md text-sm text-white/55">Grammar, lug'at va CEFR bo'yicha baho Gemini orqali olinmoqda. Iltimos kuting.</p>
            </div>
        </div>
    `;
}

function updateWordCount() {
  const writingInput = document.getElementById("writing-input");
  const wordCountEl = document.getElementById("word-count");
  const submitBtn = document.getElementById("submit-writing-btn");
  if (!writingInput || !wordCountEl || !submitBtn) return;

  const count = getWordCount(writingInput.value);
  wordCountEl.innerText = `Words: ${count}/100`;
  // Analyze tugmasi faqat 50-100 oralig'ida yoqiladi
  submitBtn.disabled = count < 50 || count > 100;
}

async function submitWriting() {
  const writingInput = document.getElementById("writing-input");
  const loadingEl = document.getElementById("ai-loading");
  const submitBtn = document.getElementById("submit-writing-btn");
  if (!writingInput || !loadingEl || !submitBtn) return;

  const text = writingInput.value;
  const count = getWordCount(text);
  if (count < 50 || count > 100) return;

  submitBtn.disabled = true;
  loadingEl.classList.remove("hidden");

  try {
    const r = await analyzeWritingWithGemini(text).catch(() => ({
      ok: false,
      error: "Tarmoq",
    }));
    if (r.ok) {
      localStorage.removeItem(draftStorageKeyForElementId("writing-input"));
      startListeningSection();
    } else {
      mergeEssayIntoWritingSubmission(text);
      document.getElementById("writing-to-listening")?.classList.remove("hidden");
      if (!r.quota) alert(String(r.error || "AI ulanishda xatolik yuz berdi!"));
    }
  } catch (_) {
    mergeEssayIntoWritingSubmission(writingInput.value);
    alert("AI ulanishda xatolik yuz berdi!");
  } finally {
    loadingEl.classList.add("hidden");
    submitBtn.disabled = false;
    updateWordCount();
  }
}

window.submitWriting = submitWriting;

const LISTENING_PART3_AUDIO_URL = `/audio/${encodeURIComponent("part 3.mp3")}?v=3`;

const listeningPart3Match = {
  title: "Part 3: Exercise 15 — Holiday Jobs",
  instruction:
    "You will hear five short extracts in which people are talking about holiday jobs they have done. For questions 1–5, choose from the list (A–H) what each speaker says about the job they did.",
  options: [
    { id: "A", legend: "Disappointed about earnings", text: "I was disappointed not to earn more." },
    { id: "B", legend: "Routine was boring", text: "The routine made it very boring." },
    { id: "C", legend: "Rude people / rude treatment", text: "I didn't like the way some people were rude to me." },
    { id: "D", legend: "Work was easy / light workload", text: "I didn't have to work very hard." },
    { id: "E", legend: "Demanding boss", text: "My boss was very demanding." },
    { id: "F", legend: "Needed to be sociable", text: "I needed to be very sociable." },
    { id: "G", legend: "Friendly colleagues", text: "Some of my colleagues were very friendly." },
    { id: "H", legend: "Prepared for surprises", text: "I had to be prepared for unexpected events." },
  ],
};

/** Exercise 15: 1.B, 2.H, 3.F, 4.D, 5.C */
const PART3_SPEAKER_KEYS = ["B", "H", "F", "D", "C"];

let listeningPart3PrepInterval = null;
let listeningPart3AudioInstance = null;
let listeningPart3ReadyForNext = false;

function buildListeningPart3LegendHtml() {
  return listeningPart3Match.options
    .map((o) => `<div><strong>${o.id}:</strong> ${o.legend ?? o.text}</div>`)
    .join("");
}

function buildListeningPart3SpeakersHtml() {
  return [1, 2, 3, 4, 5]
    .map(
      (num) => `
        <div class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-black/40 p-5 transition-all hover:border-fuchsia-500/30">
            <span class="text-lg font-semibold text-white">Speaker ${num}</span>
            <select id="p3-speaker-${num}" class="rounded-xl border border-white/20 bg-[#0f0c29] px-4 py-2 text-white outline-none focus:border-fuchsia-500">
                <option value="">Select A–H</option>
                ${["A", "B", "C", "D", "E", "F", "G", "H"]
                  .map((l) => `<option value="${l}">${l}</option>`)
                  .join("")}
            </select>
        </div>`
    )
    .join("");
}

function updateListeningPart3NextEnabled() {
  const btn = document.getElementById("p3-next-part-btn");
  if (!btn) return;
  let ok = true;
  for (let i = 1; i <= 5; i++) {
    const sel = document.getElementById(`p3-speaker-${i}`);
    if (!sel || !sel.value) ok = false;
  }
  btn.disabled = !ok;
}

function revealListeningPart3NextRow() {
  listeningPart3ReadyForNext = true;
  for (let i = 1; i <= 5; i++) {
    document
      .getElementById(`p3-speaker-${i}`)
      ?.addEventListener("change", updateListeningPart3NextEnabled);
  }
  updateListeningPart3NextEnabled();
}

function startPart3HolidayOneTime() {
  const container = document.getElementById("step-8");
  if (!container) return;

  listeningPart3ReadyForNext = false;

  if (listeningPart3PrepInterval) {
    clearInterval(listeningPart3PrepInterval);
    listeningPart3PrepInterval = null;
  }
  if (listeningPart3AudioInstance) {
    listeningPart3AudioInstance.pause();
    listeningPart3AudioInstance = null;
  }

  if (part5PrepTimerInterval) {
    clearInterval(part5PrepTimerInterval);
    part5PrepTimerInterval = null;
  }
  if (part5AudioInstance) {
    part5AudioInstance.pause();
    part5AudioInstance = null;
  }

  const audio = new Audio(LISTENING_PART3_AUDIO_URL);
  listeningPart3AudioInstance = audio;

  const legendHtml = buildListeningPart3LegendHtml();
  const speakersHtml = buildListeningPart3SpeakersHtml();

  container.innerHTML = `
        <div class="mx-auto grid w-full max-w-7xl animate-in fade-in duration-700 grid-cols-1 gap-8 p-6 lg:grid-cols-2 lg:p-10">
            <div class="flex flex-col items-center justify-center rounded-[3rem] border border-white/10 bg-white/5 p-8 text-center lg:p-10">
                <div id="p3-status" class="status-text mb-4 px-4 text-sm font-bold uppercase italic tracking-widest text-amber-400">Tayyorgarlik</div>
                <div id="p3-timer" class="mb-6 text-8xl font-black text-white lg:text-9xl">0</div>
                <p class="max-w-xs px-6 text-sm leading-relaxed text-white/50">Audio darhol <strong>bir marta</strong> ijro etiladi.</p>
            </div>
            <div class="rounded-[3rem] border border-white/10 bg-white/5 p-8 backdrop-blur-md">
                <h3 class="mb-3 text-2xl font-bold italic text-white">${listeningPart3Match.title}</h3>
                <p class="mb-4 text-xs leading-relaxed text-white/55">${listeningPart3Match.instruction}</p>
                <div class="mb-6 grid grid-cols-1 gap-2 text-sm text-white/70 md:grid-cols-2">${legendHtml}</div>
                <div class="max-h-[52vh] space-y-4 overflow-y-auto">${speakersHtml}</div>
                <div class="mt-8 flex justify-center sm:justify-end">
                    <button type="button" id="p3-next-part-btn" disabled onclick="submitListeningHolidayPart3()"
                      class="rounded-2xl border border-white/20 bg-white/10 px-8 py-4 font-bold text-white shadow-lg transition-all hover:border-fuchsia-500 hover:bg-fuchsia-600 disabled:pointer-events-none disabled:opacity-40">
                        Keyingi part →
                    </button>
                </div>
            </div>
        </div>`;

  restoreDraftInputsFromLocalStorage(container);
  revealListeningPart3NextRow();
  saveCurrentStep("step-8-p3");

  function playPart3Once() {
    const st = document.getElementById("p3-status");
    if (st) {
      st.innerText = "Audio ijro etilmoqda…";
      st.className =
        "mb-4 px-4 text-center text-sm font-bold uppercase tracking-widest text-green-400";
    }
    audio.onended = () => {
      listeningPart3AudioInstance = null;
      if (st) {
        st.innerText = "Audio tugadi";
        st.className =
          "mb-4 px-4 text-center text-sm font-bold uppercase tracking-widest text-red-400";
      }
    };
    audio.onerror = () => {
      listeningPart3AudioInstance = null;
      if (st) {
        st.innerText = "Audio yuklanmadi";
        st.className =
          "mb-4 px-4 text-center text-sm font-bold uppercase tracking-widest text-red-400";
      }
      console.error("Part3 audio:", LISTENING_PART3_AUDIO_URL);
    };
    audio.play().catch(() => {
      if (st) {
        st.innerText = "Avto-ijro bloklangan — audio uchun sahifaga bosing";
        st.className =
          "mb-4 px-4 text-center text-sm font-bold uppercase tracking-widest text-amber-300";
      }
    });
  }

  const p3TimerEl = document.getElementById("p3-timer");
  if (p3TimerEl) p3TimerEl.innerText = "0";
  playPart3Once();
}

function submitListeningHolidayPart3() {
  saveCurrentStep("step-8-p5");

  let correct = 0;
  const answers = {};
  for (let num = 1; num <= 5; num++) {
    const sel = document.getElementById(`p3-speaker-${num}`);
    const val = sel ? String(sel.value).trim().toUpperCase() : "";
    answers[num] = val;
    const key = PART3_SPEAKER_KEYS[num - 1];
    if (key && val === String(key).toUpperCase()) correct++;
  }

  const total = 5;
  const payload = {
    part: "part3",
    exercise: "15",
    correct,
    total,
    answers,
    completedAt: new Date().toISOString(),
  };
  localStorage.setItem("listeningPart3Results", JSON.stringify(payload));

  window.testResults.listening = {
    ...(window.testResults.listening || {}),
    part3: payload,
  };
  persistTestResults();

  if (listeningPart3PrepInterval) {
    clearInterval(listeningPart3PrepInterval);
    listeningPart3PrepInterval = null;
  }
  if (listeningPart3AudioInstance) {
    listeningPart3AudioInstance.pause();
    listeningPart3AudioInstance = null;
  }

  startPart5OneTime();
}

window.submitListeningHolidayPart3 = submitListeningHolidayPart3;

const listeningPart5Data = {
  /** Fayl nomi diskda bo'sh joy bilan (`public/audio/part 5.mp3`). Bo'shhizsiz `part5.mp3` bo'lsa `/audio/part5.mp3` qiling. */
  audioSrc: `/audio/${encodeURIComponent("part 5.mp3")}`,
  sections: [
    {
      title: "Extract One",
      questions: [
        {
          id: 1,
          text: "1. How does the man feel about the work?",
          options: [
            "A) He finds the creativity stimulating",
            "B) He would like to use his academic training more",
            "C) He gets most satisfaction from being part of a team",
          ],
        },
        {
          id: 2,
          text: "2. What do they both think about the job?",
          options: [
            "A) It's a difficult career to get started in",
            "B) It's important to be able to work flexible hours",
            "C) It's a poorly paid job for the amount of work involved",
          ],
        },
      ],
    },
    {
      title: "Extract Two",
      questions: [
        {
          id: 3,
          text: "3. The man thinks his success as a cyclist is due to",
          options: [
            "A) his complete dedication",
            "B) the age at which he started",
            "C) a series of great role models",
          ],
        },
        {
          id: 4,
          text: "4. When talking about cycling in a velodrome, the woman reveals her",
          options: [
            "A) fear of dangerous sports",
            "B) inability to follow instructions",
            "C) willingness to accept a challenge",
          ],
        },
      ],
    },
    {
      title: "Extract Three",
      questions: [
        {
          id: 5,
          text: "5. Why has he phoned the programme?",
          options: [
            "A) to raise issues not previously discussed",
            "B) to challenge the opinions of other contributors",
            "C) to lend his support to a view that's been expressed",
          ],
        },
        {
          id: 6,
          text: "6. When talking about gardens, he is",
          options: [
            "A) describing what he does in his own",
            "B) encouraging people to grow certain things",
            "C) suggesting that people keep bees themselves",
          ],
        },
      ],
    },
  ],
};

const listeningPart6Data = {
  /** Disk: `public/audio/part 6.mp3`. Bo'shjoysiz `part6.mp3` bo'lsa `/audio/part6.mp3` qiling. */
  audioSrc: `/audio/${encodeURIComponent("part 6.mp3")}`,
  title: "Exercise 17: Museum Tour",
  instruction: "Write ONE WORD and / or A NUMBER for each answer.",
  content: [
    {
      paragraph:
        "This museum houses objects collected by the cultural society based in the city.",
      questions: [],
    },
    {
      paragraph: "It has one of the country's best galleries containing (1) ",
      questionId: 1,
      suffix: " science exhibits.",
    },
    {
      paragraph:
        "The museum's displays of butterflies and birds are closed to visitors at present.",
      questions: [],
    },
    {
      paragraph: "The section called Let's (2) ",
      questionId: 2,
      suffix: " is popular with young people.",
    },
    {
      paragraph:
        "The picture galleries contain works on various themes by German (3) ",
      questionId: 3,
      suffix: ".",
    },
    {
      paragraph: "The museum's (4) ",
      questionId: 4,
      suffix: " needs modernising.",
    },
    {
      paragraph: "The guide uses the word (5) ",
      questionId: 5,
      suffix:
        " to describe the Rutland Dinosaur's effect on people.",
    },
    {
      paragraph:
        "Polystyrene was used to reconstruct most of the Rutland Dinosaur's (6) ",
      questionId: 6,
      suffix: ".",
    },
  ],
};


/** Exercise 9: 1.F, 2.G, 3.D, 4.H, 5.C (6-savol uchun kalit keyin qo'shiladi) */
const PART5_ANSWER_KEY = ["F", "G", "D", "H", "C", ""];

/** Part 6 museum gap-fill kaliti (savollar tartibida 1–6). */
const PART6_ANSWER_KEY = [
  "natural",
  "interact",
  "artists",
  "heating",
  "intimidating",
  "tail",
];

window.listeningPart5Data = listeningPart5Data;
window.listeningPart6Data = listeningPart6Data;

function getListeningPart5AudioUrl() {
  const base =
    listeningPart5Data.audioSrc || `/audio/${encodeURIComponent("part 5.mp3")}`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}v=10`;
}

function getListeningPart5QuestionIdsInOrder() {
  return listeningPart5Data.sections.flatMap((s) => s.questions.map((q) => q.id));
}

function updatePart5NextEnabled() {
  const btn = document.getElementById("p5-next-part-btn");
  if (!btn) return;
  const ids = getListeningPart5QuestionIdsInOrder();
  const ok = ids.every((id) => {
    const el = document.getElementById(`p5-ans-${id}`);
    return el && String(el.value).trim().length > 0;
  });
  btn.disabled = !ok;
}

function wirePart5NextButtonListeners() {
  getListeningPart5QuestionIdsInOrder().forEach((id) => {
    const el = document.getElementById(`p5-ans-${id}`);
    el?.addEventListener("input", updatePart5NextEnabled);
    el?.addEventListener("change", updatePart5NextEnabled);
  });
  updatePart5NextEnabled();
}

function updatePart6NextFinishEnabled() {
  const btn = document.getElementById("p6-next-finish-btn");
  if (!btn) return;
  const ids = getListeningPart6QuestionIdsInOrder();
  const ok = ids.every((id) => {
    const el = document.getElementById(`p6-ans-${id}`);
    return el && String(el.value).trim().length > 0;
  });
  btn.disabled = !ok;
}

function wirePart6NextFinishButtonListeners() {
  getListeningPart6QuestionIdsInOrder().forEach((id) => {
    document
      .getElementById(`p6-ans-${id}`)
      ?.addEventListener("input", updatePart6NextFinishEnabled);
  });
  updatePart6NextFinishEnabled();
}

function normalizePart6Answer(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getListeningPart6AudioUrl() {
  const base =
    listeningPart6Data.audioSrc ||
    `/audio/${encodeURIComponent("part 6.mp3")}`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}v=11`;
}

function getListeningPart6QuestionIdsInOrder() {
  return listeningPart6Data.content
    .filter((b) => b.questionId != null)
    .map((b) => b.questionId);
}

/** Part 5 sahifasini `listeningPart5Data`dan HTML qiladi (bir qator markup). */
function renderPart5() {
  let htmlContent = `<div class="max-w-4xl mx-auto p-6">
        <h2 class="text-3xl font-black text-white mb-8">Part 5: Exercise 9</h2>`;

  listeningPart5Data.sections.forEach((section) => {
    htmlContent += `<div class="mb-12">
            <h3 class="text-fuchsia-500 font-bold uppercase tracking-widest mb-6 border-b border-fuchsia-500/20 pb-2">${section.title}</h3>`;

    section.questions.forEach((q) => {
      htmlContent += `
                <div class="mb-10 bg-white/5 p-6 rounded-3xl border border-white/10 shadow-xl">
                    <p class="text-white text-xl font-medium mb-4">${q.text}</p>
                    <div class="space-y-3 ml-4 mb-6">
                        ${q.options.map((opt) => `<p class="text-white/60 text-lg">${opt}</p>`).join("")}
                    </div>
                    
                    <div class="flex items-center gap-4 bg-fuchsia-500/10 p-4 rounded-2xl border border-fuchsia-500/30">
                        <span class="text-fuchsia-400 font-bold uppercase text-sm">Your Answer:</span>
                        <input type="text" id="p5-ans-${q.id}" maxlength="1" 
                            class="bg-white/10 border-2 border-fuchsia-500/50 text-white w-16 h-12 rounded-xl text-center focus:border-fuchsia-500 outline-none font-black text-2xl uppercase" 
                            placeholder="?" inputmode="text" autocomplete="off">
                    </div>
                </div>`;
    });

    htmlContent += `</div>`;
  });

  htmlContent += `</div>`;
  return htmlContent;
}

/** Part 6: matn oqimi, raqamlangan joylarda "Your Answer" maydonlari. */
function renderPart6() {
  const d = listeningPart6Data;
  let html = `<div class="mx-auto max-w-4xl p-4 sm:p-6">
    <h2 class="mb-4 text-3xl font-black text-white">${d.title}</h2>
    <p class="mb-10 text-sm font-medium italic tracking-wide text-slate-300/90">${d.instruction}</p>
    <div class="space-y-9 rounded-[2rem] border border-white/10 bg-white/[0.06] p-8 shadow-xl backdrop-blur-sm md:p-11">`;

  d.content.forEach((block) => {
    const hasGap = block.questionId != null;
    if (!hasGap && block.paragraph) {
      html += `<p class="text-xl font-medium leading-[1.95] tracking-wide text-white/85">${block.paragraph}</p>`;
      return;
    }

    html += `<p class="text-xl font-medium leading-[2] tracking-wide text-white/90">${block.paragraph}`;
    html += `<span class="mx-1 inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-2 rounded-xl border border-slate-300/30 bg-white/10 px-3.5 py-2.5 align-middle shadow-inner shadow-slate-900/20">`;
    html += `<span class="shrink-0 text-[0.68rem] font-bold uppercase tracking-wider text-slate-300">${block.questionId}) Your Answer:</span>`;
    html += `<input type="text" id="p6-ans-${block.questionId}" autocomplete="off" spellcheck="false"
      class="min-w-[10rem] max-w-[13rem] flex-1 rounded-lg border border-slate-300/45 bg-black/35 px-3.5 py-2 text-center text-[1rem] font-semibold text-white placeholder-slate-300/55 outline-none focus:border-slate-200"
      placeholder="word / number" />`;
    html += `</span>`;
    html += `<span>${block.suffix ?? ""}</span></p>`;
  });

  html += `</div></div>`;
  return html;
}

let part5PrepTimerInterval = null;
let part5AudioInstance = null;
let part6PrepTimerInterval = null;
let part6AudioInstance = null;
/** `showFinishScreen` dan keyin DOM yo'q; Part 6 balli shu yerdan olinadi. */
let part6CapturedAnswers = null;

function updateAudioStatusUI(statusType) {
  const statusElement =
    document.getElementById("p5-status") ||
    document.getElementById("p6-status");
  if (!statusElement) return;

  if (statusType === "preparing") {
    statusElement.className =
      "text-slate-400 font-medium uppercase tracking-[0.2em] mb-4 text-sm opacity-80";
    statusElement.innerText = "Eslatma: Audio faqat bir marotaba ijro etiladi";
  } else if (statusType === "playing") {
    statusElement.className =
      "text-fuchsia-400 font-bold uppercase tracking-[0.1em] mb-4 text-sm animate-pulse";
    statusElement.innerText = "Audio ijro qilinmoqda...";
  }
}

function renderNextStepButton(nextFunction, nextStepId = null) {
  const oldBtn =
    document.getElementById("next-part-trigger") ||
    document.getElementById("dynamic-next-btn");
  if (oldBtn) oldBtn.remove();

  const nextBtn = document.createElement("button");
  nextBtn.id = "dynamic-next-btn";
  nextBtn.className =
    "fixed bottom-10 right-10 bg-white/10 hover:bg-white/20 text-slate-300 border border-white/20 px-10 py-4 rounded-2xl font-bold tracking-wider transition-all animate-bounce z-[9999] backdrop-blur-md shadow-2xl";
  nextBtn.innerHTML = `
        Keyingi partga o'tish →`;

  nextBtn.onclick = () => {
    if (nextStepId) saveCurrentStep(nextStepId);
    nextBtn.remove();
    nextFunction();
  };
  document.body.appendChild(nextBtn);
}

function startPart5OneTime() {
  const container = document.getElementById("step-8");
  if (!container) return;

  if (listeningPart3PrepInterval) {
    clearInterval(listeningPart3PrepInterval);
    listeningPart3PrepInterval = null;
  }
  if (listeningPart3AudioInstance) {
    listeningPart3AudioInstance.pause();
    listeningPart3AudioInstance = null;
  }

  if (part5PrepTimerInterval) {
    clearInterval(part5PrepTimerInterval);
    part5PrepTimerInterval = null;
  }
  if (part5AudioInstance) {
    part5AudioInstance.pause();
    part5AudioInstance = null;
  }

  const playbackUrl = getListeningPart5AudioUrl();
  const audio = new Audio(playbackUrl);
  part5AudioInstance = audio;

  const questionsPanelHtml = renderPart5();

  saveCurrentStep("step-8-p5");

  container.innerHTML = `
        <div class="grid w-full animate-in fade-in duration-700 grid-cols-1 gap-8 p-10 lg:grid-cols-2 max-w-7xl mx-auto">
            <div class="bg-white/5 p-10 rounded-[3rem] border border-white/10 flex flex-col items-center justify-center">
                <div id="p5-status" class="status-text text-slate-400 font-medium uppercase tracking-[0.2em] mb-4 text-sm opacity-80 text-center px-4">
                    Eslatma: Audio faqat bir marotaba ijro etiladi
                </div>
                <div id="p5-timer" class="text-9xl font-black text-white mb-8">0</div>
                <p class="text-white/40 text-center italic px-6">Audio darhol boshlanadi, qayta qo'yish imkoniyati yo'q.</p>
                <p class="text-white/30 text-xs text-center mt-4 px-6 break-all">${listeningPart5Data.audioSrc}</p>
            </div>

            <div class="bg-white/5 p-4 sm:p-6 rounded-[3rem] border border-white/10 overflow-y-auto max-h-[70vh]">
                <div id="p5-questions" class="min-h-0">
                    ${questionsPanelHtml}
                </div>
                <div class="mt-6 flex justify-end border-t border-white/10 pt-6">
                    <button type="button" id="p5-next-part-btn" disabled onclick="submitListeningPart3Answers()"
                      class="rounded-2xl border border-white/20 bg-white/10 px-8 py-4 font-bold text-slate-200 shadow-lg transition-all hover:border-fuchsia-500 hover:bg-fuchsia-600 hover:text-white disabled:pointer-events-none disabled:opacity-40">
                        Keyingi part (Part 6) →
                    </button>
                </div>
            </div>
        </div>
    `;

  restoreDraftInputsFromLocalStorage(container);
  wirePart5NextButtonListeners();
  updateAudioStatusUI("preparing");

  function playPart5Once() {
    const st = document.getElementById("p5-status");
    audio.onplay = () => {
      const status = document.getElementById("p5-status");
      if (!status) return;
      status.innerText = "Audio ijro qilinmoqda...";
      status.className =
        "text-fuchsia-400 font-bold uppercase tracking-[0.1em] mb-4 text-sm animate-pulse";
    };

    audio.onended = () => {
      part5AudioInstance = null;
      if (st) {
        st.innerText = "Audio tugadi";
        st.className =
          "text-red-400 font-bold mb-4 uppercase tracking-widest text-sm text-center px-4";
      }
    };

    audio.onerror = () => {
      part5AudioInstance = null;
      if (st) {
        st.innerText = "Audio yuklanmadi (fayl yo'li/audioSrc)";
        st.className =
          "text-red-400 font-bold mb-4 uppercase tracking-widest text-sm text-center px-4";
      }
      console.error("Part5 audio:", playbackUrl);
    };

    audio.play().catch(() => {
      if (st) {
        st.innerText = "Avto-ijro bloklangan — audio uchun sahifaga bosing";
        st.className =
          "text-amber-300 font-bold mb-4 uppercase tracking-widest text-sm text-center px-4";
      }
    });
  }

  const p5TimerEl = document.getElementById("p5-timer");
  if (p5TimerEl) p5TimerEl.innerText = "0";
  playPart5Once();
}

function showFinalSubmitPart6Button() {
  document.getElementById("p6-submit-row")?.classList.remove("hidden");
}

/** Listening yakunlanganidan keyingi yakun oynasi (natijaga o'tish). */
function showFinishScreen() {
  const container = document.getElementById("step-8");
  if (!container) return;

  document.getElementById("p6-finish-overlay")?.remove();

  const snap = {};
  getListeningPart6QuestionIdsInOrder().forEach((id) => {
    const el = document.getElementById(`p6-ans-${id}`);
    snap[id] = el ? String(el.value).trim() : "";
  });
  part6CapturedAnswers = snap;

  if (part6PrepTimerInterval) {
    clearInterval(part6PrepTimerInterval);
    part6PrepTimerInterval = null;
  }
  if (part6AudioInstance) {
    part6AudioInstance.pause();
    part6AudioInstance = null;
  }

  container.innerHTML = `
        <div class="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center animate-in fade-in duration-700">
            <h2 class="mb-4 text-4xl font-black uppercase tracking-tight text-white">Tekshiruv testlari tugadi!</h2>
            <p class="mx-auto mb-10 max-w-md text-white/50">Siz barcha bo'limlarni muvaffaqiyatli topshirdingiz. Natijalaringiz tahlil qilinishga tayyor.</p>
            <button type="button" onclick="finalizeTestShowStep10()" class="group relative rounded-2xl bg-white px-12 py-5 text-xl font-black text-black transition-all hover:scale-105 active:scale-95">
                <span class="relative z-10">NATIJALARNI KO'RISH</span>
                <div class="absolute inset-0 rounded-2xl bg-fuchsia-500 opacity-0 blur-xl transition-opacity group-hover:opacity-40"></div>
            </button>
        </div>
    `;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

/** Listening + boshqa bo'limlar bo'yicha "Result Dashboard" (step-8). Writing tahlili kerak bo'lsa Gemini qayta chaqiriladi. */
async function calculateAndShowResults() {
  submitListeningPart6Answers({ openDashboard: false });
  syncWritingEssayFromTextareaIfAny();

  const container = document.getElementById("step-8");
  if (!container) return;
  showResultsLoadingUI(container);

  let writing = null;
  try {
    writing = JSON.parse(localStorage.getItem("writingSubmission") || "null");
  } catch (_) {
    writing = null;
  }

  const essay = String(writing?.essayText || writing?.text || "").trim();
  const aiDone = String(writing?.aiReply || writing?.reply || "").trim();
  const wcEssay = essay ? getWordCount(essay) : 0;
  const needsGemini =
    essay &&
    (!aiDone || writing?.success === false) &&
    wcEssay >= 50 &&
    wcEssay <= 100;

  if (needsGemini) {
    const r = await analyzeWritingWithGemini(essay).catch(() => ({
      ok: false,
      error: "Network",
    }));
    if (!r.ok && r?.error && typeof r.error === "string") {
      console.warn("[Writing AI]", r.quota ? QUOTA_REPLY_UZ : r.error);
    }
    try {
      writing = JSON.parse(localStorage.getItem("writingSubmission") || "null");
    } catch (_) {
      writing = null;
    }
  }

  const grammar = JSON.parse(
    localStorage.getItem("grammarLexisResults") || "null"
  );
  const reading = JSON.parse(localStorage.getItem("readingResults") || "null");
  const listeningP3 = JSON.parse(
    localStorage.getItem("listeningPart3Results") || "null"
  );
  const listeningP5 = JSON.parse(
    localStorage.getItem("listeningPart5Results") || "null"
  );
  const listeningP6 = JSON.parse(
    localStorage.getItem("listeningPart6Results") || "null"
  );

  const grammarScore =
    grammar && typeof grammar.score === "number" ? grammar.score : 0;
  const grammarMax =
    grammar && typeof grammar.total === "number"
      ? grammar.total
      : 0;

  const readingCefr = reading?.levelResult || reading?.cefr || "—";

  const p3c =
    listeningP3 && typeof listeningP3.correct === "number"
      ? listeningP3.correct
      : 0;
  const p3total =
    listeningP3 && typeof listeningP3.total === "number"
      ? listeningP3.total
      : 5;

  const p5c =
    listeningP5 && typeof listeningP5.correct === "number"
      ? listeningP5.correct
      : 0;
  const p6c =
    listeningP6 && typeof listeningP6.correct === "number"
      ? listeningP6.correct
      : 0;
  const p5total =
    listeningP5 && typeof listeningP5.total === "number"
      ? listeningP5.total
      : 6;
  const p6total =
    listeningP6 && typeof listeningP6.total === "number"
      ? listeningP6.total
      : 6;

  const listeningScore = p3c + p5c + p6c;
  const listeningPct =
    LISTENING_SCORE_MAX > 0
      ? Math.min(100, (listeningScore / LISTENING_SCORE_MAX) * 100)
      : 0;

  persistTestResults();

  localStorage.removeItem("edunext_current_step");
  localStorage.removeItem("activeStep");

  container.innerHTML = `
        <div class="max-w-6xl mx-auto p-6 md:p-10 animate-in fade-in duration-700">
            <h1 class="mb-12 border-l-8 border-fuchsia-600 pl-6 text-4xl font-black uppercase tracking-tighter text-white md:text-5xl">
                Result Dashboard
            </h1>

            <div class="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div class="rounded-[2.5rem] border border-white/10 bg-white/5 p-8">
                    <h3 class="mb-2 text-sm font-bold uppercase tracking-widest text-fuchsia-500">Grammar</h3>
                    <div class="text-5xl font-black text-white">${grammarScore}</div>
                    <p class="mt-2 text-sm text-white/45">to'g'ri javoblar (${grammarMax} savoldan)</p>
                </div>

                <div class="rounded-[2.5rem] border border-white/10 bg-white/5 p-8">
                    <h3 class="mb-2 text-sm font-bold uppercase tracking-widest text-blue-400">Reading</h3>
                    <div class="text-5xl font-black leading-tight text-white">${escapeHtml(readingCefr)}</div>
                    <p class="mt-2 text-sm text-white/45">CEFR va matn tahlili bo'yicha daraja</p>
                </div>

                <div class="rounded-[2.5rem] border border-white/10 bg-white/5 p-8 md:col-span-2">
                    <h3 class="mb-2 text-sm font-bold uppercase tracking-widest text-amber-400">Listening</h3>
                    <div class="flex flex-wrap items-center gap-6">
                        <div class="text-5xl font-black text-white">${listeningScore}/${LISTENING_SCORE_MAX}</div>
                        <div class="h-4 min-w-[160px] flex-1 overflow-hidden rounded-full bg-white/10">
                            <div class="h-full bg-amber-400 shadow-[0_0_15px_#fbbf24]" style="width:${listeningPct}%"></div>
                        </div>
                    </div>
                    <p class="mt-4 text-sm text-white/45">
                        Part 3 (Ex.15): ${p3c}/${p3total} · Part 5 (Ex.9): ${p5c}/${p5total} · Part 6 (Ex.17): ${p6c}/${p6total}
                    </p>
                </div>
            </div>

            <button type="button" onclick="location.reload()"
                class="mt-12 text-white/50 underline decoration-fuchsia-500 underline-offset-8 transition-colors hover:text-white">
                Testni qayta topshirish
            </button>
        </div>
    `;
}

function showFinalFinishScreen() {
  showFinishScreen();
}

function showFullResults() {
  calculateAndShowResults();
}

function startPart6OneTime() {
  const container = document.getElementById("step-8");
  if (!container) return;

  part6CapturedAnswers = null;
  document.getElementById("p6-finish-overlay")?.remove();

  if (part5PrepTimerInterval) {
    clearInterval(part5PrepTimerInterval);
    part5PrepTimerInterval = null;
  }
  if (part5AudioInstance) {
    part5AudioInstance.pause();
    part5AudioInstance = null;
  }

  if (part6PrepTimerInterval) {
    clearInterval(part6PrepTimerInterval);
    part6PrepTimerInterval = null;
  }
  if (part6AudioInstance) {
    part6AudioInstance.pause();
    part6AudioInstance = null;
  }

  const playbackUrl = getListeningPart6AudioUrl();
  const audio = new Audio(playbackUrl);
  part6AudioInstance = audio;

  const proseHtml = renderPart6();

  container.innerHTML = `
        <div class="mx-auto grid w-full max-w-7xl animate-in fade-in duration-700 grid-cols-1 gap-8 p-6 lg:grid-cols-3 lg:p-10">
            <div class="lg:col-span-1 flex flex-col items-center justify-center rounded-[2.5rem] border border-white/10 bg-white/5 p-6 lg:p-7">
                <div id="p6-status" class="status-text mb-3 text-center px-3 text-xs text-slate-400 font-medium uppercase tracking-[0.18em] opacity-80">
                    Eslatma: Audio faqat bir marotaba ijro etiladi
                </div>
                <div id="p6-timer" class="mb-5 text-7xl font-black text-white lg:text-8xl">0</div>
                <p class="max-w-xs px-4 text-center text-xs italic leading-relaxed text-slate-300/75">
                    Audio darhol boshlanadi va trek bir marta ijro etiladi.
                </p>
                <p class="mt-4 break-all px-4 text-center text-[11px] text-slate-300/45">${listeningPart6Data.audioSrc}</p>
            </div>

            <div class="lg:col-span-2 max-h-[75vh] min-h-[18rem] overflow-y-auto rounded-[3rem] border border-white/10 bg-white/[0.04] p-3 sm:p-5">
                <div id="p6-content">${proseHtml}</div>
            </div>
            <div class="flex justify-center px-4 pb-6 pt-2 lg:col-span-3">
                <button type="button" id="p6-next-finish-btn" disabled onclick="showFinishScreen()"
                  class="rounded-2xl border border-white/20 bg-white/10 px-10 py-4 font-bold text-white shadow-lg transition-all hover:border-fuchsia-500 hover:bg-fuchsia-600 disabled:pointer-events-none disabled:opacity-40">
                    Yakunlash — natijalarga o'tish →
                </button>
            </div>
        </div>
    `;

  restoreDraftInputsFromLocalStorage(container);
  wirePart6NextFinishButtonListeners();
  updateAudioStatusUI("preparing");

  function playPart6Once() {
    const st = document.getElementById("p6-status");
    audio.onplay = () => {
      const status = document.getElementById("p6-status");
      if (!status) return;
      status.innerText = "Audio ijro qilinmoqda...";
      status.className =
        "text-fuchsia-400 font-bold uppercase tracking-[0.1em] mb-4 text-sm animate-pulse";
    };

    audio.onended = () => {
      part6AudioInstance = null;
      if (st) {
        st.innerText = "Audio tugadi";
        st.className =
          "mb-4 text-center px-4 text-sm font-bold uppercase tracking-widest text-red-400";
      }
    };

    audio.onerror = () => {
      part6AudioInstance = null;
      if (st) {
        st.innerText = "Audio yuklanmadi (part6)";
        st.className =
          "mb-4 text-center px-4 text-sm font-bold uppercase tracking-widest text-red-400";
      }
      console.error("Part6 audio:", playbackUrl);
    };

    audio.play().catch(() => {
      if (st) {
        st.innerText = "Avto-ijro bloklangan — audio uchun sahifaga bosing";
        st.className =
          "mb-4 text-center px-4 text-sm font-bold uppercase tracking-widest text-amber-300";
      }
    });
  }

  const p6TimerEl = document.getElementById("p6-timer");
  if (p6TimerEl) p6TimerEl.innerText = "0";
  playPart6Once();

  saveCurrentStep("step-8-part6");
}

function submitListeningPart6Answers(options = {}) {
  const { openDashboard = true } = options;

  const ids = getListeningPart6QuestionIdsInOrder();
  const answers = {};
  let correct = 0;
  const snap =
    part6CapturedAnswers != null && typeof part6CapturedAnswers === "object"
      ? part6CapturedAnswers
      : null;

  ids.forEach((id, idx) => {
    const raw = snap
      ? String(snap[id] ?? "")
      : (() => {
          const el = document.getElementById(`p6-ans-${id}`);
          return el ? String(el.value) : "";
        })();
    answers[id] = raw.trim();
    const keyRaw = PART6_ANSWER_KEY[idx] ?? "";
    const normVal = normalizePart6Answer(raw);
    const normKey = normalizePart6Answer(keyRaw);
    if (normKey && normVal === normKey) correct++;
  });

  part6CapturedAnswers = null;

  const total = ids.length;
  const payload = {
    part: "part6",
    exercise: "museum-tour",
    correct,
    total,
    answers,
    completedAt: new Date().toISOString(),
  };
  localStorage.setItem("listeningPart6Results", JSON.stringify(payload));

  window.testResults.listening = {
    ...(window.testResults.listening || {}),
    part6: payload,
  };
  persistTestResults();

  if (part6PrepTimerInterval) {
    clearInterval(part6PrepTimerInterval);
    part6PrepTimerInterval = null;
  }
  if (part6AudioInstance) {
    part6AudioInstance.pause();
    part6AudioInstance = null;
  }

  if (openDashboard) showFinalDashboard();
}

function startListeningPart3() {
  startPart3HolidayOneTime();
}

function startListeningSection() {
  syncWritingEssayFromTextareaIfAny();

  const onboardingEl = document.getElementById("onboarding");
  if (onboardingEl) onboardingEl.classList.add("hidden");

  const step7 = document.getElementById("step-7");
  const step8 = document.getElementById("step-8");
  if (step7) step7.classList.add("hidden");
  if (!step8) return;
  step8.classList.remove("hidden");
  step8.classList.add("flex");
  saveCurrentStep("step-8-p3");

  startListeningPart3();
}

function submitListeningPart3Answers() {
  saveCurrentStep("step-8-part6");

  const ids = getListeningPart5QuestionIdsInOrder();
  const answers = {};
  let correct = 0;

  ids.forEach((id, idx) => {
    const el = document.getElementById(`p5-ans-${id}`);
    const val = el ? String(el.value).trim().toUpperCase() : "";
    answers[id] = val;
    const keyRaw = PART5_ANSWER_KEY[idx] ?? "";
    const key = String(keyRaw).trim().toUpperCase();
    if (key && val === key) correct++;
  });

  const total = ids.length;

  const payload = {
    part: "part5",
    correct,
    total,
    answers,
    completedAt: new Date().toISOString(),
  };
  localStorage.setItem("listeningPart5Results", JSON.stringify(payload));

  window.testResults.listening = {
    ...(window.testResults.listening || {}),
    part5: payload,
  };
  persistTestResults();

  if (part5PrepTimerInterval) {
    clearInterval(part5PrepTimerInterval);
    part5PrepTimerInterval = null;
  }
  if (part5AudioInstance) {
    part5AudioInstance.pause();
    part5AudioInstance = null;
  }

  startPart6OneTime();
}

/** Test to'liq tugagach: saqlangan bosqichni tozalab, yakuniy panel */
function showFinalDashboard() {
  localStorage.removeItem("edunext_current_step");
  localStorage.removeItem("activeStep");

  hideAllStepSections();
  hideOnboardingFlow();

  const dash = document.getElementById("step-9-final-dashboard");
  if (!dash) {
    void goToStep11();
    return;
  }

  const reading = JSON.parse(localStorage.getItem("readingResults") || "null");
  const writing = JSON.parse(localStorage.getItem("writingSubmission") || "null");
  const listeningP5 =
    JSON.parse(localStorage.getItem("listeningPart5Results") || "null") ||
    JSON.parse(localStorage.getItem("listeningPart3Results") || "null");
  const listeningP6 = JSON.parse(
    localStorage.getItem("listeningPart6Results") || "null"
  );

  const readEl = document.getElementById("final-summary-reading");
  const writeEl = document.getElementById("final-summary-writing");
  const listEl = document.getElementById("final-summary-listening");
  if (readEl) {
    readEl.textContent = reading
      ? `${reading.correct ?? "—"}/${reading.total ?? "—"} · ${reading.levelResult ?? ""}`
      : "—";
  }
  if (writeEl) {
    if (!writing) {
      writeEl.textContent = "—";
    } else if (writing.diagnostic) {
      const raw = Number(writing.aiScore ?? writing.score ?? writing.structured?.score);
      const maxW = Number.isFinite(Number(writing.aiScoreMax)) ? Number(writing.aiScoreMax) : 5;
      writeEl.textContent = Number.isFinite(raw)
        ? `Writing (AI): ${Math.min(maxW, Math.max(1, Math.round(raw)))}/${maxW} · ${writing.words ?? "—"} so‘z`
        : `${writing.words ?? "—"} so‘z · diagnostika`;
    } else {
      writeEl.textContent = `${writing.words ?? "—"} so'z · yuborilgan`;
    }
  }
  if (listEl) {
    const p5Txt =
      !listeningP5 || typeof listeningP5.correct !== "number"
        ? null
        : listeningP5.part === "part5"
          ? `Part 5 (MC): ${listeningP5.correct}/${listeningP5.total}`
          : `${listeningP5.correct}/${listeningP5.total}`;
    const p6Txt =
      listeningP6 && typeof listeningP6.correct === "number"
        ? `Part 6 (museum): ${listeningP6.correct}/${listeningP6.total}`
        : null;
    const chunks = [];
    if (p5Txt) chunks.push(p5Txt);
    if (p6Txt) chunks.push(p6Txt);
    listEl.textContent = chunks.length ? chunks.join(" · ") : "—";
  }

  dash.classList.remove("hidden");
  dash.classList.add("flex");
}

window.showFinalDashboard = showFinalDashboard;

window.submitListeningPart3Answers = submitListeningPart3Answers;
window.submitListeningMatching = submitListeningPart3Answers;
window.startListeningPart3 = startListeningPart3;
window.startPart5OneTime = startPart5OneTime;
window.renderPart5 = renderPart5;
window.renderNextStepButton = renderNextStepButton;
window.renderPart6 = renderPart6;
window.startPart6OneTime = startPart6OneTime;
window.showFinalSubmitPart6Button = showFinalSubmitPart6Button;
window.showFinishScreen = showFinishScreen;
window.calculateAndShowResults = calculateAndShowResults;
window.analyzeWritingWithGemini = analyzeWritingWithGemini;
window.showFinalFinishScreen = showFinalFinishScreen;
window.showFullResults = showFullResults;
window.submitListeningPart6Answers = submitListeningPart6Answers;

/** PDF / manba asosidagi shaxsiy reja (darajaga qarab To-Do). A2 uchun batafsil 30 kun — `studyPlan.js`. */
const educationData = {
  A2: [
    { task: "Fallback: studyPlan.js yuklanmadi", type: "Grammar" },
  ],
  B1: [
    { task: "Murphy Blue: Unit 10-15 (Conditionals)", type: "Grammar" },
    { task: "TED-Ed: 1 ta video ko'rish", type: "Listening" },
    { task: "B1 Reading: News Article (BBC)", type: "Reading" },
  ],
  B2: [
    { task: "Advanced Grammar in Use: Unit 1", type: "Grammar" },
    { task: "IELTS Podcast: Episode 45", type: "Listening" },
    { task: "Writing: Essay on Technology", type: "Writing" },
  ],
};

/** grammarLexisResults / readingResults dan A2 | B1 | B2 plan kaliti. */
function inferEducationPlanTier() {
  const tierFromProf = planTierFromCefrBandString(__edunextProfile?.level ?? "");
  if (tierFromProf) return tierFromProf;

  let grammar = null;
  let reading = null;
  try {
    grammar = JSON.parse(localStorage.getItem("grammarLexisResults") || "null");
  } catch (_) {
    grammar = null;
  }
  try {
    reading = JSON.parse(localStorage.getItem("readingResults") || "null");
  } catch (_) {
    reading = null;
  }
  const levelRaw = String(reading?.levelResult || grammar?.level || "").trim();

  let band = "B1";
  const mBand = levelRaw.match(/\b([ABC][12])\b/i);
  if (mBand) band = mBand[1].toUpperCase();
  else if (/beginner|elementary|a1|a2/i.test(levelRaw)) band = "A2";
  else if (/advanced|c1|c2/i.test(levelRaw)) band = "C1";

  if (/^A/.test(band)) return "A2";
  if (band === "B2") return "B2";
  if (/^B/.test(band)) return "B1";
  return "B2";
}

function taskTypeToSectionKey(typeStr) {
  const t = String(typeStr || "").trim().toLowerCase();
  if (t === "grammar") return "grammar";
  if (t === "reading") return "reading";
  if (t === "vocabulary") return "vocabulary";
  if (t === "listening") return "listening";
  if (t === "listeningdictation") return "listening_bb_dict";
  if (t === "writing") return "writing";
  return null;
}

/** A2 dashboard: 2 soatlik nazorat + yakuniy `daily_tests` quiz */
const SUPERVISION_MS = 2 * 60 * 60 * 1000;
const SUPERV_DEADLINE_LS = "edunext_supervision_deadline_ms_v1_";
const DAILY_ASSESS_PASS_LS = "edunext_daily_assessment_pass_v1_day_";
const DAILY_ASSESS_NEED_CORRECT = 4;
let __dashSupervisorTimerId = null;
let __dailyAssessmentShowing = false;
let __cachedDailyAssessmentQuestions = null;
let __cachedDailyAssessmentDay = null;
/** Modal yopilgach bir necha soniya ichida takrorlab ochilmasligi uchun */
let __dailyFtDismissCooldownUntil = 0;

function supervisionDeadlineLsKey(day) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(day)) || 1));
  return `${SUPERV_DEADLINE_LS}${d}`;
}

function dailyAssessmentPassedLsKey(day) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(day)) || 1));
  return `${DAILY_ASSESS_PASS_LS}${d}`;
}

function readSupervisionDeadlineMs(day) {
  try {
    const raw = localStorage.getItem(supervisionDeadlineLsKey(day));
    const n = Number(raw);
    if (Number.isFinite(n) && n > Date.now() - SUPERVISION_MS * 48) return n;
  } catch (_) {
    /* ignore */
  }
  const end = Date.now() + SUPERVISION_MS;
  try {
    localStorage.setItem(supervisionDeadlineLsKey(day), String(end));
  } catch (_) {
    /* ignore */
  }
  return end;
}

function supervisionTimerExpired(day) {
  return Date.now() >= readSupervisionDeadlineMs(day);
}

function isDailyAssessmentPassedForDay(day) {
  try {
    return localStorage.getItem(dailyAssessmentPassedLsKey(day)) === "1";
  } catch (_) {
    return false;
  }
}

function markDailyAssessmentPassed(day) {
  try {
    localStorage.setItem(dailyAssessmentPassedLsKey(day), "1");
  } catch (_) {
    /* ignore */
  }
}

function formatHms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function hasListeningWritingCompleteFor(day) {
  const c = getDaySectionCompletion(day);
  return Boolean(c.listening && c.writing);
}

function getFallbackDailyTestQuestions() {
  return [
    {
      prompt: "He ___ tennis on Saturdays.",
      choices: ["plays", "playing", "play", "is play"],
      answer: 0,
    },
    {
      prompt: "I ___ breakfast early yesterday.",
      choices: ["had", "have", "having", "have had"],
      answer: 0,
    },
    {
      prompt: "They ___ to Paris next week.",
      choices: ["went", "go", "will go", "going"],
      answer: 2,
    },
    {
      prompt: "There ___ many students in class.",
      choices: ["was", "were", "is", "been"],
      answer: 1,
    },
    {
      prompt: "She can ___ English well.",
      choices: ["speaks", "speaking", "speak", "to spoke"],
      answer: 2,
    },
    {
      prompt: "This room is ___ than that one.",
      choices: ["more big", "bigger", "most big", "big more"],
      answer: 1,
    },
  ];
}

function stopDashboardSupervisorTimer() {
  if (__dashSupervisorTimerId != null) {
    clearInterval(__dashSupervisorTimerId);
    __dashSupervisorTimerId = null;
  }
}

function refreshDashboardSupervisorBar() {
  const wrap = document.getElementById("dashboard-a2-supervisor");
  const timerEl = document.getElementById("dashboard-supervisor-timer");
  const startBtn = document.getElementById("dashboard-final-test-start-btn");
  const passRow = document.getElementById("dashboard-supervisor-passed-row");
  if (!wrap || !timerEl) return;

  const tier = inferEducationPlanTier();
  if (tier !== "A2") {
    wrap.classList.add("hidden");
    stopDashboardSupervisorTimer();
    passRow?.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  const day = getCurrentStudyDayIndex();

  if (isDailyAssessmentPassedForDay(day)) {
    stopDashboardSupervisorTimer();
    timerEl.textContent = "00:00:00";
    startBtn?.classList.add("hidden");
    passRow?.classList.remove("hidden");
    return;
  }

  passRow?.classList.add("hidden");
  const deadline = readSupervisionDeadlineMs(day);
  const tick = () => {
    const left = deadline - Date.now();
    timerEl.textContent = formatHms(left);
    const lw = hasListeningWritingCompleteFor(day);

    if (startBtn) {
      if (lw) startBtn.classList.remove("hidden");
      else startBtn.classList.add("hidden");
    }

    const expired = left <= 0;
    maybeAutoTriggerDailyAssessment(day, expired || lw);
  };
  tick();
  stopDashboardSupervisorTimer();
  __dashSupervisorTimerId = setInterval(tick, 1000);
}

function bootstrapDashboardSupervisorMode() {
  refreshDashboardSupervisorBar();
}

function maybeAutoTriggerDailyAssessment(day, eligible) {
  if (inferEducationPlanTier() !== "A2") return;
  if (!eligible) return;
  if (__dailyAssessmentShowing) return;
  if (isDailyAssessmentPassedForDay(day)) return;
  if (Date.now() < __dailyFtDismissCooldownUntil) return;
  void openDailyFinalAssessmentUI(day);
}

/** Tugma: faqat L+W tayyor bo‘lsa ko‘rinadi; qo‘lda ochish uchun. */
function onDashboardFinalTestManualStart() {
  const day = getCurrentStudyDayIndex();
  if (!hasListeningWritingCompleteFor(day)) return;
  __dailyFtDismissCooldownUntil = 0;
  void openDailyFinalAssessmentUI(day);
}

async function fetchDailyTestsPayload(dayNum) {
  const sb = ensureSupabase();
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  if (!sb) {
    return { title: `Kun ${d}`, questions: getFallbackDailyTestQuestions() };
  }
  const { data, error } = await sb
    .from("daily_tests")
    .select("title,questions")
    .eq("day_number", d)
    .maybeSingle();

  if (error) console.warn("[daily_tests]", error.message);
  const raw = data?.questions;
  let qs = [];
  if (raw && typeof raw === "object" && Array.isArray(raw.questions)) {
    qs = raw.questions
      .map((x) => ({
        prompt: String(x.prompt ?? ""),
        choices: Array.isArray(x.choices) ? x.choices.map((c) => String(c ?? "")) : [],
        answer: Math.floor(Number(x.answer)) || 0,
      }))
      .filter((x) => x.prompt && x.choices.length >= 2);
  }
  if (qs.length < 6) qs = getFallbackDailyTestQuestions();
  return {
    title: String(data?.title ?? `Kun ${d}`).trim() || `Kunlik test — kun ${d}`,
    questions: qs.slice(0, 6),
  };
}

function closeDailyFinalAssessmentUI() {
  const wasShowing = __dailyAssessmentShowing;
  const shell = document.getElementById("dashboard-final-assessment-modal");
  if (shell) {
    shell.classList.add("hidden");
    shell.setAttribute("aria-hidden", "true");
  }
  __dailyAssessmentShowing = false;
  const day = __cachedDailyAssessmentDay ?? getCurrentStudyDayIndex();
  if (wasShowing && !isDailyAssessmentPassedForDay(day))
    __dailyFtDismissCooldownUntil = Date.now() + 90000;
  refreshDashboardSupervisorBar();
}

function renderDailyAssessmentForm(title, questions) {
  const titleEl = document.getElementById("daily-final-test-title");
  const mount = document.getElementById("daily-final-test-mount");
  const footer = document.getElementById("daily-final-test-footer");
  if (!mount || !footer) return;
  if (titleEl) titleEl.textContent = title;

  const qSel = {};
  mount.innerHTML = questions
    .map((q, qi) => {
      const pid = `dfq_${qi}`;
      const opts = (q.choices || [])
        .map(
          (c, oi) => `
          <button type="button" data-qix="${qi}" data-oix="${oi}"
            class="daily-ft-opt w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-left text-sm text-slate-100 transition hover:border-cyan-400/45 hover:bg-white/10">
            <span class="font-bold text-fuchsia-300/90">${String.fromCharCode(65 + oi)}.</span> ${escapeHtmlStep11(c)}
          </button>`,
        )
        .join("");
      return `<div class="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4" data-qwrap="${qi}">
        <p class="mb-3 text-[15px] font-semibold leading-snug text-white">${escapeHtmlStep11(q.prompt)}</p>
        <div class="grid gap-2">${opts}</div>
      </div>`;
    })
    .join("");

  mount.querySelectorAll(".daily-ft-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const qi = Number(btn.getAttribute("data-qix"));
      const oi = Number(btn.getAttribute("data-oix"));
      qSel[qi] = oi;
      const wrap = btn.closest("[data-qwrap]");
      wrap?.querySelectorAll(".daily-ft-opt").forEach((b) => {
        b.classList.remove(
          "!border-emerald-400",
          "!bg-emerald-500/20",
          "!ring-2",
          "!ring-emerald-400/40",
        );
      });
      btn.classList.add(
        "!border-emerald-400",
        "!bg-emerald-500/20",
        "!ring-2",
        "!ring-emerald-400/40",
      );
    });
  });

  footer.innerHTML = "";
  const sub = document.createElement("button");
  sub.type = "button";
  sub.className =
    "mt-2 w-full rounded-xl border border-cyan-400/50 bg-gradient-to-r from-fuchsia-600/50 to-cyan-600/40 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-[0_0_24px_rgba(52,211,153,0.2)] transition hover:brightness-110";
  sub.textContent = "Natijani yuborish";
  sub.addEventListener("click", () => {
    const day = __cachedDailyAssessmentDay ?? getCurrentStudyDayIndex();
    let correct = 0;
    questions.forEach((q, qi) => {
      if (qSel[qi] === q.answer) correct += 1;
    });
    if (correct >= DAILY_ASSESS_NEED_CORRECT) {
      __dailyFtDismissCooldownUntil = 0;
      markDailyAssessmentPassed(day);
      finalizeStudyDayViaDailyAssessment(day);
      mount.innerHTML = `<div class="rounded-2xl border border-emerald-400/35 bg-emerald-950/50 p-6 text-center">
        <p class="text-xl font-black text-emerald-200">Day ${day} completed!</p>
        <p class="mt-2 text-sm text-slate-200">Tabriklaymiz! Keyingi kunning vazifalariga o‘tishingiz mumkin.</p></div>`;
      footer.innerHTML = "";
      stopDashboardSupervisorTimer();
      refreshDashboardSupervisorBar();
      generatePersonalPlan(inferEducationPlanTier());
      refreshDashboardPlanProgress("A2");
      hydrateDashboardGreetingFromProfile();
      const closeLater = document.createElement("button");
      closeLater.type = "button";
      closeLater.className =
        "mt-6 w-full rounded-xl border border-white/20 bg-white/10 py-3 text-sm font-bold text-white transition hover:bg-white/15";
      closeLater.textContent = "Yopish";
      closeLater.addEventListener("click", () => closeDailyFinalAssessmentUI());
      footer.appendChild(closeLater);
    } else {
      mount.innerHTML = `<div class="rounded-2xl border border-amber-500/35 bg-amber-950/40 p-6 text-center">
        <p class="text-lg font-bold text-amber-100">${correct} ta to‘g‘ri javob (${DAILY_ASSESS_NEED_CORRECT} dan kam)</p>
        <p class="mt-2 text-sm text-slate-200">Iltimos, qayta urinib ko‘ring va savollarni diqqat bilan o‘qing.</p></div>`;
      footer.innerHTML = "";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className =
        "mt-4 w-full rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/35 py-3 text-sm font-bold text-white transition hover:bg-fuchsia-600/45";
      retry.textContent = "Qayta urinish";
      retry.addEventListener("click", () => {
        void renderFullDailyAssessment(day);
      });
      footer.appendChild(retry);
    }
  });
  footer.appendChild(sub);
}

async function renderFullDailyAssessment(day) {
  const payload = await fetchDailyTestsPayload(day);
  __cachedDailyAssessmentQuestions = payload.questions;
  renderDailyAssessmentForm(payload.title, payload.questions);
}

async function openDailyFinalAssessmentUI(day) {
  if (inferEducationPlanTier() !== "A2") return;
  if (isDailyAssessmentPassedForDay(day)) return;

  __cachedDailyAssessmentDay = day;
  const shell = document.getElementById("dashboard-final-assessment-modal");
  if (!shell) return;
  __dailyAssessmentShowing = true;
  shell.classList.remove("hidden");
  shell.setAttribute("aria-hidden", "false");

  await renderFullDailyAssessment(day);
}

const VOCAB_WORD_CHECK_KEY = "edunext_vocab_word_checks_v1";

/** Dashboard Vocabulary Step 2: talab qilinadigan gaplar soni. */
const VOCAB_EXPECTED_SENTENCES = 20;

/**
 * Gap sonini hisoblash — `controllers/aiController.js` ichidagi `countVocabularyStepSentences` bilan bir xil bo'lishi shart.
 * Har bir gap odatda . ? ! bilan tugashi yoki yangi qatordan boshlashi mumkin.
 */
function countDashboardVocabularySentences(raw) {
  const s = String(raw ?? "").trim().replace(/\r\n/g, "\n");
  if (!s) return 0;
  const chunks = s
    .split(/\n+|(?<=[.!?])[ \t]*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return chunks.length;
}

function vocabSentencePhaseStorageKey(day, taskId) {
  const d = String(Math.min(30, Math.max(1, Math.floor(Number(day)) || 1)));
  return `edunext_vocab_sentence_step_${d}_${String(taskId || "vocab")}`;
}

/** Listening Phase 1 (1-hafta): DB `listening_tasks`, 6 daqiqa, 5 ta gap. */
const LISTEN_PHASE1_MAX_DAY = 7;
const LISTEN_PHASE1_MIN_MS = 6 * 60 * 1000;
const LISTEN_LEGACY_MIN_MS = 10 * 60 * 1000;

const LISTEN_TIMER_LS_PREFIX = "edunext_listen_timer_start_d";
const LISTEN_TOPIC_LS_PREFIX = "edunext_listen_topic_d";

/** Admin `listening_tasks.title` generik bo'lsa — kunga mos podcast sarlavhasi. */
const PHASE1_PODCAST_DISPLAY_TITLES = [
  "The benefits of coffee",
  "Everyday English: making suggestions",
  "News review: climate and culture",
  "The English We Speak: useful phrases",
  "6 Minute English: technology in life",
  "Grammar and pronunciation in context",
  "Review: key phrases from the week",
];

function listenTimerStorageKey(dayNum) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  return `${LISTEN_TIMER_LS_PREFIX}${d}_v1`;
}

function loadOrInitListenTimerStartMs(dayNum) {
  const k = listenTimerStorageKey(dayNum);
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const t = Date.now();
    localStorage.setItem(k, String(t));
    return t;
  } catch (_) {
    return Date.now();
  }
}

function clearListenTimerStorage(dayNum) {
  try {
    localStorage.removeItem(listenTimerStorageKey(dayNum));
  } catch (_) {
    /* ignore */
  }
}

function listenTopicStorageKey(dayNum) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  return `${LISTEN_TOPIC_LS_PREFIX}${d}_v1`;
}

/** Server/bo‘yicha sarlavha + refreshda localStorage zaxirasi. */
function resolveListenTopicHeadlineForDisplay(dayNum, phase1, dbTitle) {
  const fromResolver = String(
    phase1 ? resolvePhase1PodcastTitle(dayNum, dbTitle) : resolveLegacyListenHeadline(dayNum),
  ).trim();
  const k = listenTopicStorageKey(dayNum);
  let out = fromResolver;
  try {
    const cached = localStorage.getItem(k);
    if (cached && String(cached).trim() && !out) {
      out = String(cached).trim();
    }
  } catch (_) {
    /* ignore */
  }
  if (!out) {
    try {
      const cached = localStorage.getItem(k);
      if (cached) out = String(cached).trim();
    } catch (_) {
      /* ignore */
    }
  }
  if (!out) {
    out = phase1
      ? resolvePhase1PodcastTitle(dayNum, null)
      : resolveLegacyListenHeadline(dayNum);
  }
  try {
    if (out) localStorage.setItem(k, out);
  } catch (_) {
    /* ignore */
  }
  return out;
}

function clearListenTopicStorage(dayNum) {
  try {
    localStorage.removeItem(listenTopicStorageKey(dayNum));
  } catch (_) {
    /* ignore */
  }
}

function resolvePhase1PodcastTitle(dayNum, dbTitle) {
  const d = Math.min(7, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const raw = String(dbTitle || "").trim();
  if (raw && !/^Hafta\s*1\s*[—-]\s*Listening\s*day\s*\d/i.test(raw)) {
    return raw;
  }
  return PHASE1_PODCAST_DISPLAY_TITLES[d - 1] || `Listening · Day ${d}`;
}

function resolveLegacyListenHeadline(dayNum) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  return `Listening practice · Day ${d}`;
}

/** Inglizcha matnda taxminiy gap soni (Listening summary uchun). */
function countSentencesForListening(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  const parts = t
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 3);
  return parts.length;
}

/** Supabase: `user_listening_progress` → `markDaySectionComplete` (refreshda tiklash). */
async function syncWeek1ListeningProgressFromSupabase() {
  const sb = ensureSupabase();
  if (!sb) return;
  try {
    const {
      data: { session },
    } = await sb.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    const { data: rows, error } = await sb
      .from("user_listening_progress")
      .select("day_number")
      .eq("user_id", uid)
      .eq("week_number", 1);
    if (error) {
      console.warn("[user_listening_progress sync]", error.message);
      return;
    }
    rows?.forEach((r) => {
      const d = Math.min(30, Math.max(1, Math.floor(Number(r.day_number)) || 1));
      markDaySectionComplete(d, "listening");
    });
  } catch (e) {
    console.warn("[syncWeek1ListeningProgress]", e);
  }
}

function formatListenCountdown(msLeft) {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function tokenizeDictationWords(text) {
  const cleaned = String(text || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ");
  const original = cleaned
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return {
    original,
    lower: original.map((x) => x.toLowerCase()),
  };
}

function buildLcsLengths(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function buildDictationOps(userOriginal, userLower, transcriptOriginal, transcriptLower) {
  const dp = buildLcsLengths(userLower, transcriptLower);
  const ops = [];
  let i = userLower.length;
  let j = transcriptLower.length;

  while (i > 0 && j > 0) {
    if (userLower[i - 1] === transcriptLower[j - 1]) {
      ops.push({
        type: "equal",
        user: userOriginal[i - 1],
        transcript: transcriptOriginal[j - 1],
      });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "wrong", user: userOriginal[i - 1] });
      i -= 1;
    } else {
      ops.push({ type: "missing", transcript: transcriptOriginal[j - 1] });
      j -= 1;
    }
  }
  while (i > 0) {
    ops.push({ type: "wrong", user: userOriginal[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    ops.push({ type: "missing", transcript: transcriptOriginal[j - 1] });
    j -= 1;
  }
  return ops.reverse();
}

function buildDictationWordDiffHtml(expectedText, userText, esc) {
  const expectedTokens = tokenizeDictationWords(String(expectedText || "").trim());
  const userTokens = tokenizeDictationWords(String(userText || "").trim());
  const ops = buildDictationOps(
    userTokens.original,
    userTokens.lower,
    expectedTokens.original,
    expectedTokens.lower,
  );

  let correct = 0;
  let wrong = 0;
  let missing = 0;
  const inline = ops
    .map((op) => {
      if (op.type === "equal") {
        correct += 1;
        return `<span class="font-semibold text-emerald-300 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]">${esc(op.transcript)}</span>`;
      }
      if (op.type === "wrong") {
        wrong += 1;
        return `<span class="font-bold text-rose-300 underline decoration-rose-400/70 underline-offset-4 drop-shadow-[0_0_8px_rgba(244,63,94,0.45)]">${esc(op.user)}</span>`;
      }
      missing += 1;
      return `<span class="font-semibold text-amber-200">(${esc(op.transcript)})</span>`;
    })
    .join(" ");

  const baseCount = Math.max(1, correct + wrong + missing);
  const similarity = correct / baseCount;
  return {
    similarity,
    html: `<div class="rounded-xl border border-fuchsia-500/35 bg-black/35 px-4 py-3 text-[15px] leading-relaxed text-slate-100">${inline || '<span class="text-slate-400">Matn mavjud emas.</span>'}</div>`,
    stats: { correct, wrong, missing, total: baseCount },
  };
}

const LISTENING_DICTIONARY_MS = 20 * 60 * 1000;

function listeningTasksColumnMissingInError(err, columnName) {
  const m = String(err?.message ?? "").toLowerCase();
  const c = String(columnName ?? "").toLowerCase();
  return (
    m.includes(c) &&
    (m.includes("does not exist") ||
      m.includes("unknown") ||
      m.includes("schema cache") ||
      m.includes("could not find"))
  );
}

/**
 * `listening_tasks` turli DB sxemalarida: avval `level` + `day_number` (B1/A2),
 * keyin `week_number`+`day_number` (eski), oxirida faqat `day_number`.
 */
async function fetchListeningTasksRow(sb, dayNum, planLevel, selectColumns) {
  const day = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const levelBand = String(planLevel || "A2").trim().toUpperCase() || "A2";
  const cols = selectColumns;

  const rLevel = await sb
    .from("listening_tasks")
    .select(cols)
    .eq("day_number", day)
    .eq("level", levelBand)
    .maybeSingle();
  if (!rLevel.error) return rLevel;
  if (rLevel.error.code === "PGRST116") return rLevel;
  if (!listeningTasksColumnMissingInError(rLevel.error, "level"))
    return rLevel;

  const rWeek = await sb
    .from("listening_tasks")
    .select(cols)
    .eq("week_number", 1)
    .eq("day_number", day)
    .maybeSingle();
  if (!rWeek.error) return rWeek;
  if (rWeek.error.code === "PGRST116") return rWeek;
  if (!listeningTasksColumnMissingInError(rWeek.error, "week_number"))
    return rWeek;

  return await sb.from("listening_tasks").select(cols).eq("day_number", day).maybeSingle();
}

/** Supabase Storage bucket: `day{N}-listening.mp3` (masalan day1-listening.mp3). `audio_url` bo‘sh bo‘lsa shu kalit ishlatiladi. */
const LISTENING_DICTATION_STORAGE_BUCKET = "listening-audio";

// Eslatma: Avvalgi `resolveTranscriptPdfPublicUrl()` funksiyasi va u bilan
// bog‘liq `day{N}-transcript.pdf` Storage fallback'i butunlay olib tashlandi —
// diktat tahlili faqat `listening_tasks.transcript` matn ustunidan foydalanadi.

function resolveListeningDictationAudioPublicUrl(sb, audioUrlRaw, dayNum) {
  const raw = String(audioUrlRaw ?? "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    if (raw) {
      const pathClean = raw.replace(/^\/+/, "");
      const { data: d1 } = sb.storage.from(LISTENING_DICTATION_STORAGE_BUCKET).getPublicUrl(pathClean);
      const u1 = String(d1?.publicUrl ?? "").trim();
      if (u1) return u1;
    }
    const fileName = `day${dayNum}-listening.mp3`;
    const { data: d2 } = sb.storage
      .from(LISTENING_DICTATION_STORAGE_BUCKET)
      .getPublicUrl(fileName);
    return String(d2?.publicUrl ?? "").trim();
  } catch (_) {
    return "";
  }
}

function extractTranscriptTextCandidate(value) {
  if (typeof value === "string") return value.trim();
  if (!value) return "";
  if (Array.isArray(value)) {
    return value
      .map((x) => extractTranscriptTextCandidate(x))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof value === "object") {
    const obj = value;
    const keys = [
      "text",
      "transcript",
      "content",
      "raw",
      "plain",
      "value",
      "body",
      "full_text",
    ];
    for (const k of keys) {
      const v = extractTranscriptTextCandidate(obj[k]);
      if (v) return v;
    }
    return "";
  }
  return "";
}

function pickListeningTranscriptText(row) {
  if (!row || typeof row !== "object") return "";
  const keys = [
    "transcript_text",
    "transcript",
    "transcript_plain",
    "dictation_transcript",
    "audio_transcript",
    "official_transcript",
    "full_transcript",
    "transcript_content",
  ];
  for (const key of keys) {
    const text = extractTranscriptTextCandidate(row[key]);
    if (text && text.length >= 10) return text;
  }
  return "";
}

function listeningDictationStoragePathCandidates(audioUrlRaw, dayNum) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const baseFile = `day${d}-listening.mp3`;
  const bucket = LISTENING_DICTATION_STORAGE_BUCKET;
  const raw = String(audioUrlRaw ?? "").trim();

  const out = [];
  const push = (p) => {
    const x = String(p ?? "")
      .replace(/^\/+/, "")
      .trim();
    if (!x) return;
    if (!out.includes(x)) out.push(x);
  };

  if (raw && !/^https?:\/\//i.test(raw)) {
    push(
      raw.replace(new RegExp(`^${bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "i"), ""),
    );
  }

  push(baseFile);
  push(`public/${baseFile}`);
  push(`audio/${baseFile}`);
  push(`mp3/${baseFile}`);
  push(`${d}-listening.mp3`);
  return out;
}

/**
 * Tinglash uchun ijro URL: avval har bir ehtimoliy obyekt yo‘li bilan `createSignedUrl`,
 * keyin public URL (faqat ochiq bucket uchun). Fayl papkada bo‘lsa (masalan public/) shu yerda ko‘p variant sinab ko‘riladi.
 */
async function resolveListeningDictationPlayableUrl(sb, audioUrlRaw, dayNum) {
  const raw = String(audioUrlRaw ?? "").trim();
  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, kind: "direct", objectPath: "", signErrors: [] };
  }

  const bucket = LISTENING_DICTATION_STORAGE_BUCKET;
  const candidates = listeningDictationStoragePathCandidates(raw, dayNum);

  const signErrors = [];
  for (const objectPath of candidates) {
    const { data: signed, error: signErr } = await sb.storage
      .from(bucket)
      .createSignedUrl(objectPath, 7200);

    if (!signErr && signed?.signedUrl) {
      return {
        url: signed.signedUrl,
        kind: "signed",
        objectPath,
        signErrors,
      };
    }
    if (signErr?.message)
      signErrors.push(`${objectPath}: ${signErr.message}`);
  }

  const primaryPath = candidates[0] || `day${dayNum}-listening.mp3`;
  if (signErrors.length)
    console.warn(
      "[listening dictation] createSignedUrl sinovlari:\n",
      signErrors.join("\n"),
    );

  const pub = resolveListeningDictationAudioPublicUrl(sb, raw || "", dayNum);
  if (!pub) {
    return {
      url: "",
      kind: "none",
      detail: signErrors.length
        ? signErrors.join(" | ")
        : "Imzoli havola chiqmadi",
      objectPath: primaryPath,
      signErrors,
    };
  }
  return {
    url: pub,
    kind: "public",
    detail: signErrors.join(" | ") || undefined,
    objectPath: primaryPath,
    signErrors,
  };
}

function playListeningDictationDoneChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
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
      } catch (_) {
        /* ignore */
      }
    }, 450);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Diktat: foydalanuvchi Listening bo‘limiga kirgan zahoti BBC banner ostida 20:00 taymer va `listening_tasks.audio_url` diktat pleeri DARHOL yuklanadi.
 * Hech qanday «BOSHLASH» tugmasi, modal oyna yoki PDF havolasi yo‘q — auto-start.
 * Taymer davomida ham «AI tahlili» va «So‘zma-so‘z tekshiruv» ko‘rinadi (bosilganda matn talablari tekshiriladi).
 * Vaqt tugagach ham textarea ochiq qoladi; audio qoladi. (PDF havolasi
 * ochilmaydi — tahlil faqat `transcript` matn ustunidan foydalanadi.)
 */
async function setupListeningDictationCard(card, studyDay, taskId, alreadyDoneSection, planLevel) {
  const tid = String(taskId);
  const mount = Array.from(
    card.querySelectorAll("[data-listening-dictation-mount]"),
  ).find((el) => (el.getAttribute("data-listening-dictation-mount") || "") === tid);
  const doneBtn = card.querySelector("[data-lnd-finish-btn]");
  const mainCb = Array.from(
    card.querySelectorAll("input.step11-todo-cb"),
  ).find((el) => (el.getAttribute("data-task-id") || "") === tid);
  if (!mount || !doneBtn || !mainCb) return;

  const listeningPlanLevel = String(planLevel ?? "A2").trim().toUpperCase() || "A2";
  const dayNum = dashboardWritingPathMatches()
    ? 1
    : Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
  const dictationStateKey = `edunext:listening-dictation:${listeningPlanLevel}:day:${dayNum}`;
  let timerId = null;
  /** @type {HTMLAudioElement | null} */
  let sessionAudioEl = null;
  const safeFieldId =
    String(taskId || "x").replace(/[^a-zA-Z0-9_-]/g, "_") + "_lnd";

  const cleanupTimer = () => {
    if (timerId != null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const loadDictationState = () => {
    try {
      const raw = localStorage.getItem(dictationStateKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  };

  const saveDictationState = (patch = {}) => {
    try {
      const prev = loadDictationState() || {};
      const next = { ...prev, ...patch };
      localStorage.setItem(dictationStateKey, JSON.stringify(next));
    } catch (_) {
      /* ignore */
    }
  };

  const clearDictationState = () => {
    try {
      localStorage.removeItem(dictationStateKey);
    } catch (_) {
      /* ignore */
    }
  };

  const bannerOptsStart = () => ({
    bannerTimerPreview: formatListenCountdown(LISTENING_DICTIONARY_MS),
  });

  /**
   * Boot: Listening bo‘limiga kirilgan zahoti foydalanuvchi 20:00 taymer va
   * audio yuklanguncha qisqa loader ko‘radi. Hech qanday «BOSHLASH» modal
   * yoki PDF havolasi yo‘q — `runDictationSession()` darhol chaqiriladi.
   */
  const renderBootingScreen = () => {
    mount.innerHTML = `
      <div class="space-y-8">
        ${listeningBbcPodcastBannerHtml(dayNum, escapeHtmlStep11, bannerOptsStart())}
        <div class="flex min-h-[200px] items-center justify-center rounded-2xl border border-fuchsia-500/30 bg-black/35 px-5 py-12">
          <div class="flex flex-col items-center gap-3 text-center">
            <span class="inline-block h-10 w-10 animate-spin rounded-full border-2 border-fuchsia-500/40 border-t-fuchsia-300"></span>
            <p class="text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-300/90">Diktat yuklanmoqda…</p>
            <p class="max-w-md text-xs text-slate-400">Audio va 20:00 taymer avtomatik ishga tushadi.</p>
          </div>
        </div>
      </div>`;
  };

  doneBtn.onclick = (ev) => {
    if (doneBtn.disabled) return;
    ev.preventDefault();
    markDaySectionComplete(dayNum, "listening_bb_dict");
    mainCb.checked = true;
    toggleTask(mainCb);
    persistStep11Todos();
    doneBtn.disabled = true;
    doneBtn.textContent = "VAZIFANI TUGATDIM — bajarildi";
    refreshDashboardPlanProgress(planLevel);
    // Strict ketma-ketlikda: Listening tugagach Writing kartasiga o‘tamiz.
    try {
      if (typeof generatePersonalPlan === "function") {
        generatePersonalPlan(planLevel);
        window.requestAnimationFrame(() => {
          const target = document.querySelector(
            '#todo-list [data-task-card-for="writing"]',
          );
          if (target) {
            target.classList.remove("hidden");
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.add("ring-2", "ring-fuchsia-500/45");
            window.setTimeout(
              () => target.classList.remove("ring-2", "ring-fuchsia-500/45"),
              1400,
            );
          }
        });
      }
    } catch (_) {
      /* ignore */
    }
  };

  if (alreadyDoneSection) {
    doneBtn.disabled = true;
    doneBtn.textContent = "VAZIFANI TUGATDIM — bajarildi";
    mainCb.checked = true;
    mount.innerHTML = `
      <div class="space-y-8">
        ${listeningBbcPodcastBannerHtml(dayNum, escapeHtmlStep11, {
          bannerTimerPreview: "—",
          hideBannerHint: true,
        })}
        <div class="rounded-2xl border border-white/10 bg-black/30 px-4 py-8 text-center text-sm text-slate-200">
          Diktat vazifasi bajarildi — BBC episodiga qaytib tinglashingiz mumkin.
        </div>
      </div>`;
    return;
  }

  mainCb.checked = false;
  doneBtn.disabled = true;
  renderBootingScreen();

  const runDictationSession = async (resumeState = null) => {
    if (typeof mount.__lndCleanup === "function") {
      try {
        mount.__lndCleanup();
      } catch (_) {
        /* ignore */
      }
      mount.__lndCleanup = null;
    }

    const sb = ensureSupabase();
    if (!sb) {
      console.error("[listening dictation] Supabase client unavailable");
      return;
    }

    const { data, error } = await fetchListeningTasksRow(sb, dayNum, listeningPlanLevel, "*");

    if (error) {
      console.error("[listening dictation] fetch listening_tasks failed:", error);
      return;
    }

    let transcriptText = String(pickListeningTranscriptText(data) || "").trim();

    const playable = await resolveListeningDictationPlayableUrl(
      sb,
      String(data?.audio_url ?? "").trim(),
      dayNum,
    );

    if (!playable.url) {
      console.error("[listening dictation] No playable audio URL", {
        detail: playable.detail,
        objectPath: playable.objectPath,
        signErrors: playable.signErrors,
      });
      return;
    }

    const resumedStartMs = Number(resumeState?.startedAt);
    const startAtMs =
      Number.isFinite(resumedStartMs) && resumedStartMs > 0
        ? resumedStartMs
        : Date.now();
    let sessionEndAtMs = startAtMs + LISTENING_DICTIONARY_MS;
    let msLeft = Math.max(0, sessionEndAtMs - Date.now());
    let timerRunning = false;

    mount.innerHTML = `
      <div class="space-y-8">
        <div class="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-fuchsia-500/35 bg-black/35 px-5 py-4 sm:p-5">
          <div class="min-w-0">
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-300/95">Day ${escapeHtmlStep11(String(dayNum))} — Diktat</p>
            <h4 class="mt-1 text-lg font-black text-white sm:text-xl">Tinglash va yozish</h4>
            <p class="mt-1 max-w-prose text-sm text-slate-400">Bu pleer — kunlik diktant (listening_tasks). Bo‘limga kirgan zahoti audio va 20:00 taymer avtomatik ishga tushadi.</p>
          </div>
          <div class="shrink-0 rounded-2xl border-2 border-fuchsia-500/70 bg-black px-4 py-2.5 text-right shadow-[0_0_20px_rgba(168,85,247,0.22)]">
            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Qolgan vaqt</p>
            <p data-listening-banner-timer class="font-mono text-2xl font-black tabular-nums text-fuchsia-300 sm:text-3xl">${escapeHtmlStep11(formatListenCountdown(msLeft))}</p>
          </div>
        </div>
      <div class="relative rounded-2xl border border-white/10 bg-black/35 p-4 sm:p-6" data-lnd-live>
        <div class="mb-5">
          <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-violet-400/90">Diktant audio</p>
          <audio data-lnd-audio controls preload="metadata" crossorigin="anonymous"
            class="w-full max-w-full rounded-lg border border-violet-800/55 bg-black/50"></audio>
        </div>
        <label for="${safeFieldId}" class="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-violet-300/85">
          Diktat
        </label>
        <textarea id="${safeFieldId}" rows="18" spellcheck="false" autocomplete="off" data-lnd-ta
          placeholder="Eshitganlaringizni yozing…"
          class="min-h-[280px] w-full resize-y rounded-lg border border-violet-800/60 bg-[#0d0314] px-4 py-3 font-mono text-[15px] leading-relaxed text-violet-50 placeholder:text-violet-600/50 outline-none focus:border-violet-600/70 focus:ring-1 focus:ring-violet-500/30"></textarea>
        <div data-lnd-actions class="mt-4 space-y-3">
          <button type="button" data-lnd-ai-btn
            class="dashboard-primary-btn inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-violet-500/55 bg-gradient-to-r from-violet-600/35 to-fuchsia-600/35 px-4 py-3 text-[12px] font-black uppercase tracking-[0.15em] text-violet-50 shadow-[0_0_24px_rgba(139,92,246,0.25)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40">
            AI tahlili
          </button>
          <p data-lnd-ai-micro class="text-center text-[11px] leading-snug text-slate-400">AI oficial transkript bilan siz yozgan diktatni taqqoslaydi.</p>
          <button type="button" data-lnd-check
            class="dashboard-primary-btn inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-fuchsia-500/40 bg-fuchsia-600/15 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-fuchsia-200/95 transition hover:bg-fuchsia-600/25">
            So‘zma-so‘z tekshiruv
          </button>
        </div>
        <div data-lnd-result class="mt-3 hidden rounded-lg border border-white/10 bg-black/35 p-3 text-xs text-slate-100"></div>
        <div data-lnd-writing-cta-wrap class="mt-5 hidden">
          <button
            type="button"
            data-lnd-writing-cta
            class="dashboard-primary-btn inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-fuchsia-400/70 bg-gradient-to-r from-fuchsia-600/35 to-violet-600/35 px-4 py-3 text-[12px] font-black uppercase tracking-[0.14em] text-fuchsia-50 shadow-[0_0_26px_rgba(217,70,239,0.45)] transition hover:brightness-110 hover:shadow-[0_0_34px_rgba(217,70,239,0.6)]"
          >
            Writing bo&apos;limiga o&apos;tish
          </button>
        </div>
      </div></div>`;

    const bannerTimerEl = mount.querySelector("[data-listening-banner-timer]");
    sessionAudioEl = mount.querySelector("audio[data-lnd-audio]");
    const ta = mount.querySelector("[data-lnd-ta]");
    const actionsWrap = mount.querySelector("[data-lnd-actions]");
    const aiBtn = mount.querySelector("[data-lnd-ai-btn]");
    const checkBtn = mount.querySelector("[data-lnd-check]");
    const resultRoot = mount.querySelector("[data-lnd-result]");
    const writingCtaWrap = mount.querySelector("[data-lnd-writing-cta-wrap]");
    const writingCtaBtn = mount.querySelector("[data-lnd-writing-cta]");
    const footHint = card.querySelector("[data-lnd-foot-hint]");
    let dictationPassed = false;
    const restoredText = String(resumeState?.userText ?? "");
    if (ta && restoredText) ta.value = restoredText;

    const finalizeListeningSuccess = () => {
      if (dictationPassed) return;
      dictationPassed = true;
      cleanupTimer();
      timerRunning = false;
      if (aiBtn) aiBtn.disabled = true;
      if (checkBtn) checkBtn.disabled = true;
      markDaySectionComplete(dayNum, "listening_bb_dict");
      mainCb.checked = true;
      toggleTask(mainCb);
      persistStep11Todos();
      doneBtn.disabled = true;
      doneBtn.textContent = "VAZIFANI TUGATDIM — bajarildi";
      clearDictationState();
      if (footHint) footHint.textContent = "Diktant muvaffaqiyatli: Writing bo‘limi ochildi.";
      refreshDashboardPlanProgress(planLevel);
      generatePersonalPlan(planLevel);
      window.requestAnimationFrame(() => {
        const target = document.querySelector(
          '#todo-list [data-task-card-for="writing"]',
        );
        if (target) {
          target.classList.remove("hidden");
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("ring-2", "ring-fuchsia-500/45");
          window.setTimeout(
            () => target.classList.remove("ring-2", "ring-fuchsia-500/45"),
            1400,
          );
        }
      });
    };

    const updateDictationActionsVisibility = () => {
      if (!actionsWrap || dictationPassed) return;
      actionsWrap.classList.remove("hidden");
    };

    const showWritingTransitionButton = () => {
      if (!writingCtaWrap) return;
      writingCtaWrap.classList.remove("hidden");
    };

    writingCtaBtn?.addEventListener("click", () => {
      try {
        localStorage.setItem("edunext_current_study_day", "1");
        localStorage.setItem("currentDay", "1");
      } catch (_) {
        /* ignore */
      }
      window.location.assign("/dashboard/writing");
    });

    const reloadTranscriptForCurrentDay = async () => {
      try {
        const { data: latestRow } = await fetchListeningTasksRow(
          sb,
          1,
          listeningPlanLevel,
          "*",
        );
        const latestTranscript = String(
          pickListeningTranscriptText(latestRow) || "",
        ).trim();
        if (latestTranscript) transcriptText = latestTranscript;
        return latestTranscript;
      } catch (err) {
        console.warn("[listening dictation] transcript refresh failed", err);
        return String(transcriptText || "").trim();
      }
    };

    const runTimerTick = () => {
      msLeft = Math.max(0, sessionEndAtMs - Date.now());
      if (msLeft <= 0) {
        cleanupTimer();
        timerRunning = false;
        msLeft = 0;
        if (bannerTimerEl) {
          bannerTimerEl.textContent = formatListenCountdown(0);
          bannerTimerEl.classList.remove("text-fuchsia-300");
          bannerTimerEl.classList.add("text-amber-200");
        }
        if (ta) {
          ta.readOnly = false;
          ta.classList.remove("opacity-90", "cursor-default");
        }
        saveDictationState({ startedAt: startAtMs, userText: String(ta?.value ?? ""), expired: true });
        playListeningDictationDoneChime();
        doneBtn.disabled = true;
        if (footHint)
          footHint.textContent =
            'Vaqt tugadi. Ostidagi «AI tahlili» orqali yozgan diktantingiz rasmiy transkript bilan solishtiriladi (80%+ → muvaffaqiyat). Kerak bo\'lsa «So\'zma-so\'z tekshiruv».';
        updateDictationActionsVisibility();
        try {
          actionsWrap?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (_) {
          try {
            actionsWrap?.scrollIntoView?.();
          } catch (__) {
            /* ignore */
          }
        }
        return;
      }
      if (bannerTimerEl) bannerTimerEl.textContent = formatListenCountdown(msLeft);
    };

    const startSessionTimer = () => {
      if (timerRunning) return;
      timerRunning = true;
      cleanupTimer();
      msLeft = Math.max(0, sessionEndAtMs - Date.now());
      mount.querySelector("[data-listening-banner-timer-hint]")?.classList.add("hidden");
      if (bannerTimerEl) {
        bannerTimerEl.textContent = formatListenCountdown(msLeft);
        bannerTimerEl.classList.add("text-fuchsia-300");
        bannerTimerEl.classList.remove("text-amber-200");
      }
      timerId = window.setInterval(runTimerTick, 1000);
      runTimerTick();
    };

    if (sessionAudioEl) {
      const ael = sessionAudioEl;
      ael.volume = 1;
      ael.preload = "metadata";
      ael.crossOrigin = "anonymous";
      ael.src = playable.url;

      ael.addEventListener(
        "error",
        () => {
          const ie = ael.error;
          console.error("[listening dictation] <audio> error", {
            mediaError: ie
              ? { code: ie.code, message: ie.message }
              : null,
            networkState: ael.networkState,
            readyState: ael.readyState,
            src: ael.currentSrc || ael.src,
          });
        },
        { once: true },
      );

      const detachGlobalListeners = () => {
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("visibilitychange", onVisibilityHidden);
      };

      const stopAndResetAudio = () => {
        try {
          ael.pause();
          ael.removeAttribute("src");
          ael.load();
        } catch (_) {
          /* ignore */
        }
      };

      const onPageHide = () => {
        if (typeof mount.__lndCleanup === "function") mount.__lndCleanup();
      };

      const onVisibilityHidden = () => {
        if (document.visibilityState === "hidden") ael.pause();
      };

      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("visibilitychange", onVisibilityHidden);

      mount.__lndCleanup = () => {
        cleanupTimer();
        detachGlobalListeners();
        stopAndResetAudio();
        sessionAudioEl = null;
      };
    } else {
      mount.__lndCleanup = () => {
        cleanupTimer();
      };
    }

    startSessionTimer();

    if (footHint)
      footHint.textContent =
        "20 daqiqalik taymer va audio avtomatik ishga tushdi. Matn yozib bo‘lsangiz, 20 daqiqani kutmasdan ham ostidagi «AI tahlili» tugmasidan foydalanishingiz mumkin.";

    ta?.addEventListener("input", () => {
      saveDictationState({
        startedAt: startAtMs,
        userText: String(ta.value ?? ""),
        expired: msLeft <= 0,
      });
      updateDictationActionsVisibility();
    });
    updateDictationActionsVisibility();

    const escAi = escapeHtmlStep11;

    aiBtn?.addEventListener("click", async () => {
      if (!ta || !resultRoot || dictationPassed) return;
      const learner = String(ta.value ?? "").trim();
      resultRoot.classList.remove("hidden");
      if (!learner || learner.length < 10) {
        resultRoot.innerHTML = `<p class="text-rose-300">AI tahlil uchun diktatda kamida 10 ta belgi bo‘lishi kerak.</p>`;
        return;
      }
      aiBtn.disabled = true;
      const prevAiLabel = aiBtn.textContent;
      aiBtn.textContent = "Tekshiryapmiz…";
      try {
        const refreshedTranscript = await reloadTranscriptForCurrentDay();
        const referenceTranscript = String(
          refreshedTranscript || transcriptText || "",
        ).trim();
        const { res, payload: data } = await handleCheck(
          async () => {
            const r = await fetch(apiUrl("/api/ai/validate-dictation"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userText: learner,
                referenceTranscript,
                dayNumber: dayNum,
              }),
            });
            let p = {};
            try {
              p = await r.json();
            } catch (_) {
              p = {};
            }
            return { res: r, payload: p };
          },
          { delayMs: 5000, maxAttempts: 12 },
        );
        if (!res.ok || !data.success) {
          const err =
            typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        const fallbackDiff = buildDictationWordDiffHtml(
            referenceTranscript || learner,
            learner,
            escapeHtmlStep11,
          );
          const fallbackPct = Math.round(Number(fallbackDiff.similarity || 0) * 100);
          resultRoot.innerHTML = `<p class="mb-2 font-semibold text-rose-200">${escAi(err)}</p>
            <p class="mb-2 font-bold text-fuchsia-200">Neon matnli solishtirish (fallback): ${fallbackPct}%</p>
            ${fallbackDiff.html}`;
          showWritingTransitionButton();
          return;
        }
        const pct = Number(data.accuracyPercent);
        const acc = Number.isFinite(pct) ? Math.round(pct) : 0;
        const passAi = acc >= 80;
        const spell = Array.isArray(data.spellingMistakes)
          ? data.spellingMistakes
          : [];
        const miss = Array.isArray(data.missingWordsOrPhrases)
          ? data.missingWordsOrPhrases
          : [];
        const extra = Array.isArray(data.extraIncorrectBits)
          ? data.extraIncorrectBits
          : [];
        const spellHtml = spell
          .map((row) => {
            if (!row || typeof row !== "object") return "";
            const w = escAi(String(row.studentWrote ?? "").trim()) || "—";
            const c = escAi(String(row.correct ?? "").trim()) || "—";
            const n = escAi(String(row.noteUz ?? "").trim());
            return `<div class="mt-2 rounded border border-white/10 bg-black/30 px-3 py-2 text-[13px]">
<span class="text-rose-200">Yozilgan:</span> ${w}
 · <span class="text-emerald-200">To‘g‘ri:</span> ${c}
 ${n ? `<p class="mt-1 text-slate-400">${n}</p>` : ""}</div>`;
          })
          .filter(Boolean)
          .join("");
        const missHtml = miss
          .filter(Boolean)
          .map(
            (x) =>
              `<li class="ml-5 list-disc text-amber-200/90">${escAi(String(x))}</li>`,
          )
          .join("");
        const extraHtml = extra
          .filter(Boolean)
          .map(
            (x) =>
              `<li class="ml-5 list-disc text-rose-200/90">${escAi(String(x))}</li>`,
          )
          .join("");
        const fb = escAi(String(data.feedbackUz ?? "").trim());
        const neonDiff = buildDictationWordDiffHtml(
          referenceTranscript || learner,
          learner,
          escapeHtmlStep11,
        );
        const neonPct = Math.round(Number(neonDiff.similarity || 0) * 100);

        resultRoot.innerHTML = `
          <div class="mb-4 border-l-4 ${passAi ? "border-emerald-500" : "border-rose-500"} bg-white/5 pl-4 py-2">
            <p class="text-sm font-black ${passAi ? "text-emerald-200" : "text-rose-200"}">
              AI aniqligi: ${acc}% ${passAi ? "— muvaffaqiyat (≥80)" : "— ≥80 kerak"}
            </p>
          </div>
          <div class="mb-4 whitespace-pre-wrap rounded border border-violet-500/30 bg-black/35 px-3 py-2 text-[13px] leading-relaxed">${fb || '<span class="text-slate-500">Izoh mavjud emas.</span>'}</div>
          ${
            spellHtml
              ? `<div class="mb-3"><p class="mb-1 font-semibold text-slate-300">So‘zdagi farqlar</p>${spellHtml}</div>`
              : ""
          }
          ${
            missHtml
              ? `<div class="mb-3"><p class="mb-1 font-semibold text-slate-300">Yetishmayotgilar / zo‘rilgan qism</p><ul class="space-y-1">${missHtml}</ul></div>`
              : ""
          }
          ${
            extraHtml
              ? `<div class="mb-2"><p class="mb-1 font-semibold text-slate-300">Ortiqcha / asosiz</p><ul class="space-y-1">${extraHtml}</ul></div>`
              : ""
          }
          <div class="mt-4 rounded-xl border border-fuchsia-500/35 bg-fuchsia-950/15 px-3 py-3">
            <p class="mb-2 text-[11px] font-bold uppercase tracking-wider text-fuchsia-200">Original transkript (matnli tahlil)</p>
            <p class="mb-1 text-xs text-slate-300">To‘g‘ri: <span class="text-emerald-300">${neonDiff.stats?.correct ?? 0}</span> · Xato: <span class="text-rose-300">${neonDiff.stats?.wrong ?? 0}</span> · Tushib qolgan: <span class="text-amber-200">${neonDiff.stats?.missing ?? 0}</span></p>
            <p class="mb-2 text-sm font-black text-fuchsia-100">Similarity: ${neonPct}%</p>
            ${neonDiff.html}
          </div>`;
        showWritingTransitionButton();
        if (passAi) {
          finalizeListeningSuccess();
          if (footHint) footHint.textContent = "AI tahlili: muvaffaqiyat — Reading bo‘limi ochildi.";
        } else if (footHint) {
          footHint.textContent = "AI aniqligi 80%+ bo‘lsa yoki «So‘zma-so‘z» bilan 80%+ o‘xshashlik kiriting.";
        }
      } catch (err) {
        console.error("[listening dictation] validate-dictation", err);
        resultRoot.innerHTML = `<p class="text-rose-300">${escAi(err?.message ?? "AI so‘rovida xatolik")}</p>`;
        showWritingTransitionButton();
      } finally {
        aiBtn.disabled = dictationPassed;
        aiBtn.textContent = prevAiLabel;
      }
    });

    checkBtn?.addEventListener("click", () => {
      if (!ta || !resultRoot) return;
      const learner = String(ta.value || "").trim();
      resultRoot.classList.remove("hidden");
      if (!learner) {
        resultRoot.innerHTML = `<p class="text-rose-300">Iltimos, avval diktat matnini yozing.</p>`;
        return;
      }
      const { similarity, html } = buildDictationWordDiffHtml(
        String(transcriptText || "").trim() || learner,
        learner,
        escapeHtmlStep11,
      );
      const pct = Math.round(similarity * 100);
      const pass = similarity > 0.8;
      resultRoot.innerHTML = `
        <p class="mb-2 font-bold ${pass ? "text-emerald-200" : "text-rose-200"}">
          Similarity: ${pct}% ${pass ? "— Muvaffaqiyatli" : "— Yetarli emas (80%+ kerak)"}
        </p>
        <p class="mb-2 text-[11px] font-bold uppercase tracking-wider text-fuchsia-200">Original transkript (matnli tahlil)</p>
        ${html}
      `;
      if (pass) finalizeListeningSuccess();
      else {
        doneBtn.disabled = true;
        if (footHint) footHint.textContent = "80%+ o‘xshashlikka erishing, shunda Reading ochiladi.";
      }
    });
  };

  // Auto-start: foydalanuvchi Listening bo‘limiga kirgan zahoti dars
  // komponenti (Taymer + AudioPlayer + Diktant maydoni) DARHOL yuklanadi.
  // Hech qanday «BOSHLASH» tugmasi yoki PDF havolasi yo‘q.
  const persisted = loadDictationState();
  if (persisted && Number.isFinite(Number(persisted.startedAt))) {
    await runDictationSession({
      startedAt: Number(persisted.startedAt),
      userText: String(persisted.userText ?? ""),
      expired: Boolean(persisted.expired),
    });
  } else {
    const autoStartAt = Date.now();
    saveDictationState({ startedAt: autoStartAt, userText: "", expired: false });
    await runDictationSession({ startedAt: autoStartAt, userText: "", expired: false });
  }

  // Diktant maydonini avtomatik fokuslash — foydalanuvchi yozishni darhol
  // boshlay olishi uchun. (Brauzer audio autoplay bilan bir vaqtda fokusni
  // qabul qilishi uchun keyingi tick'da chaqiramiz.)
  try {
    window.requestAnimationFrame(() => {
      const ta = mount.querySelector("[data-lnd-ta]");
      if (ta && !ta.readOnly && !ta.disabled) {
        try {
          ta.focus({ preventScroll: true });
        } catch (_) {
          ta.focus();
        }
      }
    });
  } catch (_) {
    /* ignore */
  }
}

/**
 * A2 Listening: Phase 1 (kun 1–7) — Supabase `listening_tasks` + 6 daqiqa + 5 gap + `user_listening_progress`.
 * Kun 8+ — 10 daqiqa, video tugashi, 50–100 so'z, analyze-writing.
 */
async function setupListeningTaskCard(card, studyDay, taskId, fallbackYoutubeId, alreadyDonePre) {
  const mount = card.querySelector(`[data-listen-mount="${taskId}"]`);
  if (!mount) return;
  const dayNum = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
  const phase1 = dayNum <= LISTEN_PHASE1_MAX_DAY;

  const sb = ensureSupabase();
  let effectiveYoutubeId = String(fallbackYoutubeId || "").trim();
  let listeningTaskId = null;
  let progressRow = null;
  let listeningTaskTitleFromDb = null;

  if (phase1 && sb) {
    const { data: taskRow, error: taskErr } = await fetchListeningTasksRow(
      sb,
      dayNum,
      "A2",
      "id,youtube_id,title",
    );
    if (taskErr) console.warn("[listening_tasks]", taskErr.message);
    if (taskRow?.title) listeningTaskTitleFromDb = String(taskRow.title).trim();
    if (taskRow?.youtube_id) {
      effectiveYoutubeId = String(taskRow.youtube_id).trim();
      listeningTaskId = taskRow.id ?? null;
    }
    const {
      data: { session },
    } = await sb.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      const { data: prog, error: pErr } = await sb
        .from("user_listening_progress")
        .select("*")
        .eq("user_id", uid)
        .eq("week_number", 1)
        .eq("day_number", dayNum)
        .maybeSingle();
      if (pErr) console.warn("[user_listening_progress]", pErr.message);
      progressRow = prog ?? null;
    }
  }

  const alreadyDone = Boolean(alreadyDonePre) || Boolean(progressRow?.completed_at);

  if (!effectiveYoutubeId) {
    mount.innerHTML = `<p class="text-xs text-amber-300">YouTube video topilmadi — \`listening_tasks\` jadvalini tekshiring.</p>`;
    return;
  }

  const podcastHeadline = resolveListenTopicHeadlineForDisplay(
    dayNum,
    phase1,
    listeningTaskTitleFromDb,
  );

  if (alreadyDone) {
    const scoreNote =
      progressRow?.score != null
        ? `<p class="mt-2 text-xs text-amber-200/90">Ball: ${escapeHtmlStep11(String(progressRow.score))}/100</p>`
        : "";
    mount.innerHTML = `
      <div class="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-center">
        <p class="text-sm font-semibold text-amber-100/95">Bugungi listening vazifasi bajarildi.</p>
        ${scoreNote}
        <p class="mt-2 text-xs text-slate-400">Keyingi kun — yangi video.</p>
      </div>`;
    return;
  }

  const listenMinMs = phase1 ? LISTEN_PHASE1_MIN_MS : LISTEN_LEGACY_MIN_MS;
  const timerHint = phase1
    ? "Taymer sahifa yuklanganda avtomatik boshlanadi (06:00). Boshqa oynada tinglasangiz ham, qolgan vaqt bu yerda hisoblanadi. Refresh qilsangiz, localStorage orqali davom etadi."
    : "Taymer avtomatik (10:00), refreshda localStorage orqali saqlanadi. YouTube boshqa tabda tinglanishi mumkin.";
  const summaryBlurb = phase1
    ? `Eshitganlaringiz bo'yicha <span class="font-semibold text-amber-100">5 ta gap yozing</span> (inglizcha).`
    : `Eshitganlaringiz bo'yicha 50–100 ta so'zda (inglizcha) yozing; AI grammatik xatolarni tuzatadi.`;
  const wcLabel = phase1 ? "Gaplar:" : "So'zlar:";
  const aiBtnLabel = phase1 ? "Yuborish" : "AI Mentor tekshiruvi";

  mount.innerHTML = `
    <div class="listen-inner space-y-4" data-listen-inner>
      <div class="mx-auto max-w-lg rounded-2xl border-2 border-amber-400/55 bg-gradient-to-b from-zinc-950/95 via-black/90 to-zinc-950/95 px-5 py-8 text-center shadow-[0_0_36px_rgba(251,191,36,0.22),0_0_14px_rgba(245,158,11,0.12),inset_0_1px_0_rgba(255,255,255,0.07)] sm:px-8 sm:py-9" data-listen-bbc-card>
        <div class="mx-auto mb-4 flex items-center justify-center gap-2 border-b border-amber-500/25 pb-4">
          <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-500/10 text-lg font-black text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.25)]">BBC</span>
          <span class="text-left text-[11px] font-bold uppercase leading-tight tracking-[0.2em] text-amber-100/95 sm:text-xs">
            BBC Learning<br/><span class="text-amber-50/90">English</span>
          </span>
        </div>
        <p class="mb-3 text-center sm:mb-4">
          <span class="text-[9px] font-semibold uppercase tracking-[0.28em] text-slate-500/70 sm:text-[10px]">BUGUNGI MAVZU:</span>
          <span class="mx-1.5 text-[8px] text-slate-600/50 sm:mx-2 sm:text-[9px]">·</span>
          <span class="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500/70 sm:text-[10px]">TODAY'S TOPIC:</span>
        </p>
        <h3 class="mx-auto max-w-[95%] text-center text-xl font-bold leading-snug text-slate-300 drop-shadow-[0_0_22px_rgba(203,213,225,0.22)] sm:text-2xl md:text-3xl">
          ${escapeHtmlStep11(podcastHeadline)}
        </h3>
        <p class="mt-5 text-[11px] leading-relaxed text-slate-500/90">
          Taymer pastda — tinglash vaqtingizni bu yerda kuzating.
        </p>
      </div>
      <p data-listen-timer class="text-xs font-semibold text-amber-200/95">${escapeHtmlStep11(timerHint)}</p>
      <div data-listen-countdown-panel class="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-black/35 py-3 px-4 shadow-[inset_0_0_20px_rgba(0,0,0,0.35)]">
        <span class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Qolgan vaqt</span>
        <span data-listen-countdown class="font-mono text-4xl font-black tabular-nums tracking-tight text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.35)]">${formatListenCountdown(listenMinMs)}</span>
      </div>
      <button type="button" data-listen-confirm
        class="listen-confirm-btn w-full rounded-xl border border-slate-600/55 bg-slate-800/60 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 shadow-none transition cursor-not-allowed disabled:pointer-events-none">
        Vazifani tugatdim
      </button>
      <div data-listen-write-wrap class="hidden space-y-3 rounded-xl border border-amber-400/35 bg-gradient-to-b from-amber-500/10 to-fuchsia-950/15 p-3 shadow-[0_0_28px_rgba(251,191,36,0.12)] sm:p-4">
        <p data-listen-summary-label class="text-xs font-medium text-amber-50/95 sm:text-sm">${summaryBlurb}</p>
        <textarea data-listen-textarea rows="6"
          class="w-full rounded-lg border border-amber-500/25 bg-black/45 px-3 py-2 text-sm text-amber-50 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none focus:ring-1 focus:ring-amber-400/40"
          placeholder="Masalan: I learned that ..."></textarea>
        <p data-listen-wc class="text-[11px] text-slate-400"></p>
        <button type="button" data-listen-ai-submit
          class="w-full rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/30 py-2.5 text-xs font-bold uppercase tracking-wide text-fuchsia-100 shadow-[0_0_16px_rgba(217,70,239,0.2)] transition hover:bg-fuchsia-600/45 disabled:opacity-40">
          ${escapeHtmlStep11(aiBtnLabel)}
        </button>
        <div data-listen-ai-out class="hidden rounded-lg border border-amber-500/20 bg-black/35 p-3 text-xs text-slate-100"></div>
      </div>
    </div>`;

  const timerEl = mount.querySelector("[data-listen-timer]");
  const countdownEl = mount.querySelector("[data-listen-countdown]");
  const countdownPanel = mount.querySelector("[data-listen-countdown-panel]");
  const confirmBtn = mount.querySelector("[data-listen-confirm]");
  const writeWrap = mount.querySelector("[data-listen-write-wrap]");
  const textarea = mount.querySelector("[data-listen-textarea]");
  const wcEl = mount.querySelector("[data-listen-wc]");
  const aiBtn = mount.querySelector("[data-listen-ai-submit]");
  const aiOut = mount.querySelector("[data-listen-ai-out]");

  const CLS_COUNTDOWN_RUN = `font-mono text-4xl font-black tabular-nums tracking-tight text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.35)]`;
  const CLS_COUNTDOWN_DONE = `font-mono text-4xl font-black tabular-nums tracking-tight text-emerald-400 drop-shadow-[0_0_18px_rgba(52,211,153,0.55)]`;
  const CLS_CONFIRM_LOCKED = `listen-confirm-btn w-full rounded-xl border border-slate-600/60 bg-slate-800/70 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 shadow-none pointer-events-none cursor-not-allowed opacity-95`;
  const CLS_CONFIRM_NEON = `listen-confirm-btn w-full rounded-xl border border-emerald-400/85 bg-gradient-to-b from-emerald-500/25 to-emerald-600/15 py-3 text-xs font-bold uppercase tracking-wide text-emerald-50 shadow-[0_0_28px_rgba(52,211,153,0.52),0_0_12px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:border-emerald-300/95 hover:from-emerald-500/35 hover:to-emerald-600/25 hover:shadow-[0_0_36px_rgba(52,211,153,0.62)] cursor-pointer`;
  const CLS_CONFIRM_DONE = `listen-confirm-btn w-full rounded-xl border border-slate-600/50 bg-slate-800/50 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 shadow-none cursor-default opacity-80`;

  let playStartMs = null;
  let timerReady = false;
  let videoEnded = false;
  let listeningConfirmed = false;
  let timerInterval = null;

  function applyListenConfirmStyle() {
    if (!confirmBtn) return;
    if (!timerReady) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Vazifani tugatdim";
      confirmBtn.className = CLS_CONFIRM_LOCKED;
      return;
    }
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Vazifani tugatdim";
    confirmBtn.className = CLS_CONFIRM_NEON;
  }

  function applyListenConfirmCompleted() {
    if (!confirmBtn) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Bajarildi";
    confirmBtn.className = CLS_CONFIRM_DONE;
  }

  function updateCountdownDigits(leftMs, phaseDone) {
    if (!countdownEl) return;
    if (phaseDone || timerReady) {
      countdownEl.textContent = "00:00";
      countdownEl.className = CLS_COUNTDOWN_DONE;
      countdownPanel?.classList.add("border-emerald-500/35", "shadow-[0_0_20px_rgba(52,211,153,0.15)]");
      return;
    }
    countdownEl.textContent = formatListenCountdown(leftMs);
    countdownEl.className = CLS_COUNTDOWN_RUN;
    countdownPanel?.classList.remove("border-emerald-500/35", "shadow-[0_0_20px_rgba(52,211,153,0.15)]");
  }

  function updateTimerUi() {
    if (!timerEl) return;
    if (!playStartMs) {
      timerEl.textContent = timerHint;
      updateCountdownDigits(listenMinMs, false);
      return;
    }
    const elapsed = Date.now() - playStartMs;
    const left = listenMinMs - elapsed;
    if (left <= 0) {
      if (!timerReady) {
        timerReady = true;
        if (phase1) {
          listeningConfirmed = true;
          revealPhase1Summary();
          if (confirmBtn) {
            confirmBtn.textContent = "Vazifani tugatdim";
          }
          applyListenConfirmStyle();
          timerEl.textContent =
            "Eshitganlaringiz bo'yicha 5 ta gap yozing (inglizcha), so'ng «Yuborish».";
        } else {
          listeningConfirmed = true;
          videoEnded = true;
          writeWrap?.classList.remove("hidden");
          if (confirmBtn) {
            confirmBtn.textContent = "Vazifani tugatdim";
          }
          applyListenConfirmStyle();
          timerEl.textContent =
            "50–100 so'z yozing (inglizcha) va «AI Mentor tekshiruvi»ni bosing.";
          syncAiButton();
        }
        updateCountdownDigits(0, true);
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
      }
      return;
    }
    const label = phase1 ? "Real vaqt taymer (6 daqiqa):" : "Real vaqt taymer:";
    timerEl.textContent = `${label} ${formatListenCountdown(left)}`;
    updateCountdownDigits(left, false);
  }

  function startListenClock() {
    if (timerInterval) return;
    timerInterval = window.setInterval(updateTimerUi, 250);
    updateTimerUi();
  }

  function syncAiButton() {
    const t = String(textarea?.value ?? "");
    if (phase1) {
      const sc = countSentencesForListening(t);
      if (wcEl) wcEl.textContent = `${wcLabel} ${sc} (kamida 5 ta)`;
      if (aiBtn) aiBtn.disabled = !(listeningConfirmed && sc >= 5);
    } else {
      const wc = getWordCount(t);
      if (wcEl) wcEl.textContent = `${wcLabel} ${wc} (50–100 oralig'i)`;
      const okWc = wc >= 50 && wc <= 100;
      if (aiBtn) aiBtn.disabled = !(listeningConfirmed && videoEnded && okWc);
    }
  }

  function revealPhase1Summary() {
    if (!writeWrap) return;
    writeWrap.classList.remove("hidden");
    if (timerEl) {
      timerEl.textContent =
        "Eshitganlaringiz bo'yicha 5 ta gap yozing (inglizcha), so'ng «Yuborish».";
    }
    syncAiButton();
    textarea?.focus?.();
  }

  playStartMs = loadOrInitListenTimerStartMs(dayNum);
  const elapsedOnMount = Date.now() - playStartMs;
  if (elapsedOnMount >= listenMinMs) {
    timerReady = true;
    listeningConfirmed = true;
    if (phase1) {
      revealPhase1Summary();
      if (timerEl) {
        timerEl.textContent =
          "Eshitganlaringiz bo'yicha 5 ta gap yozing (inglizcha), so'ng «Yuborish».";
      }
    } else {
      videoEnded = true;
      writeWrap?.classList.remove("hidden");
      if (timerEl) {
        timerEl.textContent =
          "50–100 so'z yozing (inglizcha) va «AI Mentor tekshiruvi»ni bosing.";
      }
      syncAiButton();
    }
    applyListenConfirmStyle();
    updateCountdownDigits(0, true);
    if (confirmBtn) confirmBtn.textContent = "Vazifani tugatdim";
  } else {
    applyListenConfirmStyle();
    startListenClock();
  }
  syncAiButton();

  confirmBtn?.addEventListener("click", () => {
    if (!timerReady) return;
    textarea?.focus?.();
  });

  textarea?.addEventListener("input", syncAiButton);

  aiBtn?.addEventListener("click", async () => {
    const text = String(textarea?.value ?? "").trim();
    if (phase1) {
      if (countSentencesForListening(text) < 5) return;
    } else {
      const wc = getWordCount(text);
      if (wc < 50 || wc > 100) return;
    }

    aiBtn.disabled = true;
    if (aiOut) {
      aiOut.classList.remove("hidden");
      aiOut.innerHTML = `<p class="text-slate-300">Tahlil qilinmoqda...</p>`;
    }

    try {
      if (phase1) {
        const sessionUserId = (await sb?.auth.getSession())?.data?.session?.user?.id ?? null;
        if (!sb || !sessionUserId) {
          if (aiOut)
            aiOut.innerHTML = `<p class="text-red-300">Listeningni saqlash uchun tizimga kiring.</p>`;
          aiBtn.disabled = false;
          return;
        }

        const { res, payload: j } = await handleCheck(
          async () => {
            const r = await fetch(apiUrl("/api/ai/validate-listening-summary"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                dayNumber: dayNum,
                podcastTopic: podcastHeadline,
              }),
            });
            const p = await r.json().catch(() => ({}));
            return { res: r, payload: p };
          },
          { delayMs: 5000, maxAttempts: 12 },
        );
        if (!res.ok || !j.success) {
          if (aiOut) {
            const msg = isGroqRateLimitPayload(res, j)
              ? "AI serveri vaqtinchalik band — qayta urinish tugadi; biroz kutib yana «AI tahlil»ni bosing."
              : j.error || "So'rov xatosi";
            aiOut.innerHTML = `<p class="${isGroqRateLimitPayload(res, j) ? "text-amber-200/95" : "text-red-300"}">${escapeHtmlStep11(msg)}</p>`;
          }
          aiBtn.disabled = false;
          return;
        }

        const score = Math.min(100, Math.max(0, Number(j.score) || 0));
        const fb = escapeHtmlStep11(j.feedbackUz || "");
        const errs = Array.isArray(j.errors) ? j.errors : [];
        const errHtml =
          errs.length > 0
            ? `<ul class="mt-2 list-inside list-disc text-amber-100/90">${errs
                .slice(0, 10)
                .map((x) => `<li>${escapeHtmlStep11(x)}</li>`)
                .join("")}</ul>`
            : "";

        if (aiOut) {
          aiOut.innerHTML =
            `<p class="mb-1 font-bold text-fuchsia-200">Ball: ${score} / 100</p>` +
            `<p class="whitespace-pre-wrap text-amber-50/95">${fb}</p>` +
            errHtml;
        }

        const { error: upErr } = await sb.from("user_listening_progress").upsert(
          {
            user_id: sessionUserId,
            week_number: 1,
            day_number: dayNum,
            listening_task_id: listeningTaskId,
            summary_text: text,
            score,
            feedback_uz: String(j.feedbackUz ?? "").trim(),
            errors_json: errs,
            completed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,week_number,day_number" },
        );
        if (upErr) {
          console.warn("[user_listening_progress upsert]", upErr);
          if (aiOut)
            aiOut.insertAdjacentHTML(
              "beforeend",
              `<p class="mt-2 text-amber-300">Ogohlantirish: serverga saqlashda xato — ${escapeHtmlStep11(upErr.message)}</p>`,
            );
        }
      } else {
        const r = await analyzeWritingWithGemini(text).catch(() => ({ ok: false, error: "Tarmoq" }));
        if (!r.ok) {
          if (aiOut) {
            const quota = Boolean(r.quota);
            const msg = quota
              ? "AI serveri vaqtinchalik band — qayta urinish tugadi; biroz kutib yana «AI tahlil»ni bosing."
              : String(r.error || "Xato");
            aiOut.innerHTML = `<p class="${quota ? "text-amber-200/95" : "text-red-300"}">${escapeHtmlStep11(msg)}</p>`;
          }
          aiBtn.disabled = false;
          return;
        }
        if (aiOut) {
          let reply = "";
          try {
            const w = JSON.parse(localStorage.getItem("writingSubmission") || "{}");
            reply = String(w.aiReply || "").trim();
          } catch (_) {
            reply = "";
          }
          aiOut.innerHTML = `<p class="whitespace-pre-wrap text-amber-50/95">${escapeHtmlStep11(reply || "Tahlil saqlandi.")}</p>`;
        }
      }

      markDaySectionComplete(studyDay, "listening");
      clearListenTimerStorage(dayNum);
      clearListenTopicStorage(dayNum);
      refreshDashboardSupervisorBar();
      refreshDashboardPlanProgress("A2");
      const mainCb = card.querySelector(".step11-todo-cb");
      if (mainCb) {
        mainCb.checked = true;
        mainCb.disabled = true;
        toggleTask(mainCb);
      }
      persistStep11Todos();
      const statusEl = card.querySelector("[data-listen-status]");
      if (statusEl) statusEl.textContent = "Listening vazifasi bajarildi";
      if (textarea) textarea.disabled = true;
      applyListenConfirmCompleted();
    } catch (e) {
      if (aiOut) {
        aiOut.classList.remove("hidden");
        aiOut.innerHTML = `<p class="text-red-300">${escapeHtmlStep11(String(e))}</p>`;
      }
      aiBtn.disabled = false;
    }
  });
}

/** Dashboard Writing: Supabase savoliga javob; minimal so‘z (gap/lug‘at moduli emas). */
const WRITING_A2_MIN_WORDS = 30;
const WRITING_B1_MIN_WORDS = 80;
const WRITING_DRAFT_SS_PREFIX = "edunext_dashboard_writing_draft_v1:";

function writingDraftSessionKey(dayNum, levelBand = "A2") {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const tier = String(levelBand || "A2").trim().toUpperCase() || "A2";
  return `${WRITING_DRAFT_SS_PREFIX}${tier}:${d}`;
}

function countWordsText(raw) {
  return String(raw ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Supabase yozma bloklari kalitlari (writing_tasks ustunlari). */
const WRITING_DASHBOARD_BLOCKS = [
  { key: "task_1_1", column: "task_1_1", label: "Task 1.1" },
  { key: "task_1_2", column: "task_1_2", label: "Task 1.2" },
  { key: "part_2", column: "part_2", label: "Part 2" },
];

const WRITING_SECTION_DURATION_SEC = 60 * 60;

function formatWritingDurationHMS(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function writingTimerStorageKey(uid, dayNum, levelBand) {
  return `edu_writing_end:${uid}:${dayNum}:${String(levelBand).toUpperCase()}`;
}

async function fetchWritingSavedTaskKeys(sb, uid, dayNum, levelBand) {
  if (!uid || !sb) return new Set();
  const { data: rows, error } = await sb
    .from("user_submissions")
    .select("task_key")
    .eq("user_id", uid)
    .eq("day_number", dayNum)
    .eq("level", levelBand)
    .in(
      "task_key",
      WRITING_DASHBOARD_BLOCKS.map((b) => b.key),
    );
  if (error) {
    console.warn("[user_submissions count]", error);
    return new Set();
  }
  return new Set((rows ?? []).map((r) => r.task_key));
}

function applyWritingTimeUp(mount, card, showAlert, uidMaybe, dayNum, levelBand) {
  if (!mount || mount.hasAttribute("data-writing-timeup")) return;
  mount.setAttribute("data-writing-timeup", "");
  if (typeof mount._writingTimerClear === "function") {
    mount._writingTimerClear();
    mount._writingTimerClear = null;
  }
  if (uidMaybe && dayNum != null && levelBand) {
    try {
      sessionStorage.removeItem(
        writingTimerStorageKey(uidMaybe, dayNum, levelBand),
      );
    } catch (_) {
      /* ignore */
    }
  }
  if (showAlert) window.alert?.("Time is up!");
  mount
    .querySelectorAll("textarea[data-writing-answer], textarea[data-writing-combined]")
    .forEach((ta) => {
      ta.disabled = true;
      ta.classList.add("opacity-65");
    });
  mount.querySelectorAll("button[data-writing-save]").forEach((btn) => {
    btn.disabled = true;
  });
  mount.querySelectorAll("[data-writing-check],[data-writing-finish-day]").forEach((btn) => {
    btn.disabled = true;
  });
  const fin = mount.querySelector("button[data-writing-ai-final]");
  if (fin) fin.disabled = true;
  mount.querySelectorAll("[data-writing-timer-live]").forEach((el) => {
    el.textContent = formatWritingDurationHMS(0);
  });
  const hint = mount.querySelector("[data-writing-timer-hint]");
  if (hint)
    hint.textContent = "Vaqt tugadi — javoblarni tahrirlab bo‘lmaydi.";
  const statusEl = card?.querySelector("[data-writing-status]");
  if (statusEl) statusEl.textContent = "Writing — taymer tugadi";
  mount.querySelector("[data-writing-final-wrap]")?.classList.add("hidden");
}

/** Barcha 3 ta saqlangan bo‘lsa, yakuniy AI tugmasini ko‘rsatadi (CEFR tekshiruvi oldin). */
async function refreshWritingFinalButtonVisibility(
  sb,
  uid,
  dayNum,
  levelBand,
  mount,
  card,
  alreadyDone,
) {
  const wrap = mount?.querySelector("[data-writing-final-wrap]");
  if (!wrap) return;
  const timeUp = mount?.hasAttribute("data-writing-timeup");
  const evalDone = mount?.hasAttribute("data-writing-eval-done");
  if (alreadyDone || timeUp || evalDone || !uid) {
    wrap.classList.add("hidden");
    return;
  }
  const have = await fetchWritingSavedTaskKeys(sb, uid, dayNum, levelBand);
  const allSaved = WRITING_DASHBOARD_BLOCKS.every((b) => have.has(b.key));
  wrap.classList.toggle("hidden", !allSaved);
}

/** Writing kartasi ichidagi Reading CTAni saqlab qoladi (no-op). */
function ensureWritingReadingNavMount(_mount /* , hintText */) {}

/** AI tekshiruvidan keyin kunlik Writing ni «bajarildi» qiladi va maydonlarni qulflaydi. */
function finalizeWritingSectionAfterEvaluation(
  card,
  studyDay,
  planLevel,
  mount,
) {
  markDaySectionComplete(studyDay, "writing");
  __dailyFtDismissCooldownUntil = 0;
  refreshDashboardSupervisorBar();
  refreshDashboardPlanProgress(planLevel);
  const mainCb = card.querySelector(".step11-todo-cb");
  if (mainCb) {
    mainCb.checked = true;
    mainCb.disabled = true;
    toggleTask(mainCb);
  }
  persistStep11Todos();
  const statusEl = card.querySelector("[data-writing-status]");
  if (statusEl)
    statusEl.textContent =
      "Writing — kunlik vazifa bajarildi (javob saqlandi)";
  mount.setAttribute("data-writing-eval-done", "");
  mount
    .querySelectorAll("textarea[data-writing-answer], textarea[data-writing-combined]")
    .forEach((ta) => {
      ta.disabled = true;
    });
  mount.querySelectorAll("button[data-writing-save]").forEach((btn) => {
    btn.disabled = true;
  });
  mount.querySelectorAll("[data-writing-check],[data-writing-finish-day]").forEach((btn) => {
    btn.disabled = true;
  });
  const fin = mount.querySelector("button[data-writing-ai-final]");
  if (fin) {
    fin.disabled = true;
    fin.textContent = "Tekshiruv saqlandi";
  }
  if (typeof mount._writingTimerClear === "function") {
    mount._writingTimerClear();
    mount._writingTimerClear = null;
  }
  ensureWritingReadingNavMount(
    mount,
    "Writing yakunlandi. Endi Reading bo‘limiga o‘ting.",
  );
  // Strict ketma-ketlikda Writing tugagach Reading bo‘limini ochish.
  try {
    if (typeof generatePersonalPlan === "function") {
      generatePersonalPlan(planLevel);
      window.requestAnimationFrame(() => {
        const target = document.querySelector(
          '#todo-list [data-task-card-for="reading"]',
        );
        if (target) {
          target.classList.remove("hidden");
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("ring-2", "ring-fuchsia-500/45");
          window.setTimeout(
            () => target.classList.remove("ring-2", "ring-fuchsia-500/45"),
            1400,
          );
        }
      });
    }
  } catch (_) {
    /* ignore */
  }
}

function renderWritingEvaluationReportHTML(report) {
  const esc = (s) => escapeHtmlStep11(String(s ?? ""));
  const tasks = report?.tasks && typeof report.tasks === "object" ? report.tasks : {};
  const blocks = WRITING_DASHBOARD_BLOCKS.map(({ key, label }) => {
    const t = tasks[key];
    if (!t || typeof t !== "object") {
      return `
      <div class="rounded-xl border border-white/10 bg-black/40 p-4 sm:p-5">
        <h4 class="text-sm font-bold uppercase tracking-wide text-fuchsia-200/90">${esc(label)}</h4>
        <p class="mt-2 text-sm text-slate-500">AI javobida bu blok bo‘yicha batafsil keltirilmagan.</p>
      </div>`;
    }
    const issues = Array.isArray(t.grammarIssues) ? t.grammarIssues : [];
    const issuesHtml = issues.length
      ? `<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-200/95">${issues
          .slice(0, 16)
          .map((x) => `<li>${esc(x)}</li>`)
          .join("")}</ul>`
      : `<p class="mt-2 text-sm text-slate-500">Aniq grammatik xatolar ro‘yxati keltirilmagan.</p>`;
    return `
      <div class="rounded-xl border border-white/10 bg-black/40 p-4 sm:p-5">
        <h4 class="text-sm font-bold uppercase tracking-wide text-fuchsia-200/90">${esc(label)}</h4>
        <p class="mt-2 text-sm text-slate-300">
          So‘zlar: <strong class="text-white">${esc(t.wordCount)}</strong> / maqsad ~<strong class="text-white">${esc(t.targetWords)}</strong>
          <span class="ml-2 rounded px-2 py-0.5 text-xs font-semibold ${t.meetsTarget ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-100"}">${t.meetsTarget ? "hajm mos" : "hajm yetarli emas / qisqa"}</span>
        </p>
        <p class="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Grammatika va tuzatishlar</p>
        ${issuesHtml}
        <p class="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Lug‘at</p>
        <p class="mt-1 text-sm leading-relaxed text-slate-200/95">${esc(t.vocabularyComment)}</p>
      </div>`;
  }).join("");

  const band = esc(report?.overallCefrBand ?? "—");
  const vocabOv = esc(report?.vocabularyLevelOverall ?? "");
  const overall = esc(report?.overallFeedbackUz ?? "");

  return `
    <div class="writing-ai-report space-y-5 rounded-2xl border border-fuchsia-500/30 bg-gradient-to-b from-violet-950/50 to-black/70 p-5 shadow-[0_0_40px_rgba(168,85,247,0.12)] sm:p-7">
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <h3 class="text-lg font-bold text-white sm:text-xl">AI Mentor — Writing hisoboti (CEFR)</h3>
        <p class="text-sm font-black uppercase tracking-[0.2em] text-amber-200">Umumiy daraja: <span class="text-2xl text-white">${band}</span></p>
      </div>
      <div class="grid gap-4 md:grid-cols-1">${blocks}</div>
      <div class="rounded-xl border border-white/10 bg-black/35 p-4 sm:p-5">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Umumiy lug‘at darajasi</p>
        <p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">${vocabOv || "—"}</p>
        <p class="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Yakuniy izoh</p>
        <p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">${overall || "—"}</p>
      </div>
    </div>`;
}

function renderWritingFeedbackEmptyHTML() {
  return `
    <div class="rounded-2xl border border-dashed border-white/15 bg-black/25 p-8 text-center">
      <p class="text-xs leading-relaxed text-slate-500">«TEKSHIRISH» bosilganda uchala matn tahlil qilinadi — natija bu yerda.</p>
    </div>`;
}

function renderHighlightedSegmentsHTML(segments, fallbackPlain) {
  const arr = Array.isArray(segments) ? segments : [];
  let out = "";
  for (const seg of arr) {
    const t = String(seg?.text ?? "");
    const esc = escapeHtmlStep11(t);
    if (seg?.isGrammarError === true || seg?.isError === true) {
      out += `<mark class="rounded-sm bg-rose-500/40 px-0.5 text-rose-50 decoration-rose-300/90">${esc}</mark>`;
    } else {
      out += esc;
    }
  }
  if (!out.trim() && fallbackPlain) {
    return `<span class="whitespace-pre-wrap">${escapeHtmlStep11(fallbackPlain)}</span>`;
  }
  return `<span class="whitespace-pre-wrap leading-relaxed">${out}</span>`;
}

function renderGrammarFixesUzHTML(fixes) {
  const e = (s) => escapeHtmlStep11(String(s ?? ""));
  const arr = Array.isArray(fixes) ? fixes : [];
  const rows = arr
    .map((f) => {
      const mis = String(f?.mistake ?? f?.original ?? "").trim();
      const cor = String(f?.correction ?? f?.corrected ?? "").trim();
      const note = String(f?.noteUz ?? f?.ruleUz ?? "").trim();
      if (!mis && !cor && !note) return "";
      return `<li class="rounded-lg border border-rose-500/25 bg-rose-950/30 px-3 py-2 text-left">
        <p class="text-[11px] text-rose-200/95"><span class="font-bold">Xato:</span> ${e(mis || "—")}</p>
        <p class="mt-1 text-[11px] text-emerald-200/95"><span class="font-bold">Tuzatilgan:</span> ${e(cor || "—")}</p>
        ${note ? `<p class="mt-1 text-[11px] text-slate-400">${e(note)}</p>` : ""}
      </li>`;
    })
    .filter(Boolean);
  if (!rows.length) {
    return `<p class="text-[11px] text-slate-500">Aniq grammatik xatolar ro‘yxati kelmadi — matndagi qizil ajratmalar yoki maslahat matnini ko‘ring.</p>`;
  }
  return `<ul class="mt-2 list-none space-y-2">${rows.join("")}</ul>`;
}

function renderWritingThreeTasksFeedbackHTML(report, learnerTexts = {}) {
  const esc = (s) => escapeHtmlStep11(String(s ?? ""));
  const tasks = report?.tasks && typeof report.tasks === "object" ? report.tasks : {};
  const vocabScore = Number(report?.vocabularyScoreOutOfTen);
  const holScore = Number(report?.overallHolisticScoreOutOfTen);
  const hasScore =
    (Number.isFinite(vocabScore) && vocabScore >= 1 && vocabScore <= 10) ||
    (Number.isFinite(holScore) && holScore >= 1 && holScore <= 10);
  const scoreRationale = String(report?.scoreRationaleUz ?? "").trim();
  const order = [
    {
      key: "task_1_1",
      label: "Task 1.1",
      hint: "Min 50 so‘z",
      focus: "Ball + qisqa maslahat",
    },
    {
      key: "task_1_2",
      label: "Task 1.2",
      hint: "120–150 so‘z",
      focus: "Grammatika va Word Choice",
    },
    {
      key: "part_2",
      label: "Part 2",
      hint: "180–200 so‘z",
      focus: "Mantiqiy izchillik",
    },
  ];

  const blocks = order
    .map(({ key, label, hint, focus }) => {
      const t = tasks[key];
      if (!t || typeof t !== "object") {
        return `
        <section class="rounded-xl border border-white/10 bg-black/35 p-4">
          <h4 class="text-sm font-bold text-fuchsia-200/90">${esc(label)}</h4>
          <p class="mt-2 text-sm text-slate-500">Ma'lumot kelmadi.</p>
        </section>`;
      }
      const band = esc(t.ieltsWritingBand ?? "—");
      const rec = esc(t.recommendationsUz ?? "");
      const plain = String(learnerTexts[key] ?? "");
      const hl = renderHighlightedSegmentsHTML(t.displaySegments, plain);
      const fixes = renderGrammarFixesUzHTML(t.grammarFixes);
      const warn = t._highlightMismatch
        ? `<p class="mt-2 text-[11px] text-amber-200/90">Ajratmalar matn bilan 100% mos kelmagan — to‘liq matn ko‘rsatildi.</p>`
        : "";
      return `
      <section class="rounded-xl border border-sky-500/25 bg-gradient-to-b from-slate-900/80 to-black/50 p-4 shadow-inner sm:p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-3">
          <div>
            <h4 class="text-[11px] font-bold uppercase tracking-wider text-sky-300/95">${esc(label)} <span class="font-normal text-slate-500">· ${esc(hint)}</span></h4>
            <p class="mt-1 text-[10px] font-medium uppercase tracking-wide text-fuchsia-400/80">${esc(focus)}</p>
          </div>
          <p class="font-mono text-lg font-black tabular-nums text-amber-200">Band ${band}</p>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-slate-200">${rec || "—"}</p>
        <div class="mt-4 rounded-lg border border-rose-500/20 bg-black/40 p-3">
          <p class="text-[10px] font-bold uppercase tracking-wider text-rose-300/90">Grammatika — tuzatishlar</p>
          ${fixes}
        </div>
        <div class="mt-3 rounded-lg border border-white/10 bg-black/45 p-3 text-[13px] text-slate-100">
          <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Matn (xatolar ajratilgan)</p>
          ${hl}
          ${warn}
        </div>
      </section>`;
    })
    .join("");

  const overall = String(report?.overallSummaryUz ?? "").trim();
  const nextLes = String(report?.nextLessonRecommendationUz ?? "").trim();
  const scorePanel =
    hasScore || scoreRationale
      ? `<div class="rounded-xl border border-amber-500/35 bg-amber-950/15 p-4 sm:p-5">
          <p class="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/90">Umumiy baho</p>
          <div class="mt-4 flex flex-wrap items-center justify-center gap-6">
            ${
              Number.isFinite(vocabScore) && vocabScore >= 1 && vocabScore <= 10
                ? `<div class="text-center">
              <p class="text-[10px] font-semibold uppercase text-slate-500">Lug‘at (1–10)</p>
              <p class="mt-1 font-mono text-3xl font-black tabular-nums text-amber-100">${Math.round(vocabScore)}<span class="text-lg text-slate-500">/10</span></p>
            </div>`
                : ""
            }
            ${
              Number.isFinite(holScore) && holScore >= 1 && holScore <= 10
                ? `<div class="text-center">
              <p class="text-[10px] font-semibold uppercase text-slate-500">Yozma (umumiy, 1–10)</p>
              <p class="mt-1 font-mono text-3xl font-black tabular-nums text-fuchsia-100">${Math.round(holScore)}<span class="text-lg text-slate-500">/10</span></p>
            </div>`
                : ""
            }
          </div>
          ${
            scoreRationale
              ? `<p class="mt-4 text-center text-xs leading-relaxed text-slate-300">${esc(scoreRationale)}</p>`
              : ""
          }
        </div>`
      : "";

  const summaryBlock =
    overall || nextLes
      ? `
      <div class="rounded-xl border border-emerald-500/35 bg-emerald-950/20 p-4 sm:p-5">
        ${
          overall
            ? `<div>
          <p class="text-[10px] font-bold uppercase tracking-wider text-emerald-300/90">Umumiy xulosa</p>
          <p class="mt-2 text-sm leading-relaxed text-slate-100">${esc(overall)}</p>
        </div>`
            : ""
        }
        ${
          nextLes
            ? `<div class="${overall ? "mt-5 border-t border-white/10 pt-5" : ""}">
          <p class="text-[10px] font-bold uppercase tracking-wider text-emerald-300/90">Keyingi dars uchun tavsiya</p>
          <p class="mt-2 text-sm leading-relaxed text-slate-100">${esc(nextLes)}</p>
        </div>`
            : ""
        }
        <button
          type="button"
          data-writing-go-reading
          class="dashboard-primary-btn mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-fuchsia-400/70 bg-gradient-to-r from-fuchsia-600/35 to-violet-600/35 px-4 py-3 text-[12px] font-black uppercase tracking-[0.14em] text-fuchsia-50 shadow-[0_0_26px_rgba(217,70,239,0.45)] transition hover:brightness-110 hover:shadow-[0_0_34px_rgba(217,70,239,0.6)]"
        >
          Reading bo&apos;limiga o&apos;tish
        </button>
      </div>`
      : "";

  return `
    <div class="writing-three-feedback space-y-5 rounded-2xl border border-fuchsia-500/30 bg-gradient-to-b from-violet-950/55 to-black/80 p-5 sm:p-6">
      <h3 class="border-b border-white/10 pb-3 text-center text-sm font-bold uppercase tracking-[0.2em] text-fuchsia-200/95">Professional Writing Examiner</h3>
      ${scorePanel}
      <div class="space-y-5">${blocks}</div>
      ${summaryBlock}
    </div>`;
}

/**
 * `writing_tasks` bo‘lmasa: Day 1 uchun B1/A2 standart topshiriqlar (maktab oshxonasi / coffee).
 * Boshqa kunlar uchun `null` — foydalanuvchiga bazani to‘ldirish kerak.
 */
function getFallbackWritingTasksRow(dayNum, writingLevel) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  const L = String(writingLevel || "A2").trim().toUpperCase() || "A2";

  if (L === "B1" && d === 1) {
    return {
      day_number: 1,
      level: "B1",
      title: "Test 1 — School Canteen",
      description:
        "One scenario: the canteen manager asks for suggestions (meals, facilities, events). Three tasks: classmate email (~50 words), formal email to the manager (120–150), online-discussion post (180–200).",
      context: `You are a student at your school, and the canteen manager sent you this message:

Dear Student,

We are planning to make some improvements in our school canteen and would like to hear your suggestions.

What new meals or snacks would you like us to include? What facilities or seating areas should we improve? What events could we organize to make lunchtimes more enjoyable?

Best wishes,
The Canteen Manager`,
      task_1_1: `TASK 1.1 (write about 50 words)

Write a short email to your classmate. Tell them about the message from the canteen manager and ask what new meals, facilities, or events they think would make the canteen better.`,
      task_1_2: `TASK 1.2 (aim for 120–150 words; allowed range in the app: 120–160)

Write an email to the canteen manager. Give your suggestions about new meals, improved facilities, and events that could make the canteen more enjoyable for students.`,
      part_2: `PART 2 (aim for 180–200 words; allowed range: 175–215)

You are participating in an online discussion for students.

Should schools ban junk food completely? Post your response, giving reasons and examples.`,
    };
  }

  if (L === "A2" && d === 1) {
    return {
      day_number: 1,
      level: "A2",
      title: "The benefits of coffee",
      description:
        "Write clear sentences; use present, past, and future where appropriate.",
      context:
        "Context: everyday topic — coffee at home, at work, or with friends (write your own ideas in English).",
      task_1_1: `TASK 1.1 (minimum ~50 words)
Write at least 50 words: one benefit of coffee for you in daily life and one small disadvantage. Use Present Simple where possible.`,
      task_1_2: `TASK 1.2 (120–150 words; range 120–160)
Write 120–150 words comparing coffee at home and in a café. Use linking words (however, although, because, so) and two short paragraphs.`,
      part_2: `PART 2 (180–200 words; range 175–215)
Essay: Some people say coffee is unhealthy. To what extent do you agree? Give reasons, examples, and a conclusion.`,
    };
  }

  return null;
}

/** Dashboard Grammar: Phase 1 (PDF + 30 dk) → Phase 2 (20 MCQ) → Phase 3 (✅/❌ + AI mentor). */
async function setupDashboardGrammarPhasedCard(
  card,
  studyDay,
  taskId,
  alreadyDoneGrammar,
  tier,
  opts,
) {
  const mount = card.querySelector(`[data-grammar-phased-mount="${taskId}"]`);
  if (!mount) return;
  if (alreadyDoneGrammar) {
    mount.innerHTML =
      '<p class="rounded-xl border border-fuchsia-500/30 bg-fuchsia-950/25 px-4 py-3 text-sm text-fuchsia-100/95">Grammar topshirig‘i ushbu kun uchun bajarilgan deb belgilangan.</p>';
    return;
  }

  const level = String(tier || "A2").trim() || "A2";
  const dayNum = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
  const pdfHref = String(opts?.pdfHref || "").trim();
  const grammarLabel = String(opts?.grammarLabel || "").trim() || "Grammar";
  const grammarDescription = String(opts?.grammarDescription || "").trim();

  if (!pdfHref) {
    mount.innerHTML = `<p class="text-sm text-amber-200">PDF manzili topilmadi — Grammar fazali rejim ishlamaydi.</p>`;
    return;
  }

  let questionsRaw = null;
  let labelFromDb = null;
  const sb = ensureSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("grammar_tasks")
      .select("questions, grammar_label")
      .eq("tier", level)
      .eq("day_number", dayNum)
      .maybeSingle();
    if (error) console.warn("[grammar_tasks]", error);
    if (data?.questions != null) questionsRaw = data.questions;
    if (data?.grammar_label) labelFromDb = String(data.grammar_label).trim();
  }

  const grammarDisplay = (grammarLabel || labelFromDb || "").trim() || "Grammar";

  setupGrammarPhasedDashboard(mount, {
    studyDay: dayNum,
    tier: level,
    pdfHref,
    grammarLabel: grammarDisplay,
    grammarDescription,
    questions: questionsRaw,
    openPdf: (href) => {
      try {
        window.open(String(href || ""), "_blank", "noopener,noreferrer");
      } catch (_) {
        /* noop */
      }
    },
    apiUrlFn: apiUrl,
    escapeHtml: escapeHtmlStep11,
    onGoListening: () => {
      try {
        localStorage.setItem(grammarListeningUnlockStorageKey(level, dayNum), "1");
      } catch (_) {
        /* noop */
      }
      document.querySelector('#todo-list [data-task-card-for="grammar"]')?.classList.add("hidden");
      navigateDashboardLesson("listening_bb_dict");
    },
  });
}

/**
 * `reading_tasks` qatoridan kutilgan maydonlarni oladi (bazada `passage` / `questions` nomlari boshqacha bo‘lishi mumkin).
 * Koddagi asosiy ustun nomlari: `passage`, `questions` { part1, part2, part3 }.
 */
function pickReadingTasksRowFields(row) {
  if (!row || typeof row !== "object") {
    return {
      title: "Reading",
      passage: "",
      questions: null,
      sourceKeys: [],
    };
  }
  const o = /** @type {Record<string, unknown>} */ (row);
  const passageRaw =
    o.passage ??
    o.reading_passage ??
    o.passage_text ??
    o.reading_text ??
    o.text_body ??
    o.body ??
    o.content ??
    "";
  const passage = String(passageRaw ?? "").trim();
  const questions =
    o.questions ?? o.reading_questions ?? o.question_data ?? o.question_json ?? o.parts ?? null;
  const titleRaw = o.title ?? o.reading_title ?? o.topic_title ?? o.name ?? "";
  const title = String(titleRaw ?? "").trim() || "Reading";
  return {
    title,
    passage,
    questions,
    sourceKeys: Object.keys(o),
  };
}

/**
 * `reading_results` satridan `{ savol_id: javob }` xaritasiga (UI `userAnswers` bilan moslab).
 */
function extractAnswersMapFromReadingResultsRow(row) {
  if (!row || typeof row !== "object") return {};
  const o = /** @type {Record<string, unknown>} */ (row);

  function mapFromKvObject(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out = {};
    for (const [k, val] of Object.entries(obj)) {
      const qid = Number(k.replace(/^q/i, "").trim());
      if (!Number.isFinite(qid)) continue;
      out[qid] = val;
    }
    return Object.keys(out).length ? out : null;
  }

  const flatCandidates = [
    o.answers,
    o.user_answers,
    o.answer_map,
    o.responses,
    o.answer_json,
  ];
  for (const c of flatCandidates) {
    const m = mapFromKvObject(c);
    if (m) return m;
  }

  const sub = o.submission;
  if (sub && typeof sub === "object" && !Array.isArray(sub)) {
    const nested = /** @type {Record<string, unknown>} */ (sub).answers ?? sub;
    const m = mapFromKvObject(nested);
    if (m) return m;
  }

  const payload = o.result_payload ?? o.result_json ?? o.details;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = /** @type {Record<string, unknown>} */ (payload);
    const m = mapFromKvObject(p.answers ?? p.user_answers);
    if (m) return m;
  }

  if (Array.isArray(o.answer_rows)) {
    const out = {};
    /** @type {unknown[]} */
    const rows = o.answer_rows;
    rows.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const r = /** @type {Record<string, unknown>} */ (item);
      const id = Number(r.question_id ?? r.id ?? r.qid ?? r.questionId);
      if (!Number.isFinite(id)) return;
      out[id] = r.answer ?? r.value ?? r.user_answer ?? r.selected;
    });
    return out;
  }

  return {};
}

/** Dashboard rejasi `tier` → `reading_tasks.level` uchun A2 yoki B1. */
function normalizeReadingTasksPlanLevel(raw) {
  const t = String(raw ?? "A2").trim();
  const u = t.toUpperCase().replace(/\s+/g, "");
  if (
    u === "B1" ||
    u === "B2" ||
    u.startsWith("B1") ||
    u.startsWith("B2") ||
    u === "INTERMEDIATE"
  ) {
    return "B1";
  }
  return "A2";
}

function readingTasksColumnMissingInError(err, columnName) {
  const m = String(err?.message ?? "").toLowerCase();
  const c = String(columnName ?? "").toLowerCase();
  return (
    m.includes(c) &&
    (m.includes("does not exist") ||
      m.includes("unknown") ||
      m.includes("schema cache") ||
      m.includes("could not find"))
  );
}

/**
 * Supabase `reading_tasks` dan bitta kun/daraja qatori (RLS/seeding xatoliklaridan chidamlik).
 * Albatta mavjud ustun nomlari `day_number` va `level` bo‘lishi kerak (`maybeSingle`).
 */
async function fetchReadingTasksRowFromSupabase(sb, dayNum, tierRaw) {
  const canon = normalizeReadingTasksPlanLevel(tierRaw);
  const d = Math.min(30, Math.max(1, Math.floor(Number(dayNum)) || 1));
  /** @type {string[]} */
  const levelVariants = [...new Set([canon, canon.toUpperCase(), canon.toLowerCase()])];
  let lastTransportError = null;

  // 1) Avval level bo'yicha olishga urinamiz (day ustuni qanday bo'lishidan qat'i nazar).
  for (const lev of levelVariants) {
    const { data, error } = await sb
      .from("reading_tasks")
      .select("*")
      .eq("level", lev)
      .limit(200);
    if (error) {
      lastTransportError = error;
      continue;
    }
    if (Array.isArray(data) && data.length) {
      const match = data.find((row) => {
        const o = row && typeof row === "object" ? row : {};
        const dayVal =
          o.day_number ?? o.day ?? o.day_index ?? o.daynum ?? o.dayNum ?? o.dayNo ?? null;
        return Math.floor(Number(dayVal)) === d;
      });
      if (match) {
        return { data: match, error: null, levelUsed: lev };
      }
    }
  }

  // 2) level ustuni yo'q/nomi boshqacha bo'lsa: umumiy ro'yxatdan client-side tanlaymiz.
  const { data: allRows, error: allErr } = await sb
    .from("reading_tasks")
    .select("*")
    .limit(400);
  if (allErr) {
    lastTransportError = allErr;
    return { data: null, error: lastTransportError, levelUsed: canon };
  }
  if (Array.isArray(allRows) && allRows.length) {
    const levelKeys = ["level", "tier", "band", "cefr_level", "difficulty"];
    const dayKeys = ["day_number", "day", "day_index", "daynum", "dayNum", "dayNo"];
    const matched = allRows.find((row) => {
      const o = row && typeof row === "object" ? row : {};
      const dayHit = dayKeys.some((k) => Math.floor(Number(o[k])) === d);
      if (!dayHit) return false;
      const lvlRaw = levelKeys
        .map((k) => (o[k] != null ? String(o[k]).trim() : ""))
        .find(Boolean);
      const lvl = normalizeReadingTasksPlanLevel(lvlRaw || canon);
      return lvl === canon;
    });
    if (matched) return { data: matched, error: null, levelUsed: canon };
  }

  return { data: null, error: lastTransportError, levelUsed: canon };
}

/** Dashboard Reading: faqat `reading_tasks` (Supabase) manbasi; fallback yo‘q. */
async function setupDashboardReadingExamCard(card, studyDay, taskId, tier) {
  const mount = card.querySelector(`[data-reading-exam-mount="${taskId}"]`);
  if (!mount) return;

  const level = normalizeReadingTasksPlanLevel(tier);
  const dayNum = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));

  let payloadFromDb = null;
  /** @type {Record<string, unknown> | null} */
  let readingRowRaw = null;
  let fetchError = null;

  let prefilledAnswers = /** @type {Record<number, string | number>} */ ({});
  /** @type {string|null} */
  let userId = null;

  const sb = ensureSupabase();
  if (sb) {
    const rtRes = await fetchReadingTasksRowFromSupabase(sb, dayNum, tier);
    const { data, error: rtFetchErr, levelUsed } = rtRes;
    fetchError = rtFetchErr ?? null;

    console.log("[reading_tasks] response", {
      dayNum,
      levelTier: tier,
      levelUsed,
      payloadLevel: level,
      data,
      error: rtFetchErr?.message ?? rtFetchErr,
      code: rtFetchErr?.code,
    });

    if (rtFetchErr) console.warn("[reading_tasks] transport/backend", rtFetchErr);

    if (data) {
      readingRowRaw = data;
      /** Payload va natijani saqlash kaliti uchun jadvaldagi darajadan foydalanamiz. */
      const levelForPayload = normalizeReadingTasksPlanLevel(
        /** @type {Record<string, unknown>} */ (data).level ?? levelUsed ?? level,
      );
      const picked = pickReadingTasksRowFields(data);
      console.log("[reading_tasks] normalized fields", {
        title: picked.title,
        passageLength: picked.passage.length,
        hasQuestions: picked.questions != null,
        questionsKeys:
          picked.questions && typeof picked.questions === "object" && !Array.isArray(picked.questions)
            ? Object.keys(/** @type {Record<string, unknown>} */ (picked.questions))
            : typeof picked.questions,
        rowColumnNames: picked.sourceKeys,
      });

      const parts = normalizeReadingExamParts(picked.questions);
      if (parts) {
        payloadFromDb = buildTimedReadingPayloadFromSources({
          passage: picked.passage,
          title: picked.title,
          parts,
          dayNum,
          tierLabel: levelForPayload,
        });
      } else {
        console.warn(
          "[reading_tasks] questions JSON: part1/2/3 kutilgan formatda emas",
          dayNum,
          levelForPayload,
          picked.questions,
        );
      }
    }

    /** `reading_results` — mavjud bo‘lsa javoblarni oldindan to‘ldirish (imtihon har doim ochiq, review bloklamaydi). */
    if (payloadFromDb) {
      try {
        const {
          data: { session },
        } = await sb.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          userId = uid;
          const rrLevelVariants = [
            ...new Set([
              level,
              level.toUpperCase(),
              level.toLowerCase(),
              String(
                /** @type {Record<string, unknown>} */ (readingRowRaw || {}).level ?? "",
              ).trim(),
            ]),
          ].filter(Boolean);

          let rrRes = { data: null, error: null };
          const variants = rrLevelVariants.length ? rrLevelVariants : [level];
          for (const levRR of variants) {
            const r = await sb
              .from("reading_results")
              .select("*")
              .eq("user_id", uid)
              .eq("day_number", dayNum)
              .eq("level", levRR)
              .maybeSingle();
            rrRes = r;
            if (!r.error && r.data) break;
          }

          if (rrRes?.error) {
            console.warn("[reading_results]", rrRes.error?.message ?? rrRes.error);
          } else if (rrRes?.data) {
            console.log("[reading_results] row (prefill only)", rrRes?.data);
            prefilledAnswers = extractAnswersMapFromReadingResultsRow(rrRes?.data);
          }
        }
      } catch (e) {
        console.warn("[reading_results]", e);
      }
    }
  } else {
    console.warn("[reading_tasks] Supabase mijoz yo‘q (APP_CONFIG yoki auth).");
  }

  if (readingRowRaw && !payloadFromDb) {
    const picked = pickReadingTasksRowFields(readingRowRaw);
    const keysHint = picked.sourceKeys.length
      ? ` Jadvaldagi ustunlar: <code class="rounded bg-black/30 px-1">${escapeHtmlStep11(picked.sourceKeys.join(", "))}</code>.`
      : "";
    mount.innerHTML = `<div class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-50/95">
      <p class="font-bold text-amber-100">Reading: «reading_tasks» ma’lumoti noto‘g‘ri</p>
      <p class="text-[13px] leading-relaxed text-amber-100/90">Kun <strong>${escapeHtmlStep11(String(dayNum))}</strong>, daraja <strong>${escapeHtmlStep11(level)}</strong> uchun qator topildi, lekin <code class="rounded bg-black/30 px-1">questions</code> JSON ichida <code class="rounded bg-black/30 px-1">part1</code>, <code class="rounded bg-black/30 px-1">part2</code>, <code class="rounded bg-black/30 px-1">part3</code> massivlari kutilgan formatda emas yoki matn (<code class="rounded bg-black/30 px-1">passage</code> yoki <code class="rounded bg-black/30 px-1">reading_passage</code> va hokazo) juda qisqa.${keysHint} Konsolga <code class="rounded bg-black/30 px-1">[reading_tasks]</code> loglarini qarang.</p>
    </div>`;
    return;
  }

  if (!payloadFromDb) {
    const errLine =
      fetchError?.message != null
        ? ` So‘rov xatosi: ${escapeHtmlStep11(String(fetchError.message))}.`
        : "";
    const noClient = !sb ? " Supabase ulanmagan." : "";
    mount.innerHTML = `<div class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-50/95">
      <p class="font-bold text-amber-100">Reading: ma’lumot topilmadi</p>
      <p class="text-[13px] leading-relaxed text-amber-100/90"><code class="rounded bg-black/30 px-1">reading_tasks</code> dan kun <strong>${escapeHtmlStep11(String(dayNum))}</strong>, daraja <strong>${escapeHtmlStep11(level)}</strong> bo‘yicha qator kelmayapti, RLS <code class="rounded bg-black/30 px-1">anon</code> roliga ruxsat bermayapti (<code class="rounded bg-black/30 px-1">data === null</code>), yoki jadval seeded emas.${noClient}${errLine}</p>
      <p class="text-[12px] leading-relaxed text-amber-100/80 mt-2">Kerak bo‘lsa: Supabase-da migratsiya <code class="rounded bg-black/30 px-1">20260506193000_reading_tasks_select_anon.sql</code> ishga tushing va <code class="rounded bg-black/30 px-1">20260205121000_reading_tasks_seed_a2_b1_day1.sql</code> (yoki mos qatorlar) yozilganini tekshiring. Konsol: <code class="rounded bg-black/30 px-1">[reading_tasks]</code> loglari.</p>
    </div>`;
    return;
  }

  if (dashboardReadingPathMatches()) {
    const readingStateKey = `edunext:reading:day:${dayNum}:answers`;
    const letterToIndex = (letterRaw, len) => {
      const ch = String(letterRaw ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .charAt(0);
      const idx = ch ? ch.charCodeAt(0) - 65 : -1;
      return Number.isFinite(idx) && idx >= 0 && idx < len ? idx : 0;
    };
    const normalizeTfng = (raw) => {
      let x = String(raw ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, " ");
      if (x === "T") x = "TRUE";
      if (x === "F") x = "FALSE";
      if (x === "NG" || x === "N/G") x = "NOT GIVEN";
      return x || "NOT GIVEN";
    };
    const part1Rows = Array.isArray(payloadFromDb.part1) ? payloadFromDb.part1 : [];
    const part2Rows = Array.isArray(payloadFromDb.part2) ? payloadFromDb.part2 : [];
    const part3Rows = Array.isArray(payloadFromDb.part3) ? payloadFromDb.part3 : [];
    const sortById = (arr) =>
      [...arr].sort(
        (a, b) =>
          Number(a?.id ?? 0) - Number(b?.id ?? 0),
      );
    const normalizedQuestions = [];
    sortById(part1Rows).forEach((q, i) => {
      const options = Array.isArray(q?.options) ? q.options.map((o) => String(o ?? "")) : [];
      if (!options.length) return;
      const correctIndex = letterToIndex(q?.correct, options.length);
      normalizedQuestions.push({
        key: `p1-${q?.id ?? i + 1}`,
        id: Number(q?.id ?? i + 1),
        part: "Part 1",
        stem: String(q?.question ?? "").trim(),
        options,
        correctAnswer: String(options[correctIndex] ?? ""),
      });
    });
    sortById(part2Rows).forEach((q, i) => {
      const options = ["TRUE", "FALSE", "NOT GIVEN"];
      normalizedQuestions.push({
        key: `p2-${q?.id ?? i + 1}`,
        id: Number(q?.id ?? i + 1),
        part: "Part 2",
        stem: String(q?.question ?? "").trim(),
        options,
        correctAnswer: normalizeTfng(q?.correct),
      });
    });
    sortById(part3Rows).forEach((q, i) => {
      const options = Array.isArray(q?.options) ? q.options.map((o) => String(o ?? "")) : [];
      if (!options.length) return;
      const correctIndex = letterToIndex(q?.correct_match, options.length);
      const word = String(q?.word ?? "").trim();
      const stemRaw = String(q?.question ?? "").trim();
      normalizedQuestions.push({
        key: `p3-${q?.id ?? i + 1}`,
        id: Number(q?.id ?? i + 1),
        part: "Part 3",
        stem: stemRaw || (word ? `Choose the closest meaning of "${word}"` : "Vocabulary question"),
        options,
        correctAnswer: String(options[correctIndex] ?? ""),
      });
    });
    const questionsForUi = normalizedQuestions;

    mount.innerHTML = `
      <div class="rounded-2xl border border-fuchsia-500/30 bg-gradient-to-b from-[#12081f]/90 to-black/90 p-4 sm:p-6">
        <div class="mb-4 border-b border-white/10 pb-3">
          <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300/90">Reading · Day 1</p>
          <h3 class="mt-1 text-xl font-black text-white sm:text-2xl">${escapeHtmlStep11(
            String(payloadFromDb.title || "Reading Text"),
          )}</h3>
        </div>
        <div class="space-y-6">
          <section class="rounded-xl border border-fuchsia-500/30 bg-white/[0.06] p-6 backdrop-blur-md">
            <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-fuchsia-300/90">Reading Text</p>
            <div class="whitespace-pre-wrap text-[19px] leading-[1.7] text-slate-100">${escapeHtmlStep11(
              String(payloadFromDb.passage || ""),
            )}</div>
          </section>
          <div class="h-px w-full bg-gradient-to-r from-transparent via-fuchsia-500/60 to-transparent shadow-[0_0_16px_rgba(217,70,239,0.55)]"></div>
          <section class="rounded-xl border border-cyan-500/30 bg-black/35 p-4">
            <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-cyan-300/90">Multiple Choice</p>
            <div data-reading-q-wrap class="space-y-5"></div>
            <button type="button" data-reading-check class="dashboard-primary-btn mt-4 inline-flex min-h-[46px] w-full items-center justify-center rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/20 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-fuchsia-100 transition hover:bg-fuchsia-600/35">
              NATIJANI TEKSHIRISH
            </button>
            <div data-reading-ai-feedback class="mt-3 hidden rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-slate-100"></div>
            <button type="button" data-reading-finish class="dashboard-primary-btn mt-3 hidden inline-flex min-h-[46px] w-full items-center justify-center rounded-xl border border-fuchsia-400/70 bg-gradient-to-r from-fuchsia-600/35 to-violet-600/35 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-fuchsia-100 shadow-[0_0_24px_rgba(217,70,239,0.45)] transition hover:brightness-110">
              Vocabulary bo&apos;limiga o&apos;tish
            </button>
          </section>
        </div>
      </div>`;

    const qWrap = mount.querySelector("[data-reading-q-wrap]");
    const checkBtn = mount.querySelector("[data-reading-check]");
    const finishBtn = mount.querySelector("[data-reading-finish]");
    const aiFeedback = mount.querySelector("[data-reading-ai-feedback]");

    let answers = {};
    try {
      answers = JSON.parse(localStorage.getItem(readingStateKey) || "{}") || {};
    } catch (_) {
      answers = {};
    }

    const letterByIndex = (i) => String.fromCharCode(65 + Math.max(0, i));
    const saveAnswers = () => {
      try {
        localStorage.setItem(readingStateKey, JSON.stringify(answers));
      } catch (_) {
        /* ignore */
      }
    };

    const renderQuestions = (showResult = false) => {
      if (!qWrap) return;
      let prevPart = "";
      qWrap.innerHTML = questionsForUi
        .map((q, idx) => {
          const qid = String(q.key ?? q.id ?? idx + 1);
          const selected = answers[qid];
          const correctOpt = String(q.correctAnswer ?? "");
          const partTitle =
            q.part === "Part 1"
              ? "PART 1: MULTIPLE CHOICE"
              : q.part === "Part 2"
                ? "PART 2: TRUE / FALSE"
                : "PART 3: VOCABULARY";
          const partHeader =
            q.part !== prevPart
              ? `<p class="mt-4 text-[12px] font-black uppercase tracking-[0.2em] text-fuchsia-300/95">${escapeHtmlStep11(
                  partTitle,
                )}</p>`
              : "";
          prevPart = q.part;
          const optionsHtml = q.options
            .map((opt, oi) => {
              const isSelected = String(selected ?? "") === String(opt);
              const isCorrect = String(opt) === correctOpt;
              const wrongSelected = showResult && isSelected && !isCorrect;
              const rightState = showResult && isCorrect;
              const cls = showResult
                ? rightState
                  ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-100"
                  : wrongSelected
                    ? "border-rose-500/60 bg-rose-500/20 text-rose-100"
                    : "border-white/10 bg-black/30 text-slate-200"
                : isSelected
                  ? "border-fuchsia-500/60 bg-fuchsia-500/20 text-fuchsia-100"
                  : "border-white/10 bg-black/30 text-slate-200";
              return `<button type="button" data-r-opt="${escapeHtmlStep11(
                qid,
              )}" data-r-val="${escapeHtmlStep11(String(opt))}" class="w-full rounded-lg border px-3 py-2.5 text-left text-[15px] leading-6 transition ${cls}">
                <span class="mr-2 font-bold">${letterByIndex(oi)}.</span><span class="break-words">${escapeHtmlStep11(String(opt))}</span>
              </button>`;
            })
            .join("");
          return `${partHeader}<article class="rounded-xl border border-white/10 bg-black/25 p-5" data-r-q="${escapeHtmlStep11(
            qid,
          )}">
            <p class="text-[16px] leading-7 font-semibold text-white">${idx + 1}. ${escapeHtmlStep11(
              String(q.stem ?? ""),
            )}</p>
            <div class="mt-2 space-y-2">${optionsHtml}</div>
            ${
              showResult
                ? `<p class="mt-2 text-[11px] text-slate-400">To‘g‘ri javob: <span class="text-emerald-300">${escapeHtmlStep11(
                    correctOpt,
                  )}</span></p>`
                : ""
            }
          </article>`;
        })
        .join("");
    };

    renderQuestions(false);

    qWrap?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-r-opt]");
      if (!btn) return;
      const qid = String(btn.getAttribute("data-r-opt") || "").trim();
      const val = String(btn.getAttribute("data-r-val") || "");
      if (!qid) return;
      answers[qid] = val;
      saveAnswers();
      renderQuestions(false);
    });

    checkBtn?.addEventListener("click", async () => {
      renderQuestions(true);
      const mistakes = [];
      let correct = 0;
      questionsForUi.forEach((q, idx) => {
        const qid = String(q.key ?? q.id ?? idx + 1);
        const selected = String(answers[qid] ?? "");
        const correctOpt = String(q.correctAnswer ?? "");
        if (selected && selected === correctOpt) correct += 1;
        else {
          mistakes.push({
            questionId: Number(q.id ?? idx + 1),
            stem: String(q.stem ?? ""),
            userAnswerLabel: selected || "Tanlanmagan",
            correctAnswerLabel: correctOpt,
          });
        }
      });
      const total = Math.max(1, questionsForUi.length);
      const pct = Math.round((correct / total) * 100);
      if (aiFeedback) {
        aiFeedback.classList.remove("hidden");
        aiFeedback.innerHTML = `<p class="font-bold ${
          pct >= 70 ? "text-emerald-200" : "text-rose-200"
        }">Natija: ${correct}/${total} (${pct}%)</p>`;
      }
      if (mistakes.length === 0) {
        if (aiFeedback) {
          aiFeedback.innerHTML += `<p class="mt-2 text-emerald-200">A'lo! Barcha javoblar to‘g‘ri.</p>`;
        }
        finishBtn?.classList.remove("hidden");
        return;
      }
      try {
        const res = await fetch(apiUrl("/api/ai/reading-exam-feedback"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            passage: String(payloadFromDb.passage || ""),
            mistakes,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        const analyses = Array.isArray(payload?.analyses) ? payload.analyses : [];
        if (aiFeedback && analyses.length) {
          aiFeedback.innerHTML += `<div class="mt-3 space-y-2">${analyses
            .map((a) => {
              const qid = escapeHtmlStep11(String(a?.questionId ?? ""));
              const ex = escapeHtmlStep11(String(a?.explanationUz ?? ""));
              const where = escapeHtmlStep11(String(a?.whereCorrectAnswerUz ?? ""));
              return `<div class="rounded-lg border border-amber-500/30 bg-amber-950/15 px-3 py-2">
                <p class="text-[11px] font-bold text-amber-200">Savol ${qid}</p>
                <p class="mt-1 text-[12px] text-slate-100">${ex}</p>
                <p class="mt-1 text-[11px] text-slate-300">${where}</p>
              </div>`;
            })
            .join("")}</div>`;
        }
      } catch (_) {
        if (aiFeedback) {
          aiFeedback.innerHTML += `<p class="mt-2 text-amber-200">AI mentor izohi hozircha olinmadi.</p>`;
        }
      }
      finishBtn?.classList.remove("hidden");
    });

    finishBtn?.addEventListener("click", () => {
      markDaySectionComplete(dayNum, "reading");
      try {
        localStorage.removeItem(readingStateKey);
        localStorage.setItem("edunext_current_study_day", "1");
        localStorage.setItem("currentDay", "1");
        sessionStorage.setItem("edunext_open_vocabulary_once", "1");
      } catch (_) {
        /* ignore */
      }
      window.location.assign("/dashboard/vocabulary");
    });
    return;
  }

  const examSourceHint = `Joriy kun ${dayNum}: matn va savollar «reading_tasks»dan. Bosqichlar: 1) matn (30 min) → 2) Part 1 MCQ (20 min) → 3) Part 2 T/F/NG (20 min) → 4) Part 3 vocab (20 min).`;

  setupTimedReadingExam(mount, {
    tier: payloadFromDb.tierLabel,
    studyDay: dayNum,
    apiUrlFn: apiUrl,
    escapeHtml: escapeHtmlStep11,
    examSourceHint,
    payload: payloadFromDb,
    prefilledAnswers,
    supabase: sb,
    userId,
    openVocabularyWindow: openVocabularyInNewWindow,
  });
}

/** Dashboard Writing: 3 ta alohida oyna (karta), qizil/yashil counter, TEKSHIRISH → `user_writing_submissions`. */
async function setupDashboardWritingCard(
  card,
  studyDay,
  taskId,
  alreadyDone,
  options = {},
) {
  const mount = card.querySelector(`[data-writing-mount="${taskId}"]`);
  if (!mount) return;

  const normalizeBand = (v) => String(v ?? "").trim().toUpperCase();
  const writingLevel = normalizeBand(options.writingLevel || "A2") || "A2";
  const planLevel = String(options.planLevel || writingLevel).trim() || "A2";
  const writingScoreUnlockKey = `edunext_writing_hol_score:${planLevel}:${Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1))}`;

  const dayNum = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
  const sb = ensureSupabase();

  if (!sb) {
    mount.innerHTML = `<p class="text-xs text-amber-300">Supabase ulanmagan — yozish vazifalari yuklanmaydi.</p>`;
    return;
  }

  const {
    data: { session },
  } = await sb.auth.getSession();
  const uid = session?.user?.id ?? null;

  const { data: dbRowsRaw, error: rowErr } = await sb
    .from("writing_tasks")
    .select(
      "day_number,title,level,context,task_1_1,task_1_2,part_2,description",
    )
    .eq("day_number", dayNum);

  if (rowErr) console.warn("[writing_tasks]", rowErr);

  const dbRows = Array.isArray(dbRowsRaw) ? dbRowsRaw : [];
  const rowByExactLevel = dbRows.find(
    (r) => normalizeBand(r?.level) === writingLevel,
  );
  const rowBySameDay = dbRows.find(
    (r) =>
      Math.min(30, Math.max(1, Math.floor(Number(r?.day_number)) || 1)) === dayNum,
  );
  const dbRow = rowByExactLevel || rowBySameDay || null;

  const hadDatabaseRow = Boolean(dbRow);
  let row = dbRow;
  if (!row) row = getFallbackWritingTasksRow(dayNum, writingLevel);

  if (!row) {
    const hint = rowErr?.message
      ? `Server: ${rowErr.message}`
      : `Jadvalda yozuv yo‘q (kun ${dayNum}, level ${writingLevel}).`;
    mount.innerHTML = `<div class="rounded-lg border border-amber-500/35 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100/95">
      <p class="font-semibold text-amber-50">Writing topshiriqlari yuklanmadi</p>
      <p class="mt-2">${escapeHtmlStep11(hint)}</p>
      <p class="mt-2 text-[11px] text-amber-200/85">Yechim: Supabase’da <code class="rounded bg-black/30 px-1">writing_tasks</code> migratsiyasini qo‘llang yoki B1 kun 1 uchun qator qo‘shing (<code class="rounded bg-black/30 px-1">task_1_1</code>, <code class="rounded bg-black/30 px-1">task_1_2</code>, <code class="rounded bg-black/30 px-1">part_2</code>, <code class="rounded bg-black/30 px-1">context</code>).</p>
    </div>`;
    return;
  }

  const subsByKey = {};
  if (uid) {
    const { data: subs, error: subsErr } = await sb
      .from("user_submissions")
      .select("task_key,answer_text")
      .eq("user_id", uid)
      .eq("day_number", dayNum)
      .eq("level", writingLevel)
      .in(
        "task_key",
        WRITING_DASHBOARD_BLOCKS.map((b) => b.key),
      );
    if (subsErr) console.warn("[user_submissions]", subsErr);
    subs?.forEach((s) => {
      subsByKey[s.task_key] = s.answer_text ?? "";
    });
  }

  let savedBundle = null;
  if (uid) {
    const { data: uwr, error: uwErr } = await sb
      .from("user_writing_submissions")
      .select("task_1_1_answer,task_1_2_answer,part_2_answer,ai_feedback_json")
      .eq("user_id", uid)
      .eq("day_number", dayNum)
      .eq("level", writingLevel)
      .maybeSingle();
    if (uwErr) console.warn("[user_writing_submissions]", uwErr);
    if (uwr) savedBundle = uwr;
  }

  let lastAiReport =
    savedBundle?.ai_feedback_json &&
    typeof savedBundle.ai_feedback_json === "object"
      ? savedBundle.ai_feedback_json
      : null;
  const persistWritingHolisticScore = (reportObj) => {
    const raw = Number(reportObj?.overallHolisticScoreOutOfTen);
    if (!Number.isFinite(raw)) return;
    try {
      localStorage.setItem(writingScoreUnlockKey, String(raw));
    } catch (_) {
      /* ignore storage errors */
    }
    mount.dispatchEvent(
      new CustomEvent("writing:score-updated", {
        bubbles: true,
        detail: { holisticScore: raw, level: planLevel },
      }),
    );
  };
  if (lastAiReport) persistWritingHolisticScore(lastAiReport);

  const metaTitle = String(row.title ?? "").trim() || `Writing · kun ${dayNum}`;
  const displayDay = Math.min(
    30,
    Math.max(1, Math.floor(Number(row.day_number ?? dayNum)) || dayNum),
  );

  const contextRaw =
    String(row.context ?? "").trim() || String(row.description ?? "").trim();
  const safeContextBody = escapeHtmlStep11(contextRaw);
  const contextPlaceholder =
    "<p class=\"m-0 text-sm italic text-stone-500\">Kirish matni yo‘q — <code class=\"rounded bg-stone-200 px-1 text-xs text-stone-800\">context</code> / <code class=\"rounded bg-stone-200 px-1 text-xs text-stone-800\">description</code>.</p>";

  const qRaw = (col) => {
    const raw =
      row[col] != null && String(row[col]).trim() ? String(row[col]).trim() : "";
    return raw || `Savol kiritilmagan — writing_tasks.${col}`;
  };

  const promptTask_1_1 = qRaw("task_1_1");
  const promptTask_1_2 = qRaw("task_1_2");
  const promptPart_2 = qRaw("part_2");
  const managerLetterDefault =
    "Dear Student,\n\nWe are planning to make some improvements to our school canteen, and we would like to hear your ideas.\nPlease share your suggestions about food quality, prices, and the overall environment.\nYour opinion is important for creating a better canteen for everyone.\n\nBest regards,\nCanteen Manager";
  const writingHeaderTitle =
    displayDay === 1 ? "Test 1 - School Canteen" : escapeHtmlStep11(metaTitle);
  const managerLetterBody =
    displayDay === 1
      ? String(contextRaw || managerLetterDefault).trim()
      : String(contextRaw || "").trim();
  const safeManagerLetter = escapeHtmlStep11(managerLetterBody);

  const draftKey = `edunext_writing3:${writingLevel}:${dayNum}`;
  const draftKeyLocal = `edunext_writing3_local:${writingLevel}:${dayNum}`;
  const aiReportLocalKey = `edunext_writing3_ai:${writingLevel}:${dayNum}`;
  let initial = { t1: "", t2: "", t3: "" };
  try {
    const raw =
      sessionStorage.getItem(draftKey) || localStorage.getItem(draftKeyLocal);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") {
        initial.t1 = String(j.t1 ?? "");
        initial.t2 = String(j.t2 ?? "");
        initial.t3 = String(j.t3 ?? "");
      }
    }
  } catch (_) {
    /* ignore */
  }
  if (!lastAiReport) {
    try {
      const rawAi = localStorage.getItem(aiReportLocalKey);
      if (rawAi) {
        const parsedAi = JSON.parse(rawAi);
        if (parsedAi && typeof parsedAi === "object" && parsedAi.tasks) {
          lastAiReport = parsedAi;
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (!initial.t1 && !initial.t2 && !initial.t3) {
    if (savedBundle) {
      initial.t1 = String(savedBundle.task_1_1_answer ?? "");
      initial.t2 = String(savedBundle.task_1_2_answer ?? "");
      initial.t3 = String(savedBundle.part_2_answer ?? "");
    } else {
      initial.t1 = String(subsByKey.task_1_1 ?? "");
      initial.t2 = String(subsByKey.task_1_2 ?? "");
      initial.t3 = String(subsByKey.part_2 ?? "");
    }
  }

  const lock = Boolean(alreadyDone);

  if (typeof mount._writingTimerClear === "function") {
    mount._writingTimerClear();
    mount._writingTimerClear = null;
  }

  const safeId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "_");

  mount.innerHTML = `
    <div class="text-left text-slate-200" data-writing-inner>
      <div class="flex flex-col gap-8">
        <div class="writing-editor-col min-w-0 w-full max-w-none space-y-6">
          <header class="border-b border-white/10 pb-4">
            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Writing · kun ${displayDay}</p>
            <h3 class="mt-2 text-xl font-semibold tracking-tight text-red-500 sm:text-2xl">${writingHeaderTitle}</h3>
          </header>
          <aside class="writing-context-shell rounded-xl border border-stone-300/95 bg-gradient-to-b from-stone-50 via-amber-50/90 to-stone-100 px-4 py-4 text-stone-900 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.35)] ring-1 ring-stone-200/95 sm:px-6 sm:py-5">
            <p class="text-[11px] font-bold uppercase tracking-wide text-red-900/95">Manager xati · Context</p>
            <div class="mt-3 text-sm leading-[1.7]">${
              managerLetterBody
                ? `<div class="whitespace-pre-wrap">${safeManagerLetter}</div>`
                : contextPlaceholder
            }</div>
          </aside>

          <p class="text-[13px] leading-relaxed text-slate-400">Har bir topshiriq alohida oynada. Vazifalarni <span class="font-semibold text-slate-300">pastma-past</span> bajaring: avval 1.1, keyin 1.2, so‘ng Part 2.</p>

          <nav class="grid gap-2 sm:grid-cols-3" data-writing-switcher aria-label="Task switcher">
            <button type="button" data-writing-switch-target="task_1_1" class="rounded-xl border border-violet-500/45 bg-violet-600/20 px-3 py-2 text-xs font-bold uppercase tracking-wide text-violet-100 transition hover:bg-violet-600/35">
              Task 1.1 (50 words)
            </button>
            <button type="button" data-writing-switch-target="task_1_2" class="rounded-xl border border-indigo-500/45 bg-indigo-600/20 px-3 py-2 text-xs font-bold uppercase tracking-wide text-indigo-100 transition hover:bg-indigo-600/35">
              Task 1.2 (120-150 words)
            </button>
            <button type="button" data-writing-switch-target="part_2" class="rounded-xl border border-cyan-500/45 bg-cyan-600/20 px-3 py-2 text-xs font-bold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-600/35">
              Part 2 (180-200 words)
            </button>
          </nav>

          <section class="space-y-8" aria-label="Yozma topshiriqlar">
            <article class="relative isolate overflow-hidden rounded-2xl border-2 border-violet-500/45 bg-gradient-to-b from-violet-950/55 via-[#10081a] to-black/95 p-5 shadow-[0_16px_48px_-12px_rgba(139,92,246,0.35)] ring-1 ring-white/10 sm:p-6" data-writing-pane="task_1_1">
              <div class="flex flex-wrap items-start gap-3 border-b border-white/10 pb-4">
                <div class="flex min-w-0 flex-1 gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/80 to-purple-900/90 text-base font-black text-white shadow-md shadow-fuchsia-500/25" aria-hidden="true">1</span>
                  <div class="min-w-0">
                    <h4 class="text-base font-bold tracking-tight text-white">Task 1.1</h4>
                    <p class="mt-0.5 text-[11px] text-slate-500">Kamida 50 so‘z</p>
                  </div>
                </div>
              </div>
              <div class="mt-4 rounded-xl border border-white/10 bg-black/35 p-4">
                <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Savol</p>
                <div class="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-200">${escapeHtmlStep11(promptTask_1_1)}</div>
              </div>
              <label class="sr-only" for="${safeId}-t11">Task 1.1 javobi</label>
              <textarea id="${safeId}-t11" data-writing-answer="task_1_1" rows="12" ${lock ? "disabled" : ""}
                class="relative z-0 mt-4 block min-h-[200px] w-full resize-y rounded-xl border border-slate-600/80 bg-neutral-950 px-4 py-3 font-mono text-[14px] leading-relaxed text-neutral-50 placeholder:text-slate-500 focus:border-fuchsia-500/60 focus:ring-2 focus:ring-fuchsia-950/50 disabled:opacity-60"
                placeholder="Bu yerda yozing…"></textarea>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">So‘zlar</span>
                <span data-wc="task_1_1" class="writing-wc-pill inline-flex items-center rounded-lg border px-3 py-1.5 font-mono text-xs font-bold tabular-nums border-rose-500/55 bg-rose-950/40 text-rose-300" aria-live="polite">0 so‘z</span>
              </div>
              <button type="button" data-writing-ai-task="task_1_1"
                class="dashboard-primary-btn mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/18 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-100 transition hover:bg-fuchsia-600/30">
                AI TEKSHIRUV
              </button>
              <div data-writing-ai-task-result="task_1_1" class="mt-2 hidden rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-slate-100"></div>
            </article>

            <article class="relative isolate overflow-hidden rounded-2xl border-2 border-indigo-500/45 bg-gradient-to-b from-indigo-950/50 via-[#0c0818] to-black/95 p-5 shadow-[0_16px_48px_-12px_rgba(99,102,241,0.3)] ring-1 ring-white/10 sm:p-6" data-writing-pane="task_1_2">
              <div class="flex flex-wrap items-start gap-3 border-b border-white/10 pb-4">
                <div class="flex min-w-0 flex-1 gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/85 to-violet-950/95 text-base font-black text-white shadow-md shadow-indigo-500/20" aria-hidden="true">2</span>
                  <div class="min-w-0">
                    <h4 class="text-base font-bold tracking-tight text-white">Task 1.2</h4>
                    <p class="mt-0.5 text-[11px] text-slate-500">120–150 so‘z (ruxsat 120–160)</p>
                  </div>
                </div>
              </div>
              <div class="mt-4 rounded-xl border border-white/10 bg-black/35 p-4">
                <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Savol</p>
                <div class="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-200">${escapeHtmlStep11(promptTask_1_2)}</div>
              </div>
              <label class="sr-only" for="${safeId}-t12">Task 1.2 javobi</label>
              <textarea id="${safeId}-t12" data-writing-answer="task_1_2" rows="14" ${lock ? "disabled" : ""}
                class="relative z-0 mt-4 block min-h-[240px] w-full resize-y rounded-xl border border-slate-600/80 bg-neutral-950 px-4 py-3 font-mono text-[14px] leading-relaxed text-neutral-50 placeholder:text-slate-500 focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-950/50 disabled:opacity-60"
                placeholder="Bu yerda yozing…"></textarea>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">So‘zlar</span>
                <span data-wc="task_1_2" class="writing-wc-pill inline-flex items-center rounded-lg border px-3 py-1.5 font-mono text-xs font-bold tabular-nums border-rose-500/55 bg-rose-950/40 text-rose-300" aria-live="polite">0 so‘z</span>
              </div>
              <button type="button" data-writing-ai-task="task_1_2"
                class="dashboard-primary-btn mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/18 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-100 transition hover:bg-fuchsia-600/30">
                AI TEKSHIRUV
              </button>
              <div data-writing-ai-task-result="task_1_2" class="mt-2 hidden rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-slate-100"></div>
            </article>

            <article class="relative isolate overflow-hidden rounded-2xl border-2 border-cyan-500/40 bg-gradient-to-b from-cyan-950/35 via-[#071018] to-black/95 p-5 shadow-[0_16px_48px_-12px_rgba(34,211,238,0.22)] ring-1 ring-white/10 sm:p-6" data-writing-pane="part_2">
              <div class="flex flex-wrap items-start gap-3 border-b border-white/10 pb-4">
                <div class="flex min-w-0 flex-1 gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/75 to-slate-900/95 text-base font-black text-white shadow-md shadow-cyan-500/20" aria-hidden="true">3</span>
                  <div class="min-w-0">
                    <h4 class="text-base font-bold tracking-tight text-white">Part 2</h4>
                    <p class="mt-0.5 text-[11px] text-slate-500">180–200 so‘z (ruxsat 175–215)</p>
                  </div>
                </div>
              </div>
              <div class="mt-4 rounded-xl border border-white/10 bg-black/35 p-4">
                <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Savol</p>
                <div class="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-200">${escapeHtmlStep11(promptPart_2)}</div>
              </div>
              <label class="sr-only" for="${safeId}-p2">Part 2 javobi</label>
              <textarea id="${safeId}-p2" data-writing-answer="part_2" rows="16" ${lock ? "disabled" : ""}
                class="relative z-0 mt-4 block min-h-[280px] w-full resize-y rounded-xl border border-slate-600/80 bg-neutral-950 px-4 py-3 font-mono text-[14px] leading-relaxed text-neutral-50 placeholder:text-slate-500 focus:border-cyan-500/55 focus:ring-2 focus:ring-cyan-950/40 disabled:opacity-60"
                placeholder="Bu yerda yozing…"></textarea>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">So‘zlar</span>
                <span data-wc="part_2" class="writing-wc-pill inline-flex items-center rounded-lg border px-3 py-1.5 font-mono text-xs font-bold tabular-nums border-rose-500/55 bg-rose-950/40 text-rose-300" aria-live="polite">0 so‘z</span>
              </div>
              <button type="button" data-writing-ai-task="part_2"
                class="dashboard-primary-btn mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/18 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-100 transition hover:bg-fuchsia-600/30">
                AI TEKSHIRUV
              </button>
              <div data-writing-ai-task-result="part_2" class="mt-2 hidden rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-slate-100"></div>
            </article>
          </section>

          <div class="rounded-xl border border-sky-500/35 bg-sky-950/20 p-4 sm:p-5">
            <p class="text-center text-sm font-semibold text-sky-100/95">Barcha uchalasini yozganingizdan keyin matnlarni AI tekshiradi.</p>
            <div data-writing-mentor-warning class="mt-3 hidden rounded-lg border border-amber-400/45 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"></div>
            <button type="button" data-writing-check
              ${lock || !uid ? "disabled" : ""}
              class="dashboard-primary-btn mt-4 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border-2 border-sky-400/50 bg-gradient-to-b from-sky-600/50 to-sky-950/80 px-6 py-3.5 text-sm font-black uppercase tracking-[0.25em] text-white shadow-[0_0_28px_rgba(14,165,233,0.25)] transition hover:from-sky-500/55 hover:to-sky-900/90 disabled:pointer-events-none disabled:opacity-35">
              TEKSHIRISH
            </button>
            ${!uid ? `<p class="mt-3 text-center text-xs text-amber-200/90">Tekshiruv uchun tizimga kiring.</p>` : ""}
          </div>

          <div class="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5">
            <p class="text-xs text-slate-400">Kunlik barqarorlik: ikkala vazifa ham bazaga yoziladi.</p>
            <button type="button" data-writing-finish-day
              ${lock || !uid ? "disabled" : ""}
              class="dashboard-primary-btn mt-4 inline-flex w-full min-h-[44px] items-center justify-center rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/25 px-5 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-fuchsia-600/38 disabled:pointer-events-none disabled:opacity-35">
              KUNLIK VAZIFANI YAKUNLASH
            </button>
          </div>
        </div>

        <aside class="writing-feedback-aside w-full min-w-0 shrink-0 border-t border-white/10 pt-8" aria-label="Writing AI feedback">
          <p class="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">AI tahlili</p>
          <div class="min-w-0" data-writing-feedback-root>${
            lastAiReport?.tasks
              ? renderWritingThreeTasksFeedbackHTML(lastAiReport, {
                  task_1_1: String(savedBundle?.task_1_1_answer ?? ""),
                  task_1_2: String(savedBundle?.task_1_2_answer ?? ""),
                  part_2: String(savedBundle?.part_2_answer ?? ""),
                })
              : renderWritingFeedbackEmptyHTML()
          }</div>
        </aside>
      </div>
    </div>`;

  mount.removeAttribute("data-writing-timeup");
  mount.removeAttribute("data-writing-timer-armed");
  mount.removeAttribute("data-writing-eval-done");
  if (alreadyDone) mount.setAttribute("data-writing-eval-done", "");
  if (uid) {
    if (alreadyDone) {
      ensureWritingReadingNavMount(
        mount,
        "Writing allaqachon yakunlangan. Reading bo‘limiga o‘tishingiz mumkin.",
      );
    } else {
      ensureWritingReadingNavMount(
        mount,
        "AI tekshiruvidan oldin ham Reading bo‘limiga o‘tishingiz mumkin.",
      );
    }
  }

  const ta1 = mount.querySelector('textarea[data-writing-answer="task_1_1"]');
  const ta2 = mount.querySelector('textarea[data-writing-answer="task_1_2"]');
  const ta3 = mount.querySelector('textarea[data-writing-answer="part_2"]');
  const perTaskResultEls = {
    task_1_1: mount.querySelector('[data-writing-ai-task-result="task_1_1"]'),
    task_1_2: mount.querySelector('[data-writing-ai-task-result="task_1_2"]'),
    part_2: mount.querySelector('[data-writing-ai-task-result="part_2"]'),
  };
  if (ta1) ta1.value = initial.t1;
  if (ta2) ta2.value = initial.t2;
  if (ta3) ta3.value = initial.t3;

  const fbRoot = mount.querySelector("[data-writing-feedback-root]");
  const wcEls = {
    task_1_1: mount.querySelector('[data-wc="task_1_1"]'),
    task_1_2: mount.querySelector('[data-wc="task_1_2"]'),
    part_2: mount.querySelector('[data-wc="part_2"]'),
  };
  const mentorWarningEl = mount.querySelector("[data-writing-mentor-warning]");
  const switchButtons = Array.from(
    mount.querySelectorAll("[data-writing-switch-target]"),
  );
  const panes = Array.from(mount.querySelectorAll("[data-writing-pane]"));

  const wcPillBase =
    "writing-wc-pill inline-flex items-center rounded-lg border px-3 py-1.5 font-mono text-xs font-bold tabular-nums transition-colors duration-150";
  const wcOk =
    "border-emerald-500/65 bg-emerald-950/55 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]";
  const wcBad =
    "border-rose-500/60 bg-rose-950/45 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.12)]";

  const setMentorWarning = (msg = "") => {
    if (!mentorWarningEl) return;
    const safe = String(msg || "").trim();
    if (!safe) {
      mentorWarningEl.classList.add("hidden");
      mentorWarningEl.textContent = "";
      return;
    }
    mentorWarningEl.textContent = `AI Mentor: ${safe}`;
    mentorWarningEl.classList.remove("hidden");
  };

  const setActivePane = (paneKey) => {
    const active = String(paneKey || "task_1_1");
    panes.forEach((pane) => {
      const isActive = pane.getAttribute("data-writing-pane") === active;
      pane.classList.toggle("hidden", !isActive);
    });
    switchButtons.forEach((btn) => {
      const isActive = btn.getAttribute("data-writing-switch-target") === active;
      btn.classList.toggle("ring-2", isActive);
      btn.classList.toggle("ring-fuchsia-400/60", isActive);
      btn.classList.toggle("shadow-[0_0_18px_rgba(217,70,239,0.35)]", isActive);
    });
  };
  setActivePane("task_1_1");
  switchButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setActivePane(btn.getAttribute("data-writing-switch-target"));
    });
  });

  const syncAllWc = () => {
    const n1 = countWordsText(ta1?.value ?? "");
    const n2 = countWordsText(ta2?.value ?? "");
    const n3 = countWordsText(ta3?.value ?? "");
    if (wcEls.task_1_1) {
      wcEls.task_1_1.textContent = `${n1} so‘z`;
      wcEls.task_1_1.className = `${wcPillBase} ${n1 >= 50 ? wcOk : wcBad}`;
    }
    if (wcEls.task_1_2) {
      wcEls.task_1_2.textContent = `${n2} so‘z`;
      const ok2 = n2 >= 120 && n2 <= 160;
      wcEls.task_1_2.className = `${wcPillBase} ${ok2 ? wcOk : wcBad}`;
    }
    if (wcEls.part_2) {
      wcEls.part_2.textContent = `${n3} so‘z`;
      const ok3 = n3 >= 175 && n3 <= 215;
      wcEls.part_2.className = `${wcPillBase} ${ok3 ? wcOk : wcBad}`;
    }
  };
  syncAllWc();

  let draftTimer = null;
  const saveDraft = () => {
    if (lock) return;
    try {
      const draftPayload = JSON.stringify({
        t1: String(ta1?.value ?? ""),
        t2: String(ta2?.value ?? ""),
        t3: String(ta3?.value ?? ""),
      });
      sessionStorage.setItem(draftKey, draftPayload);
      localStorage.setItem(draftKeyLocal, draftPayload);
    } catch (_) {
      /* ignore */
    }
  };
  [ta1, ta2, ta3].forEach((ta) => {
    if (!ta || lock) return;
    ta.addEventListener("input", () => {
      syncAllWc();
      setMentorWarning("");
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = window.setTimeout(saveDraft, 400);
    });
  });

  if (mount._onPageHideWriting) {
    window.removeEventListener("pagehide", mount._onPageHideWriting);
    mount._onPageHideWriting = null;
  }
  const onPageHideWriting = () => {
    if (!mount.hasAttribute("data-writing-eval-done")) saveDraft();
  };
  window.addEventListener("pagehide", onPageHideWriting);
  mount._onPageHideWriting = onPageHideWriting;

  const validateLengthsForSubmit = () => {
    const w1 = countWordsText(ta1?.value ?? "");
    const w2 = countWordsText(ta2?.value ?? "");
    const w3 = countWordsText(ta3?.value ?? "");
    if (w1 < 50) {
      setActivePane("task_1_1");
      setMentorWarning(`Task 1.1 uchun kamida 50 so‘z yozing (hozir ${w1}).`);
      return false;
    }
    if (w2 < 120 || w2 > 160) {
      setActivePane("task_1_2");
      setMentorWarning(`Task 1.2 uchun 120-150 so‘z yozing (hozir ${w2}).`);
      return false;
    }
    if (w3 < 175 || w3 > 215) {
      setActivePane("part_2");
      setMentorWarning(`Part 2 uchun 180-200 so‘z yozing (hozir ${w3}).`);
      return false;
    }
    setMentorWarning("");
    return true;
  };

  const validateSingleTaskLength = (taskKey) => {
    if (taskKey === "task_1_1") {
      const n = countWordsText(ta1?.value ?? "");
      if (n < 50) {
        setActivePane("task_1_1");
        setMentorWarning(`Task 1.1 uchun kamida 50 so‘z yozing (hozir ${n}).`);
        return false;
      }
      return true;
    }
    if (taskKey === "task_1_2") {
      const n = countWordsText(ta2?.value ?? "");
      if (n < 120 || n > 160) {
        setActivePane("task_1_2");
        setMentorWarning(`Task 1.2 uchun 120-150 so‘z yozing (hozir ${n}).`);
        return false;
      }
      return true;
    }
    const n = countWordsText(ta3?.value ?? "");
    if (n < 175 || n > 215) {
      setActivePane("part_2");
      setMentorWarning(`Part 2 uchun 180-200 so‘z yozing (hozir ${n}).`);
      return false;
    }
    return true;
  };

  const runSingleTaskAiCheck = async (taskKey, triggerBtn) => {
    const textByTask = {
      task_1_1: String(ta1?.value ?? "").trim(),
      task_1_2: String(ta2?.value ?? "").trim(),
      part_2: String(ta3?.value ?? "").trim(),
    };
    const promptByTask = {
      task_1_1: promptTask_1_1,
      task_1_2: promptTask_1_2,
      part_2: promptPart_2,
    };
    const titleByTask = {
      task_1_1: "Task 1.1",
      task_1_2: "Task 1.2",
      part_2: "Part 2",
    };
    const txt = textByTask[taskKey] || "";
    const resultEl = perTaskResultEls[taskKey];
    if (!resultEl) return;
    if (!txt) {
      resultEl.classList.remove("hidden");
      resultEl.innerHTML = `<p class="text-rose-200">Avval matn kiriting.</p>`;
      return;
    }
    const btn = triggerBtn;
    const prevLabel = btn?.textContent || "AI TEKSHIRUV";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Tekshirilmoqda…";
    }
    resultEl.classList.remove("hidden");
    resultEl.innerHTML = `<p class="text-slate-300">AI tekshiruv yuborildi…</p>`;
    try {
      const { res, payload } = await handleCheck(
        async () => {
          const r = await fetch(apiUrl("/api/ai/check-dashboard-writing"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: txt,
              dayNumber: dayNum,
              topicTitle: `${titleByTask[taskKey]} · Test 1 - School Canteen`,
            }),
          });
          const p = await r.json().catch(() => ({}));
          return { res: r, payload: p };
        },
        { delayMs: 3500, maxAttempts: 8 },
      );
      if (!res.ok || !payload.success) {
        const err =
          typeof payload.error === "string"
            ? payload.error
            : `AI tekshiruv xatosi (HTTP ${res.status})`;
        resultEl.innerHTML = `<p class="text-rose-200">${escapeHtmlStep11(err)}</p>`;
        return;
      }
      const fb = String(payload.feedback ?? payload.feedbackUz ?? "").trim();
      const wc = countWordsText(txt);
      resultEl.innerHTML = `<p class="mb-1 text-fuchsia-200 font-bold">${escapeHtmlStep11(
        titleByTask[taskKey],
      )} · ${wc} so‘z</p>
      <p class="whitespace-pre-wrap leading-relaxed text-slate-100">${escapeHtmlStep11(
        fb || "AI javobi olindi.",
      )}</p>`;
    } catch (e) {
      resultEl.innerHTML = `<p class="text-rose-200">${escapeHtmlStep11(
        typeof e?.message === "string" ? e.message : "AI tekshiruvda xatolik",
      )}</p>`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel;
      }
    }
  };

  mount.addEventListener("click", async (ev) => {
    const goReadingBtn = ev.target.closest("[data-writing-go-reading]");
    if (goReadingBtn) {
      try {
        localStorage.setItem("edunext_current_study_day", "1");
        localStorage.setItem("currentDay", "1");
        sessionStorage.setItem("edunext_force_open_reading", "1");
      } catch (_) {
        /* ignore */
      }
      window.location.assign("/dashboard/reading");
      return;
    }

    const perTaskBtn = ev.target.closest("[data-writing-ai-task]");
    if (perTaskBtn) {
      const taskKey = String(perTaskBtn.getAttribute("data-writing-ai-task") || "").trim();
      if (!taskKey) return;
      if (!validateSingleTaskLength(taskKey)) return;
      setMentorWarning("");
      await runSingleTaskAiCheck(taskKey, perTaskBtn);
      return;
    }

    const checkBtn = ev.target.closest("[data-writing-check]");
    if (checkBtn) {
      if (checkBtn.disabled || mount.hasAttribute("data-writing-eval-done")) return;
      if (!validateLengthsForSubmit()) return;

      const s1 = String(ta1?.value ?? "").trim();
      const s2 = String(ta2?.value ?? "").trim();
      const s3 = String(ta3?.value ?? "").trim();

      checkBtn.disabled = true;
      const prev = checkBtn.textContent;
      checkBtn.textContent = "Tekshirilmoqda…";
      try {
        const { res, payload } = await handleCheck(
          async () => {
            const r = await fetch(apiUrl("/api/ai/writing-three-tasks-feedback"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_1_1: s1,
                task_1_2: s2,
                part_2: s3,
                level: writingLevel,
                dayNumber: dayNum,
                title: metaTitle,
                context: contextRaw,
                promptTask_1_1: promptTask_1_1,
                promptTask_1_2: promptTask_1_2,
                promptPart_2: promptPart_2,
              }),
            });
            const p = await r.json().catch(() => ({}));
            return { res: r, payload: p };
          },
          { delayMs: 5000, maxAttempts: 12 },
        );

        if (!res.ok || !payload.success) {
          const rawErr =
            typeof payload.error === "string"
              ? payload.error
              : typeof payload.message === "string"
                ? payload.message
                : "";
          const err =
            rawErr ||
            (!res.ok
              ? `AI tekshiruvi muvaffaqiyatsiz (HTTP ${res.status}). Agar kalit yoki Groq bo‘lsa — server terminalidagi xabarni qarang; Agar 404 bo‘lsa — API manzili (/api/ai/...) noto‘g‘ri.`
              : "AI tekshiruvi muvaffaqiyatsiz (javobda success/error yo‘q).");
          console.warn("[writing-three-tasks-feedback]", res.status, payload);
          if (isGroqRateLimitPayload(res, payload)) {
            if (fbRoot)
              fbRoot.innerHTML = `<p class="text-sm leading-relaxed text-amber-200/90">AI serveri vaqtinchalik band (Groq rate limit). Qayta urinishlar tugagan — bir necha soniyadan keyin yana «TEKSHIRISH»ni bosing.</p>`;
          } else {
            window.alert?.(err);
          }
          checkBtn.disabled = false;
          checkBtn.textContent = prev;
          return;
        }
        if (!payload.report || typeof payload.report !== "object") {
          const err = "AI javobi noto‘g‘ri formatda keldi (report topilmadi).";
          window.alert?.(err);
          checkBtn.disabled = false;
          checkBtn.textContent = prev;
          return;
        }

        lastAiReport = payload.report;
        persistWritingHolisticScore(lastAiReport);
        if (fbRoot && payload.report) {
          fbRoot.innerHTML = renderWritingThreeTasksFeedbackHTML(payload.report, {
            task_1_1: s1,
            task_1_2: s2,
            part_2: s3,
          });
        }
        ensureWritingReadingNavMount(
          mount,
          "AI tekshiruv tugadi. Reading bo‘limiga o‘tishingiz mumkin.",
        );
        try {
          localStorage.setItem(aiReportLocalKey, JSON.stringify(payload.report));
        } catch (_) {
          /* ignore */
        }

        if (uid) {
          const { error: uwE } = await sb.from("user_writing_submissions").upsert(
            {
              user_id: uid,
              day_number: dayNum,
              level: writingLevel,
              task_1_1_answer: s1,
              task_1_2_answer: s2,
              part_2_answer: s3,
              ai_feedback_json: payload.report,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,day_number,level" },
          );
          if (uwE) console.warn("[user_writing_submissions]", uwE);
        }
      } catch (e) {
        console.warn("[writing-three-tasks-feedback]", e);
        window.alert?.(
          typeof e?.message === "string" ? e.message : "Serverga ulanilmadi.",
        );
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = prev;
      }
      return;
    }

    const finBtn = ev.target.closest("[data-writing-finish-day]");
    if (finBtn) {
      if (
        finBtn.disabled ||
        mount.hasAttribute("data-writing-eval-done") ||
        !uid
      )
        return;
      if (!validateLengthsForSubmit()) return;

      const s1 = String(ta1?.value ?? "").trim();
      const s2 = String(ta2?.value ?? "").trim();
      const s3 = String(ta3?.value ?? "").trim();

      finBtn.disabled = true;
      const prevF = finBtn.textContent;
      finBtn.textContent = "Saqlanmoqda…";
      try {
        const ts = new Date().toISOString();
        for (const [key, text] of [
          ["task_1_1", s1],
          ["task_1_2", s2],
          ["part_2", s3],
        ]) {
          const { error: upErr } = await sb.from("user_submissions").upsert(
            {
              user_id: uid,
              day_number: dayNum,
              level: writingLevel,
              task_key: key,
              answer_text: text,
              updated_at: ts,
            },
            { onConflict: "user_id,day_number,level,task_key" },
          );
          if (upErr) throw upErr;
        }

        const { error: uwE2 } = await sb.from("user_writing_submissions").upsert(
          {
            user_id: uid,
            day_number: dayNum,
            level: writingLevel,
            task_1_1_answer: s1,
            task_1_2_answer: s2,
            part_2_answer: s3,
            ai_feedback_json: lastAiReport,
            updated_at: ts,
          },
          { onConflict: "user_id,day_number,level" },
        );
        if (uwE2) console.warn("[user_writing_submissions] finish", uwE2);

        if (mount._onPageHideWriting) {
          window.removeEventListener("pagehide", mount._onPageHideWriting);
          mount._onPageHideWriting = null;
        }
        try {
          sessionStorage.removeItem(draftKey);
          localStorage.removeItem(draftKeyLocal);
          localStorage.removeItem(aiReportLocalKey);
          sessionStorage.removeItem(
            writingTimerStorageKey(uid, dayNum, writingLevel),
          );
        } catch (_) {
          /* ignore */
        }
        finalizeWritingSectionAfterEvaluation(card, studyDay, planLevel, mount);
      } catch (e) {
        window.alert?.(
          typeof e?.message === "string" ? e.message : "Saqlashda xato.",
        );
        finBtn.disabled = false;
        finBtn.textContent = prevF;
        return;
      }
      finBtn.textContent = "Yakunlandi";
      return;
    }
  });
}

function readVocabWordChecks(day) {
  const d = String(Math.min(30, Math.max(1, Math.floor(Number(day)) || 1)));
  try {
    const all = JSON.parse(localStorage.getItem(VOCAB_WORD_CHECK_KEY) || "{}");
    return all[d] && typeof all[d] === "object" ? all[d] : {};
  } catch (_) {
    return {};
  }
}

function writeVocabWordCheck(day, index, checked) {
  const d = String(Math.min(30, Math.max(1, Math.floor(Number(day)) || 1)));
  try {
    const all = JSON.parse(localStorage.getItem(VOCAB_WORD_CHECK_KEY) || "{}");
    if (!all[d]) all[d] = {};
    const k = String(index);
    if (checked) all[d][k] = true;
    else delete all[d][k];
    localStorage.setItem(VOCAB_WORD_CHECK_KEY, JSON.stringify(all));
  } catch (_) {
    /* ignore */
  }
}

/** «Vazifani tugatdim» bosilganda mentor chatiga bir martalik xabar. */
const VOCAB_FINISH_MENTOR_PROMPT_UZ =
  "Men bugungi lug'atdagi yangi so'zlarni yodladim. Endi ular bilan inglizcha gaplar yozdim yoki yozishni boshlashga tayyorman — akademik tarz va so'zlarni matnda tasdiqlab berishingizni so'rayman.";

/**
 * Supabase: vocabulary_list (joriy kun, 20 ta) + vocabulary_user_progress (is_learned).
 * `escapeHtmlStep11` modul yuklanganda mavjud.
 *
 * `level`:
 *   - "A2" — eski yodlash + checkbox + 1 daqiqa taymer rejimi (dashboarddagi A2 oqim).
 *   - "B1" — Bright Neon 2-ustunli karta grid (so‘z + transkripsiya + tarjima + misol gap)
 *           va pastida «Writing sectionga o‘tish» tugmasi.
 */
async function setupVocabularyTaskCard(card, studyDay, taskId, alreadyDone, level) {
  const mount = card.querySelector(`[data-vocab-mount="${taskId}"]`);
  if (!mount) return;

  const sb = ensureSupabase();
  if (!sb) {
    mount.innerHTML =
      `<p class="text-xs text-amber-300">Supabase ulanmagan — \`SUPABASE_URL\` va anon kalitni tekshiring.</p>`;
    return;
  }

  const planLevel = dashboardVocabularyPathMatches()
    ? "B1"
    : String(level || inferEducationPlanTier() || "A2").trim().toUpperCase() === "B1"
      ? "B1"
      : "A2";

  let sessionUserId = null;

  function renderLoading() {
    const accent =
      planLevel === "B1"
        ? "border-fuchsia-500/30 bg-fuchsia-500/[0.06]"
        : "border-white/10 bg-black/25";
    const spinner =
      planLevel === "B1"
        ? "border-fuchsia-400 border-t-transparent"
        : "border-emerald-400 border-t-transparent";
    mount.innerHTML = `
      <div class="flex flex-col items-center justify-center gap-3 rounded-lg border ${accent} py-8 px-4 text-center">
        <p class="text-sm text-slate-300">Yuklanmoqda...</p>
        <div class="h-6 w-6 animate-spin rounded-full border-2 ${spinner}" aria-hidden="true"></div>
      </div>`;
  }

  function renderError(message, showRetry) {
    const retryBtn = showRetry
      ? `<button type="button" data-vocab-retry class="mt-3 rounded-lg border border-fuchsia-500/45 bg-fuchsia-600/25 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-fuchsia-600/40">
          Qayta urinib ko'rish
        </button>`
      : "";
    mount.innerHTML = `
      <div class="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center">
        <p class="text-xs text-red-200/95">${escapeHtmlStep11(message)}</p>
        ${retryBtn}
      </div>`;
    mount.querySelector("[data-vocab-retry]")?.addEventListener("click", () => {
      void loadVocabularyMount();
    });
  }

  /**
   * B1 — Bright Neon Edition: 3 holatli state machine.
   *   - learning : 2-ustunli kartochka grid (so‘z, transkripsiya, tarjima, misol gap)
   *                + pastki o‘ng burchakda neon binafsha checkbox.
   *   - quiz     : 20 ta lug‘atdan tasodifiy biri (o‘zbekcha) ko‘rsatiladi,
   *                har savol uchun 5 soniya (countdown), foydalanuvchi inglizchasini yozadi.
   *   - result   : umumiy ball (X/20) + tafsilot. «Vazifani tugatdim» tugmasi faollashadi.
   * Holat va natija localStorage ga saqlanadi (sahifa yangilansa ham yo‘qolmaydi).
   */
  async function renderB1Grid(rows, dayNum) {
    // ---------- 1) Lug‘at progress (DB + localStorage) ----------
    const progMap = {};
    if (sessionUserId && rows.length) {
      const ids = rows.map((r) => r.id).filter(Boolean);
      const { data: progRows, error: progErr } = await sb
        .from("vocabulary_user_progress")
        .select("vocabulary_list_id,is_learned")
        .eq("user_id", sessionUserId)
        .in("vocabulary_list_id", ids);
      if (progErr) console.warn("[vocabulary_user_progress B1]", progErr);
      progRows?.forEach((p) => {
        if (p?.vocabulary_list_id)
          progMap[p.vocabulary_list_id] = Boolean(p.is_learned);
      });
    }

    const localKey = `edunext_vocab_word_checks_b1:${dayNum}`;
    const quizResultKey = `edunext_vocab_b1_quiz:${dayNum}`;
    let checksLocal = {};
    try {
      const raw = JSON.parse(localStorage.getItem(localKey) || "{}");
      checksLocal = raw && typeof raw === "object" ? raw : {};
    } catch (_) {
      checksLocal = {};
    }
    const writeLocalCheck = (rowId, idx, checked) => {
      try {
        const all = JSON.parse(localStorage.getItem(localKey) || "{}");
        const k = String(rowId || idx);
        if (checked) all[k] = true;
        else delete all[k];
        localStorage.setItem(localKey, JSON.stringify(all));
      } catch (_) {
        /* ignore */
      }
    };
    const isLearnedFor = (row, idx) => {
      if (alreadyDone) return true;
      if (row.id && progMap[row.id]) return true;
      const k1 = String(row.id || "");
      const k2 = String(idx);
      return Boolean(checksLocal[k1] || checksLocal[k2]);
    };

    const readQuizResult = () => {
      try {
        const r = JSON.parse(localStorage.getItem(quizResultKey) || "null");
        if (
          r &&
          typeof r === "object" &&
          Number.isFinite(r.score) &&
          Number.isFinite(r.total)
        ) {
          return r;
        }
      } catch (_) {
        /* ignore */
      }
      return null;
    };
    const writeQuizResult = (data) => {
      try {
        localStorage.setItem(
          quizResultKey,
          JSON.stringify({ ...data, completedAt: Date.now() }),
        );
      } catch (_) {
        /* ignore */
      }
    };

    // ---------- 2) Yordamchi util ----------
    const QUIZ_PER_WORD_MS = 7000;

    const normalizeAns = (s) =>
      String(s ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const shuffleArr = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const setFooterDoneEnabled = (enabled) => {
      const btn = card.querySelector("button.step11-done-task-btn");
      if (!btn) return;
      if (alreadyDone) {
        btn.disabled = true;
        return;
      }
      btn.disabled = !enabled;
    };

    const setFooterStatus = (text) => {
      const statusEl = card.querySelector("[data-vocab-status]");
      if (statusEl) statusEl.textContent = text;
    };

    // ---------- 3) State ----------
    let state = "learning"; // "learning" | "quiz" | "result"
    let quizQueue = [];
    let quizIndex = 0;
    let quizAnswers = [];
    let timerId = null;
    let deadlineTs = 0;

    const cachedResult = readQuizResult();
    const allInitiallyChecked = rows.every((r, i) => isLearnedFor(r, i));
    if (alreadyDone) {
      state = "result";
    } else if (cachedResult) {
      state = "result";
    } else if (allInitiallyChecked) {
      state = "learning";
    }

    // ---------- 4) Header / shell ----------
    const headerTitle = (s) =>
      s === "quiz"
        ? "Lug‘atlarni tekshirish"
        : s === "result"
          ? "Lug‘atlarni tekshirish — natija"
          : "Kunlik 20 ta akademik so‘z (B1)";
    const headerHint = (s) =>
      s === "quiz"
        ? "AI 10 ta random savol beradi — har biriga 7 soniya ichida inglizchasini yozing."
        : s === "result"
          ? "Sinov tugadi. Pastdagi «KUNLIK VAZIFANI YAKUNLASH» tugmasi orqali yakunlang."
          : "So‘zlarni o‘qing va yodlab bo‘lganda pastki o‘ng burchakdagi katakchani belgilang. Hammasi belgilangach quiz ochiladi.";
    const headerBadge = (s) => {
      if (alreadyDone || s === "result") {
        return `<span class="inline-flex items-center gap-1 rounded-full border border-emerald-400/45 bg-emerald-600/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">Bajarildi</span>`;
      }
      if (s === "quiz") {
        return `<span class="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-600/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Quiz rejimi</span>`;
      }
      return `<span class="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-600/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-200">Day ${dayNum} • B1 • ${rows.length} so‘z</span>`;
    };

    mount.innerHTML = `
    <section class="vocab-b1-wrap w-full space-y-6">
      <header class="flex flex-wrap items-end justify-between gap-3 border-b border-fuchsia-500/20 pb-4">
        <div class="min-w-0">
          <h3 class="mt-1 text-lg font-black text-white sm:text-xl" data-vocab-b1-title>${headerTitle(state)}</h3>
          <p class="mt-1 text-xs text-slate-400" data-vocab-b1-hint>${headerHint(state)}</p>
        </div>
        <div data-vocab-b1-badge>${headerBadge(state)}</div>
      </header>

      <div class="rounded-2xl border border-fuchsia-500/25 bg-black/35 p-4 sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300/95">AI Mentor — yordam</p>
            <p class="mt-1 text-xs leading-relaxed text-slate-300">O‘ngdagi <span class="font-semibold text-fuchsia-200">Edu Next AI Mentor</span> doimiy turadi. So‘zlarning ishlatilishi, kollokatsiyalari yoki sinonimlari haqida ingliz tilida savol yuboring.</p>
          </div>
          <button type="button" data-vocab-b1-mentor-btn class="dashboard-primary-btn inline-flex min-h-[40px] items-center justify-center rounded-xl border border-fuchsia-500/55 bg-fuchsia-600/30 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-fuchsia-600/45">
            AI Mentor’ga savol berish
          </button>
        </div>
      </div>

      <div data-vocab-b1-stage></div>
    </section>`;

    mount
      .querySelector("[data-vocab-b1-mentor-btn]")
      ?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          focusDashboardMentorForSubject("vocabulary");
        } catch (_) {
          /* ignore */
        }
      });

    const stageEl = () => mount.querySelector("[data-vocab-b1-stage]");

    const updateHeader = () => {
      const titleEl = mount.querySelector("[data-vocab-b1-title]");
      const hintEl = mount.querySelector("[data-vocab-b1-hint]");
      const badgeEl = mount.querySelector("[data-vocab-b1-badge]");
      if (titleEl) titleEl.textContent = headerTitle(state);
      if (hintEl) hintEl.textContent = headerHint(state);
      if (badgeEl) badgeEl.innerHTML = headerBadge(state);
    };

    // ---------- 5) Learning view ----------
    const LEARNED_CLASSES = [
      "border-emerald-400/75",
      "shadow-[0_0_28px_rgba(52,211,153,0.5)]",
    ];
    const NORMAL_CLASSES = [
      "border-fuchsia-500/35",
      "shadow-[0_0_22px_rgba(217,70,239,0.16)]",
    ];
    const applyLearnedVisual = (article, learned) => {
      if (!article) return;
      if (learned) {
        NORMAL_CLASSES.forEach((c) => article.classList.remove(c));
        LEARNED_CLASSES.forEach((c) => article.classList.add(c));
        article.dataset.learned = "true";
      } else {
        LEARNED_CLASSES.forEach((c) => article.classList.remove(c));
        NORMAL_CLASSES.forEach((c) => article.classList.add(c));
        article.dataset.learned = "false";
      }
    };

    const renderLearningStage = () => {
      const stage = stageEl();
      if (!stage) return;

      const cardsHtml = rows
        .map((row, idx) => {
          const w = escapeHtmlStep11(row.word);
          const t = escapeHtmlStep11(row.translation);
          const ipa = row.transcription
            ? escapeHtmlStep11(row.transcription)
            : "";
          const ex = row.example_sentence
            ? escapeHtmlStep11(row.example_sentence)
            : "";
          const rid = row.id ? escapeHtmlStep11(String(row.id)) : "";
          const checked = isLearnedFor(row, idx);
          const startBorder = checked
            ? "border-fuchsia-300/70 shadow-[0_0_32px_rgba(217,70,239,0.5)]"
            : "border-fuchsia-500/35 shadow-[0_0_22px_rgba(217,70,239,0.16)]";

          return `
          <article role="button" tabindex="0" aria-pressed="${checked ? "true" : "false"}" title="${checked ? "Yodlandi" : "Yodlandi deb belgilash"}"
            class="vocab-b1-card group relative flex h-full min-h-[150px] cursor-pointer flex-col gap-3 overflow-hidden rounded-[12px] border ${startBorder} bg-gradient-to-b from-fuchsia-950/35 via-black/60 to-black/85 p-5 pb-12 transition hover:border-fuchsia-400/65 hover:shadow-[0_0_38px_rgba(217,70,239,0.32)]"
            data-vocab-b1-idx="${idx}" data-vocab-row-id="${rid}" data-learned="${checked ? "true" : "false"}">
            <div class="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-fuchsia-500/15 blur-3xl transition group-hover:bg-fuchsia-400/25" aria-hidden="true"></div>
            <div class="flex items-baseline justify-between gap-3">
              <h4 class="text-xl font-black tracking-tight text-fuchsia-200 drop-shadow-[0_0_14px_rgba(217,70,239,0.65)] sm:text-2xl break-words leading-snug" style="text-wrap:balance;word-break:normal;">${w}</h4>
              <span class="shrink-0 rounded-full border border-fuchsia-500/40 bg-fuchsia-600/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-200/95">#${idx + 1}</span>
            </div>
            ${
              ipa
                ? `<p class="font-mono text-[12px] leading-snug text-slate-400/90">${ipa}</p>`
                : ""
            }
            <p class="text-[15px] font-semibold text-cyan-200/95 drop-shadow-[0_0_8px_rgba(34,211,238,0.25)] break-words leading-6" style="text-wrap:balance;">${t}</p>
            ${
              ex
                ? `<p class="mt-2 border-t border-white/10 pt-3 text-[14px] italic leading-6 text-slate-300 break-words" style="text-wrap:balance;">${ex}</p>`
                : ""
            }
            <div class="mt-auto inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${checked ? "text-emerald-300" : "text-slate-400"}">
              <span class="inline-block h-2.5 w-2.5 rounded-full ${checked ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" : "bg-slate-500"}"></span>
              ${checked ? "Yodlandi" : "Belgilanmagan"}
            </div>
            <label class="absolute bottom-3 right-3 inline-flex h-6 w-6 cursor-pointer items-center justify-center">
              <input type="checkbox" data-vocab-b1-cb ${checked ? "checked" : ""} class="peer sr-only" aria-label="So'zni yodladim" />
              <span aria-hidden="true" class="absolute inset-0 rounded-[6px] border-2 border-fuchsia-400/70 bg-black/50 transition-all peer-checked:border-emerald-400 peer-checked:bg-emerald-500/20 peer-checked:shadow-[0_0_10px_rgba(52,211,153,0.55)]"></span>
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                class="relative h-4 w-4 scale-0 opacity-0 text-emerald-200 transition-transform duration-150 peer-checked:scale-100 peer-checked:opacity-100">
                <path d="M16.704 5.296a1 1 0 0 1 0 1.408l-7.5 7.5a1 1 0 0 1-1.408 0l-3.5-3.5a1 1 0 1 1 1.408-1.408L8.5 12.092l6.796-6.796a1 1 0 0 1 1.408 0z"/>
              </svg>
            </label>
          </article>`;
        })
        .join("");

      const totalChecked = rows.filter((r, i) => isLearnedFor(r, i)).length;
      const totalGoal = 20;

      const progressPct = Math.max(
        0,
        Math.min(100, Math.round((totalChecked / Math.max(1, totalGoal)) * 100)),
      );
      stage.innerHTML = `
        <div class="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-fuchsia-500/20 bg-black/35 px-4 py-2 text-xs text-slate-300">
          <span class="font-bold uppercase tracking-wider text-fuchsia-200">Yodlangan:</span>
          <span data-vocab-b1-count class="font-mono font-black text-fuchsia-200">${totalChecked} / ${totalGoal}</span>
          <span class="ml-auto text-[10px] uppercase tracking-wider text-slate-500">Hammasi belgilangach tugma faollashadi</span>
          <div class="mt-2 w-full rounded-full bg-fuchsia-950/45 p-1">
            <div data-vocab-b1-progress class="h-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-400 shadow-[0_0_12px_rgba(217,70,239,0.55)] transition-[width] duration-300" style="width:${progressPct}%"></div>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-vocab-b1-grid>
          ${cardsHtml}
        </div>
        <button type="button" data-vocab-b1-start-quiz ${totalChecked >= totalGoal ? "" : "disabled"}
          class="dashboard-primary-btn mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-fuchsia-400/70 bg-gradient-to-r from-fuchsia-600/35 to-violet-600/35 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-fuchsia-100 shadow-[0_0_24px_rgba(217,70,239,0.45)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-35">
          Lug&apos;atlarni tekshirish
        </button>
      `;

      const toggleWordLearned = async (article, forceChecked) => {
          if (alreadyDone) return;
          const idxAttr = article?.getAttribute("data-vocab-b1-idx");
          const rid = article?.getAttribute("data-vocab-row-id") || "";
          const wasChecked = article?.dataset?.learned === "true";
          const isChecked =
            typeof forceChecked === "boolean" ? forceChecked : !wasChecked;

          applyLearnedVisual(article, isChecked);
          if (article) {
            article.setAttribute("aria-pressed", isChecked ? "true" : "false");
            article.setAttribute(
              "title",
              isChecked ? "Yodlandi" : "Yodlandi deb belgilash",
            );
            const cb = article.querySelector("[data-vocab-b1-cb]");
            if (cb) cb.checked = isChecked;
          }

          if (rid) progMap[rid] = isChecked;
          const k1 = String(rid || "");
          const k2 = String(idxAttr);
          if (isChecked) {
            checksLocal[k1 || k2] = true;
          } else {
            delete checksLocal[k1];
            delete checksLocal[k2];
          }
          writeLocalCheck(rid, idxAttr, isChecked);

          const countEl = stage.querySelector("[data-vocab-b1-count]");
          const progressEl = stage.querySelector("[data-vocab-b1-progress]");
          const startQuizEl = stage.querySelector("[data-vocab-b1-start-quiz]");
          if (countEl) {
            const n = rows.filter((r, i) => isLearnedFor(r, i)).length;
            countEl.textContent = `${n} / ${totalGoal}`;
            if (progressEl) {
              const pct = Math.max(
                0,
                Math.min(100, Math.round((n / Math.max(1, totalGoal)) * 100)),
              );
              progressEl.style.width = `${pct}%`;
            }
            if (startQuizEl) startQuizEl.disabled = n < totalGoal;
          }

          if (sessionUserId && rid) {
            const { error: upErr } = await sb
              .from("vocabulary_user_progress")
              .upsert(
                {
                  user_id: sessionUserId,
                  vocabulary_list_id: rid,
                  is_learned: isChecked,
                },
                { onConflict: "user_id,vocabulary_list_id" },
              );
            if (upErr) console.warn("[vocabulary_user_progress upsert B1]", upErr);
          }

      };

      stage.querySelectorAll("article.vocab-b1-card").forEach((article) => {
        article.addEventListener("click", () => {
          void toggleWordLearned(article);
        });
        article.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          void toggleWordLearned(article);
        });
        const cb = article.querySelector("[data-vocab-b1-cb]");
        cb?.addEventListener("click", (ev) => {
          ev.stopPropagation();
        });
        cb?.addEventListener("change", (ev) => {
          ev.stopPropagation();
          void toggleWordLearned(article, Boolean(cb.checked));
        });
      });

      stage.querySelector("[data-vocab-b1-start-quiz]")?.addEventListener("click", () => {
        const n = rows.filter((r, i) => isLearnedFor(r, i)).length;
        if (n < totalGoal) return;
        quizQueue = shuffleArr(rows).slice(0, 10);
        quizIndex = 0;
        quizAnswers = [];
        transitionTo("quiz");
      });
    };

    // ---------- 6) Quiz view ----------
    const renderQuizStage = () => {
      const stage = stageEl();
      if (!stage) return;
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      if (quizIndex >= quizQueue.length) {
        transitionTo("result");
        return;
      }

      const q = quizQueue[quizIndex];
      const totalCorrect = quizAnswers.filter((a) => a.correct).length;

      stage.innerHTML = `
        <div class="mx-auto max-w-2xl">
          <div class="rounded-2xl border-2 border-fuchsia-500/35 bg-gradient-to-b from-fuchsia-950/40 via-black/70 to-black/85 p-6 shadow-[0_0_38px_rgba(217,70,239,0.25)] sm:p-10">
            <div class="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-200">
              <span>Savol <span class="font-mono text-white">${quizIndex + 1}</span> / ${quizQueue.length}</span>
              <span>To‘g‘ri: <span class="font-mono text-emerald-300">${totalCorrect}</span></span>
            </div>

            <div class="mt-6 flex flex-col items-center gap-3 text-center">
              <p class="text-[10px] uppercase tracking-[0.22em] text-slate-400">Soniya</p>
              <div class="relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-fuchsia-500/40 bg-black/60 shadow-[0_0_28px_rgba(217,70,239,0.45)] sm:h-32 sm:w-32">
                <span data-quiz-timer class="font-mono text-5xl font-black tabular-nums text-fuchsia-100 drop-shadow-[0_0_18px_rgba(217,70,239,0.85)] sm:text-6xl">7</span>
              </div>
              <div class="mt-1 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-fuchsia-950/50">
                <div data-quiz-bar class="h-full w-full rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-400 shadow-[0_0_10px_rgba(217,70,239,0.6)]" style="width:100%"></div>
              </div>
            </div>

            <div class="mt-8 text-center">
              <p class="text-[11px] uppercase tracking-[0.22em] text-slate-400">Quyidagi so‘zning inglizcha variantini yozing</p>
              <h4 class="mt-2 text-3xl font-black text-cyan-200 drop-shadow-[0_0_16px_rgba(34,211,238,0.45)] sm:text-4xl">${escapeHtmlStep11(q.translation)}</h4>
            </div>

            <form data-quiz-form class="mt-7 flex flex-col gap-3 sm:flex-row">
              <input data-quiz-input type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
                class="flex-1 rounded-xl border-2 border-fuchsia-500/45 bg-black/55 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-fuchsia-300 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/40"
                placeholder="Inglizcha so‘zni yozing..." aria-label="Javob" />
              <button type="submit" data-quiz-submit
                class="dashboard-primary-btn inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-fuchsia-400/55 bg-gradient-to-b from-fuchsia-600/45 to-purple-700/45 px-6 py-3 text-sm font-black uppercase tracking-[0.18em] text-white shadow-[0_0_22px_rgba(217,70,239,0.4)] transition hover:from-fuchsia-500/60 hover:to-purple-600/60">
                Yuborish
              </button>
            </form>

            <p data-quiz-feedback class="mt-3 min-h-[20px] text-center text-xs font-semibold"></p>
          </div>
        </div>
      `;

      const inputEl = stage.querySelector("[data-quiz-input]");
      const formEl = stage.querySelector("[data-quiz-form]");
      const feedbackEl = stage.querySelector("[data-quiz-feedback]");
      const timerTextEl = stage.querySelector("[data-quiz-timer]");
      const timerBarEl = stage.querySelector("[data-quiz-bar]");
      const submitBtn = stage.querySelector("[data-quiz-submit]");

      window.requestAnimationFrame(() => inputEl?.focus());

      let advanced = false;
      const advance = ({ correct, userAnswer, timeoutHit }) => {
        if (advanced) return;
        advanced = true;
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
        const row = quizQueue[quizIndex];
        quizAnswers.push({
          row,
          userAnswer: String(userAnswer || ""),
          correct: Boolean(correct),
          timeoutHit: Boolean(timeoutHit),
        });
        if (feedbackEl) {
          feedbackEl.textContent = correct
            ? "✓ To‘g‘ri!"
            : timeoutHit
              ? `⏱ Vaqt tugadi. To‘g‘ri javob: ${row.word}`
              : `✗ Xato. To‘g‘ri javob: ${row.word}`;
          feedbackEl.className = `mt-3 min-h-[20px] text-center text-xs font-semibold ${correct ? "text-emerald-300" : "text-rose-300"}`;
        }
        if (inputEl) inputEl.disabled = true;
        if (submitBtn) submitBtn.disabled = true;

        window.setTimeout(
          () => {
            quizIndex++;
            if (quizIndex >= quizQueue.length) {
              const score = quizAnswers.filter((a) => a.correct).length;
              writeQuizResult({
                score,
                total: quizQueue.length,
                answers: quizAnswers.map((a) => ({
                  wordId: a.row?.id || null,
                  word: a.row?.word || "",
                  translation: a.row?.translation || "",
                  userAnswer: a.userAnswer || "",
                  correct: a.correct,
                  timeoutHit: a.timeoutHit || false,
                })),
              });
              transitionTo("result");
            } else {
              renderQuizStage();
            }
          },
          correct ? 600 : 1100,
        );
      };

      formEl?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (!inputEl || inputEl.disabled) return;
        const userAnswer = inputEl.value;
        const correct = normalizeAns(userAnswer) === normalizeAns(q.word);
        advance({ correct, userAnswer, timeoutHit: false });
      });

      // Countdown
      deadlineTs = Date.now() + QUIZ_PER_WORD_MS;
      const tick = () => {
        const left = Math.max(0, deadlineTs - Date.now());
        const secs = Math.ceil(left / 1000);
        if (timerTextEl) timerTextEl.textContent = String(secs);
        if (timerBarEl) {
          const pct = Math.max(
            0,
            Math.min(100, (left / QUIZ_PER_WORD_MS) * 100),
          );
          timerBarEl.style.width = `${pct}%`;
        }
        if (left <= 0) {
          if (timerId) {
            clearInterval(timerId);
            timerId = null;
          }
          advance({ correct: false, userAnswer: "", timeoutHit: true });
        }
      };
      timerId = window.setInterval(tick, 100);
      tick();
    };

    // ---------- 7) Result view ----------
    const renderResultStage = () => {
      const stage = stageEl();
      if (!stage) return;

      const cached = readQuizResult();
      let score =
        cached?.score ?? quizAnswers.filter((a) => a.correct).length;
      let total =
        cached?.total ?? (quizQueue.length || rows.length);
      let answers =
        cached?.answers ??
        quizAnswers.map((a) => ({
          word: a.row?.word || "",
          translation: a.row?.translation || "",
          userAnswer: a.userAnswer || "",
          correct: a.correct,
          timeoutHit: a.timeoutHit || false,
        }));

      // alreadyDone, lekin natija tarixi yo‘q — vizual to‘la holat
      if (alreadyDone && !cached && quizAnswers.length === 0) {
        score = rows.length;
        total = rows.length;
        answers = rows.map((r) => ({
          word: r.word,
          translation: r.translation,
          userAnswer: r.word,
          correct: true,
          timeoutHit: false,
        }));
      }

      const pct = total > 0 ? Math.round((score / total) * 100) : 0;
      const pass = pct >= 70;

      const buildDailyReportData = () => {
        let reading = null;
        let writing = null;
        let grammar = null;
        let lp3 = null;
        let lp5 = null;
        let lp6 = null;
        try {
          reading = JSON.parse(localStorage.getItem("readingResults") || "null");
        } catch (_) {
          reading = null;
        }
        try {
          writing = JSON.parse(localStorage.getItem("writingSubmission") || "null");
        } catch (_) {
          writing = null;
        }
        try {
          grammar = JSON.parse(localStorage.getItem("grammarLexisResults") || "null");
        } catch (_) {
          grammar = null;
        }
        try {
          lp3 = JSON.parse(localStorage.getItem("listeningPart3Results") || "null");
          lp5 = JSON.parse(localStorage.getItem("listeningPart5Results") || "null");
          lp6 = JSON.parse(localStorage.getItem("listeningPart6Results") || "null");
        } catch (_) {
          lp3 = null;
          lp5 = null;
          lp6 = null;
        }

        const readCorrect = Number(reading?.correct ?? 0);
        const readTotal = Number(reading?.total ?? 0);
        const readPct =
          Number.isFinite(Number(reading?.percent)) && Number(reading?.percent) >= 0
            ? Math.round(Number(reading?.percent))
            : readTotal > 0
              ? Math.round((readCorrect / readTotal) * 100)
              : 0;

        const lScoreParts = [lp3?.score, lp5?.score, lp6?.score]
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n));
        const lTotalParts = [lp3?.total, lp5?.total, lp6?.total]
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n));
        const listeningScore = lScoreParts.reduce((a, b) => a + b, 0);
        const listeningTotal = lTotalParts.reduce((a, b) => a + b, 0);
        const listeningPct =
          listeningTotal > 0 ? Math.round((listeningScore / listeningTotal) * 100) : 0;

        const writingRaw = Number(
          writing?.writingScore ??
            writing?.aiScore ??
            writing?.score ??
            localStorage.getItem(`edunext_writing_hol_score:${planLevel}:${dayNum}`) ??
            0,
        );
        const writingScore = Number.isFinite(writingRaw) ? Math.round(writingRaw) : 0;
        const writingNote = String(
          writing?.aiReply ?? writing?.reply ?? writing?.teacherComment ?? "",
        ).trim();
        const writingPct = writingScore > 0 ? Math.min(100, writingScore * 10) : 0;

        const grammarScore = Number(grammar?.score ?? 0);
        const grammarTotal = Number(grammar?.total ?? 0);
        const grammarPct =
          grammarTotal > 0 ? Math.round((grammarScore / grammarTotal) * 100) : 0;

        const vocabScore = Number(score);
        const vocabTotal = Number(total);
        const vocabPct = vocabTotal > 0 ? Math.round((vocabScore / vocabTotal) * 100) : 0;

        const pctList = [grammarPct, listeningPct, readPct, writingPct, vocabPct].filter(
          (n) => Number.isFinite(n) && n > 0,
        );
        const overallPct = pctList.length
          ? Math.round(pctList.reduce((a, b) => a + b, 0) / pctList.length)
          : 0;
        const userName = String(__edunextProfile?.first_name ?? "Do'stim").trim() || "Do'stim";
        const aiConclusion =
          overallPct >= 80
            ? `Barakalla, ${userName}! Bugun Writingda katta o'sish bor, Listeningni ham shu tempda davom ettiring.`
            : overallPct >= 60
              ? `Yaxshi ish, ${userName}! O'sish bor — Listening va Reading aniqligini biroz oshirsangiz natija yanada kuchli bo'ladi.`
              : `${userName}, harakat zo'r! Vocabulary va Writing mashqlarini davom ettiring, ayniqsa Listeningga ko'proq e'tibor bering.`;

        return {
          grammar: { score: grammarScore, total: grammarTotal, pct: grammarPct },
          reading: { correct: readCorrect, total: readTotal, pct: readPct },
          listening: { score: listeningScore, total: listeningTotal, pct: listeningPct },
          writing: { score: writingScore, note: writingNote, pct: writingPct },
          vocab: { score: vocabScore, total: vocabTotal, pct: vocabPct },
          overallPct,
          aiConclusion,
        };
      };

      const openDailyReportModal = () => {
        const old = document.getElementById("daily-report-modal");
        if (old) old.remove();
        const d = buildDailyReportData();
        const modal = document.createElement("div");
        modal.id = "daily-report-modal";
        modal.className =
          "fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm";
        modal.innerHTML = `
          <div class="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-fuchsia-400/45 bg-[linear-gradient(160deg,rgba(139,92,246,0.28),rgba(0,0,0,0.72))] p-4 text-white shadow-[0_0_42px_rgba(217,70,239,0.35)] sm:p-5">
            <button type="button" data-dr-close class="absolute right-3 top-3 rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">Yopish</button>
            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-300/90">Neon Bright Daily Report</p>
            <h3 class="mt-2 text-lg font-black sm:text-xl">Day ${dayNum} - Yakuniy Hisobotingiz</h3>

            <div class="mt-4 grid gap-2.5 sm:grid-cols-2">
              <div class="rounded-xl border border-violet-500/35 bg-black/35 p-3 text-sm">
                <p class="font-bold text-violet-200">🧠 Grammar</p>
                <p class="mt-1 text-slate-200">${d.grammar.score}/${d.grammar.total || "—"} (${d.grammar.pct}%)</p>
              </div>
              <div class="rounded-xl border border-cyan-500/35 bg-black/35 p-3 text-sm">
                <p class="font-bold text-cyan-200">🎧 Listening</p>
                <p class="mt-1 text-slate-200">${d.listening.score}/${d.listening.total || "—"} (${d.listening.pct}%)</p>
              </div>
              <div class="rounded-xl border border-amber-500/35 bg-black/35 p-3 text-sm">
                <p class="font-bold text-amber-200">📖 Reading</p>
                <p class="mt-1 text-slate-200">${d.reading.correct}/${d.reading.total || "—"} (${d.reading.pct}%)</p>
              </div>
              <div class="rounded-xl border border-fuchsia-500/35 bg-black/35 p-3 text-sm">
                <p class="font-bold text-fuchsia-200">✍️ Writing</p>
                <p class="mt-1 text-slate-200">Score: ${d.writing.score || "—"}/10</p>
                <p class="mt-1 text-[12px] text-slate-300">${escapeHtmlStep11(d.writing.note || "Izoh mavjud emas.")}</p>
              </div>
              <div class="rounded-xl border border-emerald-500/35 bg-black/35 p-3 text-sm">
                <p class="font-bold text-emerald-200">📚 Vocabulary</p>
                <p class="mt-1 text-slate-200">${d.vocab.score}/${d.vocab.total || "—"} (${d.vocab.pct}%)</p>
              </div>
            </div>

            <div class="mt-4 flex flex-col items-center justify-center">
              <div class="relative h-28 w-28 rounded-full" style="background: conic-gradient(rgba(217,70,239,0.95) ${Math.max(
                0,
                Math.min(100, d.overallPct),
              )}%, rgba(255,255,255,0.12) ${Math.max(
                0,
                Math.min(100, d.overallPct),
              )}%);">
                <div class="absolute inset-[9px] flex items-center justify-center rounded-full bg-black/80 text-center">
                  <span class="font-mono text-xl font-black text-fuchsia-100">${d.overallPct}%</span>
                </div>
              </div>
              <p class="mt-2 text-xs uppercase tracking-wider text-slate-300">Overall Grade</p>
            </div>

            <div class="mt-5 rounded-xl border border-white/15 bg-black/35 p-4 text-sm">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-300/90">AI Mentor Conclusion</p>
              <p class="mt-2 text-slate-100">${escapeHtmlStep11(d.aiConclusion)}</p>
            </div>

            <button type="button" data-dr-finish class="dashboard-primary-btn mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-fuchsia-400/70 bg-gradient-to-r from-fuchsia-600/35 to-violet-600/35 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-fuchsia-100 shadow-[0_0_24px_rgba(217,70,239,0.45)] transition hover:brightness-110">
              KUNLIK VAZIFANI YAKUNLASH
            </button>
          </div>`;
        document.body.appendChild(modal);
        modal.querySelector("[data-dr-close]")?.addEventListener("click", () => modal.remove());
        modal.addEventListener("click", (ev) => {
          if (ev.target === modal) modal.remove();
        });
        modal.querySelector("[data-dr-finish]")?.addEventListener("click", async () => {
          try {
            saveDailyMetricsSnapshot(__sbUser?.id, d);
            markDaySectionComplete(studyDay, "vocabulary");
            setTodayLockedForUser(__sbUser?.id);
            await persistDailyCompletionToSupabase(studyDay);
            refreshDashboardPlanProgress(planLevel);
            const mainCb = card.querySelector(".step11-todo-cb");
            if (mainCb) {
              mainCb.checked = true;
              mainCb.disabled = true;
              toggleTask(mainCb);
            }
            persistStep11Todos();
            const statusEl = card.querySelector("[data-vocab-status]");
            if (statusEl) statusEl.textContent = "Kunlik lug'at vazifasi bajarildi";
            setFooterDoneEnabled(false);
            setFooterStatus("Vocabulary — bajarildi.");
          } catch (err) {
            console.error("Xatolik:", err?.message || err);
            alert("Ma'lumot saqlanmadi!");
            return;
          }
          try {
            const parentModal = document.getElementById("daily-report-modal");
            if (parentModal) parentModal.remove();
          } catch (_) {
            /* ignore */
          }
          showDayCompletedFullscreenOverlay(studyDay);
        });
      };

      const breakdownHtml = answers
        .map(
          (a) => `
          <li class="flex items-center justify-between gap-3 rounded-lg border ${a.correct ? "border-emerald-500/15 bg-black/25" : "border-rose-500/30 bg-rose-950/20"} px-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold ${a.correct ? "text-fuchsia-200" : "text-rose-200"}">${escapeHtmlStep11(a.word)}</p>
              <p class="truncate text-[11px] text-slate-400">${escapeHtmlStep11(a.translation)}</p>
            </div>
            <div class="text-right text-[11px]">
              ${
                a.correct
                  ? `<span class="font-bold text-emerald-300">✓ To‘g‘ri</span>`
                  : a.timeoutHit
                    ? `<span class="font-bold text-amber-300">⏱ Vaqt tugadi</span>`
                    : `<span class="font-bold text-rose-300">✗ "${escapeHtmlStep11(a.userAnswer || "—")}"</span>`
              }
            </div>
          </li>`,
        )
        .join("");

      stage.innerHTML = `
        <div class="mx-auto max-w-3xl space-y-5">
          <div class="rounded-2xl border-2 ${pass ? "border-emerald-500/40" : "border-fuchsia-500/40"} bg-gradient-to-b from-fuchsia-950/40 via-black/70 to-black/85 p-6 text-center shadow-[0_0_38px_rgba(217,70,239,0.25)] sm:p-10">
            <p class="text-[11px] uppercase tracking-[0.22em] text-fuchsia-300/95">Lug‘atlarni tekshirish — natija</p>
            <p class="mt-4 font-mono text-6xl font-black tabular-nums text-fuchsia-200 drop-shadow-[0_0_22px_rgba(217,70,239,0.65)] sm:text-7xl">
              <span class="${pass ? "text-emerald-300" : "text-fuchsia-200"}">${score}</span>
              <span class="text-slate-500">/</span>
              <span class="text-slate-300">${total}</span>
            </p>
            <p class="mt-2 text-sm font-semibold ${pass ? "text-emerald-300" : "text-fuchsia-200"}">${pct}% — ${pass ? "Yaxshi natija!" : "Bir oz mashq qiling, qayta urinib ko‘ring."}</p>
            ${
              !alreadyDone
                ? `<div class="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <button type="button" data-quiz-restart
                      class="dashboard-primary-btn inline-flex min-h-[44px] items-center justify-center rounded-xl border border-fuchsia-500/55 bg-fuchsia-600/25 px-5 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-fuchsia-600/40">
                      Qayta urinish
                    </button>
                  </div>`
                : ""
            }
          </div>

          <div class="rounded-2xl border border-fuchsia-500/20 bg-black/35 p-4 sm:p-5">
            <p class="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">So‘zlar bo‘yicha tafsilot</p>
            <ul class="grid grid-cols-1 gap-2 md:grid-cols-2">${breakdownHtml}</ul>
          </div>
          <div class="flex justify-end">
            <button type="button" data-quiz-daily-report
              class="dashboard-primary-btn inline-flex min-h-[44px] items-center justify-center rounded-xl border border-cyan-500/55 bg-cyan-600/20 px-5 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-600/35">
              BUGUNGI HISOBOT
            </button>
          </div>
        </div>
      `;

      stage.querySelector("[data-quiz-restart]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (alreadyDone) return;
        try {
          localStorage.removeItem(quizResultKey);
        } catch (_) {
          /* ignore */
        }
        quizAnswers = [];
        quizIndex = 0;
        quizQueue = shuffleArr(rows);
        transitionTo("quiz");
      });
      stage.querySelector("[data-quiz-daily-report]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openDailyReportModal();
      });
    };

    const armQuizGuard = () => {
      try {
        history.pushState({ vocabQuiz: true }, "", window.location.href);
      } catch (_) {
        /* ignore */
      }
      const onPop = () => {
        if (state !== "quiz") return;
        try {
          history.pushState({ vocabQuiz: true }, "", window.location.href);
        } catch (_) {
          /* ignore */
        }
      };
      window.addEventListener("popstate", onPop);
      mount._vocabQuizPopGuard = onPop;
    };

    const disarmQuizGuard = () => {
      const h = mount._vocabQuizPopGuard;
      if (!h) return;
      window.removeEventListener("popstate", h);
      mount._vocabQuizPopGuard = null;
    };

    // ---------- 8) State transition ----------
    const transitionTo = (next) => {
      state = next;
      updateHeader();
      if (state === "learning") {
        disarmQuizGuard();
        setFooterDoneEnabled(false);
        setFooterStatus(
          "Yodlagan so‘zlarni belgilang, so‘ng «Lug‘atlarni tekshirish»ni bosing.",
        );
        renderLearningStage();
      } else if (state === "quiz") {
        armQuizGuard();
        setFooterDoneEnabled(false);
        setFooterStatus(
          "Lug‘atlarni tekshirish boshlandi — har savolga 7 soniya.",
        );
        renderQuizStage();
      } else if (state === "result") {
        disarmQuizGuard();
        setFooterDoneEnabled(false);
        setFooterStatus(
          alreadyDone
            ? "Kunlik lug'at vazifasi bajarildi"
            : "Sinov tugadi — pastdagi «KUNLIK VAZIFANI YAKUNLASH» tugmasini bosing.",
        );
        renderResultStage();
      }
    };

    // ---------- 9) Boshlang‘ich render ----------
    transitionTo(state);
  }

  /**
   * Mustahkam tortish:
   *   1) avval yangi sxema (transcription, example_sentence) bilan tortib ko‘ramiz;
   *   2) agar ustun topilmasa (42703 / "column ... does not exist") — minimal so‘rovga (id,word,translation,word_order) tushamiz;
   *   3) joriy `level` bo‘yicha hech nima qaytmasa, oxirgi chora sifatida `level` siz so‘rab ko‘ramiz.
   */
  async function fetchVocabularyRows(dayNum) {
    const FULL_COLS = "id,word,translation,transcription,example_sentence,word_order";
    const MIN_COLS = "id,word,translation,word_order";

    const isMissingColumn = (err) => {
      if (!err) return false;
      const code = String(err.code || "").trim();
      const msg = String(err.message || err.details || "").toLowerCase();
      return (
        code === "42703" ||
        msg.includes("does not exist") ||
        msg.includes("could not find the") ||
        msg.includes("column")
      );
    };

    const runQuery = async (cols, useLevelFilter) => {
      let q = sb
        .from("vocabulary_list")
        .select(cols)
        .eq("day_number", dayNum)
        .order("word_order", { ascending: true })
        .limit(20);
      if (useLevelFilter) q = q.eq("level", planLevel);
      return q;
    };

    let { data: rows, error } = await runQuery(FULL_COLS, true);
    if (error && isMissingColumn(error)) {
      console.warn(
        "[vocabulary_list] transcription/example_sentence ustunlari topilmadi — minimal sxema bilan qayta tortilmoqda.",
        error,
      );
      ({ data: rows, error } = await runQuery(MIN_COLS, true));
    }

    if (!error && Array.isArray(rows) && rows.length === 0) {
      const fb1 = await runQuery(FULL_COLS, false);
      let fbRows = fb1.data;
      let fbErr = fb1.error;
      if (fbErr && isMissingColumn(fbErr)) {
        const fb2 = await runQuery(MIN_COLS, false);
        fbRows = fb2.data;
        fbErr = fb2.error;
      }
      if (!fbErr && Array.isArray(fbRows) && fbRows.length > 0) {
        console.warn(
          `[vocabulary_list] '${planLevel}' darajada (day_number=${dayNum}) yozuv topilmadi — \`level\` filtrisiz ${fbRows.length} ta yozuv qaytdi.`,
        );
        return { rows: fbRows, error: null };
      }
    }

    return { rows, error };
  }

  async function loadVocabularyMount() {
    renderLoading();

    const {
      data: { session },
    } = await sb.auth.getSession();
    sessionUserId = session?.user?.id ?? null;

    const dayNum = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));

    const { rows, error } = await fetchVocabularyRows(dayNum);

    console.info(
      `[vocabulary_list] day_number=${dayNum} level=${planLevel} →`,
      { rows, error },
    );

    if (error) {
      console.warn("[vocabulary_list]", error);
      renderError(
        `Ma'lumot yuklanmadi: ${error.message || "noma'lum xato"}. Jadval va RLS sozlamalarini tekshiring.`,
        true,
      );
      return;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      renderError(
        `Bu kun (${dayNum}, ${planLevel}) uchun lug'at bazada topilmadi. Admin migratsiyasini tekshiring yoki boshqa kunni tanlang.`,
        true,
      );
      return;
    }

    if (planLevel === "B1") {
      await renderB1Grid(rows, dayNum);
      return;
    }

    const progMap = {};
    if (sessionUserId && rows.length) {
      const ids = rows.map((r) => r.id).filter(Boolean);
      const { data: progRows, error: progErr } = await sb
        .from("vocabulary_user_progress")
        .select("vocabulary_list_id,is_learned")
        .eq("user_id", sessionUserId)
        .in("vocabulary_list_id", ids);

      if (progErr) {
        console.warn("[vocabulary_user_progress]", progErr);
      }
      progRows?.forEach((p) => {
        if (p?.vocabulary_list_id) progMap[p.vocabulary_list_id] = Boolean(p.is_learned);
      });
    }

    const checksLocal = readVocabWordChecks(studyDay);
    const daySafe = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
    const timerKey = `edunext_vocab_mem_timer_v1:${daySafe}:${String(taskId || "vocab")}`;
    const MEMORIZE_MS = 1 * 60 * 1000;

    const rowsHtml = rows
      .map((row, idx) => {
        const w = escapeHtmlStep11(row.word);
        const t = escapeHtmlStep11(row.translation);
        const id = `vcb-${taskId}-${idx}`;
        const rid = row.id ? escapeHtmlStep11(row.id) : "";
        const isChecked =
          alreadyDone ||
          (row.id && progMap[row.id] === true) ||
          checksLocal[String(idx)] === true;
        return `<div class="flex flex-wrap items-start gap-2 rounded-lg border border-emerald-500/15 bg-black/30 px-2 py-2 shadow-[inset_0_0_12px_rgba(52,211,153,0.06)] sm:gap-3">
      <input type="checkbox" id="${id}" data-vocab-idx="${idx}" data-vocab-row-id="${rid}"
        ${isChecked ? "checked" : ""} ${alreadyDone ? "disabled" : ""}
        class="vocab-word-cb peer mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-emerald-400/30 bg-transparent accent-emerald-400" />
      <label for="${id}" class="min-w-0 flex-1 cursor-pointer text-sm leading-snug peer-checked:text-slate-500 peer-checked:line-through">
        <span class="font-semibold text-emerald-100 drop-shadow-[0_0_6px_rgba(167,243,208,0.35)]">${w}</span><span class="text-cyan-200/85"> — ${t}</span>
      </label>
    </div>`;
      })
      .join("");

    const countNote =
      rows.length < 20
        ? `<p class="text-[11px] font-medium text-amber-300/95 drop-shadow-[0_0_6px_rgba(251,191,36,0.35)]">Ushbu kun uchun bazada ${rows.length} ta yozuv (20 dan kam).</p>`
        : "";

    mount.innerHTML = `
    <div class="vocab-inner space-y-4" data-vocab-inner>
      ${countNote}
      <div class="rounded-xl border border-emerald-500/25 bg-black/35 p-3 sm:p-4">
        <p class="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300/90">Vocabulary Section</p>
        <p class="mt-2 text-xs text-slate-300/90">20 ta akademik lug'atni yodlang va pitichka bilan belgilang.</p>
        <div class="mt-3 flex items-center justify-between rounded-lg border border-cyan-500/25 bg-black/40 px-3 py-2">
          <span class="text-[10px] font-bold uppercase tracking-wider text-cyan-300/90">Yodlash taymeri</span>
          <span data-vocab-mem-timer class="font-mono text-lg font-black tabular-nums text-cyan-100">01:00</span>
        </div>
        <p data-vocab-hint class="mt-3 text-xs font-medium text-cyan-300/95 drop-shadow-[0_0_8px_rgba(34,211,238,0.3)]">Hamma pitichka qo‘yilgandan va 1 daqiqa tugagandan keyin «TUGATDIM» tugmasi ochiladi.</p>
        <div class="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">${rowsHtml}</div>
        <button type="button" data-vocab-finish-task ${alreadyDone ? "disabled" : ""}
          class="mt-4 w-full rounded-xl border border-emerald-400/50 bg-emerald-500/25 py-3 text-xs font-bold uppercase tracking-wide text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,0.35)] transition hover:border-emerald-300/60 hover:bg-emerald-500/35 disabled:pointer-events-none disabled:opacity-40">
          Tugatdim
        </button>
      </div>
    </div>`;

    const hint = mount.querySelector("[data-vocab-hint]");
    const finishTaskBtn = mount.querySelector("[data-vocab-finish-task]");
    const timerEl = mount.querySelector("[data-vocab-mem-timer]");
    let intervalId = null;

    let startedAt = null;
    try {
      const raw = localStorage.getItem(timerKey);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) startedAt = parsed;
    } catch (_) {
      /* ignore */
    }
    if (!startedAt) {
      startedAt = Date.now();
      try {
        localStorage.setItem(timerKey, String(startedAt));
      } catch (_) {
        /* ignore */
      }
    }

    const hasTimerEnded = () => Date.now() - Number(startedAt) >= MEMORIZE_MS;
    const formatMMSS = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    };

    function allWordsChecked() {
      const cbs = mount.querySelectorAll(".vocab-word-cb");
      return cbs.length > 0 && Array.from(cbs).every((cb) => cb.checked);
    }

    function syncFinishAndHint() {
      if (alreadyDone) {
        if (finishTaskBtn) finishTaskBtn.disabled = true;
        return;
      }
      const open = allWordsChecked() && hasTimerEnded();
      if (hint) hint.classList.toggle("hidden", open);
      if (finishTaskBtn) finishTaskBtn.disabled = !open;
    }

    const tickTimer = () => {
      const left = MEMORIZE_MS - (Date.now() - Number(startedAt));
      if (timerEl) timerEl.textContent = formatMMSS(left);
      if (left <= 0 && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      syncFinishAndHint();
    };

    if (!alreadyDone) {
      intervalId = window.setInterval(tickTimer, 500);
    }
    tickTimer();

    mount.querySelectorAll(".vocab-word-cb").forEach((cb) => {
      cb.addEventListener("change", async () => {
        if (alreadyDone) return;
        const idx = cb.getAttribute("data-vocab-idx");
        const vid = cb.getAttribute("data-vocab-row-id");
        writeVocabWordCheck(studyDay, idx, cb.checked);

        if (sessionUserId && vid) {
          const { error: upErr } = await sb.from("vocabulary_user_progress").upsert(
            {
              user_id: sessionUserId,
              vocabulary_list_id: vid,
              is_learned: cb.checked,
            },
            { onConflict: "user_id,vocabulary_list_id" },
          );
          if (upErr) console.warn("[vocabulary_user_progress upsert]", upErr);
        }
        syncFinishAndHint();
      });
    });

    finishTaskBtn?.addEventListener("click", () => {
      if (alreadyDone) return;
      if (!allWordsChecked() || !hasTimerEnded()) return;
      markDaySectionComplete(studyDay, "vocabulary");
      refreshDashboardPlanProgress("A2");
      const mainCb = card.querySelector(".step11-todo-cb");
      if (mainCb) {
        mainCb.checked = true;
        mainCb.disabled = true;
        toggleTask(mainCb);
      }
      persistStep11Todos();
      const statusEl = card.querySelector("[data-vocab-status]");
      if (statusEl) statusEl.textContent = "Kunlik lug'at vazifasi bajarildi";
      mount.querySelectorAll(".vocab-word-cb").forEach((x) => {
        x.disabled = true;
      });
      finishTaskBtn.disabled = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    });

    if (alreadyDone) {
      const statusEl = card.querySelector("[data-vocab-status]");
      if (statusEl) statusEl.textContent = "Kunlik lug'at vazifasi bajarildi";
      mount.querySelectorAll(".vocab-word-cb").forEach((x) => {
        x.disabled = true;
      });
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (finishTaskBtn) finishTaskBtn.disabled = true;
    }
  }

  await loadVocabularyMount();
}

function refreshDashboardPlanProgress(level) {
  const wrap = document.getElementById("dashboard-30day-progress");
  if (!wrap) return;
  if (level !== "A2") {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  const { completedDays, total, percent } = get30DayProgress();
  const label = document.getElementById("dashboard-plan-progress-label");
  const bar = document.getElementById("dashboard-plan-progress-bar");
  if (label) label.textContent = `${completedDays}/${total} kun bajarildi`;
  if (bar) bar.style.width = `${Math.min(100, percent)}%`;
}

/** Progress bar ustidagi sarlavha: `reading_tasks.title` (kun + daraja), yo‘q bo‘lsa timed reading zaxira nomi. */
async function hydrateDashboardReadingProgressTitle(level, studyDay) {
  const titleEl = document.getElementById("dashboard-reading-progress-title");
  if (!titleEl) return;
  const d = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
  const tier = level === "B1" ? "B1" : "A2";
  let bookTitle = "";

  const sb = ensureSupabase();
  if (sb) {
    try {
      const { data, error } = await fetchReadingTasksRowFromSupabase(sb, d, tier);
      if (error) console.warn("[reading_tasks title]", error);
      if (data && typeof data === "object" && data.title != null) {
        bookTitle = String(data.title).trim();
      }
    } catch (err) {
      console.warn("[reading_tasks title]", err);
    }
  }
  if (!bookTitle) bookTitle = "Reading";
  const line = `READING — ${bookTitle}`.toUpperCase();
  titleEl.textContent = line;
  titleEl.setAttribute("title", line);
}

/** Bugungi kun Reading bo'limi: alohida progress (vazifa bajarilguncha 0%, keyin 100%). */
function refreshDashboardReadingProgress(level, studyDay) {
  const wrap = document.getElementById("dashboard-reading-progress");
  if (!wrap) return;
  if (level !== "A2" && level !== "B1") {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  const d = studyDay != null ? studyDay : getCurrentStudyDayIndex();
  const done = getDaySectionCompletion(d).reading;
  const pct = done ? 100 : 0;
  const label = document.getElementById("dashboard-reading-progress-label");
  const bar = document.getElementById("dashboard-reading-progress-bar");
  if (label) label.textContent = done ? "100% — bugungi bob" : "0%";
  if (bar) bar.style.width = `${pct}%`;
  void hydrateDashboardReadingProgressTitle(level, d);
}

function generatePersonalPlan(level) {
  const todoContainer = document.getElementById("todo-list");
  if (!todoContainer) return;

  // Skeletonlarni olib tashlaymiz va keyin yangi kartalar fade-in
  // animatsiyasi bilan paydo bo'ladi (`dashboard-fade-in-card`).
  clearDashboardSkeletonFlag();
  todoContainer.replaceChildren();

  const writingRouteOnly = dashboardWritingPathMatches();
  const readingRouteOnly = dashboardReadingPathMatches();
  const vocabularyRouteOnly = dashboardVocabularyPathMatches();
  if (writingRouteOnly || readingRouteOnly || vocabularyRouteOnly) {
    try {
      localStorage.setItem("edunext_current_study_day", "1");
      localStorage.setItem("currentDay", "1");
    } catch (_) {
      /* ignore */
    }
  }
  const studyDay =
    level === "A2" || level === "B1"
      ? writingRouteOnly || readingRouteOnly
        || vocabularyRouteOnly
        ? 1
        : getCurrentStudyDayIndex()
      : 1;

  if (isTodayLockedForUser(__sbUser?.id)) {
    const lockWrap = document.createElement("div");
    lockWrap.className =
      "rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-6 text-center shadow-[0_0_24px_rgba(16,185,129,0.2)]";
    lockWrap.innerHTML = `
      <p class="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-300">✅ Completed</p>
      <h3 class="mt-2 text-xl font-black text-emerald-100">Day ${studyDay} yakunlandi</h3>
      <p class="mt-2 text-sm text-slate-200">Bugungi darslar yopilgan. Ertaga yangi mavzular soat 08:00 da ochiladi.</p>
    `;
    todoContainer.appendChild(lockWrap);
    refreshDashboardPlanProgress(level);
    render30DayOutline(level);
    return;
  }

  let plan =
    level === "A2" || level === "B1"
      ? dashboardGrammarReadingTasksForTier(level, studyDay)
      : educationData[level] || educationData.B1;

  if (!Array.isArray(plan) || plan.length === 0) {
    plan = educationData.B1 || [];
  }

  const sectionDone =
    level === "A2" || level === "B1"
      ? getDaySectionCompletion(studyDay)
      : {};
  const strictGrammarFlowEnabled = false;
  const listeningUnlockKey = grammarListeningUnlockStorageKey(level, studyDay);
  const writingScoreUnlockKey = `edunext_writing_hol_score:${level}:${studyDay}`;
  const savedWritingHolisticScore = Number(localStorage.getItem(writingScoreUnlockKey) || "0");
  const strictFlowState = {
    prepLocked: false,
    listeningUnlocked: true,
    readingUnlocked: true,
    writingUnlocked: true,
    vocabularyUnlocked: true,
  };
  const strictSequentialFlowEnabled = level === "A2" || level === "B1";
  // Strict ketma-ketlikda Vocabulary eng oxiri — oldingi 4 bo‘lim tugamaguncha
  // foydalanuvchini Vocabulary oynasiga olib chiqmaymiz, hatto session/URL flag
  // bo‘lsa ham (yangi foydalanuvchida eski flag ishlamasligi uchun).
  const vocabularyOpenRequested =
    shouldAutoOpenVocabularyFromUrl() || shouldAutoOpenVocabularyFromSession();
  const reachedVocabularyStage =
    !strictSequentialFlowEnabled ||
    (Boolean(sectionDone.grammar) &&
      (Boolean(sectionDone.listening) || Boolean(sectionDone.listening_bb_dict)) &&
      Boolean(sectionDone.writing) &&
      Boolean(sectionDone.reading));
  const vocabularyOnlyWindow = vocabularyOpenRequested && reachedVocabularyStage;
  if (vocabularyOpenRequested && !reachedVocabularyStage) {
    // Yangi foydalanuvchi yoki ketma-ketlikni buzgan kelish: stale session
    // flagini tozalaymiz — Grammar dan boshlasin.
    try {
      sessionStorage.removeItem("edunext_open_vocabulary_once");
      sessionStorage.removeItem("edunext_open_vocabulary_handled");
      const u = new URL(window.location.href);
      if (u.searchParams.has("openVocabulary")) {
        u.searchParams.delete("openVocabulary");
        window.history.replaceState({}, "", u.toString());
      }
    } catch (_) {
      /* ignore */
    }
  }
  const readingOnlyWindow =
    readingRouteOnly ||
    (!vocabularyOnlyWindow && !writingRouteOnly && shouldAutoOpenReadingFromUrl());

  /**
   * Strict 5-bosqichli ketma-ketlik:
   *   grammar → listening → writing → reading → vocabulary → done
   * Bo‘limlar yuqoridagi tartibda kuzatib boriladi: oldingisi tugamaguncha
   * keyingi bo‘lim ko‘rinmaydi.
   */
  function getSequentialStage(completion) {
    const grammarUnlock =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(listeningUnlockKey) === "1";
    if (!completion.grammar && !grammarUnlock) return "grammar";
    if (!completion.listening_bb_dict && !completion.listening) return "listening";
    if (!completion.writing) return "writing";
    if (!completion.reading) return "reading";
    if (!completion.vocabulary) return "vocabulary";
    return "done";
  }

  function isSectionVisibleInStrictFlow(sectionKey, activeStage) {
    let forceOpenReading = false;
    try {
      forceOpenReading =
        sessionStorage.getItem("edunext_force_open_reading") === "1";
    } catch (_) {
      forceOpenReading = false;
    }
    if (
      forceOpenReading &&
      (sectionKey === "reading" || sectionKey === "timed_reading" || sectionKey === "reading_exam")
    ) {
      return true;
    }
    if (!strictSequentialFlowEnabled) return true;
    if (activeStage === "done") {
      // Hammasi tugagan: barcha 5 bo‘limni ko‘rsatish (yakuniy holat).
      return (
        sectionKey === "grammar" ||
        sectionKey === "listening" ||
        sectionKey === "listening_bb_dict" ||
        sectionKey === "writing" ||
        sectionKey === "reading" ||
        sectionKey === "vocabulary"
      );
    }
    if (activeStage === "listening") {
      return sectionKey === "listening" || sectionKey === "listening_bb_dict";
    }
    // grammar | writing | reading | vocabulary — faqat shu bo‘lim ko‘rinadi.
    return sectionKey === activeStage;
  }

  function focusNextSection(sectionKey) {
    const next =
      sectionKey === "grammar"
        ? "listening"
        : sectionKey === "listening" || sectionKey === "listening_bb_dict"
          ? "writing"
          : sectionKey === "writing"
            ? "reading"
            : sectionKey === "reading"
              ? "vocabulary"
              : null;
    if (!next) return;
    generatePersonalPlan(level);
    window.requestAnimationFrame(() => {
      const target =
        document.querySelector(`#todo-list [data-task-card-for="${next}"]`) ||
        (next === "listening"
          ? document.querySelector('#todo-list [data-task-card-for="listening_bb_dict"]')
          : null);
      if (target) {
        target.classList.remove("hidden");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("ring-2", "ring-fuchsia-500/45");
        window.setTimeout(() => target.classList.remove("ring-2", "ring-fuchsia-500/45"), 1400);
      }
    });
  }

  function applyStrictGrammarLocks() {
    todoContainer.querySelectorAll(".task-plan-card").forEach((cardEl) => {
      const sk = String(cardEl.getAttribute("data-task-card-for") || "").trim();
      const shouldLock = false;
      const controls = cardEl.querySelectorAll("button, input, textarea, select, a");
      controls.forEach((el) => {
        if (el.tagName === "A") {
          const anchor = /** @type {HTMLAnchorElement} */ (el);
          const prev = anchor.dataset.strictPrevTabindex;
          if (prev) anchor.setAttribute("tabindex", prev);
          else anchor.removeAttribute("tabindex");
          anchor.removeAttribute("aria-disabled");
          anchor.classList.remove("pointer-events-none", "opacity-50");
        } else {
          const ctl = /** @type {HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */ (el);
          ctl.disabled = false;
          ctl.removeAttribute("data-strict-disabled");
        }
      });
      cardEl.classList.remove("opacity-70");
      cardEl.removeAttribute("data-strict-locked");
      cardEl.dataset.lockStatus = "unlocked";
      cardEl.dataset.isLocked = "false";
      if (sk === "grammar") cardEl.dataset.sectionStatus = "unlocked";
      if (sk === "listening_bb_dict") cardEl.dataset.sectionStatus = "unlocked";
      if (sk === "reading") cardEl.dataset.sectionStatus = "unlocked";
      if (sk === "writing") cardEl.dataset.sectionStatus = "unlocked";
      if (sk === "vocabulary") cardEl.dataset.sectionStatus = "unlocked";
    });
  }

  let hintEl = document.getElementById("dashboard-study-day-hint");
  if (!hintEl) {
    hintEl = document.createElement("p");
    hintEl.id = "dashboard-study-day-hint";
    hintEl.className =
      "mb-4 text-center text-xs font-medium text-fuchsia-300/90 sm:text-left";
    todoContainer.before(hintEl);
  }
  if (writingRouteOnly) {
    hintEl.textContent = "Writing only mode · Day 1 · Test 1 - School Canteen";
    hintEl.classList.remove("hidden");
  } else if (readingRouteOnly) {
    hintEl.textContent = "Reading only mode · Day 1 · Text & MCQ";
    hintEl.classList.remove("hidden");
  } else if (vocabularyRouteOnly) {
    hintEl.textContent = "Vocabulary only mode · Day 1";
    hintEl.classList.remove("hidden");
  } else if (level === "A2") {
    hintEl.textContent = `30 kunlik roadmap · kun ${studyDay}/30 (Listening + Writing ostida BBC diktat)`;
    hintEl.classList.remove("hidden");
  } else if (level === "B1") {
    hintEl.textContent = "";
    hintEl.classList.add("hidden");
  } else {
    hintEl.classList.add("hidden");
  }

  refreshDashboardPlanProgress(level);
  refreshDashboardReadingProgress(level, studyDay);
  render30DayOutline(level);
  if (level === "A2") bootstrapDashboardSupervisorMode();

  const activeStage = getSequentialStage(sectionDone);
  plan.forEach((item, idx) => {
    const taskId = `${level}-${idx}`;
    const cbId = `s11t-${taskId}`;
    const sk = taskTypeToSectionKey(item.type) || `task-${idx}`;

    const card = document.createElement("div");
    card.className =
      "group task-plan-card dashboard-fade-in-card flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 transition hover:border-fuchsia-500/35 shadow-[0_10px_30px_rgba(0,0,0,0.5)] sm:p-5";
    // Har bir karta navbatma-navbat (stagger) paydo bo'lsin — framer-motion'ning
    // `staggerChildren` effektiga o'xshash, lekin vanilla CSS animation-delay orqali.
    card.style.animationDelay = `${Math.min(idx, 6) * 70}ms`;
    card.dataset.taskType = item.type || "";
    card.dataset.taskSummary = item.task || "";
    card.dataset.taskCardFor = sk;
    if (item.href) card.dataset.planHref = item.href;
    const strictVisible = isSectionVisibleInStrictFlow(sk, activeStage);
    card.classList.toggle("hidden", !strictVisible);
    // Writing oynasida Reading kartani ko'rsatmaymiz; Reading faqat alohida oynada ochiladi.
    if (!readingOnlyWindow && sk === "reading") {
      card.classList.add("hidden");
    }
    // Reading-only oynada esa faqat Reading qismi ochiq bo'lsin.
    if (readingOnlyWindow && sk !== "reading") {
      card.classList.add("hidden");
    }
    if (writingRouteOnly && sk === "writing") {
      card.classList.remove("hidden");
    }
    if (writingRouteOnly && sk !== "writing") {
      card.classList.add("hidden");
    }
    if (vocabularyRouteOnly && sk === "vocabulary") {
      card.classList.remove("hidden");
    }
    if (vocabularyRouteOnly && sk !== "vocabulary") {
      card.classList.add("hidden");
    }
    if (vocabularyOnlyWindow && sk === "vocabulary") {
      card.classList.remove("hidden");
    }
    if (vocabularyOnlyWindow && sk !== "vocabulary") {
      card.classList.add("hidden");
    }
    if (strictSequentialFlowEnabled && activeStage === "grammar" && sk === "grammar") {
      card.classList.add("min-h-[calc(100vh-10rem)]");
    }

    const typeLowerEarly = String(item.type || "").toLowerCase();
    if (
      (level === "A2" || level === "B1") &&
      ((typeLowerEarly === "writing" && item.dashboardWriting) ||
        item.dashboardListeningDictation ||
        (typeLowerEarly === "reading" && item.dashboardTimedReading) ||
        (typeLowerEarly === "grammar" && item.dashboardPhasedGrammar))
    ) {
      card.classList.remove("gap-3", "p-4", "sm:p-5");
      card.classList.add("gap-7", "sm:gap-10", "p-6", "sm:p-9");
    }

    const head = document.createElement("div");
    head.className = "flex flex-wrap items-start justify-between gap-2";
    const titleBlock = document.createElement("div");
    titleBlock.className = "min-w-0 flex-1";
    const typeLowerForTag = String(item.type || "").toLowerCase();
    const typeTag = document.createElement("p");
    const isGrammarSectionTag =
      typeLowerForTag === "grammar" &&
      (level === "A2" || level === "B1") &&
      item.dashboardPhasedGrammar;
    typeTag.className = isGrammarSectionTag
      ? "text-[0.8rem] font-semibold uppercase tracking-[0.1em] text-slate-300/90"
      : typeLowerForTag === "vocabulary"
        ? "text-[10px] font-bold uppercase tracking-widest text-emerald-400/90"
        : typeLowerForTag === "listening"
          ? "text-[10px] font-bold uppercase tracking-widest text-amber-400/90"
          : typeLowerForTag === "listeningdictation"
            ? "text-[10px] font-bold uppercase tracking-widest text-amber-400/90"
            : typeLowerForTag === "writing"
              ? "text-[10px] font-bold uppercase tracking-widest text-sky-400/90"
              : "text-[10px] font-bold uppercase tracking-widest text-fuchsia-400/90";
    typeTag.textContent = isGrammarSectionTag ? "GRAMMAR SECTION" : item.type || "Vazifa";
    const isTimedReadingSection =
      (level === "A2" || level === "B1") &&
      typeLowerForTag === "reading" &&
      item.dashboardTimedReading;
    const taskLine = document.createElement("p");
    taskLine.setAttribute("data-task-line", "");
    taskLine.className = isTimedReadingSection
      ? "mt-1 text-base font-semibold leading-snug text-slate-300 sm:text-lg"
      : "mt-1 text-base font-semibold leading-snug text-white sm:text-lg";
    taskLine.textContent = isTimedReadingSection ? "Reading Section" : item.task || "";
    if (!String(item.task || "").trim()) taskLine.classList.add("hidden");
    titleBlock.append(typeTag, taskLine);
    const typeSpan = document.createElement("span");
    typeSpan.className =
      "step11-todo-type shrink-0 rounded bg-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-400";
    typeSpan.textContent =
      item.dashboardListeningDictation ? "LISTENING" : item.type || "";
    head.append(titleBlock, typeSpan);
    if (level === "B1") {
      const stepBadge = document.createElement("span");
      stepBadge.className =
        "dashboard-step-badge shrink-0 rounded-md border border-fuchsia-400/45 bg-fuchsia-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-fuchsia-200";
      stepBadge.textContent = `Step ${idx + 1}/5`;
      head.appendChild(stepBadge);
    }

    card.appendChild(head);

    const actions = document.createElement("div");
    actions.className = "flex flex-wrap items-center gap-2";

    const typeLower = String(item.type || "").toLowerCase();
    const readingTimedMarkedDone =
      typeLower === "reading" && item.dashboardTimedReading && Boolean(sectionDone.reading);

    const pdfHref = item.pdfUrl || resolvePdfLinkForTaskType(item.type);
    if (pdfHref && !item.dashboardPhasedGrammar && !readingTimedMarkedDone) {
      const pdfBtn = document.createElement("button");
      pdfBtn.type = "button";
      pdfBtn.className =
        "dashboard-primary-btn inline-flex min-h-[40px] items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-500/20 sm:text-xs";
      pdfBtn.textContent = "KITOBNI OCHISH (PDF)";
      pdfBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        openKitobPdfSmart(pdfHref, { downloadName: pdfDownloadBasename(pdfHref) });
      });
      actions.appendChild(pdfBtn);
    }

    if (
      item.href &&
      !(typeLower === "listening" && item.youtubeId) &&
      (typeLower === "listening" ||
        typeLower === "reading" ||
        (typeLower === "grammar" && !item.dashboardPhasedGrammar)) &&
      !(readingTimedMarkedDone && typeLower === "reading")
    ) {
      const ext = document.createElement("a");
      ext.href = item.href;
      ext.target = "_blank";
      ext.rel = "noopener noreferrer";
      ext.className =
        "inline-flex min-h-[40px] items-center justify-center rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-indigo-100 transition hover:bg-indigo-500/20 sm:text-xs";
      ext.textContent =
        typeLower === "listening"
          ? "Listening (tashqi sayt)"
          : typeLower === "reading"
            ? "Reading manbasi"
            : "Grammar manbasi";
      actions.appendChild(ext);
    }

    if (
      !(typeLower === "writing" && item.dashboardWriting) &&
      !(typeLower === "reading" && item.dashboardTimedReading) &&
      !(typeLower === "grammar" && item.dashboardPhasedGrammar) &&
      typeLower !== "vocabulary"
    ) {
      const mentorBtn = document.createElement("button");
      mentorBtn.type = "button";
      mentorBtn.className =
        "dashboard-primary-btn inline-flex min-h-[40px] items-center justify-center rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/25 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-fuchsia-600/40 sm:text-xs";
      mentorBtn.textContent = "AI Mentor bilan suhbat";
      mentorBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        focusDashboardMentorForSubject(sk);
        if (sk !== "writing") void maybeSendDayOneMentorKickoff();
      });
      actions.appendChild(mentorBtn);
    }

    if (actions.childElementCount > 0) card.appendChild(actions);

    if ((level === "A2" || level === "B1") && typeLower === "vocabulary") {
      const vm = document.createElement("div");
      vm.className =
        level === "B1"
          ? "rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.04] p-4 sm:p-6"
          : "rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 sm:p-4";
      vm.setAttribute("data-vocab-mount", taskId);
      card.appendChild(vm);
    }

    if (level === "A2" && typeLower === "listening" && item.youtubeId) {
      const lm = document.createElement("div");
      lm.className =
        "rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 sm:p-4";
      lm.setAttribute("data-listen-mount", taskId);
      card.appendChild(lm);
    }

    if (
      (level === "A2" || level === "B1") &&
      typeLower === "reading" &&
      item.dashboardTimedReading
    ) {
      const rem = document.createElement("div");
      rem.className =
        "mt-2 rounded-xl border border-emerald-500/35 bg-black/35 p-3 sm:p-5";
      rem.setAttribute("data-reading-exam-mount", taskId);
      card.appendChild(rem);
      void setupDashboardReadingExamCard(card, studyDay, taskId, level);
    }

    if (
      (level === "A2" || level === "B1") &&
      typeLower === "grammar" &&
      item.dashboardPhasedGrammar
    ) {
      const gm = document.createElement("div");
      gm.className =
        "mt-2 rounded-xl border border-fuchsia-500/35 bg-black/35 p-3 sm:p-5";
      gm.setAttribute("data-grammar-phased-mount", taskId);
      card.appendChild(gm);
      void setupDashboardGrammarPhasedCard(
        card,
        studyDay,
        taskId,
        Boolean(sectionDone.grammar),
        level,
        {
          pdfHref: String(item.pdfUrl || resolvePdfLinkForTaskType(item.type) || "").trim(),
          grammarLabel: String(item.task || "").trim() || "Grammar",
          grammarDescription: String(item.description || item.context || "").trim(),
        },
      );
    }

    if (
      (level === "A2" || level === "B1") &&
      typeLower === "writing" &&
      item.dashboardWriting
    ) {
      const wm = document.createElement("div");
      wm.className =
        "rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-5 sm:p-8";
      wm.setAttribute("data-writing-mount", taskId);
      card.appendChild(wm);
    }

    if (item.dashboardListeningDictation && (level === "A2" || level === "B1")) {
      const dm = document.createElement("div");
      dm.className =
        "mt-2 rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-6 min-h-[50vh]";
      dm.setAttribute("data-listening-dictation-mount", taskId);
      card.appendChild(dm);
    }

    const footer = document.createElement("div");
    footer.className =
      sk === "writing" && item.dashboardWriting
        ? "flex flex-wrap items-center gap-3 border-t border-white/5 pt-6 mt-2"
        : "flex flex-wrap items-center gap-3 border-t border-white/5 pt-3";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = cbId;
    input.setAttribute("data-task-id", taskId);
    input.className =
      "step11-todo-cb peer h-5 w-5 shrink-0 cursor-pointer rounded border-white/20 bg-transparent accent-fuchsia-500";

    const label = document.createElement("label");
    label.htmlFor = cbId;
    label.className =
      "cursor-pointer text-xs text-slate-400 peer-checked:line-through peer-checked:opacity-60";
    label.textContent = "Vazifani bajarib bo‘ldim";

    if (
      item.dashboardListeningDictation &&
      (level === "A2" || level === "B1")
    ) {
      footer.className =
        "flex flex-col gap-3 border-t border-white/5 pt-6 mt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between";
      const alreadyDict = Boolean(sectionDone.listening_bb_dict);
      if (alreadyDict) input.checked = true;
      input.classList.add(
        "fixed",
        "-left-[9999px]",
        "h-px",
        "w-px",
        "opacity-0",
      );
      label.classList.add(
        "fixed",
        "-left-[9999px]",
        "h-px",
        "w-px",
        "opacity-0",
      );
      const statusLine = document.createElement("p");
      statusLine.setAttribute("data-lnd-foot-hint", "");
      statusLine.className =
        "flex-1 text-xs font-semibold leading-snug text-fuchsia-200/90 order-2 sm:order-none";
      statusLine.textContent = alreadyDict
        ? "Diktat yakunlandi."
        : "Bo‘limga kirgan zahoti audio + 20:00 taymer avtomatik ishga tushadi. Tugagach AI tahlili va «VAZIFANI TUGATDIM».";
      const finishBtn = document.createElement("button");
      finishBtn.type = "button";
      finishBtn.setAttribute("data-lnd-finish-btn", "");
      finishBtn.disabled = true;
      finishBtn.className =
        "dashboard-primary-btn order-1 w-full shrink-0 rounded-xl border border-fuchsia-500/45 bg-fuchsia-600/25 px-5 py-3 text-[11px] font-black uppercase tracking-[0.1em] text-white shadow-[0_0_18px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-600/38 disabled:pointer-events-none disabled:opacity-35 sm:order-none sm:w-auto sm:py-2.5";
      finishBtn.textContent = alreadyDict
        ? "VAZIFANI TUGATDIM — bajarildi"
        : "VAZIFANI TUGATDIM";
      footer.append(input, label, statusLine, finishBtn);
      if (strictSequentialFlowEnabled && alreadyDict) {
        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className =
          "dashboard-primary-btn order-3 w-full shrink-0 rounded-xl border border-sky-500/45 bg-sky-600/20 px-5 py-3 text-[11px] font-black uppercase tracking-[0.1em] text-sky-100 transition hover:bg-sky-600/32 sm:order-none sm:w-auto sm:py-2.5";
        nextBtn.textContent = "Writing sectionga o'tish";
        nextBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          focusNextSection("listening");
        });
        footer.appendChild(nextBtn);
      }
    } else if (
      (level === "A2" || level === "B1") &&
      taskTypeToSectionKey(item.type)
    ) {
      const sectionKey = taskTypeToSectionKey(item.type);
      const already = Boolean(sectionDone[sectionKey]);
      if (already) input.checked = true;

      if (level === "A2" && sectionKey === "vocabulary") {
        input.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        label.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        const statusLine = document.createElement("p");
        statusLine.setAttribute("data-vocab-status", "");
        statusLine.className =
          "flex-1 text-xs font-semibold leading-snug text-emerald-300/95";
        statusLine.textContent = already
          ? "Kunlik lug'at vazifasi bajarildi"
          : "So'zlarni belgilang → «Vazifani tugatdim» → gaplar va tekshiruv";
        footer.append(input, label, statusLine);
      } else if (level === "B1" && sectionKey === "vocabulary") {
        input.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        label.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        footer.append(input, label);
      } else if (level === "A2" && sectionKey === "listening") {
        input.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        label.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        const statusLine = document.createElement("p");
        statusLine.setAttribute("data-listen-status", "");
        statusLine.className =
          "flex-1 text-xs font-semibold leading-snug text-amber-300/95";
        statusLine.textContent = already
          ? "Listening vazifasi bajarildi"
          : studyDay <= LISTEN_PHASE1_MAX_DAY
            ? "06:00 taymer (avto + refresh) → «Vazifani tugatdim» → 5 gap → «Yuborish»"
            : "10:00 taymer (avto + refresh) → yozish va AI tekshiruvi";
        footer.append(input, label, statusLine);
      } else if (sectionKey === "writing") {
        input.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        label.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        const statusLine = document.createElement("p");
        statusLine.setAttribute("data-writing-status", "");
        statusLine.className =
          "flex-1 text-xs font-semibold leading-snug text-sky-300/95";
        statusLine.textContent = already
          ? "Writing — kunlik vazifa bajarildi"
          : "3 ta oyna (pastma-past) · «TEKSHIRISH» · «KUNLIK VAZIFANI YAKUNLASH»";
        footer.append(input, label, statusLine);
      } else if (
        sectionKey === "grammar" &&
        (level === "A2" || level === "B1") &&
        item.dashboardPhasedGrammar
      ) {
        input.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        label.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        const grammarMount = card.querySelector(`[data-grammar-phased-mount="${taskId}"]`);
        const syncGrammarGate = () => {
          const passed = already || Boolean(grammarMount?.getAttribute("data-grammar-pass") === "1");
          if (!passed) return;
          if (!input.checked) {
            markDaySectionComplete(studyDay, sectionKey);
            input.checked = true;
            toggleTask(input);
            persistStep11Todos();
            refreshDashboardPlanProgress(level);
            if (strictSequentialFlowEnabled) focusNextSection("grammar");
          }
          strictFlowState.listeningUnlocked = true;
          try {
            localStorage.setItem(listeningUnlockKey, "1");
          } catch (_) {
            /* ignore */
          }
          applyStrictGrammarLocks();
        };
        card.addEventListener("grammar:strict-lock", (ev) => {
          const lockState = Boolean(ev?.detail?.locked);
          strictFlowState.prepLocked = lockState;
          applyStrictGrammarLocks();
        });
        card.addEventListener("grammar:passed", syncGrammarGate);
        syncGrammarGate();
        footer.className = "hidden";
        footer.append(input, label);
      } else if (sectionKey === "reading" && item.dashboardTimedReading) {
        input.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        label.classList.add(
          "fixed",
          "-left-[9999px]",
          "h-px",
          "w-px",
          "opacity-0",
        );
        const statusLine = document.createElement("p");
        statusLine.setAttribute("data-reading-foot-hint", "");
        statusLine.className =
          "flex-1 text-xs font-semibold leading-snug text-emerald-300/95 order-2";
        statusLine.textContent = already
          ? "Reading — vazifa belgilangan; matn va savollar baribir ochiq («reading_results» mavjud bo‘lsa javoblar qatorga tushadi). Qayta topshirish mumkin."
          : "Matn + Part 1 bir ekranda (savollar taymerni kutmaydi) → Part 2–3 → FINISH → ✅/❌ → «AI TAHLIL». Keyin «Vazifani tugatdim».";
        const doneBtn = document.createElement("button");
        doneBtn.type = "button";
        doneBtn.className =
          "dashboard-primary-btn step11-done-task-btn order-1 shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-default disabled:opacity-60";
        doneBtn.textContent = already ? "Bajarildi" : "Vazifani tugatdim";
        doneBtn.disabled = already;
        doneBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (doneBtn.disabled) return;
          markDaySectionComplete(studyDay, sectionKey);
          input.checked = true;
          toggleTask(input);
          persistStep11Todos();
          doneBtn.disabled = true;
          doneBtn.textContent = "Bajarildi";
          refreshDashboardPlanProgress(level);
          if (sectionKey === "reading") {
            refreshDashboardReadingProgress(level, studyDay);
          }
          // Strict ketma-ketlikda: Reading tugagach Vocabulary kartasiga o‘tamiz.
          if (strictSequentialFlowEnabled && sectionKey === "reading") {
            focusNextSection("reading");
          } else {
            generatePersonalPlan(level);
          }
        });
        if (already) {
          footer.className = "hidden";
        } else {
          footer.className =
            "flex flex-col gap-3 border-t border-white/5 pt-6 mt-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between";
          footer.append(input, label, statusLine, doneBtn);
        }
      } else {
        const doneBtn = document.createElement("button");
        doneBtn.type = "button";
        doneBtn.className =
          "dashboard-primary-btn step11-done-task-btn rounded-lg border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-1.5 text-[10px] font-bold uppercase text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:cursor-default disabled:opacity-60";
        doneBtn.textContent = already ? "Bajarildi" : "Vazifani tugatdim";
        doneBtn.disabled = already;
        doneBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (doneBtn.disabled) return;
          markDaySectionComplete(studyDay, sectionKey);
          input.checked = true;
          toggleTask(input);
          persistStep11Todos();
          doneBtn.disabled = true;
          doneBtn.textContent = "Bajarildi";
          refreshDashboardPlanProgress(level);
          if (sectionKey === "reading")
            refreshDashboardReadingProgress(level, studyDay);
        });
        footer.append(input, label, doneBtn);
      }
    } else {
      footer.append(input, label);
    }

    card.appendChild(footer);
    todoContainer.appendChild(card);

    if ((level === "A2" || level === "B1") && typeLower === "vocabulary") {
      void setupVocabularyTaskCard(
        card,
        studyDay,
        taskId,
        Boolean(sectionDone.vocabulary),
        level,
      );
    }

    if (level === "A2" && typeLower === "listening" && item.youtubeId) {
      void setupListeningTaskCard(
        card,
        studyDay,
        taskId,
        item.youtubeId,
        Boolean(sectionDone.listening),
      );
    }

    if (
      (level === "A2" || level === "B1") &&
      typeLower === "writing" &&
      item.dashboardWriting
    ) {
      void setupDashboardWritingCard(
        card,
        studyDay,
        taskId,
        Boolean(sectionDone.writing),
        {
          writingLevel: item.writingLevel || "A2",
          planLevel: level,
        },
      );
    }

    if (
      item.dashboardListeningDictation &&
      (level === "A2" || level === "B1")
    ) {
      void setupListeningDictationCard(
        card,
        studyDay,
        taskId,
        Boolean(sectionDone.listening_bb_dict),
        level,
      );
    }
    if (strictGrammarFlowEnabled) {
      card.addEventListener("writing:score-updated", (ev) => {
        const hs = Number(ev?.detail?.holisticScore);
        if (!Number.isFinite(hs)) return;
        strictFlowState.vocabularyUnlocked = hs >= 6 || Boolean(sectionDone.vocabulary);
        applyStrictGrammarLocks();
      });
      if (Boolean(sectionDone.listening_bb_dict)) strictFlowState.readingUnlocked = true;
      if (Boolean(sectionDone.reading)) strictFlowState.writingUnlocked = true;
    }
    applyStrictGrammarLocks();
  });

  if (level === "A2" || level === "B1") {
    const autoFocusKey = `edunext_dash_grammar_autofocus:${level}:${studyDay}`;
    const grammarCard = todoContainer.querySelector('[data-task-card-for="grammar"]');
    if (grammarCard && sessionStorage.getItem(autoFocusKey) !== "1") {
      sessionStorage.setItem(autoFocusKey, "1");
      window.requestAnimationFrame(() => {
        grammarCard.scrollIntoView({ behavior: "smooth", block: "center" });
        grammarCard.classList.add("ring-2", "ring-fuchsia-500/45");
        window.setTimeout(
          () => grammarCard.classList.remove("ring-2", "ring-fuchsia-500/45"),
          1600,
        );
      });
    }
  }
}

/** Writing: Supabase kunlik savol bo'yicha yordam (lug'at alohida Vocabulary-da). */
function activateMentorA2WritingAssist() {
  window.__edunextWritingReviewA2 = true;
  const input = document.getElementById("step11-ai-input");
  if (input) {
    input.placeholder =
      "Writing savolingizni yoki qisqa yozmangizni inglizcha yuboring — mentor tuzatish beradi.";
    input.focus();
  }
  const chat = document.getElementById("ai-chat-content");
  chat?.scrollTo?.({ top: chat.scrollHeight, behavior: "smooth" });
}

/** Inline `onchange` uchun (ixtiyoriy); asosan label + `peer-checked` bilan strikethrough. */
function toggleTask(checkbox) {
  const label = checkbox?.nextElementSibling;
  if (!label || label.tagName !== "LABEL") return;
  label.classList.toggle("line-through", checkbox.checked);
  label.classList.toggle("opacity-50", checkbox.checked);
}

function persistStep11Todos() {
  try {
    const state = {};
    document.querySelectorAll("#step-11 .step11-todo-cb").forEach((cb) => {
      const id = cb.getAttribute("data-task-id") || cb.id;
      state[id] = cb.checked;
    });
    localStorage.setItem("step11_todos", JSON.stringify(state));
  } catch (_) {
    /* ignore */
  }
}

function restoreStep11Todos() {
  let state = {};
  try {
    state = JSON.parse(localStorage.getItem("step11_todos") || "{}");
  } catch (_) {
    state = {};
  }
  document.querySelectorAll("#step-11 .step11-todo-cb").forEach((cb) => {
    const id = cb.getAttribute("data-task-id") || cb.id;
    if (state[id]) cb.checked = true;
  });
}

/** Ro‘yxat qayta tiklanganda A2 kunlik bo‘lim ma’lumoti bilan moslashtirish. */
function syncStep11TodosWithSectionCompletion() {
  if (inferEducationPlanTier() !== "A2") return;
  const day = getCurrentStudyDayIndex();
  const c = getDaySectionCompletion(day);
  document.querySelectorAll("#todo-list .step11-todo-cb").forEach((cb) => {
    const row = cb.closest(".task-plan-card");
    const sk = taskTypeToSectionKey(row?.dataset?.taskType || "");
    if (sk && c[sk]) {
      cb.checked = true;
      toggleTask(cb);
    }
  });
}

function initStep11Todos() {
  const root = document.getElementById("step-11");
  if (!root) return;
  if (root.dataset.todoDelegationWired !== "1") {
    root.dataset.todoDelegationWired = "1";
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !t.matches || !t.matches("input.step11-todo-cb")) return;
      persistStep11Todos();
      if (inferEducationPlanTier() !== "A2") return;
      const row = t.closest(".task-plan-card");
      const sk = taskTypeToSectionKey(row?.dataset?.taskType || "");
      if (sk !== "reading") return;
      const day = getCurrentStudyDayIndex();
      if (t.checked) {
        markDaySectionComplete(day, "reading");
        refreshDashboardPlanProgress("A2");
        refreshDashboardReadingProgress("A2", day);
        const doneBtn = row?.querySelector(".step11-done-task-btn");
        if (doneBtn) {
          doneBtn.disabled = true;
          doneBtn.textContent = "Bajarildi";
        }
      }
    });
  }
  restoreStep11Todos();
  syncStep11TodosWithSectionCompletion();
  if (inferEducationPlanTier() === "A2") {
    refreshDashboardReadingProgress("A2", getCurrentStudyDayIndex());
  }
}

const STEP11_CHAT_CONTEXT_MAX = 4;
/** Eski alohida chat (`eduNextHistory`) bilan aralashmasin — faqat dashboard mentor suhbati. */
const EDUNEXT_CHAT_HISTORY_KEY = "edunext_mentor_chat_v1";
const LEGACY_STANDALONE_CHAT_KEY = "eduNextHistory";

/** Bir martalik: olib tashlangan eski chat interfeysining localStorage arxivini o‘chirish. */
function purgeLegacyStandaloneChatStorage() {
  try {
    if (localStorage.getItem("edunext_legacy_chat_storage_cleared_v1")) return;
    localStorage.removeItem(LEGACY_STANDALONE_CHAT_KEY);
    localStorage.setItem("edunext_legacy_chat_storage_cleared_v1", "1");
  } catch (_) {
    /* ignore */
  }
}

function saveEduNextChatHistory(role, text) {
  const r = role === "user" ? "user" : "bot";
  const t = String(text ?? "").trim();
  if (!t) return;
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(EDUNEXT_CHAT_HISTORY_KEY) || "[]");
  } catch (_) {
    history = [];
  }
  if (!Array.isArray(history)) history = [];
  history.push({ role: r, text: t });
  localStorage.setItem(EDUNEXT_CHAT_HISTORY_KEY, JSON.stringify(history));
}

function escapeHtmlStep11(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mentor javoblari: xavfsiz HTML + sodda Markdown (**, `kod`). */
function htmlFromAssistantMarkdown(raw) {
  let t = escapeHtmlStep11(raw);
  t = t.replace(
    /`([^`]+)`/g,
    '<code class="break-all rounded bg-black/35 px-1 py-px text-[0.92em] font-mono text-cyan-100/95">$1</code>'
  );
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-slate-50">$1</strong>');
  return t
    .split(/\n{2,}/)
    .map((para) => {
      const body = para.replace(/\n/g, "<br />");
      return `<p class="step11-md-p mb-2 min-w-0 max-w-full whitespace-pre-wrap break-words last:mb-0">${body}</p>`;
    })
    .join("");
}

function appendStep11Bubble(role, text) {
  const box = document.getElementById("ai-chat-content");
  if (!box) return;
  const raw = String(text ?? "");
  const wrap = document.createElement("div");
  wrap.className = `flex w-full min-w-0 ${role === "user" ? "justify-end" : "justify-start"}`;
  wrap.dataset.chatRole = role === "user" ? "user" : "model";

  const inner = document.createElement("div");
  inner.className =
    role === "user"
      ? "flex max-w-[min(92%,42rem)] min-w-0 flex-col items-end sm:max-w-[85%]"
      : "flex w-full min-w-0 max-w-[min(100%,42rem)] flex-col items-stretch sm:max-w-[85%]";

  const bubble = document.createElement("div");
  if (role === "user") {
    bubble.className =
      "step11-chat-bubble w-fit max-w-full rounded-2xl rounded-tr-none border border-fuchsia-500/30 bg-fuchsia-500/20 px-3 py-2.5 text-left text-sm leading-relaxed text-white sm:px-4 sm:py-3";
    bubble.classList.add("whitespace-pre-wrap", "break-words");
    bubble.textContent = raw;
  } else {
    bubble.className =
      "step11-chat-bubble step11-md-root w-full rounded-2xl rounded-tl-none border border-white/10 bg-white/[0.06] px-3 py-2.5 text-left text-sm leading-relaxed text-slate-200 sm:px-4 sm:py-3";
    bubble.innerHTML = htmlFromAssistantMarkdown(raw);
  }

  inner.appendChild(bubble);
  wrap.appendChild(inner);
  box.appendChild(wrap);
  box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
}

/** Serverga faqat oxirgi N ta xabar (joriy foydalanuvchi xabari alohida `message` sifatida). */
function collectStep11ChatHistoryForApi() {
  const box = document.getElementById("ai-chat-content");
  if (!box) return [];
  const wraps = [...box.querySelectorAll(":scope > [data-chat-role]")];
  const withoutLatestUser = wraps.slice(0, -1);
  return withoutLatestUser.slice(-STEP11_CHAT_CONTEXT_MAX).map((w) => ({
    role: w.dataset.chatRole === "user" ? "user" : "model",
    text: w.querySelector(".step11-chat-bubble")?.textContent?.trim() ?? "",
  })).filter((x) => x.text);
}

/** Dashboard PDF reja va vazifa holati — mentor kitob/unit va tabriqlarni aniqlashi uchun. */
function collectStep11TodoRowsForApi() {
  const items = [];
  document.querySelectorAll("#todo-list .step11-todo-cb").forEach((cb) => {
    const row = cb.closest(".task-plan-card");
    const task =
      row?.querySelector("[data-task-line]")?.textContent?.trim() ||
      row?.dataset?.taskSummary?.trim() ||
      "";
    const typeText =
      row?.querySelector(".step11-todo-type")?.textContent?.trim() ||
      row?.dataset?.taskType?.trim() ||
      "";
    items.push({
      task,
      type: typeText || "Task",
      done: !!cb.checked,
    });
  });
  const allTodosDone = items.length > 0 && items.every((i) => i.done);
  return { todos: items, allTodosDone };
}

function buildStep11MentorContextForApi() {
  const { todos, allTodosDone } = collectStep11TodoRowsForApi();
  return {
    source: "step11-dashboard",
    planTier: inferEducationPlanTier(),
    displayBand: inferDisplayCefrBandForDashboard(),
    todos,
    allTodosDone,
    completedCount: todos.filter((t) => t.done).length,
    totalCount: todos.length,
    writingReviewA2: Boolean(
      typeof globalThis !== "undefined" && globalThis.__edunextWritingReviewA2
    ),
    pdfLinksExternalOnly: true,
    oxfordReadingAssistant: inferEducationPlanTier() === "A2",
  };
}

function pickSpeechSynthesisVoice() {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices?.() ?? [];
  if (!voices.length) return null;
  const uz =
    voices.find((v) => /^uz/i.test(v.lang)) ||
    voices.find((v) => /uzbek/i.test(String(v.name || "")));
  if (uz) return uz;
  return voices.find((v) => /^en-/i.test(v.lang)) ?? voices[0] ?? null;
}

function speakStep11LastMentorUtterance() {
  if (typeof speechSynthesis === "undefined") {
    alert("Brauzeringizda ovozli o'qish (TTS) mavjud emas.");
    return;
  }
  speechSynthesis.cancel();
  const bots = document.querySelectorAll(
    '#ai-chat-content [data-chat-role="model"] .step11-chat-bubble'
  );
  if (!bots.length) return;
  const lastBubble = bots[bots.length - 1];
  const txt = lastBubble?.textContent?.trim() ?? "";
  if (!txt) return;
  const u = new SpeechSynthesisUtterance(txt);
  const voice = pickSpeechSynthesisVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang || "en-US";
  } else {
    u.lang = "uz-UZ";
  }
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

function stopStep11MentorSpeech() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/** Natija bandi Step 10 / reading bilan mos (mentor gapida). */
function inferDisplayCefrBandForDashboard() {
  let grammar = null;
  let reading = null;
  try {
    grammar = JSON.parse(localStorage.getItem("grammarLexisResults") || "null");
  } catch (_) {
    grammar = null;
  }
  try {
    reading = JSON.parse(localStorage.getItem("readingResults") || "null");
  } catch (_) {
    reading = null;
  }
  const levelRaw = String(reading?.levelResult || grammar?.level || "").trim();
  let tier = "B1";
  const mBand = levelRaw.match(/\b([ABC][12])\b/i);
  if (mBand) tier = mBand[1].toUpperCase();
  else if (/beginner|elementary|a1|a2/i.test(levelRaw)) tier = "A2";
  else if (/advanced|c1|c2/i.test(levelRaw)) tier = "C1";
  return tier;
}

function bootstrapStep11ChatIfNeeded() {
  const box = document.getElementById("ai-chat-content");
  if (!box || box.dataset.seeded === "1") return;

  if (box.querySelector(':scope > [data-chat-role="user"], :scope > [data-chat-role="model"]')) {
    box.dataset.seeded = "1";
    return;
  }

  box.dataset.seeded = "1";
  appendStep11Bubble("bot", STEP11_MENTOR_OPENING_GREETING);
  saveEduNextChatHistory("bot", STEP11_MENTOR_OPENING_GREETING);
}

async function postStep11MentorMessage(msg) {
  const message = String(msg || "").trim();
  if (!message) return;
  const typing = document.getElementById("step11-ai-typing");

  appendStep11Bubble("user", message);
  saveEduNextChatHistory("user", message);
  const history = collectStep11ChatHistoryForApi();
  const mentorContext = buildStep11MentorContextForApi();
  if (typing) typing.classList.remove("hidden");

  try {
    const { res, payload: data } = await handleCheck(
      async () => {
        const r = await fetch(apiUrl("/api/ai/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history, mentorContext }),
        });
        const p = await r.json().catch(() => ({}));
        return { res: r, payload: p };
      },
      { delayMs: 5000, maxAttempts: 12 },
    );
    if (res.status === 429 || data.quotaExceeded) {
      const reply = data.reply || QUOTA_REPLY_UZ;
      appendStep11Bubble("bot", reply);
      saveEduNextChatHistory("bot", reply);
    } else if (res.ok && data.reply) {
      appendStep11Bubble("bot", data.reply);
      saveEduNextChatHistory("bot", data.reply);
    } else {
      const reply = data.reply || "Javob olinmadi. Qayta urinib ko'ring.";
      appendStep11Bubble("bot", reply);
      saveEduNextChatHistory("bot", reply);
    }
  } catch (_) {
    const reply = "Serverga ulanib bo'lmadi. Internet yoki API holatini tekshiring.";
    appendStep11Bubble("bot", reply);
    saveEduNextChatHistory("bot", reply);
  } finally {
    if (typing) typing.classList.add("hidden");
  }
}

async function sendStep11Chat() {
  const input = document.getElementById("step11-ai-input");
  const msg = String(input?.value || "").trim();
  if (!msg) return;
  if (input) input.value = "";
  await postStep11MentorMessage(msg);
}

/** Step 11 Dashboard ochiladi (eski Step 10 olib tashlangan). */
async function goToStep11() {
  const sb = ensureSupabase();
  let sessionUser = null;
  if (sb) {
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session?.user) {
      localStorage.removeItem("edunext_current_step");
      localStorage.removeItem("activeStep");
      document.getElementById("step-11")?.classList.add("hidden");
      hideDashboardInitOverlay();
      showAuthGate();
      setAuthTab("login");
      const errEl = document.getElementById("auth-form-error");
      if (errEl) errEl.textContent = "Dashboard uchun avval tizimga kiring.";
      return;
    }
    sessionUser = session.user;
    await refreshProfileCache(sessionUser.id);
    if (!placementLevelResolved()) {
      window.history.replaceState({ edunextSpa: "diagnostic" }, "", "/diagnostic");
      installDiagnosticNavGuard();
      hideDashboardInitOverlay();
      beginDiagnosticTestFlow();
      return;
    }
  }

  const chat = document.getElementById("ai-chat-content");
  if (chat) {
    chat.innerHTML = "";
    delete chat.dataset.seeded;
  }

  hideOnboardingFlow();
  hideAllStepSections();

  const step11 = document.getElementById("step-11");
  if (!step11) return;
  step11.classList.remove("hidden");

  // localStorage'dan joriy bosqichni darrov o'qib, mos skeleton'ni
  // ko'rsatamiz — Supabase javobi kelguncha UI sakramaydi va Vocabulary
  // adashib ochilmaydi.
  renderDashboardLoadingSkeleton();

  saveCurrentStep("step-11");
  localStorage.setItem("activeStep", "11");

  setTimeout(() => {
    void (async () => {
      await syncWeek1ListeningProgressFromSupabase();
      hydrateDashboardGreetingFromProfile();
      generatePersonalPlan(inferEducationPlanTier());
      // Real kartalar paydo bo'lgach overlay'ni silliq yashiramiz.
      hideDashboardInitOverlay();
      initStep11Todos();
      if (shouldAutoOpenReadingFromUrl()) {
        try {
          sessionStorage.setItem("edunext_force_open_reading", "1");
        } catch (_) {
          /* ignore */
        }
        setTimeout(() => navigateDashboardLesson("reading"), 120);
      }
      if (shouldAutoOpenVocabularyFromUrl() || shouldAutoOpenVocabularyFromSession()) {
        setTimeout(() => navigateDashboardLesson("vocabulary"), 160);
      }
      void bootstrapStep11ChatIfNeeded();
    })();
  }, 100);

  if (sessionUser && !isProfileComplete(__edunextProfile)) {
    openProfileCompletionModal(sessionUser);
  }
}

function showStep11() {
  goToStep11();
}

async function hideStep11() {
  const s11 = document.getElementById("step-11");
  if (!s11) return;
  stopDashboardSupervisorTimer();
  closeDailyFinalAssessmentUI();
  const sb = ensureSupabase();
  if (sb) {
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (session?.user?.id) await refreshProfileCache(session.user.id);
  }
  if (!placementLevelResolved()) {
    installDiagnosticNavGuard();
    beginDiagnosticTestFlow();
    return;
  }
  s11.classList.add("hidden");
  localStorage.removeItem("edunext_current_step");
  localStorage.removeItem("activeStep");
}

function populateStep10CefrFromStorage() {
  const tierEl = document.getElementById("step10-cefr-tier");
  const descEl = document.getElementById("step10-cefr-desc");
  if (!tierEl || !descEl) return;

  let grammar = null;
  let reading = null;
  try {
    grammar = JSON.parse(localStorage.getItem("grammarLexisResults") || "null");
  } catch (_) {
    grammar = null;
  }
  try {
    reading = JSON.parse(localStorage.getItem("readingResults") || "null");
  } catch (_) {
    reading = null;
  }

  const levelRaw = String(reading?.levelResult || grammar?.level || "").trim();

  let tier = "B1";
  let desc = "Intermediate";
  const mBand = levelRaw.match(/\b([ABC][12])\b/i);
  if (mBand) tier = mBand[1].toUpperCase();
  else if (/beginner|elementary|a1|a2/i.test(levelRaw)) tier = "A2";
  else if (/advanced|c1|c2/i.test(levelRaw)) tier = "C1";

  const low = levelRaw.toLowerCase();
  if (/beginner|elementary/.test(low) || tier === "A2") desc = "Beginner";
  else if (/upper/.test(low)) desc = "Upper-intermediate";
  else if (/intermediate/.test(low) || /^b/i.test(tier)) desc = "Intermediate";
  else if (/advanced|c1|c2/i.test(low) || /^c/i.test(tier)) desc = "Advanced";

  tierEl.textContent = tier;
  descEl.textContent = desc.toUpperCase();
}

/** Eski Step 10 o‘rniga Dashboard; dinamik eski Listening UI o‘chirilgani uchun shim. */
async function finalizeTestShowStep10() {
  await goToStep11();
}

/** Eskidan: xuddi Dashboard (Step 11) ni ochadi. */
function generateAIRoadmap() {
  goToStep11();
}
window.generateAIRoadmap = generateAIRoadmap;
window.goToStep11 = goToStep11;
window.toggleTask = toggleTask;
window.generatePersonalPlan = generatePersonalPlan;
window.inferEducationPlanTier = inferEducationPlanTier;
window.resetDiagnostic = resetDiagnosticStateForNewRun;
window.finalizeTestShowStep10 = finalizeTestShowStep10;

window.populateStep10CefrFromStorage = populateStep10CefrFromStorage;
window.showStep11 = showStep11;
window.hideStep11 = hideStep11;
window.sendStep11Chat = sendStep11Chat;
window.closeDailyFinalAssessmentUI = closeDailyFinalAssessmentUI;
window.showPaymentModal = showPaymentModal;
window.closePaymentModal = closePaymentModal;
window.checkAccess = checkAccess;
window.onDashboardFinalTestManualStart = onDashboardFinalTestManualStart;
window.speakStep11LastMentorUtterance = speakStep11LastMentorUtterance;
window.stopStep11MentorSpeech = stopStep11MentorSpeech;

/** Brauzer TTS uchun ovollar ro‘yxatini tayyorlash (Chrome uchun). */
if (typeof speechSynthesis !== "undefined") {
  try {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
  } catch (_) {
    /* ignore */
  }
}

function initListeningPart6() {
  startPart6OneTime();
}
window.initListeningPart6 = initListeningPart6;

function initListeningPart3() {
  startPart3HolidayOneTime();
}

function initListeningPart5Only() {
  startPart5OneTime();
}

window.initListeningPart3 = initListeningPart3;
window.initListeningPart5Only = initListeningPart5Only;
window.startListeningSection = startListeningSection;

const nextReadingBtn = document.getElementById("next-reading-btn");
if (nextReadingBtn) {
  nextReadingBtn.onclick = () => {
    if (selectedReadingOption === null) return;

    if (selectedReadingOption === readingData[currentReadingIdx].correct) {
      readingScore++;
    }

    currentReadingIdx++;
    if (currentReadingIdx < readingData.length) {
      loadReadingContent();
    } else {
      finishReading();
    }
  };
}

const writingInputEl = document.getElementById("writing-input");
if (writingInputEl) {
  writingInputEl.addEventListener("input", updateWordCount);
  updateWordCount();
}

queueMicrotask(() => {
  if (localStorage.getItem("edunext_current_step")) return;
  const s1 = document.getElementById("step-1");
  const s2 = document.getElementById("step-2");
  if (
    s1 &&
    !s1.classList.contains("hidden") &&
    s2 &&
    s2.classList.contains("hidden")
  ) {
    saveCurrentStep("step-1");
  }
});

queueMicrotask(() => {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get("cefrPath") !== "1") return;
    u.searchParams.delete("cefrPath");
    const qs = u.searchParams.toString();
    history.replaceState({}, "", u.pathname + (qs ? `?${qs}` : ""));
    window.location.assign("/dashboard");
  } catch (_) {
    /* ignore */
  }
});