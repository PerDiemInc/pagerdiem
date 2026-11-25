// Dates and times as the team reads them: always in the team's timezone (Team.timezone from the
// server), never the phone's, so someone travelling still sees "Fri 6:00 PM" for the shift.
import type { Coverage } from '@/lib/api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (iso: string, tz: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options }).format(new Date(iso));

/** "10:36 AM" */
export const formatClock = (iso: string, tz: string) => parts(iso, tz, { hour: 'numeric', minute: '2-digit' });

/** "Saturday, December 12" */
export const formatDay = (iso: string, tz: string) => parts(iso, tz, { weekday: 'long', month: 'long', day: 'numeric' });

/** "Mon 9:00 AM" */
export const formatDayClock = (iso: string, tz: string) => parts(iso, tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** "Jan 8" */
export const formatDate = (iso: string, tz: string) => parts(iso, tz, { month: 'short', day: 'numeric' });

/** "December" */
export const formatMonth = (iso: string, tz: string) => parts(iso, tz, { month: 'long' });

/** "Today", "Yesterday" or "Thu, Dec 10", by the team's calendar */
export function formatDayLabel(iso: string, tz: string, now = new Date()) {
  const day = (d: Date) => parts(d.toISOString(), tz, { year: 'numeric', month: 'numeric', day: 'numeric' });
  if (day(new Date(iso)) === day(now)) return 'Today';
  if (day(new Date(iso)) === day(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return parts(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The two lines of a calendar tile: { dow: 'FRI', day: '18' } */
export const dateTile = (iso: string, tz: string) => ({ dow: parts(iso, tz, { weekday: 'short' }).toUpperCase(), day: parts(iso, tz, { day: 'numeric' }) });

/** "Dec 18 to 21", or "Dec 25 to Jan 1" across months. */
export function formatRange(startIso: string, endIso: string, tz: string) {
  const start = parts(startIso, tz, { month: 'short', day: 'numeric' });
  const [startMonth] = start.split(' ');
  const end = parts(endIso, tz, { month: 'short', day: 'numeric' });
  return `${start} to ${end.startsWith(`${startMonth} `) ? end.slice(startMonth.length + 1) : end}`;
}

/** "18:00" as "6:00 PM" */
export const clock12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "Fri 6:00 PM to Mon 9:00 AM" for the first run of covered days. */
export function formatShiftHours(coverage: Coverage) {
  const days = new Set(coverage.days);
  // The run starts on a covered day whose previous day isn't covered (or on the only run, all week).
  const first = [0, 1, 2, 3, 4, 5, 6].find((d) => days.has(d) && !days.has((d + 6) % 7)) ?? coverage.days[0] ?? 5;
  let last = first;
  while (days.has((last + 1) % 7) && (last + 1) % 7 !== first) last = (last + 1) % 7;
  const overnight = coverage.end <= coverage.start;
  const endDay = overnight ? (last + 1) % 7 : last;
  return `${DAYS[first]} ${clock12(coverage.start)} to ${DAYS[endDay]} ${clock12(coverage.end)}`;
}

/** "1 day 22 hr left", "3 hr left", "12 min left" */
export function formatLeft(untilIso: string, now = new Date()) {
  const minutes = Math.max(0, Math.round((new Date(untilIso).getTime() - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days} day${days > 1 ? 's' : ''}${hours ? ` ${hours} hr` : ''} left`;
  if (hours) return `${hours} hr left`;
  return `${minutes} min left`;
}

/** How long ago: "just now", "6 min", "2 hr", "2 days" */
export function formatAge(sinceIso: string, now = new Date()) {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''}`;
}

/** "06:13", or "1:02:09" past an hour */
export function formatTimer(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** "Acknowledged in 4 min", or "in 40 s" under a minute */
export function formatAckIn(ms: number) {
  return ms < 60_000 ? `Acknowledged in ${Math.round(ms / 1000)} s` : `Acknowledged in ${Math.round(ms / 60_000)} min`;
}
