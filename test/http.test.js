import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.API_TOKEN = 'test-api-token';
process.env.SLACK_SIGNING_SECRET = 'slack-secret';
process.env.ALLOWED_EMAIL_DOMAINS = 'example.com';

const { freshDb } = await import('./helpers.js');
const { createApp } = await import('../src/app.js');
const { readPayload } = await import('../src/auth.js');
const { config } = await import('../src/config.js');

let app, base;
const sent = [];

before(async () => {
  const db = await freshDb();
  app = createApp({
    db,
    notifierOverrides: {
      slack: async (to, text) => { sent.push({ ch: 'slack', to, text }); },
      whatsapp: async (to, text, template) => { sent.push({ ch: 'whatsapp', to, text, template }); },
    },
  });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://localhost:${app.server.address().port}`;
});
after(() => app.server.close());

const form = (obj) => new URLSearchParams(obj).toString();
async function post(path, body, headers = {}) {
  return fetch(base + path, {
    method: 'POST', redirect: 'manual', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  });
}
const cookieOf = (res) => res.headers.getSetCookie().find((c) => c.startsWith('pd_session='))?.split(';')[0];

test('signup validates input and the first user becomes admin', async () => {
  let res = await post('/signup', form({ name: 'Out Sider', email: 'x@gmail.com', password: 'longenough123', whatsapp: '+14155550100' }));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /example\.com/);

  res = await post('/signup', form({ name: 'Ana', email: 'ana@example.com', password: 'short', whatsapp: '+14155550100' }));
  assert.equal(res.status, 400);

  res = await post('/signup', form({ name: 'Ana Admin', email: 'ana@example.com', password: 'longenough123', slack: 'U0ANA12345', whatsapp: '(415) 555-0100' }));
  assert.equal(res.status, 303);
  const cookie = cookieOf(res);
  assert.ok(cookie);
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@example.com'");
  assert.equal(ana.role, 'admin');
  assert.equal(ana.whatsapp, '+14155550100');
  assert.equal(ana.slack_user_id, 'U0ANA12345');

  const home = await fetch(base + '/', { headers: { cookie } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Weekend rotation/);

  res = await post('/signup', form({ name: 'Ben', email: 'ben@example.com', password: 'longenough123', slack: 'U0BEN12345', whatsapp: '+14155550101' }));
  assert.equal((await app.db.get("SELECT role FROM users WHERE email = 'ben@example.com'")).role, 'non_technical');
});

test('non-technical people can view the calendar and audit log and trigger an alert, nothing else', async () => {
  const login = async (email) => cookieOf(await post('/login', form({ email, password: 'longenough123' })));
  const ana = await login('ana@example.com');
  const ben = await login('ben@example.com');
  const get = (path, cookie) => fetch(base + path, { redirect: 'manual', headers: { cookie } });
  const act = (path, cookie, body = {}) => post(path, form(body), { cookie });

  assert.equal((await get('/', ben)).headers.get('location'), '/calendar');
  assert.equal((await get('/calendar', ben)).status, 200);
  assert.equal((await get('/log', ben)).status, 200);
  assert.equal((await get('/incidents', ben)).status, 200);
  assert.equal((await get('/team', ben)).status, 403);
  assert.equal((await get('/settings', ben)).status, 403);
  assert.equal((await act('/weekends/2026-11-20/join', ben)).status, 403);
  assert.equal((await act('/weekends/2026-11-20/swap', ben, { user_id: '1' })).status, 403);
  assert.doesNotMatch(await (await get('/calendar', ben)).text(), /Add me|Swap/);

  const created = await act('/incidents', ben, { title: 'Checkout is down' });
  assert.equal(created.status, 303);
  const id = created.headers.get('location').split('/').pop();
  assert.equal((await act(`/incidents/${id}/ack`, ben)).status, 403);
  assert.equal((await act(`/incidents/${id}/resolve`, ben)).status, 403);
  assert.equal((await act(`/incidents/${id}/ack`, ana)).status, 303);

  const benId = (await app.db.get("SELECT id FROM users WHERE email = 'ben@example.com'")).id;
  const anaId = (await app.db.get("SELECT id FROM users WHERE email = 'ana@example.com'")).id;
  assert.equal((await act(`/team/${benId}/role`, ben, { role: 'admin' })).status, 403);
  assert.equal((await act(`/team/${benId}/role`, ana, { role: 'owner' })).status, 400);
  await act(`/team/${anaId}/role`, ana, { role: 'engineer' });
  assert.equal((await app.db.get('SELECT role FROM users WHERE id = ?', [anaId])).role, 'admin', 'the last admin cannot be demoted');

  await act(`/team/${benId}/role`, ana, { role: 'engineer' });
  assert.equal((await app.db.get('SELECT role FROM users WHERE id = ?', [benId])).role, 'engineer');
  assert.equal((await get('/', ben)).status, 200);
  assert.equal((await get('/team', ben)).status, 200);
  const teamHtml = await (await get('/team', ana)).text();
  assert.match(teamHtml, /<tr class="role-admin">/);
  assert.match(teamHtml, /<tr class="role-engineer">/);
  const onlyAdmins = await (await get('/team?role=admin', ana)).text();
  assert.match(onlyAdmins, /<tr class="role-admin">/);
  assert.doesNotMatch(onlyAdmins, /<tr class="role-engineer">/);
  assert.match(onlyAdmins, /aria-current="true"[^>]*>Admin/);
  assert.match(await (await get('/team?role=bogus', ana)).text(), /<tr class="role-engineer">/, 'unknown role shows everyone');
  await app.db.run("UPDATE users SET role = 'non_technical' WHERE id = ?", [benId]);
});

test('removing a teammate signs them out everywhere and blocks sign-in until they are added back', async () => {
  const admin = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const benCookie = cookieOf(await post('/login', form({ email: 'ben@example.com', password: 'longenough123' })));
  assert.equal((await fetch(base + '/calendar', { headers: { cookie: benCookie }, redirect: 'manual' })).status, 200);
  const ben = await app.db.get("SELECT id FROM users WHERE email = 'ben@example.com'");

  let res = await post(`/team/${ben.id}/active`, form({ active: '0' }), { cookie: admin });
  assert.equal(res.status, 303);
  res = await fetch(base + '/calendar', { headers: { cookie: benCookie }, redirect: 'manual' });
  assert.equal(res.status, 303, 'the old session no longer works');
  assert.equal(res.headers.get('location'), '/login');
  res = await post('/login', form({ email: 'ben@example.com', password: 'longenough123' }));
  assert.equal(res.status, 403);
  assert.match(await res.text(), /removed/);

  await post(`/team/${ben.id}/active`, form({ active: '1' }), { cookie: admin });
  assert.equal((await fetch(base + '/calendar', { headers: { cookie: benCookie }, redirect: 'manual' })).status, 200, 'back in once re-added');
});

