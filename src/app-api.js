// How the phone app's JSON API (/api/app/*, routes in src/routes/app/) shapes its replies: people,
// incidents, weekends, the On call screen, the escalation plan and the activity log.
import { config } from './config.js';
import * as calendar from './calendar.js';
import { pairingCode } from './devices.js';
import { signPayload } from './auth.js';
import { formatRange } from './time.js';

const MINUTE = 60_000;
const VIA = { 'phone call': 'app', app: 'app', slack: 'slack', web: 'web', api: 'api' };

const initialsOf = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

export const toPerson = (u) => (u ? { id: Number(u.id), name: u.name, initials: initialsOf(u.name), role: u.role } : null);

/**
 * Where Google sign-in from the phone app ends: a pagerdiem://connect link the app opens.
 * Someone already on the team gets a pairing code; someone new gets a signed sign-up to finish
 * in the app (name, Slack, phone); a failure gets the message to show.
 */
export function appSignInRedirect({ publicUrl, user, identity, error, challenge }) {
  if (error) return `pagerdiem://connect?error=${encodeURIComponent(error)}`;
  const server = `server=${encodeURIComponent(publicUrl)}`;
  if (user) return `pagerdiem://connect?${server}&code=${encodeURIComponent(pairingCode(user.id, { challenge }))}`;
  const pending = signPayload({ ...identity, ...(challenge ? { ch: challenge } : {}) }, 1800);
  return `pagerdiem://connect?${server}&pending=${encodeURIComponent(pending)}`;
}

