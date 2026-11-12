/**
 * Turkish mobile phone helpers. Phones are stored as E.164 ("+905321234567").
 */

const ALLOWED_INPUT = /^\+?[\d\s\-().]*$/;
const MOBILE_NATIONAL = /^5\d{9}$/;

/** Normalizes a Turkish mobile number to E.164, or returns null if it is not one. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || !ALLOWED_INPUT.test(trimmed)) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return MOBILE_NATIONAL.test(digits) ? `+90${digits}` : null;
}

/** Synthetic auth email for an E.164 phone: "+905321234567" -> "905321234567@saha.local". */
export function phoneToEmail(e164: string): string {
  return `${e164.replace(/^\+/, "")}@saha.local`;
}

/** Display format: "+905321234567" -> "0532 123 45 67". */
export function formatPhone(e164: string): string {
  const national = e164.replace(/^\+90/, "");
  if (!MOBILE_NATIONAL.test(national)) return e164;
  return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8, 10)}`;
}
