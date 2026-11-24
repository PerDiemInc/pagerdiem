// The phone app's JSON API (/api/app/*): sign-in by pairing code, bearer tokens, and every screen's data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.ALLOWED_EMAIL_DOMAINS = 'example.com';

const { freshDb } = await import('./helpers.js');
const { createApp } = await import('../src/app.js');
const { pairingCode } = await import('../src/devices.js');
const { signPayload } = await import('../src/auth.js');
const { config } = await import('../src/config.js');

let app, base, db;
const sent = [];
const pushed = [];
const people = {};

before(async () => {
  db = await freshDb();
  config.slack.channel = 'CONCALL'; // so channel posts are sent and recorded, as on a real server
  app = createApp({ db, notifierOverrides: {
    slack: async (to, text) => { sent.push({ ch: 'slack', to, text }); },
    push: async (device, payload) => { pushed.push({ device, payload }); },
  } });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://localhost:${app.server.address().port}`;
  for (const [name, role] of [['Ana', 'engineer'], ['Ben', 'engineer'], ['Cal', 'engineer'], ['Iris', 'admin']]) {
    await db.run(`INSERT INTO users (name, email, password_hash, slack_user_id, whatsapp, role, is_admin, rotation_order)
      VALUES (?, ?, 'x', ?, ?, ?, ?, ?)`, [name, `${name.toLowerCase()}@example.com`, `U${name.toUpperCase()}000000`,
      `+1555000${String(name.charCodeAt(0)).padStart(4, '0')}`, role, role === 'admin' ? 1 : 0, await app.rotation.nextRotationOrder()]);
    people[name.toLowerCase()] = await db.get('SELECT * FROM users WHERE name = ?', [name]);
  }
});
after(() => app.server.close());

const headers = (token) => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const postJson = (path, body, token) => fetch(base + path, { method: 'POST', headers: headers(token), body: JSON.stringify(body ?? {}) });
const getJson = (path, token) => fetch(base + path, { headers: headers(token) });
async function signIn(user, platform = 'ios') {
  const res = await postJson('/api/app/pair', { code: pairingCode(user.id), platform, deviceName: `${user.name}'s phone` });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

test('a pairing code signs a phone in once', async () => {
  const code = pairingCode(people.ana.id);
  let res = await postJson('/api/app/pair', { code, platform: 'ios', deviceName: 'Ana’s iPhone' });
  assert.equal(res.status, 200);
  const { token, me } = await res.json();
  assert.ok(token.length >= 40);
  assert.equal(me.user.email, 'ana@example.com');
  assert.equal(me.user.initials, 'A');
  assert.equal(me.device.platform, 'ios');
  assert.equal(me.device.pushReady, false);
  assert.equal(me.team.timezone, 'America/New_York');
  assert.match(me.calendarFeedUrl, /\/calendar\.ics\?token=/);
  const stored = await db.get('SELECT * FROM devices WHERE user_id = ?', [people.ana.id]);
  assert.notEqual(stored.token_hash, token, 'only a hash of the token is stored');

  res = await postJson('/api/app/pair', { code, platform: 'ios', deviceName: 'again' });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /expired or was already used/);
});

test('a pairing code older than 10 minutes is refused', async () => {
  const old = signPayload({ uid: people.ana.id, nonce: 'n1' }, -1); // ttl in the past: already expired
  assert.equal((await postJson('/api/app/pair', { code: old, platform: 'android', deviceName: 'Pixel' })).status, 401);
  assert.equal((await postJson('/api/app/pair', { code: pairingCode(people.ana.id), platform: 'windows' })).status, 400);
});

test('removed teammates and signed-out phones get 401 everywhere', async () => {
  const token = await signIn(people.ben);
  assert.equal((await getJson('/api/app/me', token)).status, 200);
  await db.run('UPDATE users SET active = 0 WHERE id = ?', [people.ben.id]);
  assert.equal((await getJson('/api/app/me', token)).status, 401);
  assert.equal((await postJson('/api/app/device', { pushToken: 'x' }, token)).status, 401);
  assert.equal((await postJson('/api/app/pair', { code: pairingCode(people.ben.id), platform: 'ios' })).status, 401, 'a removed teammate cannot pair');
  await db.run('UPDATE users SET active = 1 WHERE id = ?', [people.ben.id]);

  const second = await signIn(people.ben);
  assert.equal((await postJson('/api/app/signout', {}, second)).status, 204);
  assert.equal((await getJson('/api/app/me', second)).status, 401);
  assert.equal((await getJson('/api/app/me', token)).status, 200, 'signing out one phone leaves the others signed in');
});

