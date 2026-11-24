// Server-rendered HTML. Every interpolated value goes through esc().
// The look follows the HeroUI V3 design system: Inter, flat surfaces, soft status chips, pill buttons.
import { config } from './config.js';
import { formatLocal, formatRange } from './time.js';
import { describeDays, DAY_NAMES, PRESETS } from './settings.js';
import { ROLES, ROLE_LABELS, isAdmin, isResponder } from './roles.js';
import qrcode from './vendor/qrcode.js';

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

// Colour tokens are HeroUI V3's (light, then dark). Coloured text on tinted fills uses the
// *-soft-fg tokens, which pass 4.5:1 in both themes; the fill colours themselves are for fills only.
const DARK = `color-scheme:dark;--bg:#060607;--surface:#18181b;--surface-2:#232325;--text:#fcfcfc;--muted:#a1a1aa;
--border:#28282c;--sep:#2a2a2e;--default:#27272a;--default-hover:#2e2e31;--accent-soft:rgba(4,133,247,.12);--accent-soft-fg:#61a8fc;
--danger-soft:rgba(219,59,62,.15);--danger-soft-fg:#eb7872;--success-soft:rgba(23,201,100,.12);--success-soft-fg:#74d88f;
--warning-soft:rgba(247,183,80,.12);--warning-soft-fg:#f9cb87;--field:#1f1f23;--field-shadow:inset 0 0 0 1px #3f3f46;--oc-l:24%;--oc-text-l:86%`;
const CSS = `
:root{color-scheme:light;--bg:#f5f5f5;--surface:#fff;--surface-2:#efeff0;--text:#18181b;--muted:#61616a;--border:#dedee0;--sep:#e4e4e7;
--default:#ebebec;--default-hover:#e1e1e2;--accent:#006fee;--accent-hover:#005bc4;--accent-soft:rgba(4,133,247,.15);--accent-soft-fg:#1a5799;
--danger:#dc2626;--danger-hover:#b91c1c;--danger-soft:rgba(255,56,60,.15);--danger-soft-fg:#a43532;
--success-soft:rgba(23,201,100,.15);--success-soft-fg:#246b3c;--warning-soft:rgba(245,165,36,.15);--warning-soft-fg:#77552a;
--field:#fff;--field-shadow:inset 0 0 0 1px var(--border),0 2px 4px rgba(0,0,0,.04),0 1px 2px rgba(0,0,0,.06);
--ring:0 0 0 2px var(--bg),0 0 0 4px var(--accent);--oc-l:91%;--oc-text-l:25%}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
body{margin:0;font:400 14px/20px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:-.005em;
background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:2px}a:hover{color:var(--accent)}
:focus-visible{outline:none;box-shadow:var(--ring)}
h1{font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.01em;margin:0}
h2{font-size:16px;line-height:24px;font-weight:600;letter-spacing:-.01em;margin:0 0 12px}
p{margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:12px;line-height:16px}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}

/* shell: sidebar + content */
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;padding:20px 12px 16px;display:flex;flex-direction:column;gap:24px;box-shadow:inset -1px 0 0 var(--sep)}
.brand{padding:4px 12px;font-size:16px;line-height:24px;font-weight:600;letter-spacing:-.01em;text-decoration:none;display:flex;gap:8px;align-items:center}
.brand i{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--accent);color:#fff;font-style:normal;font-size:12px}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:10px;height:36px;padding:0 12px;border-radius:20px;text-decoration:none;font-weight:500;color:var(--text)}
.nav a .ic{color:var(--muted)}.nav a:hover{background:var(--default)}.nav a:hover{color:var(--text)}
.nav a[aria-current=page]{background:var(--surface)}.nav a[aria-current=page] .ic{color:var(--accent)}
.nav .label{flex:1}
.badge{min-width:20px;height:20px;padding:0 6px;border-radius:99px;display:inline-grid;place-items:center;font-size:12px;font-weight:600;background:var(--danger-soft);color:var(--danger-soft-fg)}
.side-foot{margin-top:auto;display:flex;flex-direction:column;gap:8px}
.theme{display:flex;gap:2px;padding:3px;border-radius:99px;background:var(--default)}
.theme button{flex:1;height:28px;padding:0 8px;gap:6px;font-size:12px;background:none;color:var(--muted)}
.theme button:hover{background:none;color:var(--text)}.theme button[aria-pressed=true]{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.theme .ic{width:14px;height:14px}
.me{background:var(--surface);border-radius:20px;padding:12px;display:flex;align-items:center;gap:10px}
.me .who{flex:1;min-width:0;display:flex;flex-direction:column}.me .who span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{padding:28px 32px 64px;max-width:1200px;width:100%;min-width:0}
@media (max-width:900px){
  .shell{display:block}
  .side{position:static;height:auto;padding:12px 16px;gap:12px;flex-direction:row;flex-wrap:wrap;align-items:center;box-shadow:inset 0 -1px 0 var(--sep)}
  .brand{padding:4px 0}.nav{order:3;flex-direction:row;width:100%;overflow-x:auto;gap:4px;scrollbar-width:none}.nav a{flex:none;height:32px;padding:0 12px}
  .side-foot{margin:0 0 0 auto;flex-direction:row;align-items:center}.theme button{flex:none;width:28px;padding:0}.theme .label{display:none}
  .me{padding:4px 4px 4px 8px;background:none}.me .who{display:none}
  main{padding:20px 16px 48px}
}

/* page furniture */
.head{display:flex;gap:16px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;margin-bottom:20px}
.head .sub{color:var(--muted);margin:4px 0 0}
.card{background:var(--surface);border-radius:24px;padding:24px;margin-bottom:16px;min-width:0}
.card.flush{padding:0;overflow:hidden}
.card-head{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:12px}.card-head h2{margin:0}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-bottom:16px}.grid>.card{margin:0}
.split{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) 380px;margin-bottom:16px}.split>.card{margin:0}
@media (max-width:1100px){.split{grid-template-columns:minmax(0,1fr)}}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.scroll{overflow-x:auto}
.avatar{width:32px;height:32px;border-radius:99px;display:inline-grid;place-items:center;flex:none;font-size:12px;font-weight:600;background:var(--accent-soft);color:var(--accent-soft-fg)}
.avatar.sm{width:24px;height:24px;font-size:10px}
.person{display:inline-flex;gap:8px;align-items:center}

/* hero on the home page */
.hero .names{font-size:30px;line-height:36px;font-weight:600;letter-spacing:-.01em;margin:12px 0 8px}
.hero .lede{color:var(--muted);max-width:560px}
.hero .meta{margin:24px 0 0;padding-top:20px;border-top:1px solid var(--sep)}

/* stat tiles */
.stats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px}
.stat{background:var(--surface);border-radius:24px;padding:20px 24px}
.stat-label{display:flex;gap:8px;align-items:center;color:var(--muted);font-weight:500}
.stat-value{font-size:30px;line-height:36px;font-weight:600;letter-spacing:-.01em;margin:8px 0 4px}
.stat-sub{color:var(--muted);font-size:12px;line-height:16px}

/* tabs (segmented control) */
.tabs{display:inline-flex;gap:2px;padding:4px;border-radius:99px;background:var(--default);margin:0 0 16px;max-width:100%;overflow-x:auto}
.tab{display:inline-flex;gap:6px;align-items:center;height:32px;padding:0 14px;border-radius:99px;text-decoration:none;font-weight:500;white-space:nowrap}
.tab[aria-current=page]{background:var(--surface);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.tab .count{font-size:12px;color:var(--muted)}

/* tables */
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:12px;border-bottom:1px solid var(--sep);vertical-align:middle}
tr:last-child>td{border-bottom:0}
th{font-size:12px;line-height:16px;font-weight:500;color:var(--muted);white-space:nowrap}
td.num,th.num{text-align:right}.actions{text-align:right}
.card.flush th:first-child,.card.flush td:first-child{padding-left:24px}.card.flush th:last-child,.card.flush td:last-child{padding-right:24px}
tr.now>td{background:color-mix(in srgb,var(--accent-soft) 45%,transparent)}
tr.role-admin>td{background:color-mix(in srgb,var(--warning-soft) 45%,transparent)}
tr.role-engineer>td{background:color-mix(in srgb,var(--accent-soft) 35%,transparent)}
tr.role-non_technical>td{background:color-mix(in srgb,var(--default) 50%,transparent)}
.t-title{font-weight:500;text-decoration:none}.t-meta{color:var(--muted);font-size:12px;line-height:16px;margin-top:2px}
@media (max-width:640px){.hide-sm{display:none}}

/* forms */
.field{margin-bottom:16px}
.fields{display:grid;gap:0 16px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.fields .field{display:flex;flex-direction:column;justify-content:flex-end}
label.check{display:inline-flex;gap:8px;align-items:center;margin:0;font-weight:500}
label.check input{width:16px;min-height:16px;height:16px;padding:0;box-shadow:none;accent-color:var(--accent)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
label{display:block;font-weight:500;margin-bottom:6px}
input,select,textarea{width:100%;min-height:36px;padding:8px 12px;border:0;border-radius:12px;background:var(--field);color:var(--text);
font:inherit;box-shadow:var(--field-shadow)}
input:focus-visible,select:focus-visible,textarea:focus-visible{box-shadow:var(--ring)}
::placeholder{color:var(--muted);opacity:1}
textarea{min-height:84px;resize:vertical}
input[aria-invalid=true]{box-shadow:inset 0 0 0 1.5px var(--danger)}
.hint{font-size:12px;line-height:16px;color:var(--muted);margin:6px 0 0}
.field-error{font-size:12px;line-height:16px;color:var(--danger-soft-fg);margin:6px 0 0}

/* buttons */
button,.btn{display:inline-flex;gap:6px;align-items:center;justify-content:center;height:36px;padding:0 16px;border:0;border-radius:99px;
background:var(--default);color:var(--text);font:inherit;font-weight:500;letter-spacing:-.02em;cursor:pointer;text-decoration:none;white-space:nowrap}
button:hover,.btn:hover{background:var(--default-hover);color:var(--text)}
button.primary,.btn.primary{background:var(--accent);color:#fff}button.primary:hover,.btn.primary:hover{background:var(--accent-hover)}
button.danger{background:var(--danger-soft);color:var(--danger-soft-fg)}
button.danger-solid{background:var(--danger);color:#fff}button.danger-solid:hover{background:var(--danger-hover)}
button.ghost,.btn.ghost{background:none}button.ghost:hover,.btn.ghost:hover{background:var(--default)}
button.sm,.btn.sm{height:32px;padding:0 12px}button.icon,.btn.icon{width:32px;height:32px;padding:0}
button:disabled{opacity:.5;cursor:default}
.btn.block{display:flex;width:100%}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}form.inline select{width:auto;min-height:32px;padding:4px 10px}

/* chips, alerts, misc */
.pill{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:99px;font-size:12px;font-weight:500;background:var(--default);color:var(--text);white-space:nowrap}
.pill.open,.pill.failed{background:var(--danger-soft);color:var(--danger-soft-fg)}
.pill.acknowledged,.pill.dry-run{background:var(--warning-soft);color:var(--warning-soft-fg)}
.pill.resolved,.pill.sent{background:var(--success-soft);color:var(--success-soft-fg)}
.pill.accent{background:var(--accent-soft);color:var(--accent-soft-fg)}
.flash{display:flex;gap:10px;align-items:center;background:var(--surface);border-radius:16px;padding:12px 16px;margin-bottom:16px;box-shadow:inset 0 0 0 1px var(--border)}
.flash .ic{color:var(--success-soft-fg)}.flash.error .ic{color:var(--danger-soft-fg)}
.flash .msg{flex:1}
code{font:12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);padding:2px 6px;border-radius:6px;overflow-wrap:anywhere}
.timeline{list-style:none;padding:0;margin:0}.timeline li{padding:10px 0;border-bottom:1px solid var(--sep)}.timeline li:last-child{border-bottom:0}
.day{font-size:14px;margin:20px 0 4px}.day:first-child{margin-top:0}
.meta{display:grid;gap:12px 24px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:16px 0}
.meta dt{color:var(--muted);font-size:12px;line-height:16px}.meta dd{margin:2px 0 0;font-weight:500}
.empty{padding:32px 24px;text-align:center;color:var(--muted)}

/* auth */
.auth-wrap{min-height:100vh;display:grid;place-items:center;padding:32px 16px}
.auth{width:100%;max-width:420px}.auth .card{padding:32px}.auth .brand{justify-content:center;margin-bottom:20px;padding:0}
.auth h1{margin-bottom:8px}

/* calendar */
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.cal>div{border-right:1px solid var(--sep);border-bottom:1px solid var(--sep);min-height:104px;padding:8px;min-width:0}
.cal>div:nth-child(7n){border-right:0}
.cal .dow{min-height:0;font-size:12px;font-weight:500;color:var(--muted);padding:12px 8px}
.cal .out{background:color-mix(in srgb,var(--surface-2) 60%,transparent);color:var(--muted)}
.cal .num{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:99px;font-size:12px;font-weight:600}
.cal .today .num{background:var(--accent);color:#fff}
.oc{display:block;margin-top:6px;padding:4px 8px;border-radius:8px;font-size:12px;font-weight:500;line-height:16px;
background:hsl(var(--h) 70% var(--oc-l));color:hsl(var(--h) 60% var(--oc-text-l));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc small{display:block;font-weight:400;opacity:.85}
.oc.need{background:var(--danger-soft);color:var(--danger-soft-fg)}
.swatch{display:inline-block;width:10px;height:10px;border-radius:3px;background:hsl(var(--h) 70% 55%);margin-right:8px}
@media (max-width:640px){.cal>div{min-height:64px;padding:4px}.oc{font-size:10px;padding:2px 4px}.oc small{display:none}}
.n-short{display:none}
@media (max-width:900px){.n-full{display:none}.n-short{display:inline}}
.weekends .wk{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1.3fr) auto;gap:8px 20px;align-items:center;padding:14px 0;border-top:1px solid var(--sep)}
.weekends .wk:first-child{border-top:0;padding-top:4px}
.person{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0}
.person .inline{margin-left:auto}
@media (max-width:760px){.weekends .wk{grid-template-columns:1fr}.weekends .wk .actions{justify-self:start}}
`;

