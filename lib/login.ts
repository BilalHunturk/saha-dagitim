/**
 * Pure login helpers shared by the browser login form, the server and the proxy.
 * No imports beyond lib/phone, so it is safe in Client Components.
 */
import { normalizePhone, phoneToEmail } from "@/lib/phone";

export const LOGIN_MESSAGES = {
  INVALID_PHONE: "Telefon numarası geçersiz",
  WRONG_CREDENTIALS: "Telefon veya şifre hatalı",
  INACTIVE: "Hesabınız pasif. Yöneticinize başvurun.",
  RATE_LIMITED: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.",
  CONNECTION: "Bağlantı sorunu. Lütfen tekrar deneyin.",
} as const;

/** The parts of an auth-js error this module looks at. */
export type AuthErrorLike = { name?: string; status?: number; code?: string; message?: string };

/** Validates the login form; returns the sign-in credentials or the message to show. */
export function parseLoginForm(
  phoneInput: string,
  password: string,
): { email: string; password: string } | { error: string } {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { error: LOGIN_MESSAGES.INVALID_PHONE };
  if (!password) return { error: LOGIN_MESSAGES.WRONG_CREDENTIALS };
  return { email: phoneToEmail(phone), password };
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || error.code === "over_request_rate_limit";
}

/**
 * True when an auth error says nothing definite about the session: network failure,
 * rate limit, server error or an unknown failure. Such errors must never sign anyone out.
 */
export function isTransientAuthError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError") return true;
  if (isRateLimited(error)) return true;
  const status = error.status;
  return status === undefined || status === 0 || status >= 500;
}

/** Message for a failed `signInWithPassword`. Only a real credentials error says "wrong". */
export function signInErrorMessage(error: AuthErrorLike): string {
  if (isRateLimited(error)) return LOGIN_MESSAGES.RATE_LIMITED;
  if (error.code === "invalid_credentials") return LOGIN_MESSAGES.WRONG_CREDENTIALS;
  // Older auth servers send no code; their credentials error is a plain 400 with this text.
  if (error.status === 400 && !error.code && /invalid login credentials/i.test(error.message ?? "")) {
    return LOGIN_MESSAGES.WRONG_CREDENTIALS;
  }
  return LOGIN_MESSAGES.CONNECTION;
}
