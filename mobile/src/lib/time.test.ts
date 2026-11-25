import { dateTile, formatAckIn, formatAge, formatClock, formatDate, formatDay, formatDayClock, formatDayLabel, formatLeft, formatMonth, formatRange, formatShiftHours, formatTimer } from './time';

const NY = 'America/New_York';

test('clock times and days are in the team timezone, not the phone one', () => {
  expect(new Date().getTimezoneOffset()).toBe(-300); // the phone is on Pakistan time (UTC+5)
  expect(formatClock('2026-12-12T15:36:00Z', NY)).toBe('10:36 AM');
  expect(formatDay('2026-12-12T15:36:00Z', NY)).toBe('Saturday, December 12');
  expect(formatDayClock('2026-12-14T14:00:00Z', NY)).toBe('Mon 9:00 AM');
  expect(formatDate('2027-01-08T23:00:00Z', NY)).toBe('Jan 8');
  expect(dateTile('2026-12-18T23:00:00Z', NY)).toEqual({ dow: 'FRI', day: '18' });
  expect(formatMonth('2027-01-01T03:00:00Z', NY)).toBe('December'); // still Dec 31 in New York
  const now = new Date('2026-12-12T16:00:00Z');
  expect(formatDayLabel('2026-12-12T15:23:00Z', NY, now)).toBe('Today');
  expect(formatDayLabel('2026-12-12T03:00:00Z', NY, now)).toBe('Yesterday'); // Dec 11, 10 PM in New York
  expect(formatDayLabel('2026-12-10T13:02:00Z', NY, now)).toBe('Thu, Dec 10');
});

test('weekend ranges', () => {
  expect(formatRange('2026-12-18T23:00:00Z', '2026-12-21T14:00:00Z', NY)).toBe('Dec 18 to 21');
  expect(formatRange('2026-12-25T23:00:00Z', '2027-01-01T14:00:00Z', NY)).toBe('Dec 25 to Jan 1');
});

test('the shift hours line from the coverage setting', () => {
  expect(formatShiftHours({ days: [0, 5, 6], start: '18:00', end: '09:00', weekendCount: 2, weekdayCount: 2 })).toBe('Fri 6:00 PM to Mon 9:00 AM');
  expect(formatShiftHours({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30', weekendCount: 1, weekdayCount: 1 })).toBe('Mon 9:00 AM to Fri 5:30 PM');
});

test('time left, timers and how fast someone acknowledged', () => {
  const now = new Date('2026-12-12T15:00:00Z');
  expect(formatLeft('2026-12-14T13:00:00Z', now)).toBe('1 day 22 hr left');
  expect(formatLeft('2026-12-12T18:00:00Z', now)).toBe('3 hr left');
  expect(formatLeft('2026-12-12T15:12:00Z', now)).toBe('12 min left');
  expect(formatTimer(373_000)).toBe('06:13');
  expect(formatTimer(3_729_000)).toBe('1:02:09');
  expect(formatAckIn(4 * 60_000 + 10_000)).toBe('Acknowledged in 4 min');
  expect(formatAckIn(40_000)).toBe('Acknowledged in 40 s');
  expect(formatAge('2026-12-12T14:59:30Z', now)).toBe('just now');
  expect(formatAge('2026-12-12T14:54:00Z', now)).toBe('6 min');
  expect(formatAge('2026-12-12T12:40:00Z', now)).toBe('2 hr');
  expect(formatAge('2026-12-10T12:00:00Z', now)).toBe('2 days');
});
