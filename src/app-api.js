// JSON API for the PagerDiem phone app (/api/app/*). Phones authenticate with a bearer token
// from POST /api/app/pair; app.js resolves it into ctx.user and ctx.device.
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';
import * as calendar from './calendar.js';
import { PLATFORMS, pairingCode, redeemPairingCode, verifierMatches } from './devices.js';
import { signPayload, readPayload } from './auth.js';
import { REMOVED, record } from './actions.js';
import { isResponder } from './roles.js';
import { formatRange } from './time.js';

const MINUTE = 60_000;
const VIA = { 'phone call': 'app', app: 'app', slack: 'slack', web: 'web', api: 'api' };

function requireAppUser(ctx) {
  if (!ctx.user || !ctx.device) throw new HttpError(401, 'Sign in again');
}

const initialsOf = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

const toPerson = (u) => (u ? { id: Number(u.id), name: u.name, initials: initialsOf(u.name), role: u.role } : null);

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

const TEST_CALL_MS = 10 * 60_000;

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

const joinNames = (people) => (people.length < 2 ? people.map((p) => p.name).join('')
  : `${people.slice(0, -1).map((p) => p.name).join(', ')} and ${people[people.length - 1].name}`);

/** Incident rows as the phone app's IncidentSummary. */
async function toIncidents(db, rows) {
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

const toWeekend = (entry, user) => ({
  key: entry.shift.key, start: entry.shift.start.toISOString(), end: entry.shift.end.toISOString(),
  people: entry.people.map(toPerson), count: entry.shift.count, needsCover: Boolean(entry.needsCover),
  mine: entry.people.some((p) => p.id === user.id),
});

/** The On call screen: who's on call now (or nothing on a weekday), what's next, and what needs you. */
export async function buildHome({ db, shifts, rotation, incidents, user, now = new Date() }) {
  const running = await rotation.onCallNow(now);
  const onCall = running?.people.length ? {
    people: running.people.map(toPerson), until: running.shift.end.toISOString(), backup: toPerson(await rotation.backupFor(running.shift)),
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

export function registerAppApi({ router, db, shifts, rotation, incidents, actions, devices, notify }) {
  // Test calls waiting to be answered: callId -> { deviceId, at }. Kept in memory: a restart
  // only means pressing "Ring me now" again.
  const testCalls = new Map();

  function me(user, device) {
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

  // ---------- sign-in ----------
  router.post('/api/app/pair', async (ctx) => {
    const { code, platform, deviceName } = ctx.body;
    if (!PLATFORMS.includes(platform)) throw new HttpError(400, 'Unknown platform. Use ios or android.');
    const userId = await redeemPairingCode(db, String(code || ''), ctx.body.verifier);
    const user = userId ? await rotation.userById(userId) : null;
    if (!user) throw new HttpError(401, 'This code has expired or was already used. Make a new one on the Team page.');
    if (!user.active) throw new HttpError(401, REMOVED);
    const { device, token } = await devices.create(user.id, { platform, name: deviceName });
    ctx.r.json({ token, me: me(user, device) });
  });

  // Finish a Google sign-up started in the app: the same checks as the web's welcome page.
  router.post('/api/app/signup', async (ctx) => {
    const { pending, name, slack, phone, platform, deviceName } = ctx.body;
    if (!PLATFORMS.includes(platform)) throw new HttpError(400, 'Unknown platform. Use ios or android.');
    const identity = readPayload(String(pending || ''));
    if (!identity?.email || (identity.ch && !verifierMatches(identity.ch, ctx.body.verifier))) {
      throw new HttpError(401, 'This sign-up has expired. Sign in with Google again.');
    }
    const { user, error } = await actions.createMember({ name, email: identity.email, slack, whatsapp: phone, passwordHash: 'google' });
    if (error) throw new HttpError(400, error.message, error.field === 'whatsapp' ? 'phone' : error.field);
    const { device, token } = await devices.create(user.id, { platform, name: deviceName });
    ctx.r.json({ token, me: me(user, device) }, 201);
  });

  router.post('/api/app/signout', async (ctx) => {
    requireAppUser(ctx);
    await devices.revoke(ctx.device.id);
    ctx.r.empty();
  });

  router.get('/api/app/me', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(me(ctx.user, ctx.device));
  });

  router.post('/api/app/device', async (ctx) => {
    requireAppUser(ctx);
    const device = await devices.update(ctx.device.id, { pushToken: ctx.body.pushToken, checks: ctx.body.checks });
    ctx.r.json(devices.toJson(device));
  });

  // ---------- wake-up checks ----------
  router.post('/api/app/device/test-call', async (ctx) => {
    requireAppUser(ctx);
    if (!ctx.device.push_token) throw new HttpError(409, 'This phone has not registered for calls yet. Allow notifications first.');
    const now = new Date();
    for (const [id, t] of testCalls) if (now - t.at > TEST_CALL_MS) testCalls.delete(id);
    const callId = crypto.randomUUID();
    const result = await notify.callDevice(ctx.device, ctx.user, {
      payload: {
        type: 'test', callId, incidentId: '0', title: 'Test call from PagerDiem', reason: 'Answer it to finish the wake-up checks.',
        pagedBy: config.appName, attempt: 1, nextCallAt: '', server: config.publicUrl, sentAt: now.toISOString(),
      },
    });
    if (!result.ok) throw new HttpError(502, `Couldn't reach this phone: ${result.error?.message || 'push failed'}`);
    testCalls.set(callId, { deviceId: ctx.device.id, at: now });
    ctx.r.json({ callId });
  });

  router.post('/api/app/device/test-call/answered', async (ctx) => {
    requireAppUser(ctx);
    const call = testCalls.get(String(ctx.body.callId || ''));
    if (!call || call.deviceId !== ctx.device.id || Date.now() - call.at > TEST_CALL_MS) {
      throw new HttpError(409, 'That test call has expired. Press "Ring me now" again.');
    }
    testCalls.delete(String(ctx.body.callId));
    await devices.markTested(ctx.device.id);
    await record(db, { user: ctx.user, via: 'app', icon: 'test', text: `${ctx.user.name} answered a test call` });
    ctx.r.json(devices.toJson(await devices.get(ctx.device.id)));
  });

  // ---------- screens ----------
  const done = (result) => ({ ok: true, message: result.message, ...(result.undo ? { undo: result.undo } : {}) });
  const requireResponder = (ctx) => {
    if (!isResponder(ctx.user)) throw new HttpError(403, 'Only engineers and admins can do that');
  };
  async function incidentFor(ctx) {
    const id = Number(ctx.params.id);
    const inc = Number.isSafeInteger(id) ? await incidents.get(id) : null;
    if (!inc) throw new HttpError(404, 'Incident not found');
    return inc;
  }
  const summary = async (row) => (await toIncidents(db, [row]))[0];

  router.get('/api/app/home', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(await buildHome({ db, shifts, rotation, incidents, user: ctx.user }));
  });

  router.get('/api/app/incidents', async (ctx) => {
    requireAppUser(ctx);
    const status = ['open', 'acknowledged', 'resolved'].includes(ctx.query.get('status')) ? ctx.query.get('status') : null;
    ctx.r.json({
      incidents: await toIncidents(db, await incidents.list({ limit: 200, status })),
      stats: await incidents.stats(), recentTitles: await incidents.recentTitles(),
    });
  });

  router.get('/api/app/incidents/:id', async (ctx) => {
    requireAppUser(ctx);
    const inc = await incidentFor(ctx);
    const who = await incidents.responsibleFor(inc);
    const feed = [
      ...(await incidents.events(inc.id)).map((e) => ({ at: e.at, kind: 'event', text: e.message, author: null })),
      ...(await incidents.notes(inc.id)).map((n) => ({ at: n.at, kind: 'note', text: n.text, author: toPerson({ id: n.user_id, name: n.user_name, role: n.user_role }) })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const reached = (await db.all('SELECT at, channel, recipient, status FROM notifications WHERE incident_id = ? ORDER BY id', [inc.id]))
      .map((n) => ({ at: n.at, channel: n.channel, recipient: n.recipient, status: n.status }));
    ctx.r.json({
      incident: { ...(await summary(inc)), details: inc.details ?? '', backup: toPerson(await rotation.userById(inc.backup_user_id)), escalationLevel: Number(inc.escalation_level) },
      feed, reached, escalation: escalationPlan(inc, new Date(), who), onCall: (who?.onCallPeople ?? []).map(toPerson),
    });
  });

  router.post('/api/app/incidents', async (ctx) => {
    requireAppUser(ctx);
    const title = String(ctx.body.title || '').trim();
    if (!title) throw new HttpError(400, "Say what's broken.", 'title');
    const inc = await incidents.create({
      title, details: ctx.body.details, source: 'app', createdBy: ctx.user.id, quiet: ctx.body.mode === 'post',
    });
    ctx.r.json({ incident: await summary(inc), paged: inc.paged.map(toPerson) }, 201);
  });

  router.post('/api/app/incidents/:id/ack', async (ctx) => {
    requireAppUser(ctx);
    requireResponder(ctx);
    const inc = await incidentFor(ctx);
    const { changed, incident } = await incidents.acknowledge(inc.id, ctx.user, ctx.body.via === 'call' ? 'phone call' : 'app');
    ctx.r.json({ changed, incident: await summary(incident) });
  });

  router.post('/api/app/incidents/:id/resolve', async (ctx) => {
    requireAppUser(ctx);
    requireResponder(ctx);
    const inc = await incidentFor(ctx);
    const { changed, incident } = await incidents.resolve(inc.id, ctx.user, 'app');
    ctx.r.json({ changed, incident: await summary(incident) });
  });

  router.post('/api/app/incidents/:id/notes', async (ctx) => {
    requireAppUser(ctx);
    const inc = await incidentFor(ctx);
    const note = await incidents.addNote(inc.id, ctx.user, ctx.body.text, 'app');
    ctx.r.json({ at: note.at, kind: 'note', text: note.text, author: toPerson(ctx.user) }, 201);
  });

  router.post('/api/app/incidents/:id/call-again', async (ctx) => {
    requireAppUser(ctx);
    requireResponder(ctx);
    const { paged } = await incidents.callAgain((await incidentFor(ctx)).id, ctx.user);
    ctx.r.json({ ok: true, message: `Calling ${joinNames(paged)} again` });
  });

  router.post('/api/app/incidents/:id/call-backup', async (ctx) => {
    requireAppUser(ctx);
    requireResponder(ctx);
    const { paged } = await incidents.callBackupNow((await incidentFor(ctx)).id, ctx.user);
    ctx.r.json({ ok: true, message: paged.length ? `Calling ${paged[0].name}` : `No backup, so @channel in #${config.slack.channelName}` });
  });

  router.get('/api/app/schedule', async (ctx) => {
    requireAppUser(ctx);
    const weekends = await rotation.schedule(shifts.currentOrNext(new Date()), 12);
    ctx.r.json({ coverage: shifts.coverage(), weekends: weekends.map((e) => toWeekend(e, ctx.user)) });
  });

  const weekendAction = (name) => async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(done(await actions[name](ctx.user, ctx.params.key, 'app')));
  };
  router.post('/api/app/weekends/:key/join', weekendAction('joinWeekend'));
  router.post('/api/app/weekends/:key/leave', weekendAction('leaveWeekend'));
  router.post('/api/app/weekends/:key/ask-cover', weekendAction('askCover'));
  router.post('/api/app/weekends/:key/swap', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(done(await actions.swapWeekend(ctx.user, ctx.params.key, ctx.body.userId, 'app')));
  });
  router.post('/api/app/weekends/:key/trade', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(done(await actions.tradeWeekends(ctx.user, ctx.params.key, ctx.body.theirKey, ctx.body.userId, 'app')));
  });
  router.post('/api/app/swaps/undo', async (ctx) => {
    requireAppUser(ctx);
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
    if (!ids.length) throw new HttpError(400, 'Nothing to undo.');
    ctx.r.json(done(await actions.undoSwap(ctx.user, ids, 'app')));
  });

  router.get('/api/app/team', async (ctx) => {
    requireAppUser(ctx);
    requireResponder(ctx); // phone numbers and emails, like the web Team page
    const schedule = await rotation.schedule(shifts.currentOrNext(new Date()), 12);
    const phones = await db.all('SELECT user_id, push_token, tested_at FROM devices WHERE revoked_at IS NULL');
    const appStatus = (userId) => {
      const ready = phones.filter((d) => Number(d.user_id) === Number(userId) && d.push_token);
      if (ready.some((d) => d.tested_at)) return 'woken';
      return ready.length ? 'focus-risk' : 'none';
    };
    const member = (u) => ({
      ...toPerson(u), email: u.email, phone: u.whatsapp, slack: u.slack_user_id ?? null, order: Number(u.rotation_order),
      nextWeekend: schedule.find((e) => e.people.some((p) => p.id === u.id))?.shift.start.toISOString() ?? null,
      app: appStatus(u.id),
    });
    const inactive = ctx.user.role === 'admin' ? await db.all('SELECT * FROM users WHERE active = 0 ORDER BY name') : [];
    ctx.r.json({ members: (await rotation.activeMembers()).map(member), inactive: inactive.map(member), signupUrl: `${config.publicUrl}/login` });
  });

  router.post('/api/app/team/:id/role', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(done(await actions.setRole(ctx.user, ctx.params.id, ctx.body.role, 'app')));
  });
  router.post('/api/app/team/:id/active', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(done(await actions.setActive(ctx.user, ctx.params.id, Boolean(ctx.body.active), 'app')));
  });
  router.post('/api/app/team/:id/move', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(done(await actions.moveMember(ctx.user, ctx.params.id, ctx.body.dir, 'app')));
  });

  router.post('/api/app/profile', async (ctx) => {
    requireAppUser(ctx);
    const { user, error } = await actions.updateProfile(ctx.user, { name: ctx.body.name, slack: ctx.body.slack, phone: ctx.body.phone });
    if (error) throw new HttpError(400, error.message, error.field);
    ctx.r.json(me(user, ctx.device));
  });

  router.post('/api/app/coverage', async (ctx) => {
    requireAppUser(ctx);
    const { days, start, end, weekendCount, weekdayCount } = ctx.body;
    ctx.r.json(done(await actions.saveCoverage(ctx.user, { days, start, end, weekendCount, weekdayCount }, 'app')));
  });

  router.post('/api/app/resend-weekend-start', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json(done(await actions.resendWeekendStart(ctx.user, 'app')));
  });

  router.get('/api/app/activity', async (ctx) => {
    requireAppUser(ctx);
    ctx.r.json({ items: await activityFeed({ db, rotation, shifts }) });
  });

  return { me };
}
