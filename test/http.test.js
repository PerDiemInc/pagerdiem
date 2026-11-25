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