test('hardening: bad URLs and cookies, redirects, cross-site posts, Slack guests, last admin, names', async () => {
  const login = async (email) => cookieOf(await post('/login', form({ email, password: 'longenough123' })));
  const ana = await login('ana@example.com');
  const anaRow = await app.db.get("SELECT id FROM users WHERE email = 'ana@example.com'");

  const odd = await fetch(base + '//', { redirect: 'manual' });
  assert.ok([400, 404].includes(odd.status), 'a request target of // is refused, not fatal');
  assert.equal((await fetch(base + '/healthz')).status, 200, 'the server is still up');

  assert.equal((await fetch(base + '/login', { headers: { cookie: 'x=%E0%A4%A' } })).status, 200, 'malformed cookie encoding is ignored');
  assert.equal((await fetch(base + '/incidents/%E0%A4%A', { headers: { cookie: ana }, redirect: 'manual' })).status, 404);

  for (const back of ['https://evil.example/phish', '//evil.example', '/\\evil.example']) {
    const res = await post('/swaps/999/undo', form({ back }), { cookie: ana });
    assert.equal(res.headers.get('location'), '/calendar', `back=${back} is not followed`);
  }

  const crossSite = await post('/incidents', form({ title: 'csrf' }), { cookie: ana, 'sec-fetch-site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  const foreignOrigin = await post('/incidents', form({ title: 'csrf' }), { cookie: ana, origin: 'https://evil.example' });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await post('/incidents', form({ title: 'same site' }), { cookie: ana, 'sec-fetch-site': 'same-origin', origin: base })).status, 303);
  // The app sends Referrer-Policy: no-referrer, so Chrome posts its own forms with Origin: null.
  assert.equal((await post('/incidents', form({ title: 'chrome form' }), { cookie: ana, 'sec-fetch-site': 'same-origin', origin: 'null' })).status, 303);
  assert.equal((await post('/incidents', form({ title: 'csrf' }), { cookie: ana, origin: 'null' })).status, 403, 'a null origin alone is not trusted');

  const incidentId = (await app.db.get("SELECT id FROM incidents WHERE title = 'same site'")).id;
  const signed = (body) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v0=' + crypto.createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex');
    return { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig };
  };
  const payload = encodeURIComponent(JSON.stringify({ user: { id: 'UGUEST0001' }, actions: [{ action_id: 'resolve', value: String(incidentId) }] }));
  const body = `payload=${payload}`;
  assert.equal((await post('/slack/interactions', body, signed(body))).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.notEqual((await app.db.get('SELECT status FROM incidents WHERE id = ?', [incidentId])).status, 'resolved', 'a Slack user with no account cannot resolve');

  await post(`/team/${anaRow.id}/active`, form({ active: '0' }), { cookie: ana });
  assert.equal((await app.db.get('SELECT active FROM users WHERE id = ?', [anaRow.id])).active, 1, 'the last admin cannot be removed');

  await post('/profile', form({ name: 'Ana\rATTACH:<!channel>', slack: 'U0ANA12345', whatsapp: '+14155550100' }), { cookie: ana });
  const renamed = (await app.db.get('SELECT name FROM users WHERE id = ?', [anaRow.id])).name;
  assert.doesNotMatch(renamed, /[\r\n<>]/);
  await app.db.run("UPDATE users SET name = 'Ana Admin' WHERE id = ?", [anaRow.id]);
});

test('admins set the on-call days and counts from Settings, and the sign-in domain comes from the environment', async () => {
  const login = async (email) => cookieOf(await post('/login', form({ email, password: 'longenough123' })));
  const ana = await login('ana@example.com');
  const ben = await login('ben@example.com');
  const benId = (await app.db.get("SELECT id FROM users WHERE email = 'ben@example.com'")).id;
  await app.db.run("UPDATE users SET role = 'engineer' WHERE id = ?", [benId]);
  const originalCoverage = app.shifts.coverage();
  const originalDomains = [...config.allowedEmailDomains];
  const get = (path, cookie) => fetch(base + path, { redirect: 'manual', headers: { cookie } });
  try {
    const page = await (await get('/settings', ana)).text();
    assert.match(page, /On-call coverage/);
    assert.match(page, /name="weekend_count"/);
    assert.doesNotMatch(page, /name="domains"/, 'the domain is not editable in the app');
    assert.match(page, /ALLOWED_EMAIL_DOMAINS/);
    assert.match(page, /@example\.com/);
    const readOnly = await (await get('/settings', ben)).text();
    assert.doesNotMatch(readOnly, /name="weekend_count"/, 'engineers see the coverage but cannot edit it');
    assert.match(readOnly, /Ask an admin to change it/);

    const attempt = { start: '18:00', end: '09:00', weekend_count: '2', weekday_count: '3', day_1: '1', day_2: '1', day_3: '1' };
    assert.equal((await post('/settings/coverage', form(attempt), { cookie: ben })).status, 403);
    assert.equal((await post('/settings/domains', form({ domains: '@other.org' }), { cookie: ana })).status, 404, 'there is no route to change it');

    assert.equal((await post('/settings/coverage', form({ ...attempt, weekday_count: '0' }), { cookie: ana })).status, 303);
    assert.deepEqual(app.shifts.coverage().days, originalCoverage.days, 'invalid counts change nothing');
    assert.equal((await post('/settings/coverage', form({ start: '18:00', end: '09:00', weekend_count: '2', weekday_count: '2' }), { cookie: ana })).status, 303);
    assert.deepEqual(app.shifts.coverage().days, originalCoverage.days, 'no days ticked changes nothing');

    await post('/settings/coverage', form(attempt), { cookie: ana });
    assert.deepEqual(app.shifts.coverage().days, [1, 2, 3]);
    assert.equal(app.shifts.coverage().weekdayCount, 3);
    assert.equal(JSON.parse((await app.db.get("SELECT value FROM settings WHERE key = 'coverage'")).value).weekdayCount, 3);

    await post('/settings/coverage', form({ ...attempt, preset: 'all' }), { cookie: ana });
    assert.deepEqual(app.shifts.coverage().days, [0, 1, 2, 3, 4, 5, 6], 'a preset replaces the ticked days');

    app.shifts.setCoverage(originalCoverage);
    await app.loadSettings();
    assert.deepEqual(app.shifts.coverage().days, [0, 1, 2, 3, 4, 5, 6], 'saved coverage is loaded at startup');
    assert.deepEqual(config.allowedEmailDomains, originalDomains, 'the domain still comes from the environment');
  } finally {
    app.shifts.setCoverage(originalCoverage);
    await app.db.run("DELETE FROM settings WHERE key = 'coverage'");
    await app.db.run("UPDATE users SET role = 'non_technical' WHERE id = ?", [benId]);
  }
});

test('/ping is refused while off, and for people who are not engineers or admins', async () => {
  const signed = (body) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v0=' + crypto.createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex');
    return { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig };
  };
  const ping = async (slackUser) => {
    const body = form({ command: '/ping', text: 'checkout failing', user_id: slackUser, channel_id: 'C0123456789' });
    const res = await post('/slack/commands', body, signed(body));
    assert.equal(res.status, 200);
    return (await res.json()).text;
  };
  assert.match(await ping('U0ANA12345'), /turned off/, 'off by default, even for an admin');
  const saved = { ...config.ping };
  Object.assign(config.ping, { enabled: true, anthropicKey: 'sk-test', cooldownSeconds: 0 });
  try {
    assert.match(await ping('UGUEST0001'), /Only engineers and admins/, 'unknown Slack user');
    await app.db.run("UPDATE users SET role = 'non_technical' WHERE email = 'ben@example.com'");
    assert.match(await ping('U0BEN12345'), /Only engineers and admins/, 'non-technical person');
  } finally {
    Object.assign(config.ping, saved);
  }
});

