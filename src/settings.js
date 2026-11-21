// Settings an admin can change while the app runs. They live in the `settings` table and
// override the environment defaults.

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const PRESETS = {
  weekends: { label: 'Weekends (Fri–Sun)', days: [5, 6, 0] },
  weekdays: { label: 'Weekdays (Mon–Fri)', days: [1, 2, 3, 4, 5] },
  all: { label: 'All week', days: [0, 1, 2, 3, 4, 5, 6] },
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function readSetting(db, key) {
  return (await db.get('SELECT value FROM settings WHERE key = ?', [key]))?.value ?? null;
}

export async function writeSetting(db, key, value) {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
}

const count = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
};

/** Check a coverage object. Returns { coverage } or { error }. */
export function normalizeCoverage(input) {
  const days = [...new Set((input?.days ?? []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!days.length) return { error: 'Pick at least one day that needs someone on call.' };
  if (!TIME.test(String(input.start))) return { error: 'Start time must look like 18:00.' };
  if (!TIME.test(String(input.end))) return { error: 'End time must look like 09:00.' };
  const weekendCount = count(input.weekendCount);
  const weekdayCount = count(input.weekdayCount);
  if (!weekendCount || !weekdayCount) return { error: 'People on call must be a whole number from 1 to 10.' };
  return { coverage: { days, start: String(input.start), end: String(input.end), weekendCount, weekdayCount } };
}

/** Turn "@example.com, example.org" into a clean list. Returns { domains } or { error }. */
export function normalizeDomains(text) {
  const domains = [...new Set(String(text || '').split(/[\s,;]+/).map((d) => d.replace(/^@/, '').trim().toLowerCase()).filter(Boolean))];
  if (!domains.length) return { error: 'Enter at least one email domain, for example example.com.' };
  const bad = domains.find((d) => !DOMAIN.test(d));
  if (bad) return { error: `"${bad}" is not a valid domain. Use something like example.com.` };
  return { domains };
}

/** "Fri, Sat, Sun" / "Mon–Fri" style summary of covered days. */
export function describeDays(days) {
  const set = new Set(days);
  if (set.size === 7) return 'every day';
  const order = [1, 2, 3, 4, 5, 6, 0];
  const parts = [];
  let i = 0;
  while (i < order.length) {
    if (!set.has(order[i])) { i += 1; continue; }
    let j = i;
    while (j + 1 < order.length && set.has(order[j + 1])) j += 1;
    parts.push(j - i >= 2 ? `${DAY_NAMES[order[i]]}–${DAY_NAMES[order[j]]}` : order.slice(i, j + 1).map((d) => DAY_NAMES[d]).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}
