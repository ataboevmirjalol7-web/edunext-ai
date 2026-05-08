/**
 * Yangi diagnostika boshlashdan oldin: local/session + profil (Supabase) holatini tozalash.
 * index.html (script.js) va diagnostic-test.html dan umumiy chaqiriladi.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import { resetLocalStudyPlanProgress } from "/studyPlan.js";

const DIAGNOSTIC_COMPLETE_KEY = "edunext_diagnostic_complete";
const DIAG_SESSION_KEY = "edunext_diagnostic_session_v2";
const DIAG_ACTIVE_FLAG = "edunext_diag_in_progress";

const LOCAL_KEYS_TO_CLEAR = [
  "grammarLexisResults",
  "readingResults",
  "diagnosticWritingSnapshot",
  DIAGNOSTIC_COMPLETE_KEY,
  "edunext_test_results",
  "edunext_current_step",
  "activeStep",
  "step11_todos",
  "edunext_mentor_chat_v1",
];

function ensureSupabaseClient() {
  const url = String(globalThis.APP_CONFIG?.supabaseUrl ?? "").trim().replace(/\/+$/, "");
  const key = String(globalThis.APP_CONFIG?.supabaseAnonKey ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

/**
 * Eski natijalar va reja holatini tozalaydi; profilda level va study_plan_start_date ni null qiladi.
 * @returns {Promise<{ profileUpdated: boolean }>}
 */
export async function resetDiagnosticClientState() {
  for (const k of LOCAL_KEYS_TO_CLEAR) {
    try {
      localStorage.removeItem(k);
    } catch (_) {
      /* ignore */
    }
  }
  resetLocalStudyPlanProgress();

  try {
    sessionStorage.removeItem(DIAG_SESSION_KEY);
    sessionStorage.removeItem(DIAG_ACTIVE_FLAG);
    sessionStorage.removeItem("edunext_day1_mentor_kickoff");
  } catch (_) {
    /* ignore */
  }

  let profileUpdated = false;
  const sb = ensureSupabaseClient();
  if (sb) {
    const {
      data: { session },
    } = await sb.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      const { error } = await sb
        .from("profiles")
        .update({ level: null, study_plan_start_date: null })
        .eq("id", uid);
      if (!error) profileUpdated = true;
      else console.warn("[resetDiagnostic]", error.message);
    }
  }

  return { profileUpdated };
}