test('login rejects a wrong password and accepts the right one', async () => {
  let res = await post('/login', form({ email: 'ana@example.com', password: 'nope' }));
  assert.equal(res.status, 400);
  res = await post('/login', form({ email: 'ANA@example.com', password: 'longenough123' }));
  assert.equal(res.status, 303);
  assert.ok(cookieOf(res));
});

test('pages require login', async () => {
  const res = await fetch(base + '/team', { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
});

test('Slack commands need a valid signature', async () => {
  const body = form({ command: '/oncall', text: '', user_id: 'U0ANA12345' });
  let res = await post('/slack/commands', body, { 'x-slack-request-timestamp': '1', 'x-slack-signature': 'v0=bad' });
  assert.equal(res.status, 401);

  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + crypto.createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex');
  res = await post('/slack/commands', body, { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.text, /Upcoming weekends/);
});

test('alerts API needs the bearer token and creates an incident', async () => {
  let res = await fetch(base + '/api/incidents', { method: 'POST', body: JSON.stringify({ title: 'x' }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 401);
  res = await fetch(base + '/api/incidents', {
    method: 'POST',
    body: JSON.stringify({ title: 'API 5xx spike', details: 'p95 > 2s' }),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-api-token' },
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.ok(json.id);
  assert.equal((await app.incidents.get(json.id)).title, 'API 5xx spike');

  // A monitor that fires every minute keeps adding to the same open incident.
  res = await fetch(base + '/api/incidents', {
    method: 'POST',
    body: JSON.stringify({ title: 'API 5xx spike' }),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-api-token' },
  });
  assert.equal(res.status, 200);
  const again = await res.json();
  assert.equal(again.id, json.id);
  assert.equal(again.repeat, true);
});

test('Slack requests from another workspace are rejected when SLACK_TEAM_ID is set', async () => {
  const { config } = await import('../src/config.js');
  config.slack.teamId = 'T0OURTEAM';
  const signed = (body) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v0=' + crypto.createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex');
    return post('/slack/commands', body, { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig });
  };
  try {
    assert.equal((await signed(form({ command: '/oncall', team_id: 'T0OTHER' }))).status, 403);
    assert.equal((await signed(form({ command: '/oncall', team_id: 'T0OURTEAM' }))).status, 200);
  } finally {
    config.slack.teamId = '';
  }
});

test('on-call API does not leak names without the API token', async () => {
  assert.equal((await fetch(`${base}/api/oncall`)).status, 401);
  const res = await fetch(`${base}/api/oncall`, { headers: { Authorization: 'Bearer test-api-token' } });
  assert.equal(res.status, 200);
});

test('sign-up errors show on the field that needs fixing', async () => {
  const fieldError = (html, id) => {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    if (!input.includes('aria-invalid="true"') || !input.includes(`aria-describedby="${id}-error"`)) return null;
    return html.match(new RegExp(`id="${id}-error"[^>]*>([^<]*)<`))?.[1] ?? null;
  };
  const signup = async (fields) => (await post('/signup', form({
    name: 'Cal', email: 'cal@example.com', password: 'longenough123', slack: 'U0CAL12345', whatsapp: '+14155550199', ...fields,
  }))).text();

  let html = await signup({ email: 'nope' });
  assert.equal(fieldError(html, 'email'), 'Please enter a valid email.');
  assert.equal(fieldError(html, 'password'), null, 'only the field with the problem is marked');
  assert.equal(fieldError(await signup({ password: 'short' }), 'password'), 'Password must be at least 10 characters.');
  assert.equal(fieldError(await signup({ name: ' ' }), 'name'), 'Please enter your name.');
  assert.match(fieldError(await signup({ whatsapp: '+14155550100' }), 'whatsapp'), /already belongs to Ana Admin/);
  assert.match(fieldError(await signup({ slack: 'U0ANA12345' }), 'slack'), /already belongs to Ana Admin/);
  html = await signup({ whatsapp: 'call me' });
  assert.match(fieldError(html, 'whatsapp'), /country code/);
  assert.match(html, /value="Cal"/, 'what they typed is kept');

  const views = await import('../src/views.js');
  const welcome = views.welcomePage({ identity: { name: 'Cal Reyes', email: 'cal@example.com' }, values: {}, error: { field: 'name', message: 'Please enter your name.' } });
  assert.equal(fieldError(welcome, 'name'), 'Please enter your name.');
});

test('the incidents page has status tabs with counts, and the nav shows how many are open', async () => {
  const ana = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const page = async (path) => (await fetch(base + path, { headers: { cookie: ana } })).text();
  const made = [];
  for (const title of ['Tabs open', 'Tabs acknowledged']) {
    const res = await post('/incidents', form({ title }), { cookie: ana });
    made.push(res.headers.get('location').split('/').pop());
  }
  await post(`/incidents/${made[1]}/ack`, form({}), { cookie: ana });
  const count = async (status) => Number((await app.db.get('SELECT COUNT(*) AS n FROM incidents WHERE status = ?', [status])).n);
  const open = await count('open');

  const html = await page('/incidents?status=open');
  assert.match(html, /Tabs open/);
  assert.doesNotMatch(html, /Tabs acknowledged/);
  assert.match(html, new RegExp(`aria-current="page">Open <span class="count">${open}</span>`));
  assert.match(html, new RegExp(`>Acknowledged <span class="count">${await count('acknowledged')}</span>`));
  assert.match(await page('/incidents'), /Tabs acknowledged/);
  assert.match(await page('/incidents?status=bogus'), /Tabs acknowledged/, 'an unknown status shows everything');

  assert.match(await page('/calendar'), new RegExp(`aria-label="${open} open incidents?">${open}</span>`));
});

test('the theme switch saves light or dark for this browser and goes back to the page', async () => {
  const ana = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const page = async (cookie) => (await fetch(base + '/incidents', { headers: { cookie } })).text();
  assert.match(await page(ana), /<html lang="en">/, 'follows the system until someone picks');
  assert.match(await page(ana), /name="theme" value="system" aria-pressed="true"/);

  let res = await post('/theme', form({ theme: 'dark', back: '/incidents?status=open' }), { cookie: ana });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/incidents?status=open');
  const theme = res.headers.getSetCookie().find((c) => c.startsWith('pd_theme='));
  assert.match(theme, /^pd_theme=dark;.*Max-Age=31536000/);
  const html = await page(`${ana}; ${theme.split(';')[0]}`);
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.match(html, /name="theme" value="dark" aria-pressed="true"/);

  res = await post('/theme', form({ theme: 'system', back: '//evil.example' }), { cookie: ana });
  assert.equal(res.headers.get('location'), '/');
  assert.match(res.headers.getSetCookie().find((c) => c.startsWith('pd_theme=')), /Max-Age=0/);
  assert.match(await page(`${ana}; pd_theme=bogus`), /<html lang="en">/, 'an unknown value is ignored');
});

test('the Team page shows a one-time Phone app code and your signed-in phones', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  assert.ok(cookie);
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@example.com'");
  const { device } = await app.devices.create(ana.id, { platform: 'ios', name: 'Ana’s iPhone' });
  const page = await (await fetch(base + '/team', { headers: { cookie } })).text();
  assert.match(page, /<h2>Phone app<\/h2>/);
  assert.match(page, /<details>\s*<summary[^>]*>Show sign-in code<\/summary>[\s\S]*?<svg[^>]+aria-label="Phone app sign-in code"[\s\S]*?<\/details>/,
    'the code only shows when asked, so a screen share of the Team page does not leak it');
  assert.match(page, /Ana’s iPhone/);
  assert.match(page, /iPhone · signed in [A-Z][a-z]{2} \d{1,2}</, 'a phone with no push token yet is listed, with when it signed in');
  assert.match(page, /Not tested yet/);
  assert.match(page, new RegExp(`action="/devices/${device.id}/revoke"`));

  let res = await post(`/devices/${device.id}/revoke`, '', { cookie });
  assert.equal(res.status, 303);
  assert.ok((await app.devices.get(device.id)).revoked_at);

  const other = await app.db.get('SELECT * FROM users WHERE id != ? LIMIT 1', [ana.id]);
  const { device: theirs } = await app.devices.create(other.id, { platform: 'android', name: 'Theirs' });
  res = await post(`/devices/${theirs.id}/revoke`, '', { cookie });
  assert.equal(res.status, 404, "you can only sign out your own phones");
  assert.equal((await app.devices.get(theirs.id)).revoked_at, null);
});

test('notes from the phone app show in the incident timeline on the web', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@example.com'");
  const inc = await app.incidents.create({ title: 'Noted incident', quiet: true, createdBy: ana.id });
  await app.incidents.addNote(inc.id, ana, 'Square <status> page shows an outage.', 'app');
  const page = await (await fetch(`${base}/incidents/${inc.id}`, { headers: { cookie } })).text();
  assert.match(page, /Note from Ana Admin/);
  assert.match(page, /Square &lt;status&gt; page shows an outage\./, 'escaped');
});

test('Google sign-in for the phone app must carry a challenge; the web flow is unchanged', async () => {
  const saved = { ...config.google };
  config.google.clientId = 'client';
  config.google.clientSecret = 'secret';
  try {
    let res = await fetch(base + '/auth/google?app=1', { redirect: 'manual' });
    assert.equal(res.status, 400);
    const challenge = 'A'.repeat(43);
    res = await fetch(`${base}/auth/google?app=1&challenge=${challenge}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('pd_oauth=')).split(';')[0].slice('pd_oauth='.length);
    assert.deepEqual([readPayload(cookie).app, readPayload(cookie).ch], [true, challenge]);
    assert.equal((await fetch(base + '/auth/google', { redirect: 'manual' })).status, 302);
  } finally {
    Object.assign(config.google, saved);
  }
});

test('admins move people in the rotation from the Team page', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const order = async () => (await app.db.all('SELECT id FROM users WHERE active = 1 ORDER BY rotation_order, id')).map((u) => u.id);
  const before = await order();
  const res = await post(`/team/${before[0]}/move`, form({ dir: '1' }), { cookie });
  assert.equal(res.status, 303);
  assert.deepEqual((await order()).slice(0, 2), [before[1], before[0]]);
  assert.equal((await post('/team/abc/move', form({ dir: '1' }), { cookie })).status, 404);
});

test('the sidebar shows who is on call, and the home page shows whether pages can reach them', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@example.com'");
  const shift = app.shifts.currentOrNext(new Date());
  const page = async (path) => (await fetch(base + path, { headers: { cookie } })).text();
  const savedPush = config.push.apns.enabled;
  let device;
  try {
    await post(`/weekends/${shift.key}/join`, form({}), { cookie });
    const sidebar = await page('/incidents');
    assert.match(sidebar, /<section class="side-oncall" aria-label="(On call now|Next weekend)">/);
    assert.match(sidebar, new RegExp(shift.count > 1 ? `>Ana · needs ${shift.count - 1}<` : '>Ana<'));

    let home = await page('/');
    assert.match(home, /Ana Admin<\/span>[^]*?<span class="pill sm success">Slack<\/span><span class="pill sm warning">No phone<\/span>/);
    assert.match(home, /Your phone<\/span>\s*<span[^>]*>No phone signed in/);

    ({ device } = await app.devices.create(ana.id, { platform: 'ios', name: 'Ana’s iPhone' }));
    await app.devices.update(device.id, { pushToken: 'push-token-ana' });
    assert.match(await page('/'), /Ana’s iPhone · calls aren&#39;t set up on this server/);
    config.push.apns.enabled = true;
    home = await page('/');
    assert.match(home, /<span class="pill sm success">Slack<\/span><span class="pill sm success">Phone<\/span>/);
    assert.match(home, /Ana’s iPhone · calls work · not tested yet/);
  } finally {
    config.push.apns.enabled = savedPush;
    if (device) await app.devices.revoke(device.id);
    await app.db.run('DELETE FROM weekend_members WHERE weekend_key = ? AND user_id = ?', [shift.key, ana.id]);
    await app.db.run('DELETE FROM roster_log WHERE weekend_key = ? AND user_id = ?', [shift.key, ana.id]);
  }
});

test('the On call home lays out the paging plan and each open incident from the escalation settings', async () => {
  const views = await import('../src/views.js');
  const now = new Date();
  const hour = 3_600_000;
  const shift = { key: '2026-11-27', start: new Date(now - hour), end: new Date(now.getTime() + hour), count: 2 };
  const ana = { id: 1, name: 'Ana Admin', role: 'admin', slack_user_id: 'U0ANA12345' };
  const ben = { id: 2, name: 'Ben Carter', role: 'engineer', slack_user_id: 'U0BEN12345' };
  const eli = { id: 3, name: 'Eli Brooks', role: 'engineer', slack_user_id: 'U0ELI12345' };
  const cal = { id: 4, name: 'Cal Reyes', role: 'engineer', slack_user_id: 'U0CAL12345' };
  const entry = { shift, people: [ana, ben], joined: [], needsCover: false };
  const phones = new Map([[1, [{ id: 9, user_id: 1, platform: 'ios', name: 'Ana’s iPhone', push_token: 't', tested_at: null }]],
    [2, [{ id: 10, user_id: 2, platform: 'ios', name: 'Ben’s iPhone', push_token: 'u', tested_at: null }]]]);
  const inc = { id: 7, title: 'Checkout failing', status: 'open', source: 'slack', created_at: now.toISOString(),
    assigned_name: 'Ana Admin', backup_name: 'Eli Brooks', escalation_level: 0, quiet: 0 };
  const page = (fields) => views.dashboardPage({
    user: { ...cal, onCall: { ...entry, running: true } }, now, onCall: entry, runningShift: shift, nextEntry: null, backup: eli,
    schedule: [entry], coverage: app.shifts.coverage(), balance: [], recentLog: [], openIncidents: [inc], phones, flash: null, ...fields,
  });
  const { secondCallAfterMinutes: second, repageEveryMinutes: repage, escalateAfterMinutes: escalate } = config;
  const channel = `#${config.slack.channelName}`;
  const saved = config.push.apns.enabled;
  config.push.apns.enabled = true;
  try {
    let html = page({});
    assert.match(html, /<section class="side-oncall" aria-label="On call now">/);
    assert.match(html, />Ana and Ben</);
    assert.match(html, /role="progressbar"[^>]*aria-valuenow="50"/);

    assert.match(html, new RegExp(`Now</span>.*?<span>Slack DM and a phone call to Ana and Ben, and a post in ${channel}</span>`));
    assert.match(html, new RegExp(`${second} min</span>.*?<span>Call again, rings through Do Not Disturb</span>`));
    assert.match(html, new RegExp(`Every ${repage} min</span>.*?<span>Page Ana and Ben again</span>`));
    assert.match(html, new RegExp(`${escalate} min</span>.*?<span>Also page Eli Brooks, the backup \\(Slack DM only: no phone in the app\\)</span>`));
    assert.match(html, new RegExp(`${2 * escalate} min</span>.*?<span>@channel in ${channel}</span>`));
    assert.match(html, />Page Ana and Ben</);
    assert.match(html, /Eli Brooks has no phone signed in to the app/);

    assert.match(html, new RegExp(`Re-paging every ${repage} min`));
    assert.match(html, new RegExp(`Eli Brooks is paged in ${escalate} min`));

    // An empty weekend that reached @channel still re-pages the admins and the backup; a weekday page has no backup.
    html = page({ openIncidents: [{ ...inc, assigned_name: null, escalation_level: 2 }] });
    assert.match(html, new RegExp(`@channel in ${channel}</span><span class="small muted">Paging everyone every ${repage} min`));
    assert.match(html, /Nobody is on call, so paging the admins and Eli Brooks, the backup/);
    html = page({ openIncidents: [{ ...inc, assigned_name: null, backup_name: null, escalation_level: 2 }] });
    assert.match(html, new RegExp(`Posted to ${channel} with @here</span><span class="small muted">Reminds ${channel} every ${2 * escalate} min`));

    html = page({ user: cal, onCall: null, runningShift: null, backup: null, openIncidents: [],
      nextEntry: { shift: { ...shift, start: new Date(now.getTime() + 48 * hour), end: new Date(now.getTime() + 100 * hour) }, people: [ana], joined: [], needsCover: true } });
    assert.match(html, /Nobody is on call right now/);
    assert.match(html, new RegExp(`Now</span>.*?<span>@here in ${channel}</span>`));
    assert.match(html, new RegExp(`>Post to ${channel}<`));
    assert.match(html, /All quiet/);
  } finally {
    config.push.apns.enabled = saved;
  }
});

test('the incidents table shows who each page went to and how fast someone acknowledged it', async () => {
  const views = await import('../src/views.js');
  const now = new Date('2026-11-21T15:30:00Z');
  const at = (min, sec = 0) => new Date(now.getTime() - 30 * 60_000 + min * 60_000 + sec * 1000).toISOString();
  const blank = { source: 'slack', details: '', quiet: 0, test: 0, assigned_name: null, backup_name: null, acked_at: null, acked_by_name: null };
  const incidents = [
    { ...blank, id: 4, title: 'Weekday page', status: 'open', created_at: at(24), escalation_level: 2 },
    { ...blank, id: 3, title: 'Escalated', status: 'acknowledged', created_at: at(0), acked_at: at(17), acked_by_name: 'Eli Brooks',
      assigned_name: 'Ana Admin', backup_name: 'Eli Brooks', escalation_level: 1 },
    { ...blank, id: 2, title: '[Test] Phone check', status: 'resolved', created_at: at(0), acked_at: at(0, 8), acked_by_name: 'Ben Carter', escalation_level: 0, test: 1 },
    { ...blank, id: 1, title: 'FYI only', status: 'resolved', created_at: at(0), acked_at: at(3), acked_by_name: 'Ana Admin', escalation_level: 0, quiet: 1 },
  ];
  const stats = { open: 1, acknowledged: 1, resolved: 2, last30Days: 4, medianAckMinutes: 3 };
  // Everyone the first page went to: Ana was on call with Ben.
  const paged = new Map([[3, ['Ana Admin', 'Ben Carter']]]);
  const page = (user) => views.incidentsPage({ user, incidents, status: null, stats, now, paged });
  const html = page({ id: 2, name: 'Ben Carter', role: 'engineer' });
  const row = (id) => html.match(new RegExp(`<tr>(?:(?!</tr>)[^])*href="/incidents/${id}"(?:(?!</tr>)[^])*</tr>`))?.[0] ?? '';
  const channel = `#${config.slack.channelName}`;

  assert.match(row(4), new RegExp(`${channel}<[^]*?Nobody on call`));
  assert.match(row(4), /Not yet<[^]*?Waiting 6 min/);
  assert.match(row(4), /action="\/incidents\/4\/ack"/);
  assert.match(row(3), /Ana Admin, Ben Carter and Eli Brooks<[^]*?On call, then the backup/);
  assert.match(row(3), /17 min<[^]*?Eli Brooks/);
  assert.doesNotMatch(row(3), /\/ack"/, 'acknowledged: only Resolve is left');
  assert.match(row(3), /action="\/incidents\/3\/resolve"/);
  assert.match(row(2), /Test page: called once/);
  assert.match(row(2), /8 sec<[^]*?Ben Carter/);
  assert.match(row(1), new RegExp(`Posted in ${channel}, nobody called`));
  assert.doesNotMatch(page({ id: 5, name: 'Nina Nontech', role: 'non_technical' }), /action="\/incidents\/\d+\/(ack|resolve)"/,
    'non-technical people cannot acknowledge or resolve');
});

test('an incident page shows the escalation track, who each page reached, the timeline, notes and messages', async () => {
  const views = await import('../src/views.js');
  const { escalationPlan } = await import('../src/app-api.js');
  const t0 = new Date('2026-11-21T15:00:00Z');
  const at = (min) => new Date(t0.getTime() + min * 60_000).toISOString();
  const time = (min) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(at(min)));
  const now = new Date(at(6));
  const ana = { id: 1, name: 'Ana Admin', role: 'admin', slack_user_id: 'U0ANA12345' };
  const ben = { id: 2, name: 'Ben Carter', role: 'engineer', slack_user_id: 'U0BEN12345' };
  const eli = { id: 3, name: 'Eli Brooks', role: 'engineer', slack_user_id: 'U0ELI12345' };
  const inc = { id: 14, title: 'Checkout failing', details: 'Checkout returns 502.', status: 'open', source: 'slack', created_at: at(0), created_by: 4,
    assigned_user_id: 1, backup_user_id: 3, escalation_level: 0, quiet: 0, test: 0, acked_at: null, acked_by: null, resolved_at: null, resolved_by: null };
  const who = { onCallPeople: [ana, ben], responders: [ana, ben], backup: eli };
  const n = (id, min, channel, recipient, status, extra = {}) => ({
    id, at: at(min), channel, recipient, body: 'Incident #14: Checkout failing', status, error: null, incident_id: 14, device_id: null, ...extra });
  const notifications = [
    n(1, 0, 'slack', 'Ana Admin (U0ANA12345)', 'sent'), n(2, 0, 'slack', 'Ben Carter (U0BEN12345)', 'sent'),
    n(3, 0, 'slack', `#${config.slack.channelName} (CONCALL)`, 'sent'),
    n(4, 0, 'push', 'Ana Admin (iPhone: Ana’s iPhone)', 'sent', { device_id: 9, body: 'Call: Checkout failing' }),
    n(5, 0, 'push', 'Ben Carter (Android: Pixel 8)', 'failed', { device_id: 10, body: 'Call: Checkout failing', error: 'Push failed: 500' }),
    n(6, 2, 'push', 'Ana Admin (iPhone: Ana’s iPhone)', 'sent', { device_id: 9, body: 'Call: Checkout failing' }),
  ].reverse(); // the route reads them newest first
  const events = [
    { at: at(0), message: 'Triggered via slack by Cal Reyes' }, { at: at(0), message: 'Paged Ana Admin and Ben Carter (on call)' },
    { at: at(1), message: 'Same alert again via api' }, { at: at(2), message: 'Called again so it rings through Do Not Disturb' },
    { at: at(3), message: 'Same alert again via api' },
  ];
  const notes = [{ at: at(4), user_id: 4, user_name: 'Cal Reyes', text: 'Square <status> page shows an outage.' }];
  const page = (row, extra = {}) => views.incidentPage({
    user: { ...ben }, inc: row, now, events, notes, people: { assigned: ana, backup: eli }, who,
    escalation: escalationPlan(row, now, who), notifications, names: {}, ...extra,
  });
  const steps = (html) => [...html.matchAll(/<li class="(done|next|later|skipped)[^"]*">(?:(?!<\/li>)[^])*?<span class="title">([^<]*)<\/span>/g)].map((m) => [m[2], m[1]]);
  const reachRow = (html, name) => html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[^])*>${name}<(?:(?!</tr>)[^])*</tr>`))?.[0] ?? '';

  let html = page(inc);
  assert.match(html, /<span class="pill open">Open<\/span>\s*<span class="muted">Open for 6 min · nobody has acknowledged yet<\/span>/);
  assert.match(html, /Triggered by Cal Reyes/);
  assert.match(html, /Repeated 2× · grouped, not paged again/);
  assert.deepEqual(steps(html), escalationPlan(inc, now, who).map((s) => [s.label, s.state]));
  assert.match(html, new RegExp(`Call Eli Brooks, the backup at ${time(15)}, in 9 min`));

  assert.match(reachRow(html, 'Ana Admin'), /On call<[^]*?<span class="pill sm sent">Sent<\/span>[^]*?<span class="pill sm sent">Rang 2×<\/span>/);
  assert.match(reachRow(html, 'Ben Carter'), /On call · you<[^]*?<span class="pill sm sent">Sent<\/span>[^]*?<span class="pill sm failed">Failed<\/span>/);
  assert.match(reachRow(html, 'Eli Brooks'), new RegExp(`Backup<[^]*?Waiting<[^]*?At ${time(15)}`));
  assert.match(reachRow(html, `#${config.slack.channelName}`), /<span class="pill sm sent">Posted<\/span>/);

  assert.match(html, /The same alert came in 2 more times/);
  assert.match(html, /Note from Cal Reyes/);
  assert.match(html, /Square &lt;status&gt; page shows an outage\./);
  assert.match(html, /Now\. Waiting for someone to acknowledge\./);
  assert.match(html, /6 messages · 1 failed/);
  assert.match(html, /Ana’s iPhone/);
  assert.match(html, /Push failed: 500/);
  assert.match(html, /action="\/incidents\/14\/ack"/);

  // Ana answered the first call: the Do Not Disturb call never happened, the rest was not needed.
  const acked = { ...inc, status: 'acknowledged', acked_at: at(1), acked_by: 1 };
  html = page(acked, { events: [...events, { at: at(1), message: 'Acknowledged by Ana Admin via phone call' }] });
  assert.match(html, new RegExp(`Ana Admin answered the call at ${time(1)} · paging stopped`));
  assert.deepEqual(steps(html).map(([, state]) => state), ['done', 'done', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.match(html, new RegExp(`Paging stopped at ${time(1)}`));
  assert.match(reachRow(html, 'Eli Brooks'), /Not needed/);
  assert.doesNotMatch(html, /Waiting for someone to acknowledge/);
  assert.doesNotMatch(html, /\/ack"/);
});

test('test pages and posted-only incidents read correctly on the incidents list and their own page', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@example.com'");
  const page = async (path) => (await fetch(base + path, { headers: { cookie } })).text();
  const channel = `#${config.slack.channelName}`;
  const { device } = await app.devices.create(ana.id, { platform: 'ios', name: 'Ana’s iPhone' });
  await app.devices.update(device.id, { pushToken: 'push-token-test-page' });
  try {
    const { incident: testPage } = await app.incidents.testPage({ title: 'Phone check', by: ana, people: [ana] });
    const quiet = await app.incidents.create({ title: 'FYI only', quiet: true, createdBy: ana.id });
    // A weekend page names everyone it went to in its first event; the list shows them all.
    const weekend = await app.incidents.create({ title: 'Weekend page' }, new Date('2026-11-25T15:00:00Z'));
    await app.db.run('INSERT INTO incident_events (incident_id, at, message) VALUES (?, ?, ?)', [weekend.id, weekend.created_at, 'Paged Ana Admin and Cal Reyes (on call)']);
    const list = await page('/incidents');
    const row = (id) => list.match(new RegExp(`<tr>(?:(?!</tr>)[^])*href="/incidents/${id}"(?:(?!</tr>)[^])*</tr>`))?.[0] ?? '';
    assert.match(row(testPage.id), /Test page: called once/);
    assert.match(row(quiet.id), new RegExp(`Posted in ${channel}, nobody called`));
    assert.match(row(weekend.id), /Ana Admin and Cal Reyes<[^]*?On call/);

    const test = await page(`/incidents/${testPage.id}`);
    assert.match(test, /Test page: called once, never escalates/);
    assert.doesNotMatch(test, /<ol class="esc">/, 'no escalation track');
    assert.match(test, /Ana Admin<[^]*?<span class="pill sm sent">Sent<\/span>[^]*?<span class="pill sm dry-run">Dry run<\/span>/,
      'the Slack DM went out; the call was a dry run (no push keys on this server)');

    const posted = await page(`/incidents/${quiet.id}`);
    assert.match(posted, new RegExp(`Posted in ${channel}, nobody called`));
    assert.doesNotMatch(posted, /<ol class="esc">/, 'no escalation track');
  } finally {
    await app.devices.revoke(device.id);
  }
});

test('the security headers let pages load the Inter font from Google Fonts and nothing else from outside', async () => {
  const res = await fetch(base + '/login', { redirect: 'manual' });
  assert.equal(res.headers.get('content-security-policy'),
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
    + "img-src data:; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'");
});

test('the Team page shows who has Slack linked and a phone signed in, and your phones on the Phone app card', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@example.com'");
  const ben = await app.db.get("SELECT * FROM users WHERE email = 'ben@example.com'");
  const page = async () => (await fetch(base + '/team', { headers: { cookie } })).text();
  const row = (html, name) => html.match(new RegExp(`<tr class="role-[a-z_]+">(?:(?!</tr>)[^])*>${name}<(?:(?!</tr>)[^])*</tr>`))?.[0] ?? '';
  const tile = (html, label) => html.match(new RegExp(`${label}</div><div class="stat-value">([^<]*)</div>`))?.[1];
  const savedPush = config.push.apns.enabled;
  let device;
  try {
    await app.db.run('UPDATE users SET slack_user_id = ? WHERE id = ?', ['ben@example.com', ben.id]);
    let html = await page();
    assert.match(row(html, 'Ana Admin'), /<code>U0ANA12345<\/code>/);
    assert.match(row(html, 'Ana Admin'), /No phone<[^]*?Slack DM only/);
    assert.match(row(html, 'Ben'), /<span class="pill sm danger">Not linked<\/span>[^]*?ben@example\.com/, 'an email is not a linked Slack account');

    ({ device } = await app.devices.create(ana.id, { platform: 'ios', name: 'Ana’s iPhone' }));
    await app.devices.update(device.id, { pushToken: 'push-token-team-page' });
    assert.match(row(await page(), 'Ana Admin'), /Ana’s iPhone<[^]*?Calls aren’t set up on this server/);
    config.push.apns.enabled = true;
    html = await page();
    assert.match(row(html, 'Ana Admin'), /Ana’s iPhone<[^]*?Calls work/);
    const card = html.match(/<section class="card" aria-label="Phone app">[^]*?<\/section>/)?.[0] ?? '';
    assert.match(card, new RegExp(`Ana’s iPhone<[^]*?<span class="pill sm success">Calls work</span>[^]*?action="/devices/${device.id}/revoke"`));

    const responders = (await app.db.all("SELECT id FROM users WHERE active = 1 AND role IN ('admin', 'engineer')")).map((u) => Number(u.id));
    const signedIn = new Set((await app.db.all('SELECT user_id FROM devices WHERE revoked_at IS NULL')).map((d) => Number(d.user_id)));
    const engineers = await app.db.get("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'engineer'");
    assert.equal(tile(html, 'In the rotation'), String(engineers.n));
    assert.equal(tile(html, 'Phone app signed in'), `${responders.filter((id) => signedIn.has(id)).length} of ${responders.length}`);
  } finally {
    config.push.apns.enabled = savedPush;
    if (device) await app.devices.revoke(device.id);
    await app.db.run('UPDATE users SET slack_user_id = ? WHERE id = ?', [ben.slack_user_id, ben.id]);
  }
});

test('Settings shows whether phone calls ring on iPhone and Android, and recent messages name people', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const page = async () => (await fetch(base + '/settings', { headers: { cookie } })).text();
  const saved = { apns: config.push.apns.enabled, fcm: config.push.fcm.serviceAccount };
  const { id } = await app.db.get(`INSERT INTO notifications (at, channel, recipient, body, status) VALUES (?, 'slack', 'Ana Admin (U0ANA12345)', ?, 'sent') RETURNING id`,
    [new Date().toISOString(), '<@U0ANA12345> settings check']);
  try {
    let html = await page();
    assert.match(html, /iPhone calls off<[^]*?<code>APNS_KEY_ID<\/code>[^]*?<code>APNS_TEAM_ID<\/code>[^]*?<code>APNS_PRIVATE_KEY<\/code>/);
    assert.match(html, /Android calls off<[^]*?<code>FCM_SERVICE_ACCOUNT<\/code>/);
    assert.match(html, /@Ana Admin settings check/);

    config.push.apns.enabled = true;
    config.push.fcm.serviceAccount = { project_id: 'p', client_email: 'e@p.iam.gserviceaccount.com', private_key: 'k' };
    html = await page();
    assert.match(html, /iPhone calls on</);
    assert.match(html, /Android calls on</);
    assert.doesNotMatch(html, /APNS_KEY_ID|FCM_SERVICE_ACCOUNT/, 'nothing left to set');
  } finally {
    config.push.apns.enabled = saved.apns;
    config.push.fcm.serviceAccount = saved.fcm;
    await app.db.run('DELETE FROM notifications WHERE id = ?', [id]);
  }
});

test('an open test page on the home page says it called once and never escalates, and a posted-only one that nobody is called', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@example.com'");
  const channel = `#${config.slack.channelName}`;
  const card = (html, id) => html.match(new RegExp(`<article class="inc">(?:(?!</article>)[^])*href="/incidents/${id}"(?:(?!</article>)[^])*</article>`))?.[0] ?? '';
  const escalating = /Re-paging|is paged in|@channel|@here|paging the admins|Reminds/;
  const { incident: testPage } = await app.incidents.testPage({ title: 'Home card check', by: ana, people: [ana] });
  const quiet = await app.incidents.create({ title: 'Home card FYI', quiet: true, createdBy: ana.id });
  try {
    const home = await (await fetch(base + '/', { headers: { cookie } })).text();
    const test = card(home, testPage.id);
    assert.match(test, /Test page · called once/);
    assert.match(test, new RegExp(`Never escalates and stays out of ${channel}`));
    assert.doesNotMatch(test, escalating);
    const posted = card(home, quiet.id);
    assert.match(posted, new RegExp(`Posted in ${channel}`));
    assert.match(posted, /Nobody is called and it never escalates/);
    assert.doesNotMatch(posted, escalating);
  } finally {
    for (const id of [testPage.id, quiet.id]) {
      for (const table of ['incident_events', 'incident_notes', 'notifications']) await app.db.run(`DELETE FROM ${table} WHERE incident_id = ?`, [id]);
      await app.db.run('DELETE FROM incidents WHERE id = ?', [id]);
    }
  }
});

test('only pages look up who is on call for the sidebar, and the home page shares its own lookup with it', async () => {
  const cookie = cookieOf(await post('/login', form({ email: 'ana@example.com', password: 'longenough123' })));
  const { feedToken } = await import('../src/calendar.js');
  const onCallNow = app.rotation.onCallNow;
  let lookups = 0;
  app.rotation.onCallNow = (...args) => { lookups += 1; return onCallNow(...args); };
  const get = async (path) => {
    lookups = 0;
    const res = await fetch(base + path, { redirect: 'manual', headers: { cookie } });
    return { status: res.status, body: await res.text(), lookups };
  };
  try {
    const feed = await get(`/calendar.ics?token=${feedToken()}`);
    assert.equal(feed.status, 200);
    assert.match(feed.body, /BEGIN:VCALENDAR/);
    assert.equal(feed.lookups, 0, 'a calendar feed has no sidebar');
    const redirect = await get('/login');
    assert.equal(redirect.status, 303);
    assert.equal(redirect.lookups, 0, 'nor does a redirect');

    const home = await get('/');
    assert.match(home.body, /<section class="side-oncall" aria-label="(On call now|Next weekend)">/);
    assert.equal(home.lookups, 1, 'the home page and its sidebar share one lookup');
    assert.match((await get('/log')).body, /<section class="side-oncall" aria-label="(On call now|Next weekend)">/);

    lookups = 0;
    assert.equal((await post('/theme', form({ theme: 'system', back: '/log' }), { cookie })).status, 303);
    assert.equal(lookups, 0, 'form posts redirect, so they skip it');
  } finally {
    app.rotation.onCallNow = onCallNow;
  }
});
