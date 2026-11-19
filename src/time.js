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

/**
 * Build shift helpers for a weekly shift defined by start/end day+time in a time zone.
 * startSpec/endSpec look like { day: 5, hour: 18, minute: 0 } (0 = Sunday).
 */
export function makeShifts({ timezone, shiftStart, shiftEnd }) {
  // How many calendar days after the start day the shift ends.
  let endOffsetDays = (shiftEnd.day - shiftStart.day + 7) % 7;
  const startMinutes = shiftStart.hour * 60 + shiftStart.minute;
  const endMinutes = shiftEnd.hour * 60 + shiftEnd.minute;
  if (endOffsetDays === 0 && endMinutes <= startMinutes) endOffsetDays = 7;

  /** The shift whose start falls on local date `key`. */
  function forKey(key) {
    const startDate = parseKey(key);
    const endDate = addDays(startDate, endOffsetDays);
    return {
      key,
      start: zonedToUtc({ ...startDate, hour: shiftStart.hour, minute: shiftStart.minute }, timezone),
      end: zonedToUtc({ ...endDate, hour: shiftEnd.hour, minute: shiftEnd.minute }, timezone),
    };
  }

  /** The most recent shift that started at or before `now` (it may already be over). */
  function latestStarted(now) {
    const local = tzParts(now, timezone);
    const daysBack = (local.weekday - shiftStart.day + 7) % 7;
    let shift = forKey(dateKey(addDays(local, -daysBack)));
    if (shift.start > now) shift = forKey(dateKey(addDays(local, -daysBack - 7)));
    return shift;
  }

  /** The shift in progress at `now`, or null between shifts. */
  function current(now = new Date()) {
    const shift = latestStarted(now);
    return now < shift.end ? shift : null;
  }

  /** The next shift that has not started yet. */
  function next(now = new Date()) {
    return following(latestStarted(now));
  }

  /** The shift one week after `shift`. */
  function following(shift) {
    return forKey(dateKey(addDays(parseKey(shift.key), 7)));
  }

  /** The shift one week before `shift`. */
  function previous(shift) {
    return forKey(dateKey(addDays(parseKey(shift.key), -7)));
  }

  /** The current shift if one is running, otherwise the next one. */
  function currentOrNext(now = new Date()) {
    return current(now) || next(now);
  }

  return { forKey, current, next, following, previous, currentOrNext };
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
