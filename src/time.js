// Time-zone math for weekend shifts, using only Intl (no dependencies).
//
// A shift is identified by its "weekend key": the team-local date its shift starts on,
// e.g. "2026-11-20" for the shift that starts Friday Nov 20 at 18:00.

const partsFormatters = new Map();
function partsFormatter(tz) {
  if (!partsFormatters.has(tz)) {
    partsFormatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
    }));
  }
  return partsFormatters.get(tz);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `date` in time zone `tz`. */
export function tzParts(date, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second),
    weekday: WEEKDAYS[out.weekday],
  };
}

/** Milliseconds that `tz` is ahead of UTC at instant `date`. */
function tzOffsetMs(date, tz) {
  const p = tzParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when the wall clock in `tz` reads the given local date and time. */
export function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - tzOffsetMs(new Date(guess), tz);
  // Second pass corrects the offset when the guess and result straddle a DST change.
  result = guess - tzOffsetMs(new Date(result), tz);
  return new Date(result);
}

/** Add whole days to a local calendar date. */
export function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Bad weekend key "${key}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const weekdayOf = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
const parseHm = (hm) => { const [hour, minute] = String(hm).split(':').map(Number); return { hour, minute }; };

/** Runs of consecutive covered days, each starting on `startDay`. Covering all 7 days is one weekly run. */
export function runsOf(days) {
  const set = new Set(days);
  if (set.size === 7) return [{ startDay: 1, length: 7 }];
  const runs = [];
  for (const d of [...set].sort((a, b) => a - b)) {
    if (set.has((d + 6) % 7)) continue;
    let length = 1;
    while (set.has((d + length) % 7)) length += 1;
    runs.push({ startDay: d, length });
  }
  return runs;
}

/**
 * The coverage the env settings describe: SHIFT_START/SHIFT_END become the run of days they span
 * (FRI 18:00 -> MON 09:00 covers Fri, Sat and Sun), and PEOPLE_PER_WEEKEND the people per shift.
 */
export function coverageFromConfig({ shiftStart, shiftEnd, perWeekend = 2 }) {
  const length = (shiftEnd.day - shiftStart.day + 7) % 7 || 7;
  const days = Array.from({ length }, (_, i) => (shiftStart.day + i) % 7);
  const hm = ({ hour, minute }) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { days, start: hm(shiftStart), end: hm(shiftEnd), weekendCount: perWeekend, weekdayCount: perWeekend };
}

const isWeekendDay = (d) => d === 0 || d === 6;

/**
 * Shift helpers for a coverage: which days of the week need people on call, the time the shift
 * starts on its first day and ends the morning after its last day, and how many people each
 * kind of day needs. Consecutive covered days make one shift; a shift needs as many people as the
 * busiest day it covers. `setCoverage` changes it while the app runs.
 */
export function makeShifts(config) {
  const { timezone } = config;
  let coverage;
  let runs;
  let startDays;
  let start;
  let end;

  function setCoverage(next) {
    coverage = { ...next, days: [...new Set(next.days)].sort((a, b) => a - b) };
    runs = runsOf(coverage.days);
    startDays = new Set(runs.map((r) => r.startDay));
    start = parseHm(coverage.start);
    end = coverage.days.length === 7 ? start : parseHm(coverage.end);
  }
  setCoverage(config.coverage ?? coverageFromConfig(config));

  const countFor = (days) => Math.max(...days.map((d) => (isWeekendDay(d) ? coverage.weekendCount : coverage.weekdayCount)));

  /** The shift whose start falls on local date `key`. */
  function forKey(key) {
    const startDate = parseKey(key);
    const weekday = weekdayOf(startDate);
    const run = runs.find((r) => r.startDay === weekday)
      ?? runs.find((r) => Array.from({ length: r.length }, (_, i) => (r.startDay + i) % 7).includes(weekday))
      ?? { startDay: weekday, length: 1 };
    const days = Array.from({ length: run.length }, (_, i) => (weekday + i) % 7);
    return {
      key,
      start: zonedToUtc({ ...startDate, hour: start.hour, minute: start.minute }, timezone),
      end: zonedToUtc({ ...addDays(startDate, run.length), hour: end.hour, minute: end.minute }, timezone),
      count: countFor(days),
    };
  }

  /** The most recent shift that started at or before `now` (it may already be over). */
  function latestStarted(now) {
    const local = tzParts(now, timezone);
    for (let back = 0; back <= 8; back++) {
      const date = addDays(local, -back);
      if (!startDays.has(weekdayOf(date))) continue;
      const shift = forKey(dateKey(date));
      if (shift.start <= now) return shift;
    }
    throw new Error('No on-call days are configured');
  }

  /** The shift in progress at `now`, or null between shifts. */
  function current(now = new Date()) {
    const shift = latestStarted(now);
    return now < shift.end ? shift : null;
  }

  function scan(shift, step) {
    const from = parseKey(shift.key);
    for (let i = 1; i <= 8; i++) {
      const date = addDays(from, step * i);
      if (startDays.has(weekdayOf(date))) return forKey(dateKey(date));
    }
    throw new Error('No on-call days are configured');
  }

  /** The next shift that has not started yet. */
  function next(now = new Date()) {
    return following(latestStarted(now));
  }

  /** The shift after `shift`. */
  function following(shift) {
    return scan(shift, 1);
  }

  /** The shift before `shift`. */
  function previous(shift) {
    return scan(shift, -1);
  }

  /** The current shift if one is running, otherwise the next one. */
  function currentOrNext(now = new Date()) {
    return current(now) || next(now);
  }

  return { forKey, current, next, following, previous, currentOrNext, setCoverage, coverage: () => coverage };
}

const displayFormatters = new Map();
/** "Fri, Nov 20, 6:00 PM EST" in the team time zone. */
export function formatLocal(date, tz) {
  if (!displayFormatters.has(tz)) {
    displayFormatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }));
  }
  return displayFormatters.get(tz).format(date);
}

/** "Nov 20 – Nov 23" for a shift. */
export function formatRange(shift, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
  return `${f.format(shift.start)} – ${f.format(shift.end)}`;
}
