// Server replies for screen tests: Ben (an engineer) on Acme Engineering, in New York time.
import type { Home, IncidentDetail, IncidentSummary, Me, Person, Role, TeamMember, Weekend } from '@/lib/api';

export const NOW = '2026-12-12T16:00:00.000Z'; // Saturday 11:00 AM in New York

export const ben: Person = { id: 1, name: 'Ben Carter', initials: 'BC', role: 'engineer' };
export const ana: Person = { id: 2, name: 'Ana Gomez', initials: 'AG', role: 'engineer' };
export const eli: Person = { id: 3, name: 'Eli Brooks', initials: 'EB', role: 'engineer' };
export const fay: Person = { id: 4, name: 'Fay Kim', initials: 'FK', role: 'engineer' };

export function me(checks: Partial<Me['device']['checks']> = {}, role: Role = 'engineer'): Me {
  return {
    user: { ...ben, role, email: 'ben@example.com', slack: 'UBEN', phone: '+14155550101' },
    team: { appName: 'PagerDiem', teamName: 'Acme Engineering', timezone: 'America/New_York', publicUrl: 'https://pd.example.com', slackChannelName: 'on-call' },
    coverage: { days: [0, 5, 6], start: '18:00', end: '09:00', weekendCount: 2, weekdayCount: 1 },
    calendarFeedUrl: 'https://pd.example.com/calendar.ics?token=t',
    device: {
      id: 1, platform: 'ios', pushReady: true, testedAt: '2026-12-10T15:00:00.000Z',
      checks: { notifications: true, focus: true, ringer: true, fullScreen: true, dndAccess: true, ...checks },
    },
  };
}

export const weekend = (start: string, end: string, people: Person[], extra: Partial<Weekend> = {}): Weekend => ({
  key: start.slice(0, 10), start, end, people, count: 2, needsCover: people.length < 2, mine: people.some((p) => p.id === ben.id), ...extra,
});
export const thisWeekend = (people: Person[]) => weekend('2026-12-11T23:00:00.000Z', '2026-12-14T14:00:00.000Z', people);
export const dec18 = weekend('2026-12-18T23:00:00.000Z', '2026-12-21T14:00:00.000Z', [eli, fay]);
export const jan8 = weekend('2027-01-08T23:00:00.000Z', '2027-01-11T14:00:00.000Z', [ben, ana]);

export function incident(id: number, title: string, extra: Partial<IncidentSummary> = {}): IncidentSummary {
  return {
    id, title, status: 'open', source: 'web', quiet: false, createdAt: NOW, createdBy: null, assigned: null,
    ackedBy: null, ackedAt: null, resolvedAt: null, repeats: 0, ...extra,
  };
}

export function home(extra: Partial<Home> = {}): Home {
  return {
    now: NOW,
    onCall: { people: [ben, ana], start: '2026-12-11T23:00:00.000Z', until: '2026-12-14T14:00:00.000Z', backup: eli },
    next: dec18, needsYou: [], comingUp: [dec18, jan8], ...extra,
  };
}

export const minutesBefore = (minutes: number) => new Date(new Date(NOW).getTime() - minutes * 60_000).toISOString();

/** Fake only the clock, so the screen's "now" is NOW while promises and timers run for real. */
export function freezeClock(at = NOW) {
  jest.useFakeTimers({
    now: new Date(at),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'performance'],
  });
}

/** Incident #14, paged from Slack by Hana 6 min 12 s before NOW, ringing Ben and Ana, Eli the backup. */
export function detail(extra: Partial<IncidentDetail['incident']> = {}): IncidentDetail {
  const createdAt = new Date(new Date(NOW).getTime() - 372_000).toISOString();
  const hana: Person = { id: 5, name: 'Hana Ito', initials: 'HI', role: 'non_technical' };
  return {
    incident: {
      ...incident(14, 'Checkout failing for all stores', { source: 'slack', createdBy: hana, createdAt, repeats: 6 }),
      details: 'Checkout returns 502 for every store since 10:30 AM.', backup: eli, escalationLevel: 0, ...extra,
    },
    feed: [
      { at: createdAt, kind: 'event', text: 'Hana Ito paged on-call from Slack', author: null },
      { at: createdAt, kind: 'note', text: 'Square’s status page shows a partial outage.', author: hana },
    ],
    reached: [
      { at: createdAt, channel: 'push', recipient: 'Ben Carter', status: 'sent' },
      { at: createdAt, channel: 'slack', recipient: 'Ana Gomez', status: 'sent' },
      { at: createdAt, channel: 'slack', recipient: '#on-call', status: 'sent' },
    ],
    escalation: [
      { at: createdAt, label: 'Call Ben Carter and Ana Gomez', state: 'done' },
      { at: createdAt, label: 'Rings through Do Not Disturb', state: 'done' },
      { at: createdAt, label: 'Call Eli Brooks, the backup', state: 'next' },
      { at: createdAt, label: '@channel in #on-call', state: 'later' },
    ],
    onCall: [ben, ana],
  };
}

export const cal: Person = { id: 6, name: 'Cal Reyes', initials: 'CR', role: 'engineer' };
export const dee: Person = { id: 7, name: 'Dee Patel', initials: 'DP', role: 'engineer' };
export const dec25 = weekend('2026-12-25T23:00:00.000Z', '2026-12-28T14:00:00.000Z', [cal, dee]);

export const member = (p: Person, order: number, app: TeamMember['app'], nextWeekend: string | null = null): TeamMember => ({
  ...p, email: `${p.name.split(' ')[0].toLowerCase()}@example.com`, phone: '+14155550100', slack: null, order, nextWeekend, app,
});
