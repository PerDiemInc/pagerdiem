// Server-rendered HTML. Every interpolated value goes through esc().
import { config } from './config.js';
import { formatLocal, formatRange } from './time.js';
import { ROLES, ROLE_LABELS, isAdmin, isResponder } from './roles.js';

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = (d) => (d ? formatLocal(new Date(d), config.timezone) : '');

function ago(iso, now = new Date()) {
  const s = Math.round((now - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5f6673;--line:#e3e6eb;--accent:#e8492b;--accent-ink:#fff;
--ok:#14804a;--ok-bg:#e6f6ec;--warn:#9a6700;--warn-bg:#fff4d6;--bad:#c4271a;--bad-bg:#fde8e6;--chip:#eef0f3}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--text:#e8eaee;--muted:#9aa1ad;--line:#2a2f38;
--accent:#ff6a4d;--ok:#4cc38a;--ok-bg:#12291d;--warn:#e0b341;--warn-bg:#2d2412;--bad:#ff7b6e;--bad-bg:#331714;--chip:#232831}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;background:var(--bg);color:var(--text)}
a{color:inherit}header{background:var(--card);border-bottom:1px solid var(--line)}
.bar{max-width:1040px;margin:0 auto;padding:12px 16px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.brand{font-weight:700;font-size:17px;text-decoration:none;display:flex;gap:8px;align-items:center}
.brand i{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;background:var(--accent);color:var(--accent-ink);font-style:normal;font-size:14px}
nav{display:flex;gap:16px;flex:1}nav a{text-decoration:none;color:var(--muted)}nav a.on,nav a:hover{color:var(--text)}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 16px}h2{font-size:16px;margin:0 0 12px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px;min-width:0}
.hero{display:flex;gap:16px;align-items:center}
.avatar{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:20px;background:var(--chip);flex:none}
.big{font-size:20px;font-weight:700}.muted{color:var(--muted)}.small{font-size:13px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
.scroll{overflow-x:auto}
label{display:block;font-weight:600;font-size:13px;margin:12px 0 4px}
input,select,textarea{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
textarea{min-height:70px}.hint{font-size:12px;color:var(--muted);margin-top:4px}
button,.btn{display:inline-block;border:1px solid var(--line);background:var(--card);color:var(--text);padding:8px 14px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button.sm{padding:4px 9px;font-size:13px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}form.inline select{width:auto;padding:5px 8px}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:99px;background:var(--chip)}
.pill.open{background:var(--bad-bg);color:var(--bad)}.pill.acknowledged{background:var(--warn-bg);color:var(--warn)}
.pill.resolved,.pill.sent{background:var(--ok-bg);color:var(--ok)}.pill.failed{background:var(--bad-bg);color:var(--bad)}
.pill.dry-run{background:var(--warn-bg);color:var(--warn)}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:16px;background:var(--ok-bg);color:var(--ok)}
.flash.error{background:var(--bad-bg);color:var(--bad)}
.auth{max-width:420px;margin:48px auto}
code{background:var(--chip);padding:1px 6px;border-radius:5px;font-size:13px;word-break:break-all}
.timeline{list-style:none;padding:0;margin:0}.timeline li{padding:8px 0;border-bottom:1px solid var(--line)}
.now{outline:2px solid var(--accent);outline-offset:-2px}
@media (max-width:640px){.hide-sm{display:none}}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line)}
.cal>div{border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-height:92px;padding:6px;min-width:0}
.cal .dow{min-height:0;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;background:var(--bg)}
.cal .out{background:var(--bg);color:var(--muted)}
.cal .num{font-size:13px;font-weight:600}.cal .today .num{background:var(--accent);color:var(--accent-ink);border-radius:99px;padding:1px 7px}
.oc{display:block;margin-top:6px;padding:4px 6px;border-radius:6px;font-size:12px;font-weight:600;line-height:1.3;
background:hsl(var(--h) 75% 91%);color:hsl(var(--h) 60% 25%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc small{display:block;font-weight:500;opacity:.8}
.oc.need{background:var(--bad-bg);color:var(--bad)}
@media (prefers-color-scheme:dark){.oc{background:hsl(var(--h) 35% 22%);color:hsl(var(--h) 70% 85%)}}
.swatch{display:inline-block;width:12px;height:12px;border-radius:3px;background:hsl(var(--h) 70% 60%);margin-right:6px;vertical-align:-1px}
@media (max-width:640px){.cal>div{min-height:64px;padding:3px}.oc{font-size:10px;padding:2px 3px}.oc small{display:none}}
`;

export function layout({ title, user, body, flash, active }) {
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  const links = !user ? '' : isResponder(user)
    ? `${link('/', 'On call', 'home')}${link('/calendar', 'Calendar', 'calendar')}${link('/log', 'Audit log', 'log')}${link('/incidents', 'Incidents', 'incidents')}${link('/team', 'Team', 'team')}${link('/settings', 'Settings', 'settings')}`
    : `${link('/calendar', 'Calendar', 'calendar')}${link('/log', 'Audit log', 'log')}${link('/incidents', 'Incidents', 'incidents')}`;
  const nav = user
    ? `<nav>${links}</nav>
       <div class="row small"><span class="muted">${esc(user.name)}</span><form method="post" action="/logout" class="inline"><button class="sm">Log out</button></form></div>`
    : '<nav></nav>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(config.appName)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📟</text></svg>">
<style>${CSS}</style></head><body>
<header><div class="bar"><a class="brand" href="/"><i>${esc(config.appName[0] || 'P')}</i>${esc(config.appName)}</a>${nav}</div></header>
<main>${flash ? flashBox(flash) : ''}${body}</main>
${flash?.undo ? '<script src="/undo.js"></script>' : ''}
</body></html>`;
}

function flashBox(flash) {
  const undo = flash.undo && Number(flash.undo.until) > Date.now()
    ? `<form method="post" action="/swaps/${Number(flash.undo.id)}/undo" class="inline" data-undo-until="${Number(flash.undo.until)}" style="margin-left:auto">
        <button class="sm">Undo (<span data-undo-left>10</span>s)</button></form>`
    : '';
  return `<div class="flash ${flash.type === 'error' ? 'error' : ''} row">${esc(flash.message)}${undo}</div>`;
}

// Counts the Undo button down and removes it when the 10 seconds are up.
export const UNDO_SCRIPT = `
document.querySelectorAll('[data-undo-until]').forEach(function (form) {
  var until = Number(form.getAttribute('data-undo-until'));
  var label = form.querySelector('[data-undo-left]');
  function tick() {
    var left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) { form.remove(); return; }
    label.textContent = left;
    setTimeout(tick, 250);
  }
  tick();
});
`;

const initials = (name) => esc(String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase());

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const contactFields = (values = {}) => `
    <label for="slack">Your Slack</label>
    <input id="slack" name="slack" value="${esc(values.slack)}" placeholder="Slack email or member ID (U0123ABCD)">
    <div class="hint">Leave blank to use your work email. Or paste your member ID: Slack → your profile → ⋮ → Copy member ID. Each person needs their own.</div>
    <label for="whatsapp">Your WhatsApp number</label>
    <input id="whatsapp" name="whatsapp" type="tel" required value="${esc(values.whatsapp)}" placeholder="+1 415 555 0123" autocomplete="tel">
    <div class="hint">With country code. Pages arrive here when you're on call.</div>`;

export function authPage({ mode, values = {}, error, domains, google, notConfigured }) {
  const signup = mode === 'signup';
  const only = domains.length ? `@${domains.map(esc).join(' / @')}` : '';
  const body = notConfigured
    ? `<div class="auth card"><h1>PagerDiem</h1>
  <p>Sign-in isn't set up yet. An admin needs to add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> so only your team's Google accounts can get in.</p></div>`
    : google
    ? `<div class="auth card">
  <h1>${esc(config.appName)}</h1>
  <p class="muted">Weekend on-call for ${esc(config.teamName)}.</p>
  ${error ? `<div class="flash error">${esc(error)}</div>` : ''}
  <p><a class="btn" href="/auth/google" style="display:flex;gap:10px;align-items:center;justify-content:center">${GOOGLE_ICON} Sign in with Google</a></p>
  ${only ? `<p class="small muted">Only ${only} Google accounts can sign in. First time? Sign in and you'll be asked for your Slack and WhatsApp.</p>` : ''}
</div>`
    : `<div class="auth card">
  <h1>${signup ? `Join the ${esc(config.teamName)} on-call rotation` : 'Log in'}</h1>
  ${error ? `<div class="flash error">${esc(error)}</div>` : ''}
  <form method="post" action="/${mode}">
    ${signup ? `<label for="name">Full name</label><input id="name" name="name" required value="${esc(values.name)}" autocomplete="name">` : ''}
    <label for="email">Work email</label>
    <input id="email" name="email" type="email" required value="${esc(values.email)}" autocomplete="email">
    ${signup && only ? `<div class="hint">Must be an ${only} address.</div>` : ''}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required minlength="${signup ? 10 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">
    ${signup ? `<div class="hint">At least 10 characters.</div>${contactFields(values)}` : ''}
    <p><button class="primary" type="submit">${signup ? 'Sign up' : 'Log in'}</button></p>
  </form>
  <p class="small muted">${signup ? 'Already signed up? <a href="/login">Log in</a>' : 'New to the team? <a href="/signup">Sign up</a>'}</p>
</div>`;
  return layout({ title: signup ? 'Sign up' : 'Log in', body });
}

export function welcomePage({ identity, values = {}, error }) {
  const body = `<div class="auth card">
  <h1>Welcome, ${esc(identity.name.split(' ')[0])}!</h1>
  <p class="muted small">Signed in as ${esc(identity.email)}. Add how we reach you when you're on call.</p>
  ${error ? `<div class="flash error">${esc(error)}</div>` : ''}
  <form method="post" action="/welcome">
    <label for="name">Full name</label><input id="name" name="name" required value="${esc(values.name)}" autocomplete="name">
    ${contactFields(values)}
    <p><button class="primary" type="submit">Join the rotation</button></p>
  </form></div>`;
  return layout({ title: 'Welcome', body });
}

function personCell(u, extra = '') {
  if (!u) return '<span class="muted">Nobody — add people on the Team page</span>';
  return `<div class="row"><span class="avatar" style="width:30px;height:30px;font-size:12px">${initials(u.name)}</span><span>${esc(u.name)}${extra}</span></div>`;
}

const names = (people) => people.map((p) => esc(p.name)).join(' & ');

/** "Add me" / "Remove me" for the signed-in user only. */
function selfButton(user, e, back = '') {
  if (e.shift.end <= new Date() || !isResponder(user)) return '';
  const on = e.people.some((p) => p.id === user.id);
  const hidden = back ? `<input type="hidden" name="back" value="${back}">` : '';
  return on
    ? `<form method="post" action="/weekends/${e.shift.key}/leave" class="inline">${hidden}<button class="sm">Remove me</button></form>`
    : `<form method="post" action="/weekends/${e.shift.key}/join" class="inline">${hidden}<button class="sm primary">Add me</button></form>`;
}

function peopleCell(e, perWeekend) {
  const chips = e.people.map((p) => `<span class="row" style="gap:6px"><span class="avatar" style="width:26px;height:26px;font-size:11px">${initials(p.name)}</span>${esc(p.name)}${
    e.joined.includes(p.id) ? ' <span class="pill">added themselves</span>' : ''}</span>`).join('');
  const cover = e.needsCover
    ? ` <span class="pill open">needs ${perWeekend - e.people.length} more</span>` : '';
  return `<div class="row" style="gap:12px">${chips || '<span class="muted">Nobody yet</span>'}${cover}</div>`;
}

export function dashboardPage({ user, now, onCall, nextEntry, backup, schedule, perWeekend, balance, recentLog, openIncidents, flash }) {
  const tz = config.timezone;
  const hero = onCall
    ? `<div class="hero"><div class="avatar">📟</div><div>
        <div class="muted small">On call right now</div><div class="big">${names(onCall.people)}</div>
        <div class="muted small">Until ${esc(fmt(onCall.shift.end))}${backup ? ` · backup ${esc(backup.name)}` : ''}</div></div></div>`
    : `<div class="hero"><div class="avatar">💤</div><div>
        <div class="muted small">Nobody is on call right now — it's a weekday</div>
        <div class="big">${nextEntry?.people.length ? `Next: ${names(nextEntry.people)}` : 'Next weekend needs cover'}</div>
        <div class="muted small">${nextEntry ? `Starts ${esc(fmt(nextEntry.shift.start))}` : ''}</div></div></div>`;

  const rows = schedule.map((e) => {
    const isNow = onCall && e.shift.key === onCall.shift.key;
    return `<tr class="${isNow ? 'now' : ''}">
      <td><strong>${esc(formatRange(e.shift, tz))}</strong><div class="small muted">${esc(fmt(e.shift.start))} → ${esc(fmt(e.shift.end))}</div></td>
      <td>${peopleCell(e, perWeekend)}</td>
      <td style="text-align:right">${selfButton(user, e)}${isNow ? ' <span class="pill open">now</span>' : ''}</td>
    </tr>`;
  }).join('');

  const incidents = openIncidents.length
    ? `<table>${openIncidents.map((inc) => `<tr>
        <td><a href="/incidents/${inc.id}"><strong>#${inc.id} ${esc(inc.title)}</strong></a>
          <div class="small muted">${esc(ago(inc.created_at, now))} · ${inc.assigned_name ? 'paged the on-call' : 'team channel'}</div></td>
        <td><span class="pill ${inc.status}">${inc.status}</span></td>
        <td style="text-align:right">${incidentButtons(user, inc, 'home')}</td></tr>`).join('')}</table>`
    : '<p class="muted">All quiet. No open incidents.</p>';

  const balanceRows = balance.map((b) => `<tr><td>${esc(b.user.name)}${isAdmin(b.user) ? ' <span class="pill">admin · optional</span>' : ''}</td>
    <td style="text-align:right"><strong>${b.weekends}</strong></td></tr>`).join('');

  const group = config.whatsappGroupUrl
    ? `<p style="margin:14px 0 0"><a class="btn" href="${esc(config.whatsappGroupUrl)}" target="_blank" rel="noopener noreferrer">💬 Join the on-call WhatsApp group</a></p>` : '';
  const body = `<div class="grid">
    <div class="card">${hero}${group}</div>
    <div class="card"><h2>Page the on-call</h2>${pageForm()}</div>
  </div>
  <div class="card"><h2>Open incidents</h2>${incidents}</div>
  <div class="card"><h2>Weekend rotation</h2>
    <p class="small muted">Each weekend (${esc(dayTime(config.shiftStart))} → ${esc(dayTime(config.shiftEnd))}, ${esc(tz)}) gets ${perWeekend} people from the rotation, in turn, so everyone gets the same share. Admins are optional.
    Anyone can <strong>add themselves</strong> to any weekend, with no limit, and <strong>remove themselves</strong> from one of theirs. You can only change your own spot. Every change goes into the <a href="/log">public log</a>.</p>
    <div class="scroll"><table><thead><tr><th>Weekend</th><th>On call</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="grid">
    <div class="card"><h2>Balance · next ${schedule.length} weekends</h2>
      <table>${balanceRows}</table></div>
    <div class="card"><h2>Recent changes</h2>${logList(recentLog)}
      <p class="small" style="margin-bottom:0"><a href="/log">Full audit log →</a></p></div>
  </div>`;
  return layout({ title: 'On call', user, body, flash, active: 'home' });
}

function logLine(l) {
  const wk = esc(weekendLabel(l.weekend_key));
  if (l.action === 'swap') {
    return `🔁 <strong>${esc(l.user_name)}</strong> took <strong>${esc(l.other_name)}</strong>'s spot on the weekend of ${wk}${
      l.undone_at ? ' <span class="pill">undone within 10s</span>' : ''}`;
  }
  return `${l.action === 'join' ? '➕' : '➖'} <strong>${esc(l.user_name)}</strong>
    ${l.action === 'join' ? 'added themselves to' : 'removed themselves from'} the weekend of ${wk}`;
}

const timeOnly = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const dayHeading = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));

function logList(log, { grouped = false } = {}) {
  if (!log.length) return '<p class="muted">No changes yet.</p>';
  if (!grouped) {
    return `<ul class="timeline">${log.map((l) => `<li><div>${logLine(l)}</div><div class="small muted">${esc(fmt(l.at))}</div></li>`).join('')}</ul>`;
  }
  const days = [];
  for (const l of log) {
    const day = dayHeading(l.at);
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(l);
  }
  return days.map((d) => `<h2 style="margin:18px 0 6px">${esc(d.day)}</h2>
    <ul class="timeline">${d.items.map((l) => `<li class="row" style="align-items:baseline;flex-wrap:nowrap">
      <span class="small muted" style="min-width:70px">${esc(timeOnly(l.at))}</span><span>${logLine(l)}</span></li>`).join('')}</ul>`).join('');
}

function weekendLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function logPage({ user, log, flash }) {
  const body = `<h1>Audit log</h1>
  <p class="muted">Visible to everyone on the team: every time someone added themselves to a weekend, removed themselves, or swapped in for someone, newest first.</p>
  <div class="card">${logList(log, { grouped: true })}</div>`;
  return layout({ title: 'Audit log', user, body, flash, active: 'log' });
}

function pageForm() {
  return `<form method="post" action="/incidents">
        <input name="title" required maxlength="200" placeholder="What's broken? e.g. Checkout failing for all stores">
        <textarea name="details" maxlength="4000" placeholder="Details, links, dashboards (optional)" style="margin-top:8px"></textarea>
        <p style="margin:10px 0 0"><button class="primary">🚨 Page now</button></p>
      </form>`;
}

function dayTime({ day, hour, minute }) {
  const d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
  const h = hour % 12 || 12;
  return `${d} ${h}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function incidentButtons(user, inc, back = '') {
  if (inc.status === 'resolved' || !isResponder(user)) return '';
  return `<div class="row" style="justify-content:flex-end">
    ${inc.status === 'open' ? `<form method="post" action="/incidents/${inc.id}/ack" class="inline"><input type="hidden" name="back" value="${back}"><button class="sm primary">Acknowledge</button></form>` : ''}
    <form method="post" action="/incidents/${inc.id}/resolve" class="inline"><button class="sm">Resolve</button></form></div>`;
}

export function incidentsPage({ user, incidents, now, flash }) {
  const rows = incidents.map((inc) => `<tr>
    <td><a href="/incidents/${inc.id}"><strong>#${inc.id} ${esc(inc.title)}</strong></a>
      <div class="small muted">${esc(fmt(inc.created_at))} · via ${esc(inc.source)}</div></td>
    <td>${esc(inc.assigned_name || '—')}</td>
    <td><span class="pill ${inc.status}">${inc.status}</span>
      <div class="small muted">${inc.acked_by_name ? `ack ${esc(inc.acked_by_name)}` : ''}</div></td>
    <td style="text-align:right">${incidentButtons(user, inc)}</td></tr>`).join('');
  const body = `<h1>Incidents</h1>
  <div class="card"><h2>Trigger an alert</h2>${pageForm()}</div>
  <div class="card scroll">${incidents.length
    ? `<table><thead><tr><th>Incident</th><th>Paged</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No incidents yet. 🎉</p>'}</div>`;
  return layout({ title: 'Incidents', user, body, flash, active: 'incidents' });
}

export function incidentPage({ user, inc, events, people, notifications, flash }) {
  const body = `<p class="small"><a href="/incidents">← All incidents</a></p>
  <div class="card"><div class="row" style="justify-content:space-between">
    <h1 style="margin:0">#${inc.id} ${esc(inc.title)}</h1><span class="pill ${inc.status}">${inc.status}</span></div>
    ${inc.details ? `<p style="white-space:pre-wrap">${esc(inc.details)}</p>` : ''}
    <p class="small muted">Triggered ${esc(fmt(inc.created_at))} via ${esc(inc.source)} ·
      On call: ${esc(people.assigned?.name || 'nobody')} · Backup: ${esc(people.backup?.name || '—')}</p>
    ${incidentButtons(user, inc)}</div>
  <div class="grid">
    <div class="card"><h2>Timeline</h2><ul class="timeline">${events.map((e) =>
      `<li><div>${esc(e.message)}</div><div class="small muted">${esc(fmt(e.at))}</div></li>`).join('')}</ul></div>
    <div class="card"><h2>Messages sent</h2>${notificationTable(notifications)}</div>
  </div>`;
  return layout({ title: `Incident #${inc.id}`, user, body, flash, active: 'incidents' });
}

function notificationTable(rows) {
  if (!rows.length) return '<p class="muted">None.</p>';
  return `<div class="scroll"><table>${rows.map((n) => `<tr>
    <td class="small"><strong>${esc(n.channel)}</strong> → ${esc(n.recipient)}<div class="muted">${esc(n.body.slice(0, 140))}${n.body.length > 140 ? '…' : ''}</div>
      ${n.error ? `<div style="color:var(--bad)">${esc(n.error)}</div>` : ''}</td>
    <td><span class="pill ${esc(n.status)}">${esc(n.status)}</span><div class="small muted">${esc(fmt(n.at))}</div></td></tr>`).join('')}</table></div>`;
}

export function teamPage({ user, members, inactive, flash }) {
  const admin = isAdmin(user);
  const rows = members.map((m, i) => `<tr>
    <td>${i + 1}</td>
    <td>${personCell(m, ` <span class="pill">${esc(ROLE_LABELS[m.role] || m.role)}</span>`)}<div class="small muted">${esc(m.email)}</div></td>
    <td class="small hide-sm">${m.slack_user_id ? `<code>${esc(m.slack_user_id)}</code>` : '<span class="pill failed">not linked</span>'}</td>
    <td class="small hide-sm">${esc(m.whatsapp)}</td>
    <td style="text-align:right">${admin ? `<div class="row" style="justify-content:flex-end">
      <form method="post" action="/team/${m.id}/move" class="inline"><input type="hidden" name="dir" value="-1"><button class="sm" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button></form>
      <form method="post" action="/team/${m.id}/move" class="inline"><input type="hidden" name="dir" value="1"><button class="sm" ${i === members.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></form>
      <form method="post" action="/team/${m.id}/active" class="inline"><input type="hidden" name="active" value="0"><button class="sm">Remove</button></form>
      <form method="post" action="/team/${m.id}/role" class="inline"><select name="role" aria-label="Role for ${esc(m.name)}">${ROLES.map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${esc(ROLE_LABELS[r])}</option>`).join('')}</select><button class="sm">Set role</button></form>
    </div>` : ''}</td></tr>`).join('');
  const removed = inactive.length ? `<div class="card"><h2>Removed from rotation</h2><table>${inactive.map((m) => `<tr>
    <td>${esc(m.name)} <span class="small muted">${esc(m.email)}</span></td>
    <td style="text-align:right">${admin ? `<form method="post" action="/team/${m.id}/active" class="inline"><input type="hidden" name="active" value="1"><button class="sm">Add back</button></form>` : ''}</td>
  </tr>`).join('')}</table></div>` : '';
  const body = `<h1>Team</h1>
  <div class="card scroll"><h2>Rotation order</h2>
    <p class="small muted">Each weekend goes to the next engineer in this list. Admins are optional, and non-technical people (C-level, support, product) are never on call: they can view the calendar and audit log and trigger an alert. ${admin ? 'You can reorder or remove people.' : 'Ask an admin to reorder.'}</p>
    <table><thead><tr><th>#</th><th>Name</th><th class="hide-sm">Slack</th><th class="hide-sm">WhatsApp</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  ${removed}
  <div class="card" style="max-width:520px"><h2>Your contact details</h2>
    <form method="post" action="/profile">
      <label for="name">Name</label><input id="name" name="name" required value="${esc(user.name)}">
      <label for="slack">Slack</label><input id="slack" name="slack" value="${esc(user.slack_user_id || '')}" placeholder="Slack email or member ID">
      <label for="whatsapp">WhatsApp number</label><input id="whatsapp" name="whatsapp" type="tel" required value="${esc(user.whatsapp)}">
      <p><button class="primary">Save</button>
      <button formaction="/profile/test" class="sm" style="margin-left:6px">Send me a test message</button></p>
    </form></div>`;
  return layout({ title: 'Team', user, body, flash, active: 'team' });
}

export function settingsPage({ user, status, notifications, flash }) {
  const yes = (ok, label) => `<span class="pill ${ok ? 'sent' : 'dry-run'}">${ok ? 'connected' : label}</span>`;
  const url = (p) => `<code>${esc(config.publicUrl + p)}</code>`;
  const body = `<h1>Settings</h1>
  <div class="grid">
    <div class="card"><h2>Slack ${yes(status.slack, 'dry-run')}</h2>
      <p class="small">On-call channel: ${config.slack.channel ? `<code>${esc(config.slack.channel)}</code>` : '<span class="muted">not set</span>'}</p>
      <p class="small">Slash commands (point both at the same URL): <code>/oncall</code>, <code>/page</code> → ${url('/slack/commands')}</p>
      <p class="small">Interactivity request URL (Acknowledge / Resolve buttons): ${url('/slack/interactions')}</p>
      <p class="small muted">Bot scopes: chat:write, users:read, users:read.email, im:write, commands.</p></div>
    <div class="card"><h2>WhatsApp (Twilio) ${yes(status.whatsapp, 'dry-run')}</h2>
      <p class="small">Sender: ${config.whatsapp.from ? `<code>${esc(config.whatsapp.from)}</code>` : '<span class="muted">not set</span>'}</p>
      <p class="small">Incoming message webhook (lets people reply ACK / RESOLVE): ${url('/whatsapp/incoming')}</p>
      <p class="small muted">WhatsApp only allows free-form messages within 24h of the person's last message to you. For pages outside that window, set approved templates in TWILIO_PAGE_TEMPLATE_SID / TWILIO_SHIFT_TEMPLATE_SID.</p></div>
    <div class="card"><h2>Alerts API ${yes(status.api, 'disabled')}</h2>
      <p class="small">Trigger a page from Sentry, Coralogix, CI or a script:</p>
      <p class="small"><code>curl -X POST ${esc(config.publicUrl)}/api/incidents -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d '{"title":"API 5xx spike","details":"..."}'</code></p>
      <p class="small muted">Set API_TOKEN to enable.</p></div>
  </div>
  <div class="card"><h2>Recent messages</h2>${notificationTable(notifications)}</div>`;
  return layout({ title: 'Settings', user, body, flash, active: 'settings' });
}

export function messagePage({ user, title, message, link }) {
  const body = `<div class="auth card"><h1>${esc(title)}</h1><p>${esc(message)}</p>${link ? `<p><a class="btn primary" href="${esc(link.href)}">${esc(link.label)}</a></p>` : ''}</div>`;
  return layout({ title, user, body });
}

/** Next to each name: "Remove me" on your own name, "Swap" (take their spot) on others. */
function personAction(user, e, p) {
  if (e.shift.end <= new Date() || !isResponder(user)) return '';
  if (p.id === user.id) {
    return `<form method="post" action="/weekends/${e.shift.key}/leave" class="inline"><input type="hidden" name="back" value="calendar"><button class="sm">Remove me</button></form>`;
  }
  if (e.people.some((x) => x.id === user.id)) return ''; // you're already on this weekend
  return `<form method="post" action="/weekends/${e.shift.key}/swap" class="inline"><input type="hidden" name="user_id" value="${p.id}">
    <button class="sm" title="Take ${esc(p.name)}'s spot on this weekend">Swap</button></form>`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const hue = (id) => (Number(id) * 137) % 360;

export function calendarPage({ user, grid, prevMonth, nextMonth, thisMonth, feedUrl, perWeekend, flash }) {
  const tz = config.timezone;
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
  const timeOf = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
  const cells = grid.weeks.flat().map((d) => {
    const e = d.entry;
    const when = !e ? '' : d.isStart ? `<small>from ${esc(timeOf(e.shift.start))}</small>` : d.isEnd ? `<small>until ${esc(timeOf(e.shift.end))}</small>` : '';
    const chip = !e ? '' : e.people.length
      ? e.people.map((p, i) => `<span class="oc" style="--h:${hue(p.id)}" title="${esc(p.name)} on call">${esc(p.name)}${i === e.people.length - 1 ? when : ''}</span>`).join('')
        + (e.needsCover ? '<span class="oc need">needs cover</span>' : '')
      : `<span class="oc need">needs cover${when}</span>`;
    return `<div class="${d.inMonth ? '' : 'out'} ${d.today ? 'today' : ''}"><span class="num">${d.day}</span>${chip}</div>`;
  }).join('');

  const list = grid.entries.length
    ? `<table>${grid.entries.map((e) => `<tr>
        <td><strong>${esc(formatRange(e.shift, tz))}</strong><div class="small muted">${esc(fmt(e.shift.start))} → ${esc(fmt(e.shift.end))}</div></td>
        <td>${e.people.map((p) => `<div class="row" style="gap:8px;margin:3px 0"><span><span class="swatch" style="--h:${hue(p.id)}"></span>${esc(p.name)}</span>${personAction(user, e, p)}</div>`).join('') || '<span class="muted">nobody</span>'}
          ${e.needsCover ? `<span class="pill open">needs ${perWeekend - e.people.length} more</span>` : ''}</td>
        <td style="text-align:right">${e.people.some((p) => p.id === user.id) ? '' : selfButton(user, e, 'calendar')}</td></tr>`).join('')}</table>`
    : '<p class="muted">No weekends scheduled this month yet.</p>';

  const googleAdd = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace(/^https?:/, 'webcal:'))}`;
  const body = `<div class="row" style="justify-content:space-between;margin-bottom:12px">
    <h1 style="margin:0">${MONTHS[grid.month - 1]} ${grid.year}</h1>
    <div class="row"><a class="btn" href="/calendar?month=${prevMonth}" aria-label="Previous month">←</a>
      <a class="btn" href="/calendar?month=${thisMonth}">Today</a>
      <a class="btn" href="/calendar?month=${nextMonth}" aria-label="Next month">→</a></div></div>
  <div class="card" style="padding:0;overflow:hidden"><div class="cal">${dows}${cells}</div></div>
  <div class="grid">
    <div class="card"><h2>Weekends this month</h2>${list}
      <p class="small muted" style="margin-bottom:0">${isResponder(user)
        ? `<strong>Add me</strong> joins a weekend. <strong>Swap</strong> takes that person's spot, and you have 10 seconds to undo it before they and Slack are told. Every change is in the <a href="/log">audit log</a>.`
        : 'Need an engineer now? <a href="/incidents">Trigger an alert</a>. Every roster change is in the <a href="/log">audit log</a>.'}</p></div>
    <div class="card"><h2>Add to your calendar</h2>
      <p class="small">Subscribe once and every on-call weekend shows up in your calendar, updated automatically.</p>
      <p><a class="btn primary" href="${esc(googleAdd)}" target="_blank" rel="noopener">Add to Google Calendar</a></p>
      <p class="small muted">Other apps: subscribe to this URL. Keep it inside the team.</p>
      <p class="small"><code>${esc(feedUrl)}</code></p></div>
  </div>`;
  return layout({ title: 'Calendar', user, body, flash, active: 'calendar' });
}