test('POST /api/app/device stores the push token and checks', async () => {
  const token = await signIn(people.cal, 'android');
  const res = await postJson('/api/app/device', { pushToken: 'fcm-token-1', checks: { notifications: true, dndAccess: true, bogus: true } }, token);
  assert.equal(res.status, 200);
  const device = await res.json();
  assert.equal(device.pushReady, true);
  assert.deepEqual(device.checks, { notifications: true, focus: false, ringer: false, fullScreen: false, dndAccess: true });

  // A reinstall gets a new sign-in but the same push token: only the newest row keeps it.
  const again = await signIn(people.cal, 'android');
  await postJson('/api/app/device', { pushToken: 'fcm-token-1' }, again);
  assert.equal((await db.all("SELECT id FROM devices WHERE push_token = 'fcm-token-1'")).length, 1);
});

test('requests without a bearer token get 401 JSON, not a redirect', async () => {
  const res = await fetch(base + '/api/app/me', { redirect: 'manual' });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal((await getJson('/api/app/me', 'not-a-real-token')).status, 401);
});

test('signup from the app adds the person and signs the phone in', async () => {
  const pending = signPayload({ email: 'nia@example.com', name: 'Nia Lee' }, 1800);
  const body = { pending, name: 'Nia Lee', slack: 'U0NIA12345', phone: '', platform: 'ios', deviceName: 'Nia’s iPhone' };
  let res = await postJson('/api/app/signup', body);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Please enter your phone number with country code, e.g. +1 415 555 0123.', field: 'phone' });

  res = await postJson('/api/app/signup', { ...body, phone: '+1 415 555 0177' });
  assert.equal(res.status, 201);
  const { token, me } = await res.json();
  assert.equal(me.user.email, 'nia@example.com');
  assert.equal(me.user.initials, 'NL');
  assert.equal(me.user.phone, '+14155550177');
  assert.equal((await getJson('/api/app/me', token)).status, 200);

  assert.equal((await postJson('/api/app/signup', { ...body, pending: 'garbage', phone: '+14155550178' })).status, 401);
});

test('a test call rings only this phone, and answering it marks the phone tested', async () => {
  const token = await signIn(people.iris);
  let res = await postJson('/api/app/device/test-call', {}, token);
  assert.equal(res.status, 409, 'nothing to ring before the phone sends its push token');
  await postJson('/api/app/device', { pushToken: 'voip-iris' }, token);
  const other = await signIn(people.iris);
  await postJson('/api/app/device', { pushToken: 'voip-iris-2' }, other);

  pushed.length = 0;
  res = await postJson('/api/app/device/test-call', {}, token);
  assert.equal(res.status, 200);
  const { callId } = await res.json();
  assert.deepEqual(pushed.map((p) => [p.device.push_token, p.payload.type, p.payload.callId]), [['voip-iris', 'test', callId]]);

  assert.equal((await postJson('/api/app/device/test-call/answered', { callId: '00000000-0000-4000-8000-000000000000' }, token)).status, 409);
  assert.equal((await postJson('/api/app/device/test-call/answered', { callId }, other)).status, 409, "another phone can't answer it");
  res = await postJson('/api/app/device/test-call/answered', { callId }, token);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).testedAt);
});

