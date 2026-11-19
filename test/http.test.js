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
  assert.equal(ana.is_admin, 1);
  assert.equal(ana.whatsapp, '+14155550100');
  assert.equal(ana.slack_user_id, 'U0ANA12345');

  const home = await fetch(base + '/', { headers: { cookie } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Weekend rotation/);

  res = await post('/signup', form({ name: 'Ben', email: 'ben@example.com', password: 'longenough123', slack: 'U0BEN12345', whatsapp: '+14155550101' }));
  assert.equal((await app.db.get("SELECT is_admin FROM users WHERE email = 'ben@example.com'")).is_admin, 0);
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

test('WhatsApp ACK acknowledges the latest open incident (dry-run, unsigned allowed locally)', async () => {
  const inc = await app.incidents.create({ title: 'Orders stuck' });
  const res = await post('/whatsapp/incoming', form({ From: 'whatsapp:+14155550100', Body: 'ack' }));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Acknowledged #/);
  assert.equal((await app.incidents.get(inc.id)).status, 'acknowledged');
});

test('ack link: GET only shows a button, POST with the token acknowledges', async () => {
  const inc = await app.incidents.create({ title: 'Login broken' });
  let res = await fetch(`${base}/ack/${inc.id}?t=wrong`);
  assert.equal(res.status, 404);
  res = await fetch(`${base}/ack/${inc.id}?t=${inc.ack_token}`);
  assert.equal(res.status, 200);
  assert.equal((await app.incidents.get(inc.id)).status, 'open', 'GET does not acknowledge');
  res = await post(`/ack/${inc.id}`, form({ t: inc.ack_token }));
  assert.equal(res.status, 200);
  assert.equal((await app.incidents.get(inc.id)).status, 'acknowledged');
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
