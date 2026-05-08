/** Groq/API rate-limit uchun asosiy retry yordamchilari (`script.js`, `readingExamDashboard.js`). */

export function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {Response|undefined|null} res @param {*} payload */
export function isGroqRateLimitPayload(res, payload) {
  try {
    const p = payload && typeof payload === "object" ? payload : {};
    if (res && res.status === 429) return true;
    if (p.quotaExceeded === true) return true;
    const err = String(p.error ?? p.message ?? "");
    if (/rate\s*limit|Too Many Requests|\b429\b|quota/i.test(err)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Rate limit bo‘lsa foydalanuvchiga alert chiqarmay, `delayMs` kutib qayta tekshiradi.
 * @param {() => Promise<{ res: Response, payload: any }>} performAttempt
 * @param {{ delayMs?: number, maxAttempts?: number }} [opts]
 */
export async function handleCheck(performAttempt, opts = {}) {
  const delayMs = opts.delayMs ?? 5000;
  const maxAttempts = opts.maxAttempts ?? 12;
  /** @type {{ res: Response, payload: any }} */
  let pack;
  for (let i = 0; i < maxAttempts; i++) {
    pack = await performAttempt();
    if (!isGroqRateLimitPayload(pack.res, pack.payload)) return pack;
    if (i < maxAttempts - 1) await sleepMs(delayMs);
  }
  return pack;
}
