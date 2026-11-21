import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.API_TOKEN = 'test-api-token';
process.env.SLACK_SIGNING_SECRET = 'slack-secret';
process.env.ALLOWED_EMAIL_DOMAINS = 'example.com';

const { freshDb } = await import('./helpers.js');
const { createApp } = await import('../src/app.js');

let app, base;
const sent = [];

before(async () => {
  const db = await freshDb();
  app = createApp({
    db,
    notifierOverrides: {
      slack: async (to, text) => { sent.push({ ch: 'slack', to, text }); },
      whatsapp: async (to, text) => { sent.push({ ch: 'whatsapp', to, text }); },
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
  await app.db.run("UPDATE users SET role = 'non_technical' WHERE id = ?", [benId]);
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
