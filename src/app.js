// Wires everything together and defines the HTTP routes.
import http from 'node:http';
import crypto from 'node:crypto';
import { config, slackEnabled, whatsappEnabled, googleEnabled } from './config.js';
import * as google from './google.js';
import { makeShifts, formatLocal, formatRange, parseKey, tzParts } from './time.js';
import * as calendar from './calendar.js';
import { makeRotation } from './rotation.js';
import { makeNotifier } from './notify/index.js';
import { makeIncidents } from './incidents.js';
import { makeScheduler } from './scheduler.js';
import { lookupUserIdByEmail, verifySlackSignature, mention } from './notify/slack.js';
import { normalizePhone, verifyTwilioSignature } from './notify/whatsapp.js';
import {
  hashPassword, verifyPassword, sessionCookie, clearSessionCookie, sessionUserId, parseCookies, safeEqual,
  signPayload, readPayload,
} from './auth.js';
import { HttpError, readBody, parseBody, makeResponder, makeRouter } from './http.js';
import * as views from './views.js';
import { DEFAULT_ROLE, isRole, isAdmin, isResponder } from './roles.js';

const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp({ db, notifierOverrides } = {}) {
  const shifts = makeShifts(config);
  const rotation = makeRotation(db, shifts, { perWeekend: config.perWeekend });
  const notify = makeNotifier(db, notifierOverrides);
  const incidents = makeIncidents({ db, rotation, notify });
  const scheduler = makeScheduler({ db, shifts, rotation, notify, incidents });
  const router = makeRouter();
  const fmt = (d) => formatLocal(d, config.timezone);

  // ---------- helpers ----------
  const userCount = async () => (await db.get('SELECT COUNT(*) AS n FROM users')).n;
  const userByEmail = async (email) => (await db.get('SELECT * FROM users WHERE email = ?', [email]));
  const userBySlack = async (id) => (id ? (await db.get('SELECT * FROM users WHERE slack_user_id = ?', [id])) : null);
  const userByPhone = async (phone) => (phone ? (await db.get('SELECT * FROM users WHERE whatsapp = ?', [phone])) : null);

  /** Turn "U0123ABCD" or an email into a Slack member ID (when Slack is connected). */
  async function resolveSlack(value, fallbackEmail) {
    const v = String(value || '').trim() || fallbackEmail;
    if (SLACK_ID.test(v.toUpperCase())) return v.toUpperCase();
    if (!slackEnabled()) return v || null; // dry-run: keep what they typed, relinked once Slack is connected
    return EMAIL.test(v) ? lookupUserIdByEmail(v) : null;
  }

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

  /**
   * Validate and add a team member. Each person must have their own Slack account and
   * WhatsApp number. Returns { user } or { error }.
   */
  async function createMember({ name, email, slack, whatsapp: rawPhone, passwordHash }) {
    name = String(name || '').trim().slice(0, 80);
    const whatsapp = normalizePhone(rawPhone);
    if (!name) return { error: 'Please enter your name.' };
    if (!whatsapp) return { error: 'Please enter your WhatsApp number with country code, e.g. +1 415 555 0123.' };
    if (await userByEmail(email)) return { error: 'That email is already signed up — log in instead.' };
    const slackId = await resolveSlack(slack, email);
    if (!slackId) return { error: "We couldn't find you on Slack. Enter your Slack member ID (Slack profile → ⋮ → Copy member ID)." };
    const clash = await contactClash({ slackId, whatsapp });
    if (clash) return { error: clash };

    const isFirst = (await userCount()) === 0;
    const role = isFirst ? 'admin' : DEFAULT_ROLE;
    const { id } = await db.get(`INSERT INTO users (name, email, password_hash, slack_user_id, whatsapp, is_admin, role, rotation_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [name, email, passwordHash, slackId, whatsapp, isFirst ? 1 : 0, role, await rotation.nextRotationOrder()]);
    const user = await rotation.userById(Number(id));
    if (isResponder(user)) await notify.channel({ text: `:wave: ${mention(user)} joined the weekend on-call rotation.` });
    return { user, isFirst };
  }

  /** Someone else already uses this Slack account or phone number? Returns a message or null. */
  async function contactClash({ slackId, whatsapp, exceptId = null }) {
    const bySlack = await userBySlack(slackId);
    if (bySlack && bySlack.id !== exceptId) return `That Slack account already belongs to ${bySlack.name}. Use your own Slack account.`;
    const byPhone = await userByPhone(whatsapp);
    if (byPhone && byPhone.id !== exceptId) return `That WhatsApp number already belongs to ${byPhone.name}. Use your own number.`;
    return null;
  }

  function welcomeFlash(r, user, isFirst) {
    setFlash(r, 'ok', isFirst
      ? "Welcome! You're the first member, so you're an admin. Invite the rest of the team to sign up."
      : isResponder(user)
        ? "You're in the weekend rotation. Use “Send me a test message” on the Team page to check Slack and WhatsApp."
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
    if (!EMAIL.test(email)) return fail('Please enter a valid email.');
    if (config.allowedEmailDomains.length && !config.allowedEmailDomains.includes(email.split('@')[1])) {
      return fail(`Sign up with your @${config.allowedEmailDomains.join(' or @')} email.`);
    }
    if (String(b.password || '').length < 10) return fail('Password must be at least 10 characters.');
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
    ctx.r.cookie(tempCookie(OAUTH_COOKIE, signPayload({ state }, 600), 600));
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
      if (err.status === 403) throw new HttpError(403, err.message);
      console.error(err.message);
      return ctx.r.redirect('/login?error=1');
    }
    const existing = await userByEmail(identity.email);
    if (existing) {
      ctx.r.cookie(sessionCookie(existing.id));
      return ctx.r.redirect('/');
    }
    // New teammate: ask for their Slack and WhatsApp before adding them to the rotation.
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

  // ---------- dashboard & schedule ----------
  router.get('/', async (ctx) => {
    if (!requireUser(ctx)) return;
    if (!isResponder(ctx.user)) return ctx.r.redirect('/calendar');
    const now = new Date();
    const onCall = await rotation.onCallNow(now);
    const schedule = await rotation.schedule(shifts.currentOrNext(now), 12);
    ctx.r.html(views.dashboardPage({
      user: ctx.user, now, onCall: onCall?.people.length ? onCall : null,
      nextEntry: onCall ? null : schedule[0],
      backup: onCall?.people.length ? await rotation.backupFor(onCall.shift) : null,
      schedule,
      perWeekend: rotation.perWeekend,
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
    parseKey(ctx.params.key);
    const shift = shifts.forKey(ctx.params.key);
    const fn = action === 'join' ? rotation.join : rotation.leave;
    let result;
    try {
      result = await fn(shift, ctx.user);
    } catch (err) {
      throw new HttpError(err.status || 500, err.message);
    }
    const range = formatRange(shift, config.timezone);
    if (result.changed) {
      const { entry } = result;
      const short = entry.needsCover ? ` :warning: Now ${entry.people.length}/${rotation.perWeekend} — needs cover.` : '';
      await notify.channel({
        text: action === 'join'
          ? `:raised_hand: ${mention(ctx.user)} added themselves to the weekend of ${range}. On call: ${entry.people.map(mention).join(', ')}.`
          : `:wave: ${mention(ctx.user)} removed themselves from the weekend of ${range}. On call: ${entry.people.map(mention).join(', ') || 'nobody'}.${short}`,
      });
      setFlash(ctx.r, 'ok', action === 'join' ? `You're on call for ${range}.` : `You're off ${range}.${entry.needsCover ? ' That weekend now needs cover.' : ''}`);
    }
    ctx.r.redirect(ctx.body.back === 'calendar' ? `/calendar?month=${ctx.params.key.slice(0, 7)}` : '/');
  }
  router.post('/weekends/:key/join', (ctx) => rosterChange(ctx, 'join'));
  router.post('/weekends/:key/leave', (ctx) => rosterChange(ctx, 'leave'));

  // "Take their spot": you're in, they're out. Undoable by you for 10 seconds; Slack and the
  // replaced person hear about it only after that window passes (see announceSwaps).
  router.post('/weekends/:key/swap', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    parseKey(ctx.params.key);
    const shift = shifts.forKey(ctx.params.key);
    const replaced = await rotation.userById(Number(ctx.body.user_id));
    if (!replaced) throw new HttpError(400, 'Pick someone on that weekend.');
    let row;
    try {
      row = await rotation.swap(shift, ctx.user, replaced.id);
    } catch (err) {
      throw new HttpError(err.status || 500, err.message);
    }
    setTimeout(() => announceSwaps().catch((err) => console.error('announce swaps failed:', err)), rotation.UNDO_MS + 2_500).unref?.();
    setFlash(ctx.r, 'ok', `You took ${replaced.name}'s spot for ${formatRange(shift, config.timezone)}.`,
      { undo: { id: row.id, until: new Date(row.at).getTime() + rotation.UNDO_MS } });
    ctx.r.redirect(`/calendar?month=${ctx.params.key.slice(0, 7)}`);
  });

  router.post('/swaps/:id/undo', async (ctx) => {
    if (!requireUser(ctx)) return;
    let undone;
    try {
      undone = await rotation.undoSwap(Number(ctx.params.id), ctx.user);
    } catch (err) {
      setFlash(ctx.r, 'error', err.message);
      return ctx.r.redirect(ctx.body.back || '/calendar');
    }
    setFlash(ctx.r, 'ok', undone ? 'Swap undone. Nothing changed and nobody was notified.' : 'Already undone.');
    ctx.r.redirect(ctx.body.back || '/calendar');
  });

  /** Tell Slack and the replaced person about swaps whose undo window has passed. */
  async function announceSwaps(now = new Date()) {
    for (const s of await rotation.claimSwapsToAnnounce(now)) {
      const shift = shifts.forKey(s.weekend_key);
      const by = await rotation.userById(s.by_user_id);
      const replaced = await rotation.userById(s.replaced_user_id);
      const range = formatRange(shift, config.timezone);
      await notify.user(replaced, { text: `:repeat: ${by.name} took your on-call spot for the weekend of ${range}. You're off that weekend.` });
      await notify.channel({ text: `:repeat: ${mention(by)} took ${mention(replaced)}'s spot for the weekend of ${range}.` });
    }
  }

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
      perWeekend: rotation.perWeekend,
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
    ctx.r.html(views.incidentsPage({ user: ctx.user, incidents: (await incidents.list({ limit: 200 })), now: new Date(), flash: takeFlash(ctx) }));
  });

  router.post('/incidents', async (ctx) => {
    if (!requireUser(ctx)) return;
    const inc = await incidents.create({ title: ctx.body.title, details: ctx.body.details, source: 'web', createdBy: ctx.user.id });
    const who = (await rotation.userById(inc.assigned_user_id));
    setFlash(ctx.r, 'ok', who ? `Paged ${who.name} on Slack and WhatsApp.` : 'Nobody is on call — alerted the team channel.');
    ctx.r.redirect(`/incidents/${inc.id}`);
  });

  router.get('/incidents/:id', async (ctx) => {
    if (!requireUser(ctx)) return;
    const inc = (await incidents.get(Number(ctx.params.id)));
    if (!inc) throw new HttpError(404, 'Incident not found');
    ctx.r.html(views.incidentPage({
      user: ctx.user, inc, events: (await incidents.events(inc.id)),
      people: { assigned: (await rotation.userById(inc.assigned_user_id)), backup: (await rotation.userById(inc.backup_user_id)) },
      notifications: (await db.all('SELECT * FROM notifications WHERE incident_id = ? ORDER BY id DESC', [inc.id])),
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

  // One-tap acknowledge link from WhatsApp. GET only shows a button, because chat apps
  // pre-fetch links for previews and a GET must never acknowledge by itself.
  async function ackTarget(ctx) {
    const inc = (await incidents.get(Number(ctx.params.id)));
    const token = ctx.query.get('t') || ctx.body.t;
    if (!inc || !token || !safeEqual(token, inc.ack_token)) throw new HttpError(404, 'This link is not valid.');
    return inc;
  }
  router.get('/ack/:id', async (ctx) => {
    const inc = await ackTarget(ctx);
    const body = `<div class="auth card"><h1>#${inc.id} ${views.esc(inc.title)}</h1>
      <p><span class="pill ${inc.status}">${inc.status}</span></p>
      ${inc.status === 'open' ? `<form method="post" action="/ack/${inc.id}"><input type="hidden" name="t" value="${views.esc(inc.ack_token)}">
        <button class="primary">Acknowledge</button></form>` : '<p>Nothing to do — someone already has it.</p>'}</div>`;
    ctx.r.html(views.layout({ title: `Incident #${inc.id}`, user: ctx.user, body }));
  });
  router.post('/ack/:id', async (ctx) => {
    const inc = await ackTarget(ctx);
    const by = ctx.user || (await rotation.userById(inc.escalation_level === 1 ? inc.backup_user_id : inc.assigned_user_id));
    const { changed } = await incidents.acknowledge(inc.id, by, 'link');
    ctx.r.html(views.messagePage({
      user: ctx.user, title: changed ? 'Acknowledged ✅' : 'Already acknowledged',
      message: changed ? 'Paging has stopped. The team channel knows you have it.' : 'Someone is already on it.',
      link: ctx.user ? { href: `/incidents/${inc.id}`, label: 'Open incident' } : null,
    }));
  });

  // ---------- team ----------
  router.get('/team', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    ctx.r.html(views.teamPage({
      user: ctx.user, members: (await rotation.activeMembers()),
      inactive: (await db.all('SELECT * FROM users WHERE active = 0 ORDER BY name')),
      flash: takeFlash(ctx),
    }));
  });

  router.post('/team/:id/move', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    (await rotation.move(Number(ctx.params.id), Number(ctx.body.dir) < 0 ? -1 : 1));
    ctx.r.redirect('/team');
  });

  router.post('/team/:id/active', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    const active = ctx.body.active === '1' ? 1 : 0;
    const id = Number(ctx.params.id);
    if (active) await db.run('UPDATE users SET active = 1, rotation_order = ? WHERE id = ?', [await rotation.nextRotationOrder(), id]);
    else await db.run('UPDATE users SET active = 0 WHERE id = ?', [id]);
    setFlash(ctx.r, 'ok', active ? 'Added back to the end of the rotation.' : 'Removed from the rotation.');
    ctx.r.redirect('/team');
  });

  router.post('/team/:id/role', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    const role = String(ctx.body.role || '');
    if (!isRole(role)) throw new HttpError(400, 'Pick a role.');
    const target = await rotation.userById(Number(ctx.params.id));
    if (!target) throw new HttpError(404, 'Person not found');
    if (target.role === 'admin' && role !== 'admin') {
      const admins = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1");
      if (admins.n <= 1) {
        setFlash(ctx.r, 'error', 'There must be at least one admin.');
        return ctx.r.redirect('/team');
      }
    }
    await db.run('UPDATE users SET role = ?, is_admin = ? WHERE id = ?', [role, role === 'admin' ? 1 : 0, target.id]);
    setFlash(ctx.r, 'ok', `${target.name} is now ${role.replace('_', '-')}.`);
    ctx.r.redirect('/team');
  });

  router.post('/profile', async (ctx) => {
    if (!requireUser(ctx)) return;
    const name = String(ctx.body.name || '').trim().slice(0, 80);
    const whatsapp = normalizePhone(ctx.body.whatsapp);
    if (!name || !whatsapp) {
      setFlash(ctx.r, 'error', 'Name and a WhatsApp number with country code are required.');
      return ctx.r.redirect('/team');
    }
    const slackId = await resolveSlack(ctx.body.slack, ctx.user.email);
    if (!slackId) {
      setFlash(ctx.r, 'error', "Couldn't find that Slack account. Paste your Slack member ID instead.");
      return ctx.r.redirect('/team');
    }
    const clash = await contactClash({ slackId, whatsapp, exceptId: ctx.user.id });
    if (clash) {
      setFlash(ctx.r, 'error', clash);
      return ctx.r.redirect('/team');
    }
    (await db.run('UPDATE users SET name = ?, whatsapp = ?, slack_user_id = ? WHERE id = ?', [name, whatsapp, slackId, ctx.user.id]));
    setFlash(ctx.r, 'ok', 'Saved.');
    ctx.r.redirect('/team');
  });

  router.post('/profile/test', async (ctx) => {
    if (!requireUser(ctx)) return;
    const results = await notify.user(ctx.user, {
      text: ':white_check_mark: PagerDiem test — this is how on-call pages will reach you on Slack.',
      whatsappText: '✅ PagerDiem test — this is how on-call pages will reach you on WhatsApp.',
    });
    // results are [slack?, whatsapp?] in the order notify.user sends them.
    const channels = [ctx.user.slack_user_id && 'Slack', ctx.user.whatsapp && 'WhatsApp'].filter(Boolean);
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
    const people = await scheduler.resendWeekendStart();
    setFlash(ctx.r, people ? 'ok' : 'error', people
      ? `Re-sent "you're on call now" to ${people.map((p) => p.name).join(', ') || 'nobody (no one is on call)'}.`
      : 'No weekend is in progress, so there is nothing to re-send.');
    ctx.r.redirect('/settings');
  });

  router.get('/settings', async (ctx) => {
    if (!requireUser(ctx)) return;
    requireResponder(ctx);
    ctx.r.html(views.settingsPage({
      user: ctx.user,
      status: { slack: slackEnabled(), whatsapp: whatsappEnabled(), api: Boolean(config.apiToken) },
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
        text: onCall?.people.length ? `:rotating_light: Paging ${onCall.people.map(mention).join(' and ')}: *${what}*` : `:rotating_light: *${what}* — nobody is on call, alerting the channel.`,
      });
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
    if (user && !isResponder(user)) {
      if (payload.response_url) {
        fetch(payload.response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replace_original: false, response_type: 'ephemeral', text: 'Only engineers and admins can acknowledge or resolve incidents.' }),
        }).catch((err) => console.error('slack interaction failed:', err));
      }
      return;
    }
    (async () => {
      const fn = action.action_id === 'ack' ? incidents.acknowledge : incidents.resolve;
      const { changed, incident } = await fn(id, user || { name: `<@${payload.user?.id}>` }, 'slack');
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

  // ---------- WhatsApp (Twilio) ----------
  router.post('/whatsapp/incoming', async (ctx) => {
    const signed = verifyTwilioSignature(`${config.publicUrl}/whatsapp/incoming`, ctx.body, ctx.req.headers['x-twilio-signature']);
    if (!signed && (whatsappEnabled() || config.isProd)) throw new HttpError(403, 'Bad Twilio signature');
    const phone = normalizePhone(String(ctx.body.From || '').replace(/^whatsapp:/, ''));
    const user = (await userByPhone(phone));
    const text = String(ctx.body.Body || '').trim();
    const word = text.split(/\s+/)[0]?.toUpperCase();
    const reply = (msg) => ctx.r.xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${views.esc(msg)}</Message></Response>`);

    if (!user) return reply("This number isn't registered with PagerDiem. Sign up at " + config.publicUrl);
    const respondersOnly = ['ACK', 'ACKNOWLEDGE', 'OK', 'ON IT', 'RESOLVE', 'RESOLVED', 'FIXED', 'DONE'];
    if (respondersOnly.includes(word) && !isResponder(user)) return reply('Only engineers and admins can acknowledge or resolve incidents.');
    if (['ACK', 'ACKNOWLEDGE', 'OK', 'ON IT'].includes(word)) {
      const inc = (await incidents.latestOpenFor(user));
      if (!inc) return reply('No open incidents. 👍');
      await incidents.acknowledge(inc.id, user, 'whatsapp');
      return reply(`✅ Acknowledged #${inc.id}: ${inc.title}. Reply RESOLVE when it's fixed.`);
    }
    if (['RESOLVE', 'RESOLVED', 'FIXED', 'DONE'].includes(word)) {
      const inc = (await db.get(`SELECT * FROM incidents WHERE status != 'resolved'
        ORDER BY CASE WHEN acked_by = ? THEN 1 ELSE 0 END DESC, CASE WHEN assigned_user_id = ? THEN 1 ELSE 0 END DESC, id DESC LIMIT 1`, [user.id, user.id]));
      if (!inc) return reply('No open incidents. 👍');
      await incidents.resolve(inc.id, user, 'whatsapp');
      return reply(`✅ Resolved #${inc.id}: ${inc.title}. Thanks!`);
    }
    if (['WHO', 'ONCALL', 'STATUS'].includes(word)) {
      const onCall = (await rotation.onCallNow());
      return reply(onCall?.people.length ? `📟 ${onCall.people.map((p) => p.name).join(' and ')} on call until ${fmt(onCall.shift.end)}.` : '💤 Nobody is on call right now.');
    }
    return reply('PagerDiem commands: ACK, RESOLVE, WHO');
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
    const inc = await incidents.create({ title: ctx.body.title, details: ctx.body.details, source: String(ctx.body.source || 'api').slice(0, 30) });
    ctx.r.json({ id: inc.id, status: inc.status, paged: (await rotation.userById(inc.assigned_user_id))?.name ?? null, url: `${config.publicUrl}/incidents/${inc.id}` }, 201);
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

  // ---------- server ----------
  async function handle(req, res) {
    const r = makeResponder(res);
    const url = new URL(req.url, 'http://localhost');
    const ctx = { req, r, query: url.searchParams, params: {}, body: {}, raw: '', user: null,
      ip: req.socket.remoteAddress };
    try {
      const found = router.match(req.method, url.pathname);
      if (!found) throw new HttpError(404, 'Not found');
      ctx.params = found.params;
      if (req.method === 'POST') {
        ctx.raw = await readBody(req);
        ctx.body = parseBody(ctx.raw, req.headers['content-type']);
      }
      const uid = sessionUserId(req.headers.cookie);
      ctx.user = uid ? (await rotation.userById(uid)) ?? null : null;
      await found.handler(ctx);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      const message = status === 500 ? 'Something went wrong.' : err.message;
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/slack/')) r.json({ error: message }, status);
      else r.html(views.messagePage({ user: ctx.user, title: status === 404 ? 'Not found' : 'Oops', message, link: { href: '/', label: 'Back' } }), status);
    }
  }

  const server = http.createServer(handle);
  scheduler.addStep?.(announceSwaps);
  return { server, scheduler, rotation, announceSwaps, incidents, shifts, relinkSlackUsers, db };
}
