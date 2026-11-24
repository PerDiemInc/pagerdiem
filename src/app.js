// Wires everything together and defines the HTTP routes.
import http from 'node:http';
import crypto from 'node:crypto';
import { config, slackEnabled, googleEnabled } from './config.js';
import * as google from './google.js';
import { makeShifts, formatLocal, formatRange, tzParts } from './time.js';
import * as calendar from './calendar.js';
import { makeRotation } from './rotation.js';
import { makeNotifier } from './notify/index.js';
import { makeIncidents } from './incidents.js';
import { makeScheduler } from './scheduler.js';
import { makePing } from './ping.js';
import { lookupUserIdByEmail, verifySlackSignature, mention, slackText, postMessage as slackPost } from './notify/slack.js';
import {
  hashPassword, verifyPassword, sessionCookie, clearSessionCookie, sessionUserId, parseCookies, safeEqual,
  signPayload, readPayload,
} from './auth.js';
import { HttpError, readBody, parseBody, makeResponder, makeRouter } from './http.js';
import * as views from './views.js';
import { normalizeCoverage, readSetting } from './settings.js';
import { isRole, isAdmin, isResponder } from './roles.js';
import { makeActions, EMAIL, REMOVED } from './actions.js';
import { makeDevices, CHALLENGE } from './devices.js';
import { appSignInRedirect } from './app-api.js';
import { registerAppApi } from './routes/app/index.js';

const safeBack = (value, fallback) => (/^\/(?![/\\])[^\r\n\\]*$/.test(String(value || '')) ? value : fallback);

