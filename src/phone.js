/** Normalise user input to E.164 (+ and digits). Returns null if it doesn't look valid. */
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  // Assume US/Canada for 10-digit numbers typed without a country code.
  if (!raw.startsWith('+') && digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}