test('incidents from the phone: page, post, list, detail, acknowledge at once, notes', async () => {
  const ben = await signIn(people.ben);
  const ana = await signIn(people.ana);
  const cal = await signIn(people.cal);
  let res = await postJson('/api/app/incidents', { title: '  ', mode: 'call' }, ben);
  assert.equal(res.status, 400);
  res = await postJson('/api/app/incidents', { title: 'Menu sync slow', details: 'Three stores', mode: 'post' }, ben);
  assert.equal(res.status, 201);
  const posted = await res.json();
  assert.equal(posted.incident.quiet, true);
  assert.deepEqual(posted.paged, []);
  assert.equal(posted.incident.createdBy.name, 'Ben');
  res = await postJson('/api/app/incidents', { title: 'Orders not printing', mode: 'call' }, ben);
  assert.equal(res.status, 201);
  const { incident } = await res.json();

  const list = await (await getJson('/api/app/incidents', ben)).json();
  assert.ok(list.incidents.some((i) => i.id === incident.id && i.status === 'open'));
  assert.ok(list.stats.open >= 2);
  assert.equal(list.recentTitles[0], 'Orders not printing');
  assert.deepEqual((await (await getJson('/api/app/incidents?status=resolved', ben)).json()).incidents, []);

  const detail = await (await getJson(`/api/app/incidents/${posted.incident.id}`, ben)).json();
  assert.equal(detail.incident.details, 'Three stores');
  assert.ok(detail.feed.some((f) => f.kind === 'event' && /Triggered via app by Ben/.test(f.text)));
  assert.ok(Array.isArray(detail.reached) && detail.reached.length >= 1);
  assert.ok(Array.isArray(detail.escalation) && detail.escalation.length >= 1);
  assert.equal((await getJson('/api/app/incidents/999999', ben)).status, 404);
  assert.equal((await getJson('/api/app/incidents/abc', ben)).status, 404);

  sent.length = 0;
  const acks = await Promise.all([ana, cal].map((t) => postJson(`/api/app/incidents/${incident.id}/ack`, { via: 'call' }, t)));
  assert.deepEqual(acks.map((r) => r.status), [200, 200]);
  const bodies = await Promise.all(acks.map((r) => r.json()));
  assert.equal(bodies.filter((b) => b.changed).length, 1, 'first acknowledgement wins');
  assert.ok(bodies.every((b) => b.incident.status === 'acknowledged'));
  assert.equal(sent.filter((m) => /acknowledged by/.test(m.text)).length, 1, '#on-call hears it once');

  const nia = await (async () => {
    const r = await postJson('/api/app/signup', { pending: signPayload({ email: 'zed@example.com', name: 'Zed' }, 60), name: 'Zed', slack: 'U0ZED12345', phone: '+14155550190', platform: 'android' });
    return (await r.json()).token;
  })();
  assert.equal((await postJson(`/api/app/incidents/${incident.id}/resolve`, {}, nia)).status, 403, 'non-technical people cannot resolve');

  res = await postJson(`/api/app/incidents/${incident.id}/notes`, { text: 'Printer driver crashed' }, ben);
  assert.equal(res.status, 201);
  const note = await res.json();
  assert.equal(note.kind, 'note');
  assert.equal(note.author.name, 'Ben');
  assert.equal((await postJson(`/api/app/incidents/${incident.id}/resolve`, {}, ana)).status, 200);
  assert.equal((await postJson(`/api/app/incidents/${incident.id}/notes`, { text: 'late' }, ben)).status, 409);
  assert.equal((await postJson(`/api/app/incidents/${incident.id}/call-again`, {}, ana)).status, 409);
});

test('weekends from the phone: ask for cover, swap with undo, leave and join', async () => {
  const ben = await signIn(people.ben);
  const cal = await signIn(people.cal);
  const schedule = await (await getJson('/api/app/schedule', ben)).json();
  assert.equal(schedule.weekends.length, 12);
  assert.deepEqual(Object.keys(schedule.coverage).sort(), ['days', 'end', 'start', 'weekdayCount', 'weekendCount']);
  const future = schedule.weekends.filter((w) => new Date(w.start) > new Date());
  const bensOnly = future.find((w) => w.mine && !w.people.some((p) => p.id === people.cal.id));
  assert.ok(bensOnly, 'a future weekend with Ben and without Cal');

  sent.length = 0;
  let res = await postJson(`/api/app/weekends/${bensOnly.key}/ask-cover`, {}, ben);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, message: 'Asked for cover in #on-call' });
  assert.ok(sent.some((m) => /^:sos: /.test(m.text)));

  res = await postJson(`/api/app/weekends/${bensOnly.key}/swap`, { userId: people.ben.id }, cal);
  assert.equal(res.status, 200);
  const swap = await res.json();
  assert.equal(swap.undo.ids.length, 1);
  assert.ok(Math.abs(new Date(swap.undo.until) - Date.now() - 10_000) < 3_000, 'undo for 10 seconds');
  res = await postJson('/api/app/swaps/undo', { ids: swap.undo.ids }, cal);
  assert.equal((await res.json()).message, 'Swap undone. Nothing changed and nobody was notified.');

  res = await postJson(`/api/app/weekends/${bensOnly.key}/leave`, {}, ben);
  assert.match((await res.json()).message, /^You're off /);
  res = await postJson(`/api/app/weekends/${bensOnly.key}/join`, {}, ben);
  assert.match((await res.json()).message, /^You're on call for /);
  assert.equal((await postJson('/api/app/weekends/not-a-date/join', {}, ben)).status, 400);
});