// Icons: 24px stroke paths in the style the design system uses (Lucide geometry).
const icon = (paths) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const I = {
  bell: icon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  calendar: icon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  alert: icon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>'),
  users: icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  list: icon('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  sliders: icon('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
  moon: icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>'),
  monitor: icon('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  logout: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  check: icon('<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'),
  info: icon('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'),
  eye: icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  clock: icon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  chart: icon('<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>'),
  back: icon('<path d="m15 18-6-6 6-6"/>'),
  next: icon('<path d="m9 18 6-6-6-6"/>'),
};

export const THEMES = ['system', 'light', 'dark'];

const initials = (name) => esc(String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase());

export function layout({ title, user, body, flash, active }) {
  const theme = THEMES.includes(user?.theme) ? user.theme : 'system';
  const head = `<!doctype html><html lang="en"${theme === 'system' ? '' : ` data-theme="${theme}"`}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(config.appName)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📟</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>${CSS}</style></head><body>`;
  const brand = `<a class="brand" href="/"><i aria-hidden="true">${esc(config.appName[0] || 'P')}</i>${esc(config.appName)}</a>`;
  const foot = `${flash?.undo ? '<script src="/undo.js"></script>' : ''}</body></html>`;
  if (!user) return `${head}<div class="auth-wrap"><div class="auth">${brand}${flash ? flashBox(flash) : ''}${body}</div></div>${foot}`;

  const open = Number(user.openIncidents) || 0;
  const link = (href, label, key, ic, extra = '') =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${ic}<span class="label">${label}</span>${extra}</a>`;
  const badge = open ? `<span class="badge" aria-label="${open} open incident${open === 1 ? '' : 's'}">${open}</span>` : '';
  const responder = isResponder(user);
  const links = [
    responder && link('/', 'On call', 'home', I.bell),
    link('/calendar', 'Calendar', 'calendar', I.calendar),
    link('/incidents', 'Incidents', 'incidents', I.alert, badge),
    responder && link('/team', 'Team', 'team', I.users),
    link('/log', 'Audit log', 'log', I.list),
    responder && link('/settings', 'Settings', 'settings', I.sliders),
  ].filter(Boolean).join('');
  return `${head}<div class="shell">
<aside class="side">${brand}
  <nav class="nav" aria-label="Main">${links}</nav>
  <div class="side-foot">
  <form method="post" action="/theme" class="theme" aria-label="Theme"><input type="hidden" name="back" value="${esc(user.path || '/')}">
    ${[['system', 'System', I.monitor], ['light', 'Light', I.sun], ['dark', 'Dark', I.moon]].map(([value, label, ic]) =>
      `<button name="theme" value="${value}" aria-pressed="${theme === value}" title="${label} theme">${ic}<span class="label">${label}</span></button>`).join('')}</form>
  <div class="me"><span class="avatar">${initials(user.name)}</span>
    <div class="who"><span>${esc(user.name)}</span><span class="small muted">${esc(ROLE_LABELS[user.role] || '')}</span></div>
    <form method="post" action="/logout" class="inline"><button class="ghost icon" aria-label="Log out" title="Log out">${I.logout}</button></form></div></div>
</aside>
<main>${flash ? flashBox(flash) : ''}${body}</main></div>${foot}`;
}

function flashBox(flash) {
  const undo = flash.undo && Number(flash.undo.until) > Date.now()
    ? `<form method="post" action="/swaps/${Number(flash.undo.id)}/undo" class="inline" data-undo-until="${Number(flash.undo.until)}">
        <button class="sm">Undo (<span data-undo-left>10</span>s)</button></form>`
    : '';
  const error = flash.type === 'error';
  return `<div class="flash ${error ? 'error' : ''}" role="${error ? 'alert' : 'status'}">${error ? I.info : I.check}<span class="msg">${esc(flash.message)}</span>${undo}</div>`;
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

/** A labelled input. A field error replaces the hint and is announced with the input. */
function field({ id, label, value = '', type = 'text', attrs = '', hint = '', error = null }) {
  const described = error ? `${id}-error` : hint ? `${id}-hint` : '';
  return `<div class="field"><label for="${id}">${label}</label>
    <input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${attrs}${error ? ' aria-invalid="true"' : ''}${described ? ` aria-describedby="${described}"` : ''}>
    ${error ? `<p class="field-error" id="${id}-error">${esc(error)}</p>` : hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}</div>`;
}

/**
 * Form errors are a string (about the whole form) or { field, message }. A field error is shown
 * on that field when the form has it, otherwise at the top of the card.
 */
function splitError(error, fields) {
  if (!error) return { top: null, on: () => null };
  if (typeof error === 'string') return { top: error, on: () => null };
  return fields.includes(error.field)
    ? { top: null, on: (f) => (f === error.field ? error.message : null) }
    : { top: error.message, on: () => null };
}
const topError = (message) => (message ? `<div class="flash error" role="alert">${I.info}<span class="msg">${esc(message)}</span></div>` : '');

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const contactFields = (values, on) =>
  field({ id: 'slack', label: 'Your Slack', value: values.slack, attrs: 'placeholder="Slack email or member ID (U0123ABCD)"', error: on('slack'),
    hint: 'Leave blank to use your work email. Or paste your member ID: Slack → your profile → ⋮ → Copy member ID. Each person needs their own.' })
  + field({ id: 'whatsapp', label: 'Your phone number', type: 'tel', value: values.whatsapp, error: on('whatsapp'),
    attrs: 'required placeholder="+1 415 555 0123" autocomplete="tel"', hint: "With country code. Pages arrive here when you're on call." });

export function authPage({ mode, values = {}, error, domains, google, notConfigured }) {
  const signup = mode === 'signup';
  const only = domains.length ? `@${domains.map(esc).join(' / @')}` : '';
  const { top, on } = splitError(error, signup ? ['name', 'email', 'password', 'slack', 'whatsapp'] : []);
  const body = notConfigured
    ? `<div class="card"><h1>Sign-in isn't set up yet</h1>
  <p class="muted">An admin needs to add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> so only your team's Google accounts can get in.</p></div>`
    : google
    ? `<div class="card">
  <h1>Sign in</h1>
  <p class="muted">Weekend on-call for ${esc(config.teamName)}.</p>
  ${topError(top)}
  <a class="btn block" href="/auth/google" style="height:40px;margin:20px 0 16px">${GOOGLE_ICON} Sign in with Google</a>
  ${only ? `<p class="small muted" style="margin:0">Only ${only} Google accounts can sign in. First time? Sign in and you'll be asked for your Slack account and phone number.</p>` : ''}
</div>`
    : `<div class="card">
  <h1>${signup ? `Join the ${esc(config.teamName)} on-call rotation` : 'Log in'}</h1>
  <p class="muted">${signup ? 'The team takes turns covering weekends.' : `Weekend on-call for ${esc(config.teamName)}.`}</p>
  ${topError(top)}
  <form method="post" action="/${mode}" style="margin-top:20px" novalidate>
    ${signup ? field({ id: 'name', label: 'Full name', value: values.name, attrs: 'required autocomplete="name"', error: on('name') }) : ''}
    ${field({ id: 'email', label: 'Work email', type: 'email', value: values.email, attrs: 'required autocomplete="email"', error: on('email'),
      hint: signup && only ? `Must be an ${only} address.` : '' })}
    ${field({ id: 'password', label: 'Password', type: 'password', error: on('password'),
      attrs: `required minlength="${signup ? 10 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"`, hint: signup ? 'At least 10 characters.' : '' })}
    ${signup ? contactFields(values, on) : ''}
    <button class="primary block" type="submit" style="width:100%;height:40px">${signup ? 'Sign up' : 'Log in'}</button>
  </form>
  <p class="muted" style="margin:16px 0 0;text-align:center">${signup ? 'Already signed up? <a href="/login">Log in</a>' : 'New to the team? <a href="/signup">Sign up</a>'}</p>
</div>`;
  return layout({ title: signup ? 'Sign up' : 'Log in', body });
}

export function welcomePage({ identity, values = {}, error }) {
  const { top, on } = splitError(error, ['name', 'slack', 'whatsapp']);
  const body = `<div class="card">
  <h1>Welcome, ${esc(identity.name.split(' ')[0])}</h1>
  <p class="muted">Signed in as ${esc(identity.email)}. Add how we reach you when you're on call.</p>
  ${topError(top)}
  <form method="post" action="/welcome" style="margin-top:20px" novalidate>
    ${field({ id: 'name', label: 'Full name', value: values.name, attrs: 'required autocomplete="name"', error: on('name') })}
    ${contactFields(values, on)}
    <button class="primary" type="submit" style="width:100%;height:40px">Join the rotation</button>
  </form></div>`;
  return layout({ title: 'Welcome', body });
}

function personCell(u, extra = '') {
  if (!u) return '<span class="muted">Nobody — add people on the Team page</span>';
  return `<div class="person"><span class="avatar">${initials(u.name)}</span><span>${esc(u.name)}${extra}</span></div>`;
}

const names = (people) => people.map((p) => esc(p.name)).join(' & ');

/** "Add me" / "Remove me" for the signed-in user only. */
function selfButton(user, e, back = '', now = new Date()) {
  if (e.shift.end <= now || !isResponder(user)) return '';
  const on = e.people.some((p) => p.id === user.id);
  if (on && e.shift.start <= now) return ''; // can't leave a running weekend; someone takes the spot instead
  const hidden = back ? `<input type="hidden" name="back" value="${back}">` : '';
  return on
    ? `<form method="post" action="/weekends/${e.shift.key}/leave" class="inline">${hidden}<button class="sm">Remove me</button></form>`
    : `<form method="post" action="/weekends/${e.shift.key}/join" class="inline">${hidden}<button class="${e.needsCover ? 'sm primary' : 'sm'}">Add me</button></form>`;
}

function peopleCell(e) {
  const chips = e.people.map((p) => `<span class="person"><span class="avatar sm">${initials(p.name)}</span>${esc(p.name)}${
    e.joined.includes(p.id) ? ' <span class="pill">added themselves</span>' : ''}</span>`).join('');
  const cover = e.needsCover
    ? ` <span class="pill open">needs ${e.shift.count - e.people.length} more</span>` : '';
  return `<div class="row" style="gap:16px">${chips || '<span class="muted">Nobody yet</span>'}${cover}</div>`;
}

export function dashboardPage({ user, now, onCall, runningShift, nextEntry, backup, schedule, coverage, balance, recentLog, openIncidents, flash }) {
  const tz = config.timezone;
  const shown = onCall?.shift ?? runningShift ?? nextEntry?.shift;
  const after = schedule.find((e) => shown && e.shift.start > shown.start);
  const facts = `<dl class="meta">
    ${shown ? `<div><dt>Shift</dt><dd>${esc(shiftSpan(shown))}</dd></div>` : ''}
    <div><dt>Backup</dt><dd>${esc(backup?.name || '—')}</dd></div>
    ${after ? `<div><dt>Next weekend</dt><dd>${after.people.length ? names(after.people) : 'Needs cover'}</dd></div>` : ''}
  </dl>`;
  const hero = onCall
    ? `<span class="pill accent">On call now</span>
        <div class="names">${names(onCall.people)}</div>
        <p class="lede">On call until ${esc(fmt(onCall.shift.end))}.${backup ? ` ${esc(backup.name)} is the backup if nobody acknowledges in ${config.escalateAfterMinutes} minutes.` : ''}</p>`
    : runningShift
    ? `<span class="pill open">Nobody is on call this weekend</span>
        <div class="names">Pages go to the team channel and the admins</div>
        <p class="lede">Until ${esc(fmt(runningShift.end))}. Add yourself below to cover it.</p>`
    : `<span class="pill">Nobody is on call right now — it's a weekday</span>
        <div class="names">${nextEntry?.people.length ? `Next: ${names(nextEntry.people)}` : 'Next weekend needs cover'}</div>
        <p class="lede">${nextEntry ? `Starts ${esc(fmt(nextEntry.shift.start))}.` : ''}</p>`;
  const group = config.whatsappGroupUrl
    ? `<a class="btn" href="${esc(config.whatsappGroupUrl)}" target="_blank" rel="noopener noreferrer">Join the on-call WhatsApp group</a>` : '';

  const rows = schedule.map((e) => {
    const isNow = onCall && e.shift.key === onCall.shift.key;
    return `<tr class="${isNow ? 'now' : ''}">
      <td><strong>${esc(formatRange(e.shift, tz))}</strong>${isNow ? ' <span class="pill accent">now</span>' : ''}<div class="t-meta">${esc(shiftSpan(e.shift))}</div></td>
      <td>${peopleCell(e)}</td>
      <td class="actions">${selfButton(user, e, '', now)}</td>
    </tr>`;
  }).join('');

  const incidents = openIncidents.length
    ? `<table>${openIncidents.map((inc) => `<tr>
        <td><div class="row"><span class="pill ${inc.status}">${statusLabel(inc.status)}</span><a class="t-title" href="/incidents/${inc.id}">#${inc.id} ${esc(inc.title)}</a></div>
          <div class="t-meta">${esc(ago(inc.created_at, now))} · ${inc.assigned_name ? 'paged the on-call' : 'team channel'}</div></td>
        <td class="actions">${incidentButtons(user, inc, 'home')}</td></tr>`).join('')}</table>`
    : '<p class="muted" style="margin:0">All quiet. No open incidents.</p>';

  const balanceRows = balance.map((b) => `<tr><td>${personCell(b.user, isAdmin(b.user) ? ' <span class="pill">Admin, optional</span>' : '')}</td>
    <td class="num"><strong>${b.weekends}</strong></td></tr>`).join('');

  const body = `<div class="head"><div><h1>On call</h1><p class="sub">${esc(fmt(now))}</p></div></div>
  <div class="split">
    <div class="card hero">${hero}${facts}${group ? `<div class="row" style="margin-top:20px">${group}</div>` : ''}</div>
    <div class="card"><h2>Page the on-call</h2>${pageForm()}</div>
  </div>
  <div class="card"><div class="card-head"><h2>Open incidents</h2><a class="small" href="/incidents">All incidents</a></div>${incidents}</div>
  <div class="card flush"><div style="padding:24px 24px 0"><h2>Weekend rotation</h2>
    <p class="muted">Each shift (${esc(describeDays(coverage.days))}, ${esc(coverage.start)} → ${esc(coverage.end)}, ${esc(tz)}) gets ${coverage.weekendCount === coverage.weekdayCount ? coverage.weekendCount : `${coverage.weekendCount} on weekend days and ${coverage.weekdayCount} on weekdays`} people from the rotation, in turn, so everyone gets the same share. Admins are optional.
    Anyone can <strong>add themselves</strong> to any weekend, with no limit, and <strong>remove themselves</strong> from one of theirs before it starts. You can only change your own spot. Every change goes into the <a href="/log">public log</a>.</p></div>
    <div class="scroll"><table><thead><tr><th>Weekend</th><th>On call</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="grid">
    <div class="card"><h2>Balance · next ${schedule.length} weekends</h2>
      <table>${balanceRows}</table></div>
    <div class="card"><div class="card-head"><h2>Recent changes</h2><a class="small" href="/log">Full audit log</a></div>${logList(recentLog)}</div>
  </div>`;
  return layout({ title: 'On call', user, body, flash, active: 'home' });
}

function logLine(l) {
  const wk = esc(weekendLabel(l.weekend_key));
  if (l.action === 'swap') {
    return `<strong>${esc(l.user_name)}</strong> took <strong>${esc(l.other_name)}</strong>'s spot on the weekend of ${wk}${
      l.undone_at ? ' <span class="pill">Undone within 10 s</span>' : ''}`;
  }
  return `<strong>${esc(l.user_name)}</strong>
    ${l.action === 'join' ? 'added themselves to' : 'removed themselves from'} the weekend of ${wk}`;
}

const timeOnly = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const dayHeading = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));
const logIcon = (l) => `<span class="pill ${l.action === 'leave' ? 'open' : l.action === 'swap' ? 'accent' : 'resolved'}">${l.action === 'join' ? 'Added' : l.action === 'leave' ? 'Removed' : 'Swap'}</span>`;

function logList(log, { grouped = false } = {}) {
  if (!log.length) return '<p class="muted" style="margin:0">No changes yet.</p>';
  if (!grouped) {
    return `<ul class="timeline">${log.map((l) => `<li><div>${logLine(l)}</div><div class="t-meta">${esc(fmt(l.at))}</div></li>`).join('')}</ul>`;
  }
  const days = [];
  for (const l of log) {
    const day = dayHeading(l.at);
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(l);
  }
  return days.map((d) => `<h2 class="day">${esc(d.day)}</h2>
    <ul class="timeline">${d.items.map((l) => `<li class="row" style="align-items:center;flex-wrap:nowrap;gap:12px">
      <span class="small muted" style="min-width:64px">${esc(timeOnly(l.at))}</span>${logIcon(l)}<span>${logLine(l)}</span></li>`).join('')}</ul>`).join('');
}

function weekendLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function logPage({ user, log, flash }) {
  const body = `<div class="head"><div><h1>Audit log</h1>
    <p class="sub">Visible to everyone on the team: every time someone added themselves to a weekend, removed themselves, or swapped in for someone, newest first.</p></div></div>
  <div class="card">${logList(log, { grouped: true })}</div>`;
  return layout({ title: 'Audit log', user, body, flash, active: 'log' });
}

function pageForm({ compact = false } = {}) {
  if (compact) {
    return `<form method="post" action="/incidents" class="row" style="align-items:flex-start;flex-wrap:nowrap">
        <div style="flex:1;min-width:0"><label for="page-title" class="sr">What's broken?</label>
          <input id="page-title" name="title" required maxlength="200" placeholder="What's broken? e.g. Checkout failing for all stores">
          <textarea name="details" maxlength="4000" aria-label="Details" placeholder="Details, links, dashboards (optional)" style="margin-top:8px;min-height:36px;height:36px"></textarea></div>
        <button class="danger-solid">${I.bell} Page now</button>
      </form>`;
  }
  return `<form method="post" action="/incidents">
        <div class="field"><label for="page-title">What's broken?</label>
          <input id="page-title" name="title" required maxlength="200" placeholder="e.g. Checkout failing for all stores"></div>
        <div class="field"><label for="page-details">Details</label>
          <textarea id="page-details" name="details" maxlength="4000" placeholder="Links, dashboards, what you've tried (optional)"></textarea></div>
        <button class="danger-solid" style="width:100%">${I.bell} Page now</button>
      </form>`;
}

const statusLabel = (s) => ({ open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' })[s] || esc(s);

function incidentButtons(user, inc, back = '') {
  if (inc.status === 'resolved' || !isResponder(user)) return '';
  return `<div class="row" style="justify-content:flex-end">
    ${inc.status === 'open' ? `<form method="post" action="/incidents/${inc.id}/ack" class="inline"><input type="hidden" name="back" value="${back}"><button class="sm primary">Acknowledge</button></form>` : ''}
    <form method="post" action="/incidents/${inc.id}/resolve" class="inline"><button class="sm">Resolve</button></form></div>`;
}

export function incidentsPage({ user, incidents, status, stats, now, flash }) {
  const tile = (ic, label, value, sub) => `<div class="stat"><div class="stat-label">${ic}${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
  const tiles = `<div class="stats">
    ${tile(I.alert, 'Open now', stats.open, stats.open ? 'Waiting for someone to acknowledge' : 'All quiet')}
    ${tile(I.eye, 'Acknowledged', stats.acknowledged, 'Someone is on it')}
    ${tile(I.clock, 'Median time to acknowledge', stats.medianAckMinutes === null ? '—' : `${stats.medianAckMinutes} min`, 'Last 30 days')}
    ${tile(I.chart, 'Last 30 days', stats.last30Days, stats.last30Days === 1 ? 'incident' : 'incidents')}
  </div>`;
  const tab = (key, label, count) => `<a href="/incidents${key ? `?status=${key}` : ''}" class="tab"${status === key ? ' aria-current="page"' : ''}>${label} <span class="count">${count}</span></a>`;
  const tabs = `<nav class="tabs" aria-label="Filter by status">${tab(null, 'All', stats.open + stats.acknowledged + stats.resolved)}${
    tab('open', 'Open', stats.open)}${tab('acknowledged', 'Acknowledged', stats.acknowledged)}${tab('resolved', 'Resolved', stats.resolved)}</nav>`;
  const rows = incidents.map((inc) => `<tr>
    <td><a class="t-title" href="/incidents/${inc.id}">${esc(inc.title)}</a>
      <div class="t-meta">#${inc.id} · via ${esc(inc.source)}</div></td>
    <td><span class="pill ${inc.status}">${statusLabel(inc.status)}</span>
      ${inc.acked_by_name ? `<div class="t-meta">by ${esc(inc.acked_by_name)}</div>` : ''}</td>
    <td class="hide-sm">${inc.assigned_name ? personCell({ name: inc.assigned_name }) : '<span class="muted">Team channel</span>'}</td>
    <td class="hide-sm">${esc(fmt(inc.created_at))}<div class="t-meta">${esc(ago(inc.created_at, now))}</div></td>
    <td class="actions">${incidentButtons(user, inc)}</td></tr>`).join('');
  const empty = { open: 'No open incidents. All quiet.', acknowledged: 'Nothing acknowledged and waiting.', resolved: 'No resolved incidents yet.' }[status] || 'No incidents yet.';
  const body = `<div class="head"><div><h1>Incidents</h1><p class="sub">Every page, who it reached and how fast someone picked it up.</p></div></div>
  ${tiles}
  <div class="card"><h2>Trigger an alert</h2>${pageForm({ compact: true })}</div>
  ${tabs}
  <div class="card flush scroll">${incidents.length
    ? `<table><thead><tr><th>Incident</th><th>Status</th><th class="hide-sm">Paged</th><th class="hide-sm">Started</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty">${empty}</p>`}</div>`;
  return layout({ title: 'Incidents', user, body, flash, active: 'incidents' });
}

export function incidentPage({ user, inc, events, notes = [], people, notifications, names = {}, flash }) {
  const body = `<p style="margin:0 0 12px"><a class="btn ghost sm" href="/incidents" style="margin-left:-12px">${I.back} All incidents</a></p>
  <div class="card">
    <div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px">
      <div><span class="pill ${inc.status}">${statusLabel(inc.status)}</span>
        <h1 style="margin-top:12px">${esc(inc.title)}</h1><p class="muted" style="margin:4px 0 0">Incident #${inc.id}</p></div>
      ${incidentButtons(user, inc)}</div>
    ${inc.details ? `<p style="white-space:pre-wrap;margin:16px 0 0">${esc(inc.details)}</p>` : ''}
    <dl class="meta">
      <div><dt>Triggered</dt><dd>${esc(fmt(inc.created_at))}</dd></div>
      <div><dt>Source</dt><dd>${esc(inc.source)}</dd></div>
      <div><dt>On call</dt><dd>${esc(people.assigned?.name || 'Nobody')}</dd></div>
      <div><dt>Backup</dt><dd>${esc(people.backup?.name || '—')}</dd></div>
    </dl></div>
  <div class="grid">
    <div class="card"><h2>Timeline</h2><ul class="timeline">${[
      ...events.map((e) => ({ at: e.at, html: esc(e.message) })),
      ...notes.map((n) => ({ at: n.at, html: `<strong>Note from ${esc(n.user_name)}:</strong> ${esc(n.text)}` })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((item) =>
      `<li><div>${item.html}</div><div class="t-meta">${esc(fmt(item.at))}</div></li>`).join('')}</ul></div>
    <div class="card"><h2>Messages sent</h2>${notificationTable(notifications, names)}</div>
  </div>`;
  return layout({ title: `Incident #${inc.id}`, user, body, flash, active: 'incidents' });
}

/** "Fri 6:00 PM → Mon 9:00 AM EST": a shift on one line, with the time zone once. */
function shiftSpan(shift) {
  const part = (d) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, timeZoneName: 'short' }).formatToParts(shift.start).find((p) => p.type === 'timeZoneName')?.value;
  return `${part(shift.start)} → ${part(shift.end)}${zone ? ` ${zone}` : ''}`;
}

