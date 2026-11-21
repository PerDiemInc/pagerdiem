// Calendar views of the rotation: a month grid for the web page and an iCalendar feed
// that people can subscribe to from Google Calendar.
import crypto from 'node:crypto';
import { config } from './config.js';
import { tzParts, dateKey, addDays, parseKey, zonedToUtc } from './time.js';

/**
 * Weekend entries whose shift overlaps [fromKey, toKey] (local dates). Weekends before the
 * rotation started are left out unless a shift was actually recorded for them.
 */
export async function entriesBetween({ shifts, rotation }, fromKey, toKey) {
  // The latest shift that started by the end of fromKey: it may still be running that day.
  const endOfFromDay = zonedToUtc({ ...parseKey(fromKey), hour: 23, minute: 59 }, config.timezone);
  const list = [];
  for (let s = shifts.previous(shifts.next(endOfFromDay)); dateKey(tzParts(s.start, config.timezone)) <= toKey; s = shifts.following(s)) {
    list.push(s);
  }
  if (!list.length) return [];
  const startKey = await rotation.rotationStartKey();
  const entries = await rotation.schedule(list[0], list.length);
  return entries.filter((e) => e.locked || e.shift.key >= startKey);
}

/** Month grid: weeks of days, each day tagged with who is on call (if anyone). */
export async function monthGrid(deps, year, month) {
  const firstDay = { year, month, day: 1 };
  const lastDay = addDays({ year: month === 12 ? year + 1 : year, month: month === 12 ? 1 : month + 1, day: 1 }, -1);
  const weekdayOfFirst = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const gridStart = addDays(firstDay, -weekdayOfFirst);
  const cells = 42;
  const gridEnd = addDays(gridStart, cells - 1);
  const entries = await entriesBetween(deps, dateKey(addDays(gridStart, -7)), dateKey(gridEnd));
  const tz = config.timezone;
  const spans = entries.map((e) => ({
    ...e,
    startKey: dateKey(tzParts(e.shift.start, tz)),
    endKey: dateKey(tzParts(e.shift.end, tz)),
  }));
  const todayKey = dateKey(tzParts(new Date(), tz));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(gridStart, w * 7 + d);
      const key = dateKey(date);
      const items = spans.filter((s) => key >= s.startKey && key <= s.endKey)
        .map((span) => ({ entry: span, isStart: span.startKey === key, isEnd: span.endKey === key }));
      days.push({
        key, day: date.day, inMonth: date.month === month, today: key === todayKey, items,
        entry: items[0]?.entry ?? null, isStart: items[0]?.isStart ?? false, isEnd: items[0]?.isEnd ?? false,
      });
    }
    if (w === 5 && !days.some((d) => d.inMonth)) break;
    weeks.push(days);
  }
  return { year, month, weeks, entries: spans.filter((s) => s.endKey >= dateKey(firstDay) && s.startKey <= dateKey(lastDay)) };
}

// ---------- iCalendar feed ----------

/** The secret part of the feed URL. Changing SESSION_SECRET changes it. */
export const feedToken = () =>
  crypto.createHmac('sha256', config.sessionSecret).update('calendar-feed-v1').digest('base64url').slice(0, 32);

const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (v) => String(v).replace(/\r\n|\r/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export async function icsFeed(deps) {
  const today = tzParts(new Date(), config.timezone);
  const entries = await entriesBetween(deps, dateKey(addDays(today, -56)), dateKey(addDays(today, 7 * 26)));
  const stamp = icsDate(new Date());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${config.appName}//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`${config.teamName} on-call`)}`, 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const e of entries) {
    const who = e.people.map((p) => p.name).join(' & ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:oncall-${e.shift.key}@pagerdiem`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.shift.start)}`,
      `DTEND:${icsDate(e.shift.end)}`,
      `SUMMARY:${icsText(who ? `📟 On call: ${who}` : '📟 On call: needs cover')}`,
      `DESCRIPTION:${icsText(`${who || 'Nobody yet'} on call this weekend.${e.needsCover ? ' Needs cover — add yourself in PagerDiem.' : ''}\n${config.publicUrl}/calendar`)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