/** Newest first: [{ at, text, via, icon }]. */
export async function activityFeed({ db, rotation, shifts, limit = 200 }) {
  const items = [];
  for (const l of await rotation.log({ limit })) {
    const range = formatRange(shifts.forKey(l.weekend_key), config.timezone);
    if (l.action === 'swap') {
      items.push({ at: l.at, text: `${l.user_name} took ${l.other_name}'s spot for ${range}${l.undone_at ? ' (undone)' : ''}`, via: null, icon: 'swap' });
    } else {
      items.push({ at: l.at, text: `${l.user_name} ${l.action === 'join' ? 'added themselves to' : 'left'} ${range}`, via: null, icon: l.action });
    }
  }
  const handled = await db.all(`SELECT e.at, e.message, i.id, i.title FROM incident_events e JOIN incidents i ON i.id = e.incident_id
    WHERE e.message LIKE 'Acknowledged by %' OR e.message LIKE 'Resolved by %' ORDER BY e.id DESC LIMIT ?`, [limit]);
  for (const e of handled) {
    const m = /^(Acknowledged|Resolved) by (.+) via (.+)$/.exec(e.message);
    if (!m) continue;
    const verb = m[1] === 'Acknowledged' ? 'acknowledged' : 'resolved';
    items.push({ at: e.at, text: `${m[2]} ${verb} #${e.id} ${e.title}`, via: VIA[m[3]] ?? null, icon: verb === 'acknowledged' ? 'ack' : 'resolve' });
  }
  for (const a of await db.all('SELECT at, via, icon, text FROM admin_log ORDER BY id DESC LIMIT ?', [limit])) {
    items.push({ at: a.at, text: a.text, via: a.via ?? null, icon: a.icon });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

export const joinNames = (people) => (people.length < 2 ? people.map((p) => p.name).join('')
  : `${people.slice(0, -1).map((p) => p.name).join(', ')} and ${people[people.length - 1].name}`);

/** Incident rows as the phone app's IncidentSummary. */
export async function toIncidents(db, rows) {
  if (!rows.length) return [];
  const users = new Map((await db.all('SELECT id, name, role FROM users')).map((u) => [Number(u.id), u]));
  const repeats = new Map((await db.all(`SELECT incident_id, COUNT(*) AS n FROM incident_events
    WHERE message LIKE 'Same alert again%' GROUP BY incident_id`)).map((r) => [Number(r.incident_id), Number(r.n)]));
  const person = (id) => toPerson(users.get(Number(id)));
  return rows.map((row) => ({
    id: Number(row.id), title: row.title, status: row.status, source: row.source, quiet: Boolean(Number(row.quiet)),
    createdAt: row.created_at, createdBy: person(row.created_by), assigned: person(row.assigned_user_id),
    ackedBy: person(row.acked_by), ackedAt: row.acked_at ?? null, resolvedAt: row.resolved_at ?? null,
    repeats: repeats.get(Number(row.id)) ?? 0,
  }));
}

export const toWeekend = (entry, user) => ({
  key: entry.shift.key, start: entry.shift.start.toISOString(), end: entry.shift.end.toISOString(),
  people: entry.people.map(toPerson), count: entry.shift.count, needsCover: Boolean(entry.needsCover),
  mine: entry.people.some((p) => p.id === user.id),
});

/** The On call screen: who's on call now (or nothing on a weekday), what's next, and what needs you. */
export async function buildHome({ db, shifts, rotation, incidents, user, now = new Date() }) {
  const running = await rotation.onCallNow(now);
  const onCall = running?.people.length ? {
    people: running.people.map(toPerson), start: running.shift.start.toISOString(), until: running.shift.end.toISOString(),
    backup: toPerson(await rotation.backupFor(running.shift)),
  } : null;
  const comingUp = (await rotation.schedule(onCall ? shifts.next(now) : shifts.currentOrNext(now), 4)).map((e) => toWeekend(e, user));
  const unresolved = (await incidents.list({ limit: 20 })).filter((i) => i.status !== 'resolved');
  return { now: now.toISOString(), onCall, next: comingUp[0] ?? null, needsYou: await toIncidents(db, unresolved), comingUp };
}

/**
 * The Escalation tab: each step paging takes, with its time and whether it's done, next,
 * later, or skipped (paging stopped before it). `who` is incidents.responsibleFor(inc).
 */
export function escalationPlan(inc, now, who) {
  const t0 = new Date(inc.created_at).getTime();
  const at = (min) => new Date(t0 + min * MINUTE).toISOString();
  const channel = `#${config.slack.channelName}`;
  const stopped = inc.status !== 'open';
  if (Number(inc.quiet)) return [{ at: at(0), label: `Posted in ${channel}, nobody called`, state: 'done' }];
  const { secondCallAfterMinutes: second, repageEveryMinutes: repage, escalateAfterMinutes: escalate } = config;
  if (!who) {
    return [
      { at: at(0), label: `@here in ${channel}`, state: 'done' },
      { at: at(2 * escalate), label: `Remind ${channel} every ${2 * escalate} min`, state: stopped ? 'skipped' : 'next' },
    ];
  }
  const level = Number(inc.escalation_level);
  const age = (now - t0) / MINUTE;
  const steps = [
    { at: at(0), label: `Call ${joinNames(who.responders)}`, done: true },
    { at: at(0), label: `Slack DMs and ${channel} post`, done: true },
    { at: at(second), label: 'Rings through Do Not Disturb', done: age >= second },
    { at: at(repage), label: `Keep calling every ${repage} min`, done: level >= 1 },
    who.backup ? { at: at(escalate), label: `Call ${who.backup.name}, the backup`, done: level >= 1 }
      : { at: at(escalate), label: 'Call the backup', skip: true },
    { at: at(2 * escalate), label: `@channel in ${channel}`, done: level >= 2 },
    { at: at(2 * escalate), label: 'Then keep calling everyone', done: false },
  ];
  let nextFound = false;
  return steps.map(({ done, skip, ...step }) => {
    if (done) return { ...step, state: 'done' };
    if (skip || stopped) return { ...step, state: 'skipped' };
    if (nextFound) return { ...step, state: 'later' };
    nextFound = true;
    return { ...step, state: 'next' };
  });
}

/** One incident row as an IncidentSummary. */
export const incidentSummary = async (db, row) => (await toIncidents(db, [row]))[0];

/** The reply to a change: its message, and how to undo it when it can be (swaps and trades). */
export const done = (result) => ({ ok: true, message: result.message, ...(result.undo ? { undo: result.undo } : {}) });

/** Who's signed in on this phone, their team, and the phone itself (GET /api/app/me). */
export function appMe({ shifts, devices }, user, device) {
  return {
    user: { ...toPerson(user), email: user.email, slack: user.slack_user_id ?? null, phone: user.whatsapp },
    team: {
      appName: config.appName, teamName: config.teamName, timezone: config.timezone,
      publicUrl: config.publicUrl, slackChannelName: config.slack.channelName,
    },
    coverage: shifts.coverage(),
    calendarFeedUrl: `${config.publicUrl}/calendar.ics?token=${calendar.feedToken()}`,
    device: devices.toJson(device),
  };
}