export function createApp({ db, notifierOverrides, pingPost, pingFetch } = {}) {
  const shifts = makeShifts(config);
  const rotation = makeRotation(db, shifts);
  const notify = makeNotifier(db, notifierOverrides);
  const incidents = makeIncidents({ db, rotation, notify });
  const scheduler = makeScheduler({ db, shifts, rotation, notify, incidents });
  const ping = makePing({ db, rotation, post: pingPost ?? slackPost, fetchImpl: pingFetch });
  const actions = makeActions({ db, shifts, rotation, notify, scheduler });
  const devices = makeDevices(db);
  const { userCount, userByEmail, userBySlack, createMember } = actions;
  const router = makeRouter();
  const fmt = (d) => formatLocal(d, config.timezone);

  /** On startup with Slack connected, turn any stored Slack emails into member IDs. */
  async function relinkSlackUsers() {
    if (!slackEnabled()) return;
    const pending = (await db.all('SELECT * FROM users WHERE slack_user_id IS NULL OR slack_user_id LIKE \'%@%\''));
    for (const u of pending) {
      const id = await lookupUserIdByEmail(u.slack_user_id?.includes('@') ? u.slack_user_id : u.email).catch(() => null);
      if (id) (await db.run('UPDATE users SET slack_user_id = ? WHERE id = ?', [id, u.id]));
    }
  }

  function setFlash(r, type, message, extra = {}) {
    r.cookie(`pd_flash=${encodeURIComponent(JSON.stringify({ type, message, ...extra }))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60`);
  }
  /** Run an action and flash its message; a rule broken with `status` flashes as an error instead. */
  async function flashAction(ctx, status, fn) {
    try {
      setFlash(ctx.r, 'ok', (await fn()).message);
    } catch (err) {
      if (err.status !== status) throw err;
      setFlash(ctx.r, 'error', err.message);
    }
  }
  function takeFlash(ctx) {
    const raw = parseCookies(ctx.req.headers.cookie).pd_flash;
    if (!raw) return null;
    ctx.r.cookie('pd_flash=; Path=/; Max-Age=0');
    try { return JSON.parse(raw); } catch { return null; }
  }

  function requireUser(ctx) {
    if (!ctx.user) {
      ctx.r.redirect('/login'); // /login sends you on to /signup when nobody has signed up yet
      return false;
    }
    return true;
  }
  function requireAdmin(ctx) {
    if (!isAdmin(ctx.user)) throw new HttpError(403, 'Only admins can do that');
  }
  function requireResponder(ctx) {
    if (!isResponder(ctx.user)) throw new HttpError(403, 'Only engineers and admins can do that');
  }

  // Login throttling: 10 failed attempts per email+IP per 15 minutes.
  const failures = new Map();
  const throttleKey = (ctx, email) => `${ctx.ip}|${email}`;
  function tooManyAttempts(key) {
    const f = failures.get(key);
    if (!f || Date.now() - f.first > 15 * 60_000) { failures.delete(key); return false; }
    return f.count >= 10;
  }
  function recordFailure(key) {
    const f = failures.get(key);
    if (!f || Date.now() - f.first > 15 * 60_000) failures.set(key, { first: Date.now(), count: 1 });
    else f.count += 1;
  }

  // ---------- auth ----------
  // Production: "Sign in with Google", limited to your Google Workspace domain (ALLOWED_EMAIL_DOMAINS).
  // Local dev (no GOOGLE_CLIENT_ID): email + password, limited to the same email domains.

  function welcomeFlash(r, user, isFirst) {
    setFlash(r, 'ok', isFirst
      ? "Welcome! You're the first member, so you're an admin. Invite the rest of the team to sign up."
      : isResponder(user)
        ? "You're in the weekend rotation. Use “Send me a test message” on the Team page to check Slack."
        : "You're in. You can view the calendar and audit log and trigger an alert. Ask an admin if you should be on call.");
  }

  // Passwords can't prove someone works at your company, so they're only for local development.
  const passwordAuth = () => !googleEnabled() && !config.isProd;
  const authView = (mode, extra = {}) => views.authPage({
    mode, domains: config.allowedEmailDomains, google: googleEnabled(), notConfigured: !googleEnabled() && !passwordAuth(), ...extra,
  });

  router.get('/login', async (ctx) => {
    if (ctx.user) return ctx.r.redirect('/');
    if (passwordAuth() && (await userCount()) === 0) return ctx.r.redirect('/signup');
    ctx.r.html(authView('login', { error: ctx.query.get('error') ? 'Sign-in failed. Please try again.' : null }));
  });

  router.get('/signup', async (ctx) => {
    if (!passwordAuth()) return ctx.r.redirect('/login'); // Google covers sign-up too
    ctx.r.html(authView('signup'));
  });

  router.post('/signup', async (ctx) => {
    if (!passwordAuth()) throw new HttpError(404, 'Not found');
    const b = ctx.body;
    const fail = (error) => ctx.r.html(authView('signup', { values: b, error }), 400);
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return fail({ field: 'email', message: 'Please enter a valid email.' });
    if (config.allowedEmailDomains.length && !config.allowedEmailDomains.includes(email.split('@')[1])) {
      return fail({ field: 'email', message: `Sign up with your @${config.allowedEmailDomains.join(' or @')} email.` });
    }
    if (String(b.password || '').length < 10) return fail({ field: 'password', message: 'Password must be at least 10 characters.' });
    const { user, isFirst, error } = await createMember({
      name: b.name, email, slack: b.slack, whatsapp: b.whatsapp, passwordHash: hashPassword(String(b.password)),
    });
    if (error) return fail(error);
    ctx.r.cookie(sessionCookie(user.id));
    welcomeFlash(ctx.r, user, isFirst);
    ctx.r.redirect('/');
  });

  router.post('/login', async (ctx) => {
    if (!passwordAuth()) throw new HttpError(404, 'Not found');
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const key = throttleKey(ctx, email);
    const fail = (error) => ctx.r.html(authView('login', { values: { email }, error }), 400);
    if (tooManyAttempts(key)) return fail('Too many attempts. Try again in 15 minutes.');
    const user = await userByEmail(email);
    if (!user || !verifyPassword(String(ctx.body.password || ''), user.password_hash)) {
      recordFailure(key);
      return fail('Wrong email or password.');
    }
    failures.delete(key);
    if (!user.active) return ctx.r.html(authView('login', { values: { email }, error: REMOVED }), 403);
    ctx.r.cookie(sessionCookie(user.id));
    ctx.r.redirect('/');
  });

  // --- Google ---
  const OAUTH_COOKIE = 'pd_oauth';
  const PENDING_COOKIE = 'pd_pending';
  const tempCookie = (name, value, maxAge) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.publicUrl.startsWith('https://') ? '; Secure' : ''}`;

  router.get('/auth/google', async (ctx) => {
    if (!googleEnabled()) throw new HttpError(404, 'Not found');
    const state = crypto.randomBytes(16).toString('hex');
    // ?app=1: the phone app opened this sign-in and gets the result back as a pagerdiem:// link. It
    // must send a challenge, so only the app that started the sign-in can use what comes back.
    const app = ctx.query.get('app') === '1';
    const challenge = ctx.query.get('challenge') || '';
    if (app && !CHALLENGE.test(challenge)) throw new HttpError(400, 'This sign-in is missing its security check. Update the PagerDiem app and try again.');
    ctx.r.cookie(tempCookie(OAUTH_COOKIE, signPayload({ state, ...(app ? { app: true, ch: challenge } : {}) }, 600), 600));
    ctx.r.redirect(google.authorizeUrl(state), 302);
  });

  router.get('/auth/google/callback', async (ctx) => {
    if (!googleEnabled()) throw new HttpError(404, 'Not found');
    const saved = readPayload(parseCookies(ctx.req.headers.cookie)[OAUTH_COOKIE]);
    ctx.r.cookie(tempCookie(OAUTH_COOKIE, '', 0));
    const state = ctx.query.get('state');
    if (!saved || !state || !safeEqual(saved.state, state) || !ctx.query.get('code')) return ctx.r.redirect('/login?error=1');

    let identity;
    try {
      identity = await google.exchangeCode(ctx.query.get('code'));
    } catch (err) {
      if (err.status !== 403) console.error(err.message);
      if (saved.app) return ctx.r.redirect(appSignInRedirect({ error: err.status === 403 ? err.message : 'Sign-in failed. Please try again.' }), 302);
      if (err.status === 403) throw new HttpError(403, err.message);
      return ctx.r.redirect('/login?error=1');
    }
    const existing = await userByEmail(identity.email);
    if (saved.app) {
      // The phone gets a pairing code (or, for someone new, a signed sign-up to finish in the app).
      return ctx.r.redirect(existing && !existing.active
        ? appSignInRedirect({ error: REMOVED })
        : appSignInRedirect({ publicUrl: config.publicUrl, user: existing, identity, challenge: saved.ch }), 302);
    }
    if (existing) {
      if (!existing.active) throw new HttpError(403, REMOVED);
      ctx.r.cookie(sessionCookie(existing.id));
      return ctx.r.redirect('/');
    }
    // New teammate: ask for their Slack and phone number before adding them to the rotation.
    ctx.r.cookie(tempCookie(PENDING_COOKIE, signPayload(identity, 1800), 1800));
    ctx.r.redirect('/welcome');
  });

  const pendingIdentity = (ctx) => readPayload(parseCookies(ctx.req.headers.cookie)[PENDING_COOKIE]);

  router.get('/welcome', async (ctx) => {
    const identity = pendingIdentity(ctx);
    if (!identity) return ctx.r.redirect('/login');
    ctx.r.html(views.welcomePage({ identity, values: { name: identity.name } }));
  });

  router.post('/welcome', async (ctx) => {
    const identity = pendingIdentity(ctx);
    if (!identity) return ctx.r.redirect('/login');
    const { user, isFirst, error } = await createMember({
      name: ctx.body.name, email: identity.email, slack: ctx.body.slack, whatsapp: ctx.body.whatsapp,
      passwordHash: 'google', // no password: Google is the only way in
    });
    if (error) return ctx.r.html(views.welcomePage({ identity, values: ctx.body, error }), 400);
    ctx.r.cookie(tempCookie(PENDING_COOKIE, '', 0));
    ctx.r.cookie(sessionCookie(user.id));
    welcomeFlash(ctx.r, user, isFirst);
    ctx.r.redirect('/');
  });

  router.post('/logout', async (ctx) => { ctx.r.cookie(clearSessionCookie()); ctx.r.redirect('/login'); });

  // The theme is a per-browser choice, so it lives in a cookie rather than on the user.
  router.post('/theme', async (ctx) => {
    const theme = views.THEMES.includes(ctx.body.theme) ? ctx.body.theme : 'system';
    ctx.r.cookie(theme === 'system' ? 'pd_theme=; Path=/; Max-Age=0'
      : `pd_theme=${theme}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${config.publicUrl.startsWith('https://') ? '; Secure' : ''}`);
    ctx.r.redirect(safeBack(ctx.body.back, '/'));
  });

  // ---------- dashboard & schedule ----------
  router.get('/', async (ctx) => {
    if (!requireUser(ctx)) return;
    if (!isResponder(ctx.user)) return ctx.r.redirect('/calendar');
    const now = new Date();
    const onCall = await rotation.onCallNow(now);
    const schedule = await rotation.schedule(shifts.currentOrNext(now), 12);
    ctx.r.html(views.dashboardPage({
      user: ctx.user, now, onCall: onCall?.people.length ? onCall : null, runningShift: onCall?.shift ?? null,
      nextEntry: onCall ? null : schedule[0],
      backup: onCall?.people.length ? await rotation.backupFor(onCall.shift) : null,
      schedule,
      coverage: shifts.coverage(),
      balance: await rotation.balance(schedule),
      recentLog: await rotation.log({ limit: 8 }),
      openIncidents: (await incidents.list()).filter((i) => i.status !== 'resolved'),
      flash: takeFlash(ctx),
    }));
  });

  // Add or remove YOURSELF for a weekend. There is deliberately no way to change anyone else.
  async function rosterChange(ctx, action) {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    const fn = action === 'join' ? actions.joinWeekend : actions.leaveWeekend;
    const result = await fn(ctx.user, ctx.params.key, 'web');
    if (result.changed) setFlash(ctx.r, 'ok', result.message);
    ctx.r.redirect(ctx.body.back === 'calendar' ? `/calendar?month=${ctx.params.key.slice(0, 7)}` : '/');
  }
  router.post('/weekends/:key/join', (ctx) => rosterChange(ctx, 'join'));
  router.post('/weekends/:key/leave', (ctx) => rosterChange(ctx, 'leave'));

  // "Take their spot": you're in, they're out. Undoable by you for 10 seconds; Slack and the
  // replaced person hear about it only after that window passes (see announceSwaps).
  router.post('/weekends/:key/swap', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    const r = await actions.swapWeekend(ctx.user, ctx.params.key, ctx.body.user_id, 'web');
    setFlash(ctx.r, 'ok', r.message, { undo: { id: r.undo.ids[0], until: new Date(r.undo.until).getTime() } });
    ctx.r.redirect(`/calendar?month=${ctx.params.key.slice(0, 7)}`);
  });

  router.post('/swaps/:id/undo', async (ctx) => {
    if (!requireUser(ctx)) return;
    let undone;
    try {
      undone = await actions.undoSwap(ctx.user, [ctx.params.id], 'web');
    } catch (err) {
      setFlash(ctx.r, 'error', err.message);
      return ctx.r.redirect(safeBack(ctx.body.back, '/calendar'));
    }
    setFlash(ctx.r, 'ok', undone.message);
    ctx.r.redirect(safeBack(ctx.body.back, '/calendar'));
  });

  // Public (to everyone signed in) history of who added or removed themselves.
  router.get('/log', async (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.r.html(views.logPage({ user: ctx.user, log: await rotation.log({ limit: 1000 }), flash: takeFlash(ctx) }));
  });

  // ---------- calendar ----------
  router.get('/calendar', async (ctx) => {
    if (!requireUser(ctx)) return;
    const today = tzParts(new Date(), config.timezone);
    const m = /^(\d{4})-(\d{2})$/.exec(ctx.query.get('month') || '');
    const year = m ? Number(m[1]) : today.year;
    const month = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : today.month;
    const ym = (y, mo) => `${y}-${String(mo).padStart(2, '0')}`;
    const prev = month === 1 ? ym(year - 1, 12) : ym(year, month - 1);
    const next = month === 12 ? ym(year + 1, 1) : ym(year, month + 1);
    ctx.r.html(views.calendarPage({
      user: ctx.user,
      grid: await calendar.monthGrid({ shifts, rotation }, year, month),
      prevMonth: prev, nextMonth: next, thisMonth: ym(today.year, today.month),
      feedUrl: `${config.publicUrl}/calendar.ics?token=${calendar.feedToken()}`,
      flash: takeFlash(ctx),
    }));
  });

  // Subscribable feed for Google Calendar etc. Calendar apps can't log in, so it uses a secret token.
  router.get('/calendar.ics', async (ctx) => {
    if (!safeEqual(ctx.query.get('token') || '', calendar.feedToken())) throw new HttpError(404, 'Not found');
    ctx.r.calendar(await calendar.icsFeed({ shifts, rotation }));
  });

  // ---------- incidents ----------
  router.get('/incidents', async (ctx) => {
    if (!requireUser(ctx)) return;
    const status = ['open', 'acknowledged', 'resolved'].includes(ctx.query.get('status')) ? ctx.query.get('status') : null;
    const now = new Date();
    ctx.r.html(views.incidentsPage({
      user: ctx.user, incidents: await incidents.list({ limit: 200, status }), status, stats: await incidents.stats(now), now, flash: takeFlash(ctx),
    }));
  });

  router.post('/incidents', async (ctx) => {
    if (!requireUser(ctx)) return;
    const inc = await incidents.create({ title: ctx.body.title, details: ctx.body.details, source: 'web', createdBy: ctx.user.id });
    const who = (await rotation.userById(inc.assigned_user_id));
    setFlash(ctx.r, 'ok', who ? `Paged the on-call on Slack.` : 'Nobody is on call — alerted the team channel.');
    ctx.r.redirect(`/incidents/${inc.id}`);
  });

  router.get('/incidents/:id', async (ctx) => {
    if (!requireUser(ctx)) return;
    const inc = (await incidents.get(Number(ctx.params.id)));
    if (!inc) throw new HttpError(404, 'Incident not found');
    ctx.r.html(views.incidentPage({
      user: ctx.user, inc, events: (await incidents.events(inc.id)), notes: await incidents.notes(inc.id),
      people: { assigned: (await rotation.userById(inc.assigned_user_id)), backup: (await rotation.userById(inc.backup_user_id)) },
      notifications: (await db.all('SELECT * FROM notifications WHERE incident_id = ? ORDER BY id DESC', [inc.id])),
      names: Object.fromEntries((await db.all('SELECT slack_user_id, name FROM users WHERE slack_user_id IS NOT NULL')).map((u) => [u.slack_user_id, u.name])),
      flash: takeFlash(ctx),
    }));
  });

  router.post('/incidents/:id/ack', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    const { changed } = await incidents.acknowledge(Number(ctx.params.id), ctx.user, 'web');
    setFlash(ctx.r, 'ok', changed ? 'Acknowledged. Paging stopped.' : 'Already acknowledged.');
    ctx.r.redirect(ctx.body.back === 'home' ? '/' : `/incidents/${ctx.params.id}`);
  });

  router.post('/incidents/:id/resolve', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    await incidents.resolve(Number(ctx.params.id), ctx.user, 'web');
    setFlash(ctx.r, 'ok', 'Resolved.');
    ctx.r.redirect(`/incidents/${ctx.params.id}`);
  });

  // ---------- team ----------
  router.get('/team', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    const role = isRole(ctx.query.get('role')) ? ctx.query.get('role') : '';
    const link = appSignInRedirect({ publicUrl: config.publicUrl, user: ctx.user });
    ctx.r.html(views.teamPage({
      user: ctx.user, role, members: (await rotation.activeMembers()),
      phoneApp: { qr: views.qrSvg(link), phones: await devices.listForUser(ctx.user.id) },
      inactive: (await db.all('SELECT * FROM users WHERE active = 0 ORDER BY name')),
      flash: takeFlash(ctx),
    }));
  });

  router.post('/team/:id/move', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    await actions.moveMember(ctx.user, ctx.params.id, ctx.body.dir, 'web');
    ctx.r.redirect('/team');
  });

  router.post('/team/:id/active', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    await flashAction(ctx, 409, () => actions.setActive(ctx.user, ctx.params.id, ctx.body.active === '1', 'web'));
    ctx.r.redirect('/team');
  });

  router.post('/team/:id/role', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    await flashAction(ctx, 409, () => actions.setRole(ctx.user, ctx.params.id, ctx.body.role, 'web'));
    ctx.r.redirect('/team');
  });

  // Sign one of your own phones out of the app.
  router.post('/devices/:id/revoke', async (ctx) => {
    if (!requireUser(ctx)) return;
    const id = Number(ctx.params.id);
    const device = Number.isSafeInteger(id) ? await devices.get(id) : null;
    if (!device || device.user_id !== ctx.user.id || device.revoked_at) throw new HttpError(404, 'Phone not found');
    await devices.revoke(device.id);
    setFlash(ctx.r, 'ok', `Signed out of ${device.name}. It won't ring for pages any more.`);
    ctx.r.redirect('/team');
  });

  router.post('/profile', async (ctx) => {
    if (!requireUser(ctx)) return;
    const { error } = await actions.updateProfile(ctx.user, { name: ctx.body.name, slack: ctx.body.slack, phone: ctx.body.whatsapp });
    setFlash(ctx.r, error ? 'error' : 'ok', error ? error.message : 'Saved.');
    ctx.r.redirect('/team');
  });

  router.post('/profile/test', async (ctx) => {
    if (!requireUser(ctx)) return;
    const results = await notify.user(ctx.user, {
      text: ':white_check_mark: PagerDiem test — this is how on-call pages will reach you on Slack.',
    });
    const channels = ['Slack'];
    const describe = (r, name) => (!r.ok ? `${name} failed` : r.dryRun ? `${name} not connected yet (logged only)` : `${name} sent`);
    const summary = results.map((r, i) => describe(r, channels[i])).join(' · ');
    setFlash(ctx.r, results.some((x) => !x.ok) ? 'error' : 'ok',
      `${summary}.${results.some((x) => !x.ok) ? ' See Settings → Recent messages for the error.' : ''}`);
    ctx.r.redirect('/team');
  });

  // Admin only: re-send this weekend's "you're on call now" messages.
  router.post('/admin/resend-weekend-start', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    await flashAction(ctx, 409, () => actions.resendWeekendStart(ctx.user, 'web'));
    ctx.r.redirect('/settings');
  });

  /** Load the coverage an admin saved in Settings. Call once at startup. */
  async function loadSettings() {
    const saved = await readSetting(db, 'coverage');
    if (saved) {
      try {
        const { coverage } = normalizeCoverage(JSON.parse(saved));
        if (coverage) shifts.setCoverage(coverage);
      } catch (err) {
        console.error('ignoring saved coverage:', err.message);
      }
    }
  }

  router.post('/settings/coverage', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    const b = ctx.body;
    await flashAction(ctx, 400, () => actions.saveCoverage(ctx.user, {
      preset: b.preset, days: [0, 1, 2, 3, 4, 5, 6].filter((d) => b[`day_${d}`] === '1'),
      start: b.start, end: b.end, weekendCount: b.weekend_count, weekdayCount: b.weekday_count,
    }, 'web'));
    ctx.r.redirect('/settings');
  });

  router.get('/settings', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    ctx.r.html(views.settingsPage({
      user: ctx.user, coverage: shifts.coverage(), domains: config.allowedEmailDomains, ping: ping.status(),
      status: { slack: slackEnabled(), api: Boolean(config.apiToken) },
      notifications: (await db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 30')),
      flash: takeFlash(ctx),
    }));
  });

  // ---------- Slack ----------
  function requireSlackSignature(ctx) {
    if (!verifySlackSignature(ctx.req.headers, ctx.raw)) throw new HttpError(401, 'Bad Slack signature');
    if (config.slack.teamId) {
      let team = ctx.body.team_id;
      if (!team && ctx.body.payload) {
        try { team = JSON.parse(ctx.body.payload).team?.id; } catch { team = null; }
      }
      if (team !== config.slack.teamId) throw new HttpError(403, 'This Slack workspace is not allowed');
    }
  }

  async function onCallSummary() {
    const now = new Date();
    const onCall = await rotation.onCallNow(now);
    const upcoming = await rotation.schedule(onCall ? shifts.next(now) : shifts.currentOrNext(now), 4);
    const lines = [];
    if (onCall?.people.length) {
      const backup = await rotation.backupFor(onCall.shift);
      lines.push(`:pager: *On call now:* ${onCall.people.map(mention).join(' and ')} until ${fmt(onCall.shift.end)}${backup ? ` (backup ${mention(backup)})` : ''}`);
    } else {
      lines.push(':zzz: Nobody is on call right now. `/page` alerts the whole channel.');
    }
    lines.push('*Upcoming weekends:*');
    for (const e of upcoming) {
      lines.push(`• ${formatRange(e.shift, config.timezone)}: ${e.people.map((p) => p.name).join(', ') || 'nobody'}${e.needsCover ? ' — :warning: needs cover' : ''}`);
    }
    lines.push(`<${config.publicUrl}/|Open PagerDiem>`);
    return lines.join('\n');
  }

  router.post('/slack/commands', async (ctx) => {
    requireSlackSignature(ctx);
    const { command, text = '', user_id: slackUser } = ctx.body;
    const title = text.trim();
    if (command === '/page' || (command !== '/oncall' && title.toLowerCase().startsWith('page '))) {
      const what = command === '/page' ? title : title.slice(5).trim();
      if (!what) return ctx.r.json({ response_type: 'ephemeral', text: 'Usage: `/page <what is broken>`' });
      const creator = (await userBySlack(slackUser));
      const onCall = (await rotation.onCallNow());
      // Slack needs an answer within 3 seconds, so page in the background.
      incidents.create({ title: what, source: 'slack', createdBy: creator?.id ?? null })
        .catch((err) => console.error('slack /page failed:', err));
      return ctx.r.json({
        response_type: 'in_channel',
        text: onCall?.people.length ? `:rotating_light: Paging ${onCall.people.map(mention).join(' and ')}: *${slackText(what)}*` : `:rotating_light: *${slackText(what)}* — nobody is on call, alerting the channel.`,
      });
    }
    if (command === '/ping') {
      const verdict = ping.accept({ user: await userBySlack(slackUser) });
      if (!verdict.ok) return ctx.r.json({ response_type: 'ephemeral', text: verdict.message });
      const asker = await userBySlack(slackUser);
      ping.run({ text, channel: ctx.body.channel_id, user: asker, responseUrl: ctx.body.response_url })
        .catch((err) => console.error('slack /ping failed:', err.message));
      return ctx.r.json({ response_type: 'ephemeral', text: ':mag: On it. I will reply in a thread when I have something.' });
    }
    return ctx.r.json({ response_type: 'ephemeral', text: (await onCallSummary()) });
  });

  router.post('/slack/interactions', async (ctx) => {
    requireSlackSignature(ctx);
    let payload;
    try { payload = JSON.parse(ctx.body.payload || '{}'); } catch { throw new HttpError(400, 'Bad payload'); }
    const action = payload.actions?.[0];
    ctx.r.text(''); // acknowledge within 3 seconds; do the work after
    if (!action || !['ack', 'resolve'].includes(action.action_id)) return;
    const user = (await userBySlack(payload.user?.id));
    const id = Number(action.value);
    if (!user || !user.active || !isResponder(user)) {
      if (payload.response_url) {
        fetch(payload.response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replace_original: false, response_type: 'ephemeral', text: 'Only engineers and admins with a PagerDiem account can acknowledge or resolve incidents.' }),
        }).catch((err) => console.error('slack interaction failed:', err));
      }
      return;
    }
    (async () => {
      const fn = action.action_id === 'ack' ? incidents.acknowledge : incidents.resolve;
      const { changed, incident } = await fn(id, user, 'slack');
      if (payload.response_url) {
        await fetch(payload.response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            replace_original: false, response_type: 'ephemeral',
            text: changed ? `Incident #${id} ${incident.status}.` : `Incident #${id} is already ${incident.status}.`,
          }),
        });
      }
    })().catch((err) => console.error('slack interaction failed:', err));
  });

  // ---------- alerts API ----------
  function requireApiToken(ctx) {
    const auth = String(ctx.req.headers.authorization || '');
    if (!config.apiToken || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), config.apiToken)) {
      throw new HttpError(401, 'Unauthorized');
    }
  }

  router.post('/api/incidents', async (ctx) => {
    requireApiToken(ctx);
    const inc = await incidents.create({ title: ctx.body.title, details: ctx.body.details, source: String(ctx.body.source || 'api').slice(0, 30), dedupe: true });
    ctx.r.json({
      id: inc.id, status: inc.status, paged: (await rotation.userById(inc.assigned_user_id))?.name ?? null,
      url: `${config.publicUrl}/incidents/${inc.id}`, ...(inc.repeat ? { repeat: true } : {}),
    }, inc.repeat ? 200 : 201);
  });

  router.get('/api/oncall', async (ctx) => {
    requireApiToken(ctx); // names are team-internal
    const onCall = (await rotation.onCallNow());
    ctx.r.json({
      on_call: onCall?.people.length ? { names: onCall.people.map((p) => p.name), until: onCall.shift.end.toISOString() } : null,
      next: (await rotation.schedule(onCall ? shifts.next(new Date()) : shifts.currentOrNext(new Date()), 1))
        .map((e) => ({ names: e.people.map((p) => p.name), starts: e.shift.start.toISOString() }))[0],
    });
  });

  router.get('/undo.js', async (ctx) => ctx.r.script(views.UNDO_SCRIPT));

  router.get('/healthz', async (ctx) => ctx.r.json({ ok: true }));

  registerAppApi({ router, db, shifts, rotation, incidents, notify, actions, devices });

  // ---------- server ----------
  // Browsers send Sec-Fetch-Site / Origin on form posts. Slack and the API authenticate with a
  // signature or token instead, so they are exempt.
  function isSameOrigin(req, pathname) {
    if (pathname.startsWith('/slack/') || pathname.startsWith('/api/')) return true;
    // Sec-Fetch-Site is the reliable signal: with Referrer-Policy no-referrer, Chrome sends Origin: null
    // on the app's own form posts. Origin is only the fallback for browsers that don't send it.
    const site = req.headers['sec-fetch-site'];
    if (site) return ['same-origin', 'none'].includes(site);
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      try { return new URL(origin).host === new URL(config.publicUrl).host || new URL(origin).host === req.headers.host; } catch { return false; }
    }
    return origin !== 'null';
  }

  async function handle(req, res) {
    const r = makeResponder(res);
    let url = new URL('http://localhost/');
    const ctx = { req, r, query: url.searchParams, params: {}, body: {}, raw: '', user: null, device: null,
      ip: req.socket.remoteAddress };
    try {
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        throw new HttpError(400, 'Bad request');
      }
      ctx.query = url.searchParams;
      if (req.method === 'POST' && !isSameOrigin(req, url.pathname)) throw new HttpError(403, 'Cross-site request blocked');
      const found = router.match(req.method, url.pathname);
      if (!found) throw new HttpError(404, 'Not found');
      ctx.params = found.params;
      if (req.method === 'POST') {
        ctx.raw = await readBody(req);
        ctx.body = parseBody(ctx.raw, req.headers['content-type']);
      }
      // The phone app signs every request with its own bearer token instead of a cookie.
      const bearer = url.pathname.startsWith('/api/app/') && /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
      if (bearer) {
        const auth = await devices.authenticate(bearer);
        ctx.user = auth?.user ?? null;
        ctx.device = auth?.device ?? null;
      } else {
        const uid = sessionUserId(req.headers.cookie);
        // Sessions are stateless cookies, so a removed teammate is shut out by checking on every request.
        const sessionUser = uid ? await rotation.userById(uid) : null;
        ctx.user = sessionUser?.active
          ? { ...sessionUser, openIncidents: Number((await db.get("SELECT COUNT(*) AS n FROM incidents WHERE status = 'open'")).n),
            theme: parseCookies(req.headers.cookie).pd_theme, path: url.pathname + url.search }
          : null;
      }
      await found.handler(ctx);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      const message = status === 500 ? 'Something went wrong.' : err.message;
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/slack/')) r.json({ error: message, ...(err.field ? { field: err.field } : {}) }, status);
      else r.html(views.messagePage({ user: ctx.user, title: status === 404 ? 'Not found' : 'Oops', message, link: { href: '/', label: 'Back' } }), status);
    }
  }

  const server = http.createServer(handle);
  // Swaps announce themselves after their undo window; this catches any a restart left behind.
  scheduler.addStep?.(actions.announceMissedSwaps);
  return { server, scheduler, rotation, ping, loadSettings, announceSwaps: actions.announceSwaps, incidents, shifts, relinkSlackUsers, db, devices };
}
