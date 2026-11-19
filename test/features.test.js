import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TEAM_TIMEZONE = 'America/New_York';
process.env.ALLOWED_EMAIL_DOMAINS = 'tryperdiem.com';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const { config } = await import('../src/config.js');
const google = await import('../src/google.js');
const { freshDb } = await import('./helpers.js');
const { createApp } = await import('../src/app.js');
const calendar = await import('../src/calendar.js');

// ---------- Google sign-in: only verified tryperdiem.com Workspace accounts ----------

function fakeGoogle(claims) {
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: config.google.clientId, exp: Math.floor(Date.now() / 1000) + 600,
    email_verified: true, ...claims,
  })).toString('base64url');
  return async (url) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    return new Response(JSON.stringify({ id_token: `x.${payload}.sig` }), { status: 200 });
  };
}

test('Google: a tryperdiem.com Workspace account is accepted', async (t) => {
  t.mock.method(globalThis, 'fetch', fakeGoogle({ email: 'Maya@tryperdiem.com', hd: 'tryperdiem.com', name: 'Maya Cohen' }));
  assert.deepEqual(await google.exchangeCode('code'), { email: 'maya@tryperdiem.com', name: 'Maya Cohen' });
});

test('Google: personal Gmail, other workspaces and unverified emails are rejected', async (t) => {
  const cases = [
    { email: 'maya@gmail.com' },
    { email: 'maya@othercompany.com', hd: 'othercompany.com' },
    { email: 'maya@tryperdiem.com' }, // no hd claim = not a Workspace account
    { email: 'maya@tryperdiem.com', hd: 'tryperdiem.com', email_verified: false },
    { email: 'maya@tryperdiem.com', hd: 'tryperdiem.com', aud: 'someone-elses-app' },
  ];
  for (const claims of cases) {
    t.mock.method(globalThis, 'fetch', fakeGoogle(claims));
    await assert.rejects(google.exchangeCode('code'), undefined, JSON.stringify(claims));
    t.mock.restoreAll();
  }
});

test('Google: the sign-in link pins the tryperdiem.com domain', () => {
  const url = new URL(google.authorizeUrl('state123'));
  assert.equal(url.searchParams.get('hd'), 'tryperdiem.com');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
});

// ---------- the web app with Google on ----------

let app, base;
before(async () => {
  const db = await freshDb();
  await db.run("INSERT INTO settings (key, value) VALUES ('rotation_start', '2026-11-20')");
  app = createApp({ db, notifierOverrides: { slack: async () => {}, whatsapp: async () => {} } });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://localhost:${app.server.address().port}`;
});
after(() => app.server.close());

test('with Google on, password signup and login are disabled', async () => {
  const signup = await fetch(`${base}/signup`, { method: 'POST', body: 'email=a@tryperdiem.com', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(signup.status, 404);
  const page = await (await fetch(`${base}/login`)).text();
  assert.match(page, /Sign in with Google/);
  assert.doesNotMatch(page, /type="password"/);
});

test('Google round trip: new teammate adds Slack + WhatsApp; duplicates are refused', async (t) => {
  async function signIn(email, name) {
    const start = await fetch(`${base}/auth/google`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const oauthCookie = start.headers.getSetCookie()[0].split(';')[0];
    // Fake only Google's token endpoint; calls to our own server go through for real.
    t.mock.method(globalThis, 'fetch', async (url, opts) => (String(url).startsWith('https://oauth2.googleapis.com')
      ? fakeGoogle({ email, name, hd: 'tryperdiem.com' })(url)
      : realFetch(url, opts)));
    const cb = await fetch(`${base}/auth/google/callback?state=${state}&code=abc`, { redirect: 'manual', headers: { cookie: oauthCookie } });
    t.mock.restoreAll();
    return cb;
  }
  const realFetch = globalThis.fetch;
  const form = (o) => ({ method: 'POST', redirect: 'manual', body: new URLSearchParams(o).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  let cb = await signIn('ana@tryperdiem.com', 'Ana Admin');
  assert.equal(cb.headers.get('location'), '/welcome');
  let pending = cb.headers.getSetCookie().find((c) => c.startsWith('pd_pending=')).split(';')[0];
  let res = await fetch(`${base}/welcome`, { ...form({ name: 'Ana Admin', slack: 'U0ANA12345', whatsapp: '+14155550100' }),
    headers: { ...form({}).headers, cookie: pending } });
  assert.equal(res.status, 303);
  const ana = await app.db.get("SELECT * FROM users WHERE email = 'ana@tryperdiem.com'");
  assert.equal(ana.slack_user_id, 'U0ANA12345');
  assert.equal(ana.is_admin, 1);

  cb = await signIn('ben@tryperdiem.com', 'Ben');
  pending = cb.headers.getSetCookie().find((c) => c.startsWith('pd_pending=')).split(';')[0];
  const welcome = (fields) => fetch(`${base}/welcome`, { ...form(fields), headers: { ...form({}).headers, cookie: pending } });
  res = await welcome({ name: 'Ben', slack: 'U0ANA12345', whatsapp: '+14155550101' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Slack account already belongs to Ana Admin/);
  res = await welcome({ name: 'Ben', slack: 'U0BEN12345', whatsapp: '(415) 555-0100' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /WhatsApp number already belongs to Ana Admin/);
  res = await welcome({ name: 'Ben', slack: 'U0BEN12345', whatsapp: '+14155550101' });
  assert.equal(res.status, 303);

  // Returning user goes straight in.
  cb = await signIn('ana@tryperdiem.com', 'Ana Admin');
  assert.equal(cb.headers.get('location'), '/');
});

test('Google callback rejects a forged state', async () => {
  const res = await fetch(`${base}/auth/google/callback?state=forged&code=abc`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/login?error=1');
});

// ---------- calendar ----------

test('month calendar marks each weekend with the rotation', async () => {
  const grid = await calendar.monthGrid({ shifts: app.shifts, rotation: app.rotation }, 2026, 12);
  const byKey = Object.fromEntries(grid.weeks.flat().map((d) => [d.key, d]));
  assert.equal(byKey['2026-12-04'].entry.user.name, 'Ana Admin'); // Nov 20 Ana, Nov 27 Ben, Dec 4 Ana
  assert.ok(byKey['2026-12-04'].isStart);
  assert.equal(byKey['2026-12-07'].entry.user.name, 'Ana Admin');
  assert.ok(byKey['2026-12-07'].isEnd, 'Monday morning is the end of the shift');
  assert.equal(byKey['2026-12-08'].entry, null, 'Tuesday is not on call');
  assert.equal(byKey['2026-12-11'].entry.user.name, 'Ben');
  assert.deepEqual(grid.entries.map((e) => e.user.name), ['Ana Admin', 'Ben', 'Ana Admin', 'Ben']);
});

test('calendar feed needs the secret token and lists weekends', async () => {
  assert.equal((await fetch(`${base}/calendar.ics?token=nope`)).status, 404);
  const res = await fetch(`${base}/calendar.ics?token=${calendar.feedToken()}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  const ics = await res.text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:📟 On call: Ana Admin/);
  assert.match(ics, /DTSTART:20261204T230000Z/);
});