/** Slack markup as plain text for the page: names for mentions, no shortcodes, links as their text. */
export function plainSlack(text, names = {}) {
  return String(text ?? '')
    .replace(/<@([UW][A-Z0-9]+)>/g, (_, id) => `@${names[id] || 'someone'}`)
    .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g, (_, label) => label || '@group')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/:[a-z][a-z0-9_+-]*:\s*/g, '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

function notificationTable(rows, names = {}) {
  if (!rows.length) return '<p class="muted" style="margin:0">None.</p>';
  return `<div class="scroll"><table>${rows.map((n) => `<tr>
    <td><strong>${esc(n.channel)}</strong> <span class="muted">→ ${esc(n.recipient)}</span><div class="t-meta">${esc(plainSlack(n.body, names).slice(0, 200))}${plainSlack(n.body, names).length > 200 ? '…' : ''}</div>
      ${n.error ? `<div class="t-meta" style="color:var(--danger-soft-fg)">${esc(n.error)}</div>` : ''}</td>
    <td class="actions"><span class="pill ${esc(n.status)}">${esc(n.status)}</span><div class="t-meta">${esc(fmt(n.at))}</div></td></tr>`).join('')}</table></div>`;
}

export function teamPage({ user, members, inactive, role = '', phoneApp, flash }) {
  const admin = isAdmin(user);
  const counts = Object.fromEntries(ROLES.map((r) => [r, members.filter((m) => m.role === r).length]));
  const chip = (value, label, count) =>
    `<a class="tab" href="${value ? `/team?role=${value}` : '/team'}"${role === value ? ' aria-current="true"' : ''}>${esc(label)} <span class="count">${count}</span></a>`;
  const filter = `<nav class="tabs" aria-label="Filter by role">${chip('', 'All', members.length)}${
    ROLES.map((r) => chip(r, ROLE_LABELS[r], counts[r])).join('')}</nav>`;
  const rows = members.map((m, i) => (role && m.role !== role ? '' : `<tr class="role-${esc(m.role)}">
    <td class="muted">${i + 1}</td>
    <td>${personCell(m, ` <span class="pill">${esc(ROLE_LABELS[m.role] || m.role)}</span>`)}<div class="t-meta" style="margin-left:40px">${esc(m.email)}</div></td>
    <td class="hide-sm">${m.slack_user_id ? `<code>${esc(m.slack_user_id)}</code>` : '<span class="pill failed">Not linked</span>'}</td>
    <td class="hide-sm">${esc(m.whatsapp)}</td>
    <td class="actions">${admin ? `<div class="row" style="justify-content:flex-end">
      <form method="post" action="/team/${m.id}/move" class="inline"><input type="hidden" name="dir" value="-1"><button class="sm icon" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button></form>
      <form method="post" action="/team/${m.id}/move" class="inline"><input type="hidden" name="dir" value="1"><button class="sm icon" ${i === members.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></form>
      <form method="post" action="/team/${m.id}/role" class="inline"><select name="role" aria-label="Role for ${esc(m.name)}">${ROLES.map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${esc(ROLE_LABELS[r])}</option>`).join('')}</select><button class="sm">Set role</button></form>
      <form method="post" action="/team/${m.id}/active" class="inline"><input type="hidden" name="active" value="0"><button class="sm danger">Remove</button></form>
    </div>` : ''}</td></tr>`)).join('');
  const shownInactive = inactive.filter((m) => !role || m.role === role);
  const removed = shownInactive.length ? `<div class="card"><h2>Removed from rotation</h2>
    <p class="muted">Removed people can't sign in until an admin adds them back.</p><table>${shownInactive.map((m) => `<tr>
    <td>${esc(m.name)} <span class="t-meta">${esc(m.email)}</span></td>
    <td class="actions">${admin ? `<form method="post" action="/team/${m.id}/active" class="inline"><input type="hidden" name="active" value="1"><button class="sm">Add back</button></form>` : ''}</td>
  </tr>`).join('')}</table></div>` : '';
  const body = `<div class="head"><div><h1>Team</h1>
    <p class="sub">Each weekend goes to the next engineer in this list. Admins are optional, and non-technical people (C-level, support, product) are never on call: they can view the calendar and audit log and trigger an alert. ${admin ? 'You can reorder or remove people.' : 'Ask an admin to reorder.'}</p></div></div>
  ${filter}
  <div class="card flush scroll"><div style="padding:24px 24px 4px"><h2>Rotation order</h2></div>
    <table><thead><tr><th>#</th><th>Name</th><th class="hide-sm">Slack</th><th class="hide-sm">Phone</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">Nobody has this role.</td></tr>'}</tbody></table></div>
  ${removed}
  ${phoneApp ? phoneAppCard(phoneApp) : ''}
  <div class="card" style="max-width:560px"><h2>Your contact details</h2>
    <form method="post" action="/profile">
      ${field({ id: 'name', label: 'Name', value: user.name, attrs: 'required' })}
      ${field({ id: 'slack', label: 'Slack', value: user.slack_user_id || '', attrs: 'placeholder="Slack email or member ID"' })}
      ${field({ id: 'whatsapp', label: 'Phone number', type: 'tel', value: user.whatsapp, attrs: 'required' })}
      <div class="row"><button class="primary">Save</button>
      <button formaction="/profile/test">Send me a test message</button></div>
    </form></div>`;
  return layout({ title: 'Team', user, body, flash, active: 'team' });
}

const QUIET_ZONE = 4; // modules of blank border scanners need around the code

/**
 * Black modules on a white square, whatever the page theme: phone cameras read dark-on-light
 * codes reliably and inverted ones often not at all.
 */
export function qrSvg(text, { label = 'Phone app sign-in code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
}

/** The QR code that signs the PagerDiem app in as you, and the phones already signed in. */
function phoneAppCard({ qr, phones }) {
  const rows = phones.map((d) => `<tr>
    <td>${esc(d.name)} <span class="t-meta">${d.platform === 'ios' ? 'iPhone' : 'Android'}</span></td>
    <td class="t-meta">${d.tested_at ? `Tested ${esc(fmt(d.tested_at))}` : 'Not tested yet'}</td>
    <td class="actions"><form method="post" action="/devices/${Number(d.id)}/revoke" class="inline"><button class="sm">Sign out</button></form></td>
  </tr>`).join('');
  return `<div class="card" style="max-width:560px"><h2>Phone app</h2>
    <p class="muted">Pages ring your phone like a call. Scan this with the PagerDiem app to sign in. The code works once, for 10 minutes.</p>
    <details>
      <summary class="btn sm">Show sign-in code</summary>
      <div style="width:200px;max-width:100%;margin:12px 0">${qr}</div>
    </details>
    ${rows ? `<table>${rows}</table>` : '<p class="t-meta">No phones signed in yet.</p>'}</div>`;
}

export function settingsPage({ user, coverage, domains, ping, status, notifications, flash }) {
  const admin = isAdmin(user);
  const yes = (ok, label) => `<span class="pill ${ok ? 'sent' : 'dry-run'}">${ok ? 'Connected' : label}</span>`;
  const url = (p) => `<code>${esc(config.publicUrl + p)}</code>`;
  const resend = admin
    ? `<div class="card"><h2>Weekend messages</h2>
        <p class="muted">Re-send this weekend's "you're on call now" message to everyone on call, and post it in the on-call channel again. Useful if Slack was connected after the weekend started.</p>
        <form method="post" action="/admin/resend-weekend-start" class="inline"><button class="sm">Re-send this weekend's on-call messages</button></form></div>`
    : '';
  const dayBoxes = DAY_NAMES.map((name, d) =>
    `<label class="check"><input type="checkbox" name="day_${d}" value="1" ${coverage.days.includes(d) ? 'checked' : ''}> ${name}</label>`).join('');
  const presetButtons = Object.entries(PRESETS).map(([key, p]) => `<button name="preset" value="${key}" class="sm">${esc(p.label)}</button>`).join(' ');
  const coverageCard = admin
    ? `<div class="card"><h2>On-call coverage</h2>
        <p class="muted">Which days need someone on call. Consecutive days form one shift: it starts at the start time on its first day and ends at the end time the morning after its last day. Changes apply to the calendar and rotation right away.</p>
        <form method="post" action="/settings/coverage">
          <div class="row" style="gap:4px 16px;margin:16px 0">${dayBoxes}</div>
          <div class="fields" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            <div class="field"><label for="start">Shift starts</label><input id="start" name="start" type="time" required value="${esc(coverage.start)}"></div>
            <div class="field"><label for="end">Shift ends</label><input id="end" name="end" type="time" required value="${esc(coverage.end)}"></div>
            <div class="field"><label for="weekend_count">People on weekend days</label><input id="weekend_count" name="weekend_count" type="number" min="1" max="10" required value="${coverage.weekendCount}"></div>
            <div class="field"><label for="weekday_count">People on weekdays</label><input id="weekday_count" name="weekday_count" type="number" min="1" max="10" required value="${coverage.weekdayCount}"></div>
          </div>
          <p class="hint" style="margin:0 0 16px">A shift needs as many people as the busiest day it covers. Set both to the same number for "same all week".</p>
          <button class="primary">Save coverage</button>
          <p class="small muted" style="margin:20px 0 8px">Or start from a preset (keeps the times and counts above):</p>
          <div class="row">${presetButtons}</div>
        </form></div>`
    : `<div class="card"><h2>On-call coverage</h2>
        <p>${esc(describeDays(coverage.days))}, ${esc(coverage.start)} → ${esc(coverage.end)}. ${coverage.weekendCount} on weekend days, ${coverage.weekdayCount} on weekdays.</p>
        <p class="small muted" style="margin:0">Ask an admin to change it.</p></div>`;
  const domainsCard = `<div class="card"><h2>Workspace</h2>
        <p>${domains.length ? `Only ${domains.map((d) => `@${esc(d)}`).join(', ')} accounts can sign in.` : 'Not restricted (local development).'}</p>
        <p class="small muted" style="margin:0">Set by the <code>ALLOWED_EMAIL_DOMAINS</code> environment variable. Change it where the app is deployed and restart.</p></div>`;
  const pingCard = `<div class="card"><div class="card-head"><h2>/ping AI check</h2>${ping.mode === 'off' ? '<span class="pill dry-run">Off</span>' : `<span class="pill sent">${esc(ping.mode)}</span>`}</div>
        ${ping.mode === 'off'
    ? '<p>Off. Set <code>PING_ENABLED=true</code> with <code>ANTHROPIC_API_KEY</code> (or a routine) to let engineers run <code>/ping</code> in Slack.</p>'
    : ping.mode === 'api'
      ? `<p>Runs on the Claude API (<code>${esc(ping.model)}</code>) with your skill file <code>${esc(ping.skillFile)}</code>${ping.skillFound ? '' : ' <span class="pill failed">not found, using a short default</span>'}. ${ping.checkUrls} health URL${ping.checkUrls === 1 ? '' : 's'} probed.</p>`
      : '<p>Hands each request to your Claude Code routine, which replies in the thread.</p>'}
        <p class="small muted" style="margin:0">Engineers and admins only. One check every ${ping.cooldownSeconds} s, at most ${ping.maxPerDay} a day. Configured by environment variables, see docs/ping.md.</p></div>`;
  const body = `<div class="head"><div><h1>Settings</h1><p class="sub">How ${esc(config.appName)} reaches people, and how alerts get in.</p></div></div>
  <div class="split">${coverageCard}${domainsCard}</div>
  <div class="grid">${pingCard}</div>
  <div class="grid">
    <div class="card"><div class="card-head"><h2>Slack</h2>${yes(status.slack, 'Dry run')}</div>
      <p>On-call channel: ${config.slack.channel ? `<code>${esc(config.slack.channel)}</code>` : '<span class="muted">not set</span>'}</p>
      <p>Slash commands (point both at the same URL): <code>/oncall</code>, <code>/page</code>, <code>/ping</code> → ${url('/slack/commands')}</p>
      <p>Interactivity request URL (Acknowledge / Resolve buttons): ${url('/slack/interactions')}</p>
      <p class="small muted" style="margin:0">Bot scopes: chat:write, users:read, users:read.email, im:write, commands.</p></div>
    <div class="card"><div class="card-head"><h2>Alerts API</h2>${yes(status.api, 'Disabled')}</div>
      <p>Trigger a page from Sentry, Coralogix, CI or a script:</p>
      <p><code>curl -X POST ${esc(config.publicUrl)}/api/incidents -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d '{"title":"API 5xx spike","details":"..."}'</code></p>
      <p class="small muted" style="margin:0">Set API_TOKEN to enable. An alert with the same title as an unresolved incident joins it instead of paging again.</p></div>
  </div>
  ${resend}
  <div class="card"><h2>Recent messages</h2>${notificationTable(notifications)}</div>`;
  return layout({ title: 'Settings', user, body, flash, active: 'settings' });
}

export function messagePage({ user, title, message, link }) {
  const body = `<div class="card"><h1>${esc(title)}</h1><p class="muted" style="margin:8px 0 ${link ? '20px' : '0'}">${esc(message)}</p>${
    link ? `<a class="btn primary" href="${esc(link.href)}">${esc(link.label)}</a>` : ''}</div>`;
  return layout({ title, user, body });
}

/** Next to each name: "Remove me" on your own name, "Swap" (take their spot) on others. */
function personAction(user, e, p) {
  if (e.shift.end <= new Date() || !isResponder(user)) return '';
  if (p.id === user.id) {
    if (e.shift.start <= new Date()) return ''; // can't leave a running weekend; someone takes the spot instead
    return `<form method="post" action="/weekends/${e.shift.key}/leave" class="inline"><input type="hidden" name="back" value="calendar"><button class="sm">Remove me</button></form>`;
  }
  if (e.people.some((x) => x.id === user.id)) return ''; // you're already on this weekend
  return `<form method="post" action="/weekends/${e.shift.key}/swap" class="inline"><input type="hidden" name="user_id" value="${p.id}">
    <button class="sm" title="Take ${esc(p.name)}'s spot on this weekend">Swap</button></form>`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const hue = (id) => (Number(id) * 137) % 360;

export function calendarPage({ user, grid, prevMonth, nextMonth, thisMonth, feedUrl, flash }) {
  const tz = config.timezone;
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
  const timeOf = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
  const chipsFor = ({ entry: e, isStart, isEnd }) => {
    const when = isStart ? `<small>from ${esc(timeOf(e.shift.start))}</small>` : isEnd ? `<small>until ${esc(timeOf(e.shift.end))}</small>` : '';
    return e.people.length
      ? e.people.map((p, i) => `<span class="oc" style="--h:${hue(p.id)}" title="${esc(p.name)} on call"><span class="n-full">${esc(p.name)}</span><span class="n-short">${esc(p.name.split(' ')[0])}</span>${i === e.people.length - 1 ? when : ''}</span>`).join('')
        + (e.needsCover ? '<span class="oc need">needs cover</span>' : '')
      : `<span class="oc need">needs cover${when}</span>`;
  };
  const cells = grid.weeks.flat().map((d) =>
    `<div class="${d.inMonth ? '' : 'out'} ${d.today ? 'today' : ''}"><span class="num">${d.day}</span>${d.items.map(chipsFor).join('')}</div>`).join('');

  const list = grid.entries.length
    ? `<div class="weekends">${grid.entries.map((e) => `<div class="wk">
        <div><strong>${esc(formatRange(e.shift, tz))}</strong><div class="t-meta">${esc(shiftSpan(e.shift))}</div></div>
        <div>${e.people.map((p) => `<div class="person"><span class="swatch" style="--h:${hue(p.id)}"></span><span>${esc(p.name)}</span>${personAction(user, e, p)}</div>`).join('') || '<span class="muted">Nobody</span>'}
          ${e.needsCover ? `<span class="pill open">needs ${e.shift.count - e.people.length} more</span>` : ''}</div>
        <div class="actions">${e.people.some((p) => p.id === user.id) ? '' : selfButton(user, e, 'calendar')}</div></div>`).join('')}</div>`
    : '<p class="muted" style="margin:0">No weekends scheduled this month yet.</p>';

  const googleAdd = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace(/^https?:/, 'webcal:'))}`;
  const body = `<div class="head"><div><h1>${MONTHS[grid.month - 1]} ${grid.year}</h1><p class="sub">Who's on call each weekend.</p></div>
    <div class="row"><a class="btn icon" href="/calendar?month=${prevMonth}" aria-label="Previous month">${I.back}</a>
      <a class="btn sm" href="/calendar?month=${thisMonth}">Today</a>
      <a class="btn icon" href="/calendar?month=${nextMonth}" aria-label="Next month">${I.next}</a></div></div>
  <div class="card flush"><div class="cal">${dows}${cells}</div></div>
  <div class="split">
    <div class="card"><h2>Weekends this month</h2>${list}
      <p class="small muted" style="margin:16px 0 0">${isResponder(user)
        ? `<strong>Add me</strong> joins a weekend. <strong>Swap</strong> takes that person's spot, and you have 10 seconds to undo it before they and Slack are told. Every change is in the <a href="/log">audit log</a>.`
        : 'Need an engineer now? <a href="/incidents">Trigger an alert</a>. Every roster change is in the <a href="/log">audit log</a>.'}</p></div>
    <div class="card"><h2>Add to your calendar</h2>
      <p>Subscribe once and every on-call weekend shows up in your calendar, updated automatically.</p>
      <p><a class="btn primary" href="${esc(googleAdd)}" target="_blank" rel="noopener">Add to Google Calendar</a></p>
      <p class="small muted">Other apps: subscribe to this URL. Keep it inside the team.</p>
      <p style="margin:0"><code>${esc(feedUrl)}</code></p></div>
  </div>`;
  return layout({ title: 'Calendar', user, body, flash, active: 'calendar' });
}