test('team, profile and settings from the phone; admin actions are admin-only', async () => {
  const ben = await signIn(people.ben);
  const iris = await signIn(people.iris);
  const team = await (await getJson('/api/app/team', ben)).json();
  const byName = Object.fromEntries(team.members.map((m) => [m.name, m]));
  assert.equal(byName.Iris.app, 'woken', 'Iris answered a test call');
  assert.equal(byName.Cal.app, 'focus-risk', 'Cal has the app but never tested it');
  assert.equal(byName.Ana.app, 'none');
  assert.deepEqual(team.inactive, [], 'only admins see removed people');
  assert.match(team.signupUrl, /\/login$/);

  assert.equal((await postJson(`/api/app/team/${people.ana.id}/role`, { role: 'admin' }, ben)).status, 403);
  let res = await postJson(`/api/app/team/${people.ben.id}/role`, { role: 'admin' }, iris);
  assert.deepEqual(await res.json(), { ok: true, message: 'Ben is now admin.' });
  await postJson(`/api/app/team/${people.ben.id}/role`, { role: 'engineer' }, iris);
  assert.equal((await postJson(`/api/app/team/${people.iris.id}/active`, { active: false }, iris)).status, 409, 'the last admin stays');

  res = await postJson('/api/app/coverage', { days: [], start: '18:00', end: '09:00', weekendCount: 2, weekdayCount: 2 }, iris);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Pick at least one day that needs someone on call.');
  assert.ok([200, 409].includes((await postJson('/api/app/resend-weekend-start', {}, iris)).status));

  res = await postJson('/api/app/profile', { name: 'Ben Carter', slack: 'UBEN000000', phone: '(415) 555-0101' }, ben);
  assert.equal(res.status, 200);
  const me = await res.json();
  assert.equal(me.user.name, 'Ben Carter');
  assert.equal(me.user.phone, '+14155550101');
  res = await postJson('/api/app/profile', { name: 'Ben Carter', slack: 'UBEN000000', phone: people.ana.whatsapp }, ben);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'phone');
});

test('home and activity from the phone', async () => {
  const ben = await signIn(people.ben);
  const home = await (await getJson('/api/app/home', ben)).json();
  assert.deepEqual(Object.keys(home).sort(), ['comingUp', 'needsYou', 'next', 'now', 'onCall']);
  const activity = await (await getJson('/api/app/activity', ben)).json();
  const texts = activity.items.map((i) => i.text);
  assert.ok(texts.some((t) => /answered a test call/.test(t)));
  assert.ok(texts.some((t) => /acknowledged #\d+ Orders not printing/.test(t)));
  assert.ok(texts.some((t) => /made Ben an admin/.test(t)));
  assert.ok(texts.some((t) => /asked for cover/.test(t)));
  const ats = activity.items.map((i) => i.at);
  assert.deepEqual(ats, [...ats].sort().reverse(), 'newest first');
});

test('trading weekends from the phone, with undo', async () => {
  const ben = await signIn(people.ben);
  const { weekends } = await (await getJson('/api/app/schedule', ben)).json();
  const future = weekends.filter((w) => new Date(w.start) > new Date());
  const has = (w, p) => w.people.some((x) => x.id === p.id);
  const mine = future.find((w) => has(w, people.ben) && !has(w, people.cal));
  const theirs = future.find((w) => has(w, people.cal) && !has(w, people.ben));
  assert.ok(mine && theirs);
  let res = await postJson(`/api/app/weekends/${mine.key}/trade`, { theirKey: theirs.key, userId: people.cal.id }, ben);
  assert.equal(res.status, 200);
  const trade = await res.json();
  assert.match(trade.message, /^Swapped\. You take /);
  assert.equal(trade.undo.ids.length, 2);
  res = await postJson('/api/app/swaps/undo', { ids: trade.undo.ids }, ben);
  assert.equal((await res.json()).message, 'Swap undone. Nothing changed and nobody was notified.');
  assert.equal((await postJson(`/api/app/weekends/${mine.key}/trade`, { theirKey: mine.key, userId: people.cal.id }, ben)).status, 409);
});

test("non-technical people can't read the team's phone numbers", async () => {
  const res = await postJson('/api/app/signup', { pending: signPayload({ email: 'ola@example.com', name: 'Ola' }, 60), name: 'Ola', slack: 'U0OLA12345', phone: '+14155550191', platform: 'ios' });
  const { token, me } = await res.json();
  assert.equal(me.user.role, 'non_technical');
  assert.equal((await getJson('/api/app/team', token)).status, 403);
});
