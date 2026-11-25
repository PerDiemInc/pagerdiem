// Server-rendered HTML. Every interpolated value goes through esc().
// The look follows the HeroUI V3 design system: Inter, flat surfaces, soft status chips, pill buttons.
import { config, pushEnabled } from './config.js';
import { formatLocal, formatRange } from './time.js';
import { describeDays, DAY_NAMES, PRESETS } from './settings.js';
import { ROLES, ROLE_LABELS, isAdmin, isResponder } from './roles.js';
import qrcode from './vendor/qrcode.js';

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = (d) => (d ? formatLocal(new Date(d), config.timezone) : '');
const MINUTE = 60_000;

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
--border:#28282c;--sep:#2a2a2e;--default:#27272a;--default-hover:#2e2e31;--hover:rgba(39,39,42,.6);--accent-soft:rgba(4,133,247,.12);--accent-soft-fg:#61a8fc;
--danger-soft:rgba(219,59,62,.15);--danger-soft-fg:#eb7872;--success-soft:rgba(23,201,100,.12);--success-soft-fg:#74d88f;
--warning:#f7b750;--warning-soft:rgba(247,183,80,.12);--warning-soft-fg:#f9cb87;--field:#1f1f23;--field-shadow:inset 0 0 0 1px #3f3f46;
--overlay:inset 0 0 0 1px rgba(255,255,255,.08),0 2px 8px rgba(0,0,0,.4)`;
const CSS = `
:root{color-scheme:light;--bg:#f5f5f5;--surface:#fff;--surface-2:#efeff0;--text:#18181b;--muted:#61616a;--border:#dedee0;--sep:#e4e4e7;
--default:#ebebec;--default-hover:#e1e1e2;--hover:rgba(235,235,236,.6);--accent:#006fee;--accent-hover:#005bc4;--accent-soft:rgba(4,133,247,.15);--accent-soft-fg:#1a5799;
--danger:#dc2626;--danger-hover:#b91c1c;--danger-soft:rgba(255,56,60,.15);--danger-soft-fg:#a43532;
--success:#17c964;--success-soft:rgba(23,201,100,.15);--success-soft-fg:#246b3c;--warning:#f5a524;--warning-soft:rgba(245,165,36,.15);--warning-soft-fg:#77552a;
--field:#fff;--field-shadow:inset 0 0 0 1px var(--border),0 2px 4px rgba(0,0,0,.04),0 1px 2px rgba(0,0,0,.06);
--hairline:inset 0 0 0 1px var(--border);--overlay:inset 0 0 1px rgba(0,0,0,.3),0 2px 8px rgba(0,0,0,.08);
--ring:0 0 0 2px var(--bg),0 0 0 4px var(--accent)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
body{margin:0;font:400 14px/20px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:-.005em;
background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:2px}a:hover{color:var(--accent)}
.link{font-weight:500}
:focus-visible{outline:none;box-shadow:var(--ring)}
h1{font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.01em;margin:0}
h2{font-size:16px;line-height:24px;font-weight:600;letter-spacing:-.01em;margin:0 0 12px}
h3{font-size:16px;line-height:24px;font-weight:600;letter-spacing:-.01em;margin:0}
.display{font-size:30px;line-height:36px;font-weight:600;letter-spacing:-.01em;margin:0}
p{margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:12px;line-height:20px}.strong{font-weight:500}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.logo{width:28px;height:28px;flex:none;display:block}

/* shell: sidebar + content */
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;overflow-y:auto;padding:20px 12px 16px;display:flex;flex-direction:column;gap:24px;box-shadow:inset -1px 0 0 var(--sep)}
.brand{padding:2px 12px;font-size:16px;line-height:24px;font-weight:600;letter-spacing:-.01em;text-decoration:none;display:flex;gap:10px;align-items:center}
.brand:hover{color:var(--text)}
.side-oncall{background:var(--surface);border-radius:20px;padding:12px;display:flex;flex-direction:column;gap:10px}
.so-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.so-body{display:flex;align-items:center;gap:8px;min-width:0}
.so-text{display:flex;flex-direction:column;min-width:0}
.so-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:99px;flex:none;background:var(--muted)}
.dot.success{background:var(--success)}.dot.warning{background:var(--warning)}.dot.danger{background:var(--danger)}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:10px;height:36px;padding:0 12px;border-radius:20px;text-decoration:none;font-weight:500;color:var(--text)}
.nav a .ic{color:var(--muted)}.nav a:hover{background:var(--hover);color:var(--text)}
.nav a[aria-current=page]{background:var(--surface)}.nav a[aria-current=page] .ic{color:var(--text)}
.nav .label{flex:1}
.badge{min-width:20px;height:20px;padding:0 6px;border-radius:99px;display:inline-grid;place-items:center;font-size:12px;font-weight:600;background:var(--danger-soft);color:var(--danger-soft-fg)}
.side-foot{margin-top:auto;display:flex;flex-direction:column;gap:12px}
.theme{display:flex;gap:2px;padding:2px;border-radius:99px;box-shadow:var(--hairline)}
.theme button{flex:1;min-width:0;height:32px;padding:0 4px;gap:6px;font-size:12px;line-height:16px;background:none;color:var(--muted)}
.theme button:hover{background:var(--hover);color:var(--text)}.theme button[aria-pressed=true]{background:var(--surface);color:var(--text);box-shadow:var(--hairline)}
.theme .ic{width:14px;height:14px}
.me{background:var(--surface);border-radius:20px;padding:12px;display:flex;align-items:center;gap:10px}
.me .who{flex:1;min-width:0;display:flex;flex-direction:column}.me .who span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{padding:20px 24px 48px;max-width:1228px;width:100%;min-width:0}
@media (max-width:900px){
  .shell{display:block}
  .side{position:static;height:auto;overflow:visible;padding:16px;gap:16px;box-shadow:inset 0 -1px 0 var(--sep)}
  .brand{padding:2px 0}
  .nav{flex-direction:row;flex-wrap:wrap;gap:4px}.nav a{flex:1 1 auto;justify-content:center}.nav .label{flex:none}
  .side-foot{margin:0;flex-direction:row;align-items:center;gap:8px}
  .theme{flex:none}.theme button{flex:none;width:32px;padding:0}.theme .label{display:none}
  .me{flex:1;min-width:0;padding:8px 8px 8px 12px}
  main{padding:20px 16px 48px}
}

/* page furniture */
.head{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:24px;min-height:48px}
.head .sub{color:var(--muted);margin:2px 0 0}
.card{background:var(--surface);border-radius:24px;padding:20px;margin-bottom:16px;min-width:0}
.card.flush{padding:0;overflow:hidden}
.card-head{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;margin-bottom:12px}.card-head h2{margin:0}
.card-desc{color:var(--muted);margin:-8px 0 16px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));margin-bottom:16px}.grid>.card{margin:0}
.split{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) 380px;margin-bottom:16px}.split>.card{margin:0}
@media (max-width:1100px){.split{grid-template-columns:minmax(0,1fr)}}
.duo{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin-bottom:24px}.duo>*{flex:1 1 340px;min-width:0}.duo>.wide{flex:999 1 520px}.duo>.card{margin:0}
.sec{margin-bottom:24px}
.sec-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.sec-head h2{margin:0}.sec-head p{margin:2px 0 0;max-width:720px}
.sec-head>div:first-child{flex:1 1 0;min-width:0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.scroll{overflow-x:auto;position:relative}
.avatar{width:32px;height:32px;border-radius:99px;display:inline-grid;place-items:center;flex:none;font-size:12px;font-weight:600;background:var(--default);color:var(--text)}
.avatar.accent{background:var(--accent-soft);color:var(--accent-soft-fg)}
.avatar.warning{background:var(--warning-soft);color:var(--warning-soft-fg)}.avatar.success{background:var(--success-soft);color:var(--success-soft-fg)}
.avatar.xs{width:20px;height:20px;font-size:9px}.avatar.sm{width:24px;height:24px;font-size:10px}.avatar.md{width:28px;height:28px;font-size:11px}.avatar.lg{width:36px;height:36px}
.avatar .ic{width:14px;height:14px}.avatar.sm .ic{width:12px;height:12px}
.avatars{display:inline-flex;flex:none}.avatars .avatar{box-shadow:0 0 0 2px var(--surface)}.avatars .avatar+.avatar{margin-left:-6px}.avatars .avatar.xs+.avatar.xs{margin-left:-3px}
.progress{height:4px;border-radius:99px;background:var(--default);overflow:hidden}.progress.md{height:6px}
.progress>span{display:block;height:100%;border-radius:inherit;background:var(--accent)}
.progress.warning>span{background:var(--warning)}.progress.danger>span{background:var(--danger)}

/* the On call home */
.hero{display:flex;flex-wrap:wrap;gap:24px;padding:24px;margin-bottom:24px}
.hero-main{flex:999 1 420px;min-width:0;display:flex;flex-direction:column;gap:20px}
.hero-main .lede{color:var(--muted);max-width:520px;margin:8px 0 0;line-height:24px}
.hero-actions{margin-top:auto}
.shift-bar{display:flex;flex-direction:column;gap:8px;max-width:560px}
.shift-bar .ends{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
.your-phone{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.your-phone .ic{width:16px;height:16px;color:var(--muted)}
.hero-side{flex:1 1 320px;min-width:0;align-self:flex-start;border-radius:20px;box-shadow:var(--hairline);padding:16px;display:flex;flex-direction:column;gap:14px}
.reach{display:flex;align-items:center;gap:12px}
.reach .who{flex:1;min-width:0;display:flex;flex-direction:column}
.reach .chips{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.inc{background:var(--surface);border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:16px;margin-bottom:12px}
.inc-top{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.inc-top>div:first-child{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:6px}
.inc-title{font-size:16px;line-height:24px;font-weight:600;letter-spacing:-.01em;text-decoration:none;overflow-wrap:anywhere}
.track{display:flex;flex-direction:column;gap:8px}
.segs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px}
.segs span{height:4px;border-radius:99px;background:var(--default)}.segs span.on{background:var(--accent)}
.track .steps{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.quiet{background:var(--surface);border-radius:24px;padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.quiet .avatar{width:48px;height:48px}.quiet .avatar .ic{width:22px;height:22px}
.quiet .title{font-size:18px;line-height:28px;font-weight:600;letter-spacing:-.01em}
.plan{display:flex;flex-direction:column;gap:10px;margin:4px 0 20px}
.plan ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.plan li{display:flex;align-items:flex-start;gap:10px}
.plan .when{width:76px;flex:none;font-size:12px;line-height:20px;color:var(--muted);font-variant-numeric:tabular-nums}
.plan li .ic{width:16px;height:16px;color:var(--muted);margin-top:2px}
.wk-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr))}
.wk-card{background:var(--surface);border-radius:24px;padding:16px;display:flex;flex-direction:column;gap:14px;min-height:200px;min-width:0}
.wk-card .top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.wk-card .top>div{display:flex;flex-direction:column;min-width:0}
.wk-card .people{display:flex;flex-direction:column;gap:8px}
.wk-card .p{display:flex;align-items:center;gap:8px;min-width:0}
.wk-card .p .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wk-card .open-spot{color:var(--warning-soft-fg);font-weight:500}
.wk-card .act{margin-top:auto}
.meter{display:flex;flex-direction:column;gap:6px;padding:6px 0}
.meter .top{display:flex;justify-content:space-between;gap:12px}
.changes{list-style:none;margin:0;padding:0}
.changes li{display:flex;gap:12px;align-items:flex-start;padding:10px 0}
.changes .body{flex:1;min-width:0}.changes li>.ic{width:16px;height:16px;color:var(--muted);margin-top:4px}

/* stat tiles */
.stats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px}
.stat{background:var(--surface);border-radius:24px;padding:20px 24px}
.stat-label{display:flex;gap:8px;align-items:flex-start;color:var(--muted);font-weight:500}
.stat-value{font-size:30px;line-height:36px;font-weight:600;letter-spacing:-.01em;margin:8px 0 4px}
.stat-sub{color:var(--muted);font-size:12px;line-height:16px}.stat-label .ic{margin-top:1px}

/* tabs (segmented control) */
.tabs{display:inline-flex;gap:2px;padding:4px;border-radius:99px;background:var(--default);margin:0 0 16px;max-width:100%;overflow-x:auto}
.tab{display:inline-flex;gap:6px;align-items:center;height:32px;padding:0 14px;border-radius:99px;text-decoration:none;font-weight:500;white-space:nowrap}
.tab[aria-current=page],.tab[aria-current=true]{background:var(--surface);box-shadow:var(--overlay)}
.tab .count{font-size:12px;color:var(--muted)}

/* tables */
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:12px;border-bottom:1px solid var(--sep);vertical-align:middle}
tr:last-child>td{border-bottom:0}
th{font-size:12px;line-height:16px;font-weight:500;color:var(--muted);white-space:nowrap}
td.num,th.num{text-align:right}.actions{text-align:right}
.card.flush th:first-child,.card.flush td:first-child{padding-left:24px}.card.flush th:last-child,.card.flush td:last-child{padding-right:24px}
tr.now>td{background:color-mix(in srgb,var(--accent-soft) 45%,transparent)}
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
background:var(--default);color:var(--text);font:inherit;font-weight:500;letter-spacing:-.02em;cursor:pointer;text-decoration:none;white-space:nowrap;
transition:background-color .12s cubic-bezier(.4,0,.2,1)}
button .ic,.btn .ic{width:16px;height:16px}
button:hover,.btn:hover{background:var(--default-hover);color:var(--text)}
button.primary,.btn.primary{background:var(--accent);color:#fff}button.primary:hover,.btn.primary:hover{background:var(--accent-hover)}
button.danger{background:var(--danger-soft);color:var(--danger-soft-fg)}
button.danger-solid{background:var(--danger);color:#fff}button.danger-solid:hover{background:var(--danger-hover)}
button.ghost,.btn.ghost{background:none}button.ghost:hover,.btn.ghost:hover{background:var(--hover)}
button.sm,.btn.sm{height:32px;padding:0 12px}button.lg,.btn.lg{height:40px;padding:0 20px}
button.icon,.btn.icon{width:32px;height:32px;padding:0}
button:disabled{opacity:.5;cursor:not-allowed}
.btn.block,button.block{display:flex;width:100%}
.btn.static{cursor:default;pointer-events:none}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}form.inline select{width:auto;min-height:32px;padding:4px 10px}
form.block{display:flex;margin:0}form.block button{flex:1}

/* chips, alerts, misc */
.pill{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:99px;font-size:12px;line-height:16px;font-weight:500;letter-spacing:-.003em;background:var(--default);color:var(--text);white-space:nowrap}
.pill.sm{height:20px;padding:0 6px}
.pill.open,.pill.failed,.pill.danger{background:var(--danger-soft);color:var(--danger-soft-fg)}
.pill.acknowledged,.pill.dry-run,.pill.warning{background:var(--warning-soft);color:var(--warning-soft-fg)}
.pill.resolved,.pill.sent,.pill.success{background:var(--success-soft);color:var(--success-soft-fg)}
.pill.accent{background:var(--accent-soft);color:var(--accent-soft-fg)}
.alert{display:flex;gap:12px;align-items:flex-start;background:var(--surface);border-radius:24px;padding:16px;margin-bottom:16px}
.card .alert{box-shadow:var(--hairline);border-radius:20px;margin:0}
.alert>.ic{width:20px;height:20px;margin-top:2px}
.alert.warning>.ic{color:var(--warning-soft-fg)}.alert.danger>.ic{color:var(--danger-soft-fg)}
.alert .body{flex:1;min-width:0}.alert .title{font-weight:500}.alert .desc{color:var(--muted);margin:2px 0 0}
.alert .act{flex:none;align-self:center}
.flash{display:flex;gap:10px;align-items:center;background:var(--surface);border-radius:20px;padding:12px 16px;margin-bottom:16px;box-shadow:var(--overlay)}
.flash .ic{color:var(--success-soft-fg)}.flash.error .ic{color:var(--danger-soft-fg)}
.flash .msg{flex:1}
code{font:12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);padding:2px 6px;border-radius:6px;overflow-wrap:anywhere}
.sep{height:1px;background:var(--sep);border:0;margin:0}
.empty{padding:32px 24px;text-align:center;color:var(--muted)}

/* incidents */
.cell{display:flex;align-items:center;gap:10px;min-width:0}
.cell-text{display:flex;flex-direction:column;min-width:0}
td.nowrap{white-space:nowrap}
table.wide{min-width:900px}table.wide td.actions .row{flex-wrap:nowrap}table.msgs{min-width:760px}
table.plain th,table.plain td{border:0;padding:6px 8px;vertical-align:top}
table.plain th:first-child,table.plain td:first-child{padding-left:0}table.plain th:last-child,table.plain td:last-child{padding-right:0}
table.plain tr.sep-top>td{border-top:1px solid var(--sep);padding-top:12px}
th .ic{width:14px;height:14px;vertical-align:-3px;margin-right:4px}
.crumbs{display:flex;align-items:center;gap:8px;margin:0 0 16px;color:var(--muted)}
.crumbs a{text-decoration:none}.crumbs [aria-current]{color:var(--text);font-weight:500}
.head.top{align-items:flex-start}
.head-main{flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:10px}.head-main h1{overflow-wrap:anywhere}
.meta{display:flex;flex-wrap:wrap;gap:8px 16px}.meta>span{display:inline-flex;align-items:center;gap:6px}.meta .ic{width:16px;height:16px;color:var(--muted)}
.stack{display:flex;flex-direction:column;gap:16px}.stack>.card{margin:0}
.esc-now{display:inline-flex;align-items:center;gap:8px;font-weight:500;font-variant-numeric:tabular-nums}
.esc-now .ic{color:var(--accent-soft-fg)}.esc-now.stopped .ic{color:var(--success-soft-fg)}
.esc{list-style:none;margin:8px 0 0;padding:0;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}
.esc li{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 6px;text-align:center;min-width:0}
.esc li::before,.esc li::after{content:"";position:absolute;top:35px;width:50%;height:2px;background:var(--sep)}
.esc li::before{left:0}.esc li::after{right:0}
.esc li:first-child::before,.esc li:last-child::after{display:none}
.esc li.l-on::before,.esc li.r-on::after{background:var(--accent)}
.esc .when,.esc .time{font-size:12px;line-height:16px;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.esc .node{position:relative;z-index:1;width:24px;height:24px;flex:none;border-radius:99px;display:grid;place-items:center;background:var(--default);color:#fff}
.esc .node::after{content:"";width:8px;height:8px;border-radius:99px;background:var(--muted)}
.esc .node .ic{width:14px;height:14px;stroke-width:2.6}
.esc .done .node{background:var(--accent)}.esc .done .node::after{display:none}
.esc .next .node{background:var(--surface);box-shadow:inset 0 0 0 2px var(--accent)}.esc .next .node::after{background:var(--accent)}
.esc .title{font-weight:500;overflow-wrap:anywhere}.esc .skipped .title{color:var(--muted)}
.esc .done .time{color:var(--text)}.esc .next .time{color:var(--accent-soft-fg)}
@media (max-width:760px){
  .esc{grid-auto-flow:row}
  .esc li{display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:12px;row-gap:2px;justify-items:start;text-align:left;padding:0 0 16px}
  .esc li:last-child{padding-bottom:0}
  .esc .node{grid-column:1;grid-row:1 / span 3}.esc li>:not(.node){grid-column:2}
  .esc li::before,.esc li::after{left:11px;right:auto;width:2px}
  .esc li::before{top:0;height:12px}.esc li::after{top:12px;bottom:0;height:auto}
}
.feed{list-style:none;margin:0;padding:0}
.feed li{position:relative;display:grid;grid-template-columns:64px 24px minmax(0,1fr);column-gap:12px}
.feed li::before{content:"";position:absolute;left:87px;top:0;bottom:0;width:2px;background:var(--sep)}
.feed li:first-child::before{top:14px}.feed li:last-child::before{bottom:auto;height:14px}.feed li:only-child::before{display:none}
.feed .time{padding-top:4px;font-size:12px;line-height:16px;color:var(--muted);font-variant-numeric:tabular-nums}
.feed .node{position:relative;z-index:1;margin-top:2px;width:24px;height:24px;border-radius:99px;display:grid;place-items:center;background:var(--default);color:var(--text)}
.feed .node .ic{width:12px;height:12px}
.feed .node.success{background:var(--success-soft);color:var(--success-soft-fg)}.feed .node.accent{background:var(--accent-soft);color:var(--accent-soft-fg)}
.feed .node.warning{background:var(--warning-soft);color:var(--warning-soft-fg)}
.feed .body{padding:4px 0 16px;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px;overflow-wrap:anywhere}
.feed li:last-child .body{padding-bottom:0}
.disclosure>summary{display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none}
.disclosure>summary::-webkit-details-marker{display:none}
.chev{margin-left:auto;display:inline-flex;color:var(--muted);transition:transform .15s cubic-bezier(.4,0,.2,1)}.disclosure[open]>summary .chev{transform:rotate(90deg)}

/* auth */
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:64px 24px}
.auth-page{width:100%;max-width:1040px}
.auth-cols{display:flex;flex-wrap:wrap;align-items:center;gap:64px}
.auth-intro{flex:999 1 420px;min-width:0;display:flex;flex-direction:column;gap:32px}
.auth-intro h1{font-size:36px;line-height:40px;max-width:520px}
.auth-intro .lede{font-size:16px;line-height:28px;max-width:500px;margin:16px 0 0}
.points{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:16px}
.points li{display:flex;gap:14px;align-items:flex-start}
.points li>span:first-child{width:36px;height:36px;flex:none;border-radius:99px;display:grid;place-items:center;background:var(--surface);box-shadow:var(--hairline)}
.points li>span:last-child{display:flex;flex-direction:column;min-width:0;line-height:20px}
.auth-card{flex:1 1 360px;min-width:0;max-width:420px}
.auth-card>.card,.welcome-card>.card{padding:28px;margin:0;display:flex;flex-direction:column;gap:20px}
.auth-card h2,.welcome-card h1{margin:0}.auth-card h2{font-size:20px;line-height:28px}
.card-title p{margin:4px 0 0}
.auth-card form .field:last-of-type{margin-bottom:20px}
.auth-switch{margin:0;text-align:center;color:var(--muted)}
.auth-msg{max-width:420px;margin:0 auto}.auth-msg .brand{padding:0;margin-bottom:24px;justify-content:center}
.card.message{display:flex;flex-direction:column;align-items:flex-start;gap:12px}.auth-msg .card.message{padding:28px}
.welcome-cols{display:flex;flex-wrap:wrap;align-items:flex-start;gap:48px}
.welcome-card{flex:1 1 400px;min-width:0;max-width:460px}
.welcome-card .top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.welcome-card .brand{padding:0}
.step-bar{display:grid;grid-template-columns:repeat(2,28px);gap:4px}.step-bar span{height:4px;border-radius:99px;background:var(--accent)}
.next-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.next-steps li{display:flex;gap:12px;align-items:flex-start}.next-steps li>span:last-child{display:flex;flex-direction:column;gap:2px;min-width:0}
.preview{flex:999 1 420px;min-width:0;display:flex;flex-direction:column;gap:16px;padding-top:8px}
.preview-msg{background:var(--surface);border-radius:20px;padding:16px;display:flex;flex-direction:column;gap:12px}
.preview-msg .from{display:flex;align-items:center;gap:10px}.preview-msg .from>span:last-child{display:flex;flex-direction:column;min-width:0}
@media (max-width:640px){.auth-wrap{padding:32px 16px}.auth-cols,.welcome-cols{gap:32px}.auth-intro h1{font-size:30px;line-height:36px}
  .auth-card>.card,.welcome-card>.card{padding:20px}}

/* calendar: each week is a row of day numbers with the weekends drawn as bands across their days */
.cal-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 12px;padding:0 4px}
.cal-legend span{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:16px}
.cal-legend i{width:12px;height:12px;border-radius:4px;background:var(--default)}
.cal-dows,.cal-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));column-gap:4px}
.cal-dows span{padding:4px 6px;font-size:12px;line-height:16px;font-weight:500;color:var(--muted)}
.cal-week{grid-template-rows:38px;grid-auto-rows:auto;align-content:start;min-height:112px;padding-bottom:6px;box-shadow:inset 0 1px 0 var(--sep)}
.cal-week>.d{grid-row:1;padding:8px 6px 4px;min-width:0}
.cal .num{display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 7px;border-radius:99px;font-size:13px;line-height:16px;font-weight:500;font-variant-numeric:tabular-nums}
.cal .out .num{color:var(--muted)}
.cal .num[aria-current=date]{background:var(--accent);color:#fff}
.band{min-width:0;margin:0 2px 4px;padding:6px 8px;border-radius:10px;display:flex;flex-direction:column;gap:4px;background:var(--default);color:var(--text);text-decoration:none;font-size:12px;line-height:16px}
.band:hover{color:var(--text);box-shadow:inset 0 0 0 1.5px currentColor}
.cal-legend i.you,.band.you{background:var(--accent-soft);color:var(--accent-soft-fg)}
.cal-legend i.need,.band.need{background:var(--warning-soft);color:var(--warning-soft-fg)}
.band .who{display:flex;align-items:center;gap:6px;min-width:0;font-weight:500}
.band .names,.band .when{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:640px){.cal-week{min-height:76px;grid-template-rows:32px}.cal-week>.d{padding:4px 2px}.cal .num{min-width:22px;height:22px;padding:0 4px;font-size:12px}
  .band{margin:0 0 4px;padding:4px 5px;font-size:11px}.band .avatars,.band .when{display:none}}
.wk-list{margin:0 -12px}
.wk-item{padding:14px 12px;border-radius:16px;scroll-margin-top:16px}.wk-item+.wk-item{border-top:1px solid var(--sep)}
.wk-item:target{background:color-mix(in srgb,var(--accent-soft) 45%,transparent);border-color:transparent}.wk-item:target+.wk-item{border-color:transparent}
.wk-item .top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.wk-item .top>div{display:flex;flex-direction:column;min-width:0}
.wk-item .people{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.wk-item .p{display:flex;align-items:center;gap:10px;min-width:0}.wk-item .p .cell-text{flex:1}
.wk-item .open-spot{color:var(--warning-soft-fg);font-weight:500}
.wk-item .act{margin-top:12px}

/* team */
table.team{min-width:720px}table.team.wide{min-width:980px}
table.team td.num{color:var(--muted);width:40px}
.sec-head .tabs{margin:0}
summary.btn{list-style:none}summary.btn::-webkit-details-marker{display:none}
.qr-box{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-top:12px;padding:16px;border-radius:16px;background:var(--surface-2)}
.qr-box .qr{width:160px;max-width:100%;flex:none;border-radius:12px;overflow:hidden}.qr-box svg{display:block;width:100%;height:auto}
.qr-box ol{flex:1 1 180px;min-width:0;margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px}
.items{display:flex;flex-direction:column;gap:14px}
.item{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.item>.cell-text{flex:1 1 160px}
.tile{width:40px;height:40px;flex:none;border-radius:12px;display:grid;place-items:center;background:var(--surface-2);color:var(--text)}
.tile .ic{width:20px;height:20px}.item>.tile{width:36px;height:36px}.item>.tile .ic{width:18px;height:18px}
.note{display:flex;gap:10px;align-items:flex-start}.note>.ic{width:16px;height:16px;margin-top:2px;color:var(--muted)}

/* settings */
.int{display:flex;flex-direction:column;gap:16px}.int p{margin:0}
.int-head{display:flex;align-items:center;gap:12px}.int-head .cell-text{flex:1}
.kv{display:flex;align-items:center;justify-content:space-between;gap:4px 12px;flex-wrap:wrap}
.kv-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.kv-block>code{display:block;padding:8px 12px;border-radius:12px;font-size:12px;line-height:18px}
pre.code{margin:0;padding:12px 14px;border-radius:12px;background:var(--surface-2);overflow-x:auto;font:12px/20px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}
.check-row{display:flex;gap:10px;align-items:flex-start}.check-row>.ic{width:16px;height:16px;margin-top:2px;color:var(--success-soft-fg)}.check-row.off>.ic{color:var(--warning-soft-fg)}
.check-row .codes{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
fieldset{border:0;margin:0;padding:0;min-width:0}legend{padding:0;margin:0 0 12px;font-weight:500}

/* audit log */
.log{max-width:928px;padding:4px 20px 12px}
.log-group+.log-group{border-top:1px solid var(--sep)}
.log-day{font-size:14px;line-height:20px;font-weight:500;color:var(--muted);margin:0;padding:16px 0 4px}
.log-items{list-style:none;margin:0;padding:0}
.log-items li{display:flex;align-items:center;gap:12px;padding:10px 0}
.log-items .what{flex:1 1 0;min-width:0;overflow-wrap:anywhere}
.log-items .when{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.log-items .when .ic{width:16px;height:16px}
`;

// Icons: 24px stroke paths in the style the design system uses (Lucide geometry).
const icon = (paths) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const I = {
  bell: icon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  calendar: icon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  alert: icon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>'),
  users: icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  userPlus: icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  list: icon('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  gear: icon('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
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
  up: icon('<path d="m18 15-6-6-6 6"/>'),
  down: icon('<path d="m6 9 6 6 6-6"/>'),
  smartphone: icon('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'),
  phone: icon('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  megaphone: icon('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
  shield: icon('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  repeat: icon('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  plus: icon('<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>'),
  minus: icon('<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>'),
  swap: icon('<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>'),
  external: icon('<path d="M7 7h10v10M7 17 17 7"/>'),
  send: icon('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  chat: icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  user: icon('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  tick: icon('<path d="M20 6 9 17l-5-5"/>'),
  qr: icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
};

// The bell-ring mark (docs/images/logo.svg): a white Lucide bell-ring on a #1E1B4B → #09090B rounded square.
const LOGO_ART = '<defs><linearGradient id="pd-logo-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E1B4B"/><stop offset="1" stop-color="#09090B"/></linearGradient></defs>'
  + '<rect width="64" height="64" rx="15" fill="url(#pd-logo-bg)"/>'
  + '<g transform="translate(13.25 13.25) scale(1.5625)" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>'
  + '<path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>'
  + '<path d="M4 2C2.8 3.7 2 5.7 2 8"/></g>';
const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">${LOGO_ART}</svg>`;
const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${LOGO_ART}</svg>`)}`;
const brand = (tag = 'a') => `<${tag} class="brand"${tag === 'a' ? ' href="/"' : ''}>${LOGO}<span>${esc(config.appName)}</span></${tag}>`;

export const THEMES = ['system', 'light', 'dark'];

const initials = (name) => esc(String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase());
const firstName = (p) => String(p.name || '').split(' ')[0];
/** "Ana", "Ana and Ben", "Ana, Ben and Cal". */
const andList = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const channel = () => `#${config.slack.channelName}`;
const shortWhen = (d) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
const shortDate = (d) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, month: 'short', day: 'numeric' }).format(new Date(d));
const avatarGroup = (people, user, size = 'md') => `<span class="avatars">${people.map((p) =>
  `<span class="avatar ${size}${Number(p.id) === Number(user.id) ? ' accent' : ''}" title="${esc(p.name)}">${initials(p.name)}</span>`).join('')}</span>`;
const progress = (pct, tone, label, size = '') => `<div class="progress ${size} ${tone}" role="progressbar" aria-label="${esc(label)}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
const statTile = (ic, label, value, sub) => `<div class="stat"><div class="stat-label">${ic}${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
const elapsed = (shift, now) => Math.min(100, Math.max(0, Math.round(((now - shift.start) / (shift.end - shift.start)) * 100)));

/** The sidebar's panel: who is on call now and until when, or the next weekend, or nobody. */
function onCallPanel(user) {
  const e = user.onCall;
  if (!e) return '';
  const missing = Math.max(0, e.shift.count - e.people.length);
  const label = e.running ? 'On call now' : 'Next weekend';
  const title = e.people.length ? `${andList(e.people.map(firstName))}${missing ? ` · needs ${missing}` : ''}`
    : e.running ? 'Nobody' : 'Nobody yet';
  const sub = !e.running ? `From ${shortWhen(e.shift.start)}` : e.people.length ? `Until ${shortWhen(e.shift.end)}` : `Pages start in ${channel()}`;
  const tone = !e.people.length ? (e.running ? 'danger' : 'warning') : missing ? 'warning' : e.running ? 'success' : '';
  return `<section class="side-oncall" aria-label="${label}">
    <div class="so-head"><span class="small strong muted">${label}</span><span class="dot ${tone}" aria-hidden="true"></span></div>
    <div class="so-body">${e.people.length ? avatarGroup(e.people, user) : ''}<div class="so-text"><span class="so-title">${esc(title)}</span><span class="small muted">${esc(sub)}</span></div></div>
    ${e.running ? progress(elapsed(e.shift, new Date()), tone === 'success' ? '' : tone, "How much of this weekend's shift has passed") : ''}
  </section>`;
}

export function layout({ title, user, body, flash, active }) {
  const theme = THEMES.includes(user?.theme) ? user.theme : 'system';
  const head = `<!doctype html><html lang="en"${theme === 'system' ? '' : ` data-theme="${theme}"`}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(config.appName)}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>${CSS}</style></head><body>`;
  const foot = `${flash?.undo ? '<script src="/undo.js"></script>' : ''}</body></html>`;
  if (!user) return `${head}<div class="auth-wrap"><div class="auth-page">${flash ? flashBox(flash) : ''}${body}</div></div>${foot}`;

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
    responder && link('/settings', 'Settings', 'settings', I.gear),
  ].filter(Boolean).join('');
  return `${head}<div class="shell">
<aside class="side">${brand()}
  ${onCallPanel(user)}
  <nav class="nav" aria-label="Main">${links}</nav>
  <div class="side-foot">
  <form method="post" action="/theme" class="theme" aria-label="Theme"><input type="hidden" name="back" value="${esc(user.path || '/')}">
    ${[['system', 'System', I.monitor], ['light', 'Light', I.sun], ['dark', 'Dark', I.moon]].map(([value, label, ic]) =>
      `<button name="theme" value="${value}" aria-pressed="${theme === value}" title="${label} theme">${ic}<span class="label">${label}</span></button>`).join('')}</form>
  <div class="me"><span class="avatar accent">${initials(user.name)}</span>
    <div class="who"><span class="strong">${esc(user.name)}</span><span class="small muted">${esc(ROLE_LABELS[user.role] || '')}</span></div>
    <form method="post" action="/logout" class="inline"><button class="ghost icon" aria-label="Sign out" title="Sign out">${I.logout}</button></form></div></div>
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
const alertBox = (tone, title, desc = '') => `<div class="alert ${tone}" role="alert">${tone === 'danger' ? I.info : I.alert}<div class="body"><div class="title">${title}</div>${desc ? `<p class="desc">${desc}</p>` : ''}</div></div>`;
const topError = (message) => (message ? alertBox('danger', esc(message)) : '');

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const contactFields = (values, on) =>
  field({ id: 'slack', label: 'Slack account', value: values.slack, attrs: 'placeholder="Slack email or member ID (U0123ABCD)"', error: on('slack'),
    hint: 'Leave blank to use your work email.' })
  + field({ id: 'whatsapp', label: 'Phone number', type: 'tel', value: values.whatsapp, error: on('whatsapp'),
    attrs: 'required placeholder="+1 415 555 0123" autocomplete="tel"', hint: 'With country code. The team sees it on the Team page.' });

const cardTitle = (tag, title, sub) => `<div class="card-title"><${tag}>${title}</${tag}><p class="muted">${sub}</p></div>`;

export function authPage({ mode, values = {}, error, domains, google, notConfigured }) {
  const signup = mode === 'signup';
  const only = domains.length ? `@${domains.map(esc).join(' / @')}` : '';
  const { top, on } = splitError(error, signup ? ['name', 'email', 'password', 'slack', 'whatsapp'] : []);
  const { repageEveryMinutes: repage } = config;
  const points = [
    [I.users, 'A fair rotation', 'Everyone gets a fair share of weekends, and swaps take one tap.'],
    [I.smartphone, 'Rings like a phone call', `Pages ring the ${esc(config.appName)} app on your phone. The second call gets through Do Not Disturb.`],
    [I.bell, 'Pages that escalate', `Again every ${repage} minutes, then the backup, then ${esc(channel())}.`],
    [I.calendar, 'In your calendar', 'Every on-call weekend shows up in Google Calendar.'],
  ].map(([ic, t, text]) => `<li><span>${ic}</span><span><span class="strong">${t}</span><span>${text}</span></span></li>`).join('');
  const intro = `<div class="auth-intro">${brand('div')}
    <div><h1>Weekend on-call for ${esc(config.teamName)}</h1>
      <p class="lede">The team takes turns covering weekends. When something breaks, ${esc(config.appName)} messages whoever is on call on Slack and rings their phones until someone acknowledges.</p></div>
    <ul class="points">${points}</ul></div>`;
  const card = notConfigured
    ? `${cardTitle('h2', 'Sign in', 'Use your work Google account.')}
  ${alertBox('warning', 'Sign-in isn’t set up yet.', 'An admin needs to add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> so only your team’s Google accounts can get in.')}`
    : google
    ? `${cardTitle('h2', 'Sign in', 'Use your work Google account.')}
  ${topError(top)}
  <div class="row" style="flex-direction:column;align-items:stretch;gap:8px">
    <a class="btn primary lg block" href="/auth/google">${GOOGLE_ICON}<span>Sign in with Google</span></a>
    ${only ? `<p class="hint" style="margin:0">Only ${only} Google Workspace accounts.</p>` : ''}</div>
  <hr class="sep">
  <p class="muted" style="margin:0">First time here? Sign in, then add your Slack account and phone number.</p>`
    : `${cardTitle('h2', signup ? 'Join the on-call rotation' : 'Log in', signup ? 'The team takes turns covering weekends.' : `Weekend on-call for ${esc(config.teamName)}.`)}
  ${topError(top)}
  <form method="post" action="/${mode}" novalidate>
    ${signup ? field({ id: 'name', label: 'Full name', value: values.name, attrs: 'required autocomplete="name"', error: on('name') }) : ''}
    ${field({ id: 'email', label: 'Work email', type: 'email', value: values.email, attrs: 'required autocomplete="email"', error: on('email'),
      hint: signup && only ? `Must be an ${only} address.` : '' })}
    ${field({ id: 'password', label: 'Password', type: 'password', error: on('password'),
      attrs: `required minlength="${signup ? 10 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"`, hint: signup ? 'At least 10 characters.' : '' })}
    ${signup ? contactFields(values, on) : ''}
    <button class="primary lg block" type="submit">${signup ? 'Sign up' : 'Log in'}</button>
  </form>
  <p class="auth-switch">${signup ? 'Already signed up? <a class="link" href="/login">Log in</a>' : 'New to the team? <a class="link" href="/signup">Sign up</a>'}</p>`;
  const body = `<div class="auth-cols">${intro}<div class="auth-card"><div class="card">${card}</div></div></div>`;
  return layout({ title: signup ? 'Sign up' : 'Log in', body });
}

export function welcomePage({ identity, values = {}, error }) {
  const { top, on } = splitError(error, ['name', 'slack', 'whatsapp']);
  const app = esc(config.appName);
  const next = [
    [I.send, 'Check Slack', 'Use “Send me a test message” on the Team page.', false],
    [I.qr, 'Get the phone app', 'Pages ring your phone like a phone call. Scan the code on the Team page to sign in.', true],
  ].map(([ic, t, text, optional]) => `<li><span class="avatar md">${ic}</span><span>
      <span class="row" style="gap:8px"><span class="strong">${t}</span>${optional ? '<span class="pill sm">Optional</span>' : ''}</span>
      <span class="small muted">${text}</span></span></li>`).join('');
  const card = `<div class="welcome-card"><div class="card">
  <div style="display:flex;flex-direction:column;gap:12px">
    <div class="top">${brand('div')}<div class="row" style="gap:10px"><div class="step-bar" aria-hidden="true"><span></span><span></span></div><span class="small strong muted">Step 2 of 2</span></div></div>
    <h1>Welcome, ${esc(identity.name.split(' ')[0])}</h1>
    <p class="muted" style="margin:0">Signed in as ${esc(identity.email)}. Add how we reach you when you’re on call.</p>
  </div>
  ${topError(top)}
  <form method="post" action="/welcome" novalidate>
    ${field({ id: 'name', label: 'Full name', value: values.name, attrs: 'required autocomplete="name"', error: on('name') })}
    ${contactFields(values, on)}
    <button class="primary lg block" type="submit">Join the rotation</button>
  </form>
  <hr class="sep">
  <div style="display:flex;flex-direction:column;gap:14px"><span class="small strong muted">After you join</span><ul class="next-steps">${next}</ul></div>
</div></div>`;
  const preview = `<div class="preview" aria-label="What a page looks like">
    <div><h2 style="margin:0 0 4px">What a page looks like</h2>
      <p style="margin:0">A Slack DM and, with the phone app, a phone call. Acknowledge either one and the re-pages stop.</p>
      <p class="small muted" style="margin:0">Preview only. The buttons work in the real Slack message and call.</p></div>
    <div class="preview-msg" aria-hidden="true">
      <div class="from"><span class="avatar accent">${I.bell}</span><span><span class="strong">${app} in Slack</span><span class="small muted">Direct message</span></span></div>
      <div><div class="strong">Incident #14: Checkout failing for all stores</div><div>You are on call. Please acknowledge.</div></div>
      <div class="row"><span class="btn sm primary static">Acknowledge</span><span class="btn sm static">Resolve</span><span class="btn sm static">Open</span></div>
    </div>
    <div class="preview-msg" aria-hidden="true">
      <div class="from"><span class="avatar success">${I.phone}</span><span><span class="strong">${app} app</span><span class="small muted">Phone call to your phone</span></span></div>
      <div><div class="strong">Checkout failing for all stores</div><div>Incident #14 · Paged from Slack</div></div>
      <div class="row"><span class="btn sm primary static">${I.phone}Answer</span><span class="btn sm static">Decline</span></div>
      <span class="small muted">Answering acknowledges the page. No answer? It calls again at ${config.secondCallAfterMinutes} min, through Do Not Disturb.</span>
    </div></div>`;
  return layout({ title: 'Welcome', body: `<div class="welcome-cols">${card}${preview}</div>` });
}

/** "Add me" / "Remove me" for the signed-in user only. */
function selfButton(user, e, back = '', now = new Date(), block = false) {
  if (e.shift.end <= now || !isResponder(user)) return '';
  const on = e.people.some((p) => p.id === user.id);
  if (on && e.shift.start <= now) return ''; // can't leave a running weekend; someone takes the spot instead
  const hidden = back ? `<input type="hidden" name="back" value="${back}">` : '';
  const form = block ? 'block' : 'inline';
  return on
    ? `<form method="post" action="/weekends/${e.shift.key}/leave" class="${form}">${hidden}<button class="sm">Remove me</button></form>`
    : `<form method="post" action="/weekends/${e.shift.key}/join" class="${form}">${hidden}<button class="${e.needsCover ? 'sm primary' : 'sm'}">Add me</button></form>`;
}

/** Can a page ring this person? `ready`: a phone with a push token and push keys for its kind on this server. */
function phoneReach(devices = []) {
  const push = pushEnabled();
  const registered = devices.filter((d) => d.push_token);
  return { ready: registered.some((d) => push[d.platform]), registered: registered.length > 0 };
}

/** "Ana’s iPhone · calls work · not tested yet", or how to get a phone signed in. */
function phoneLine(devices = []) {
  if (!devices.length) return 'No phone signed in. <a class="link" href="/team">Scan the code on the Team page</a> to get calls.';
  const push = pushEnabled();
  return devices.map((d) => esc(`${d.name} · ${!d.push_token ? 'not registered for calls yet'
    : !push[d.platform] ? "calls aren't set up on this server"
      : `calls work · ${d.tested_at ? `last test call answered ${shortDate(d.tested_at)}` : 'not tested yet'}`}`)).join('; ');
}

/** A stored Slack email only becomes a member ID once Slack looks it up, so it can't be DMed yet. */
const slackLinked = (p) => Boolean(p.slack_user_id) && !String(p.slack_user_id).includes('@');

/** One person in "Can we reach them?": Slack linked, and a phone that can ring. */
function reachRow(p, role, user, phones) {
  const slack = slackLinked(p);
  const { ready } = phoneReach(phones.get(Number(p.id)));
  return `<div class="reach"><span class="avatar lg${Number(p.id) === Number(user.id) ? ' accent' : ''}">${initials(p.name)}</span>
    <div class="who"><span class="strong">${esc(p.name)}</span><span class="small muted">${esc(role)}</span></div>
    <div class="chips">${slack ? '<span class="pill sm success">Slack</span>' : '<span class="pill sm warning">No Slack</span>'}${
  ready ? '<span class="pill sm success">Phone</span>' : '<span class="pill sm warning">No phone</span>'}</div></div>`;
}

/** Who a page from this form reaches, step by step, from the escalation settings. */
function pagingPlan({ user, onCall, runningShift, backup, admins, phones }) {
  const { secondCallAfterMinutes: second, repageEveryMinutes: repage, escalateAfterMinutes: escalate } = config;
  const ch = channel();
  const ready = (p) => phoneReach(phones.get(Number(p.id))).ready;
  if (onCall) {
    // Whoever pages already knows: when someone else is on call too, only they are paged.
    const paged = onCall.people.length > 1 && onCall.people.some((p) => p.id === user.id) ? onCall.people.filter((p) => p.id !== user.id) : onCall.people;
    const who = andList(paged.map(firstName));
    const calls = paged.some(ready);
    return {
      label: 'If nobody acknowledges', button: `Page ${who}`, icon: I.bell,
      description: `Pages ${who} on Slack${calls ? ' and rings their phones' : ''} right away.`,
      steps: [
        ['Now', I.bell, `Slack DM${calls ? ' and a phone call' : ''} to ${who}, and a post in ${ch}`],
        calls && [`${second} min`, I.phone, 'Call again, rings through Do Not Disturb'],
        [`Every ${repage} min`, I.repeat, `Page ${who} again`],
        backup ? [`${escalate} min`, I.shield, `Also page ${backup.name}, the backup${ready(backup) ? '' : ' (Slack DM only: no phone in the app)'}`]
          : [`${escalate} min`, I.megaphone, `@channel in ${ch}, as there’s no backup`],
        backup && [`${2 * escalate} min`, I.megaphone, `@channel in ${ch}`],
        ['After that', I.repeat, `Keep paging ${backup ? 'everyone' : who} every ${repage} min until someone acknowledges`],
      ],
    };
  }
  if (runningShift) {
    const names = andList(admins.map((a) => a.name));
    const s = admins.length === 1 ? '' : 's';
    return {
      label: 'If nobody acknowledges', button: `Post to ${ch}`, icon: I.megaphone,
      description: `Nobody is on call this weekend, so this starts in ${ch}.`,
      steps: [
        ['Now', I.megaphone, `@here in ${ch}`],
        admins.some(ready) && [`${second} min`, I.phone, `Call ${names}, the admin${s}`],
        admins.length && [`Every ${repage} min`, I.shield, `Page ${names}, the admin${s}`],
        backup ? [`${escalate} min`, I.shield, `Also page ${backup.name}, the backup`] : [`${escalate} min`, I.megaphone, `@channel in ${ch}`],
        backup && [`${2 * escalate} min`, I.megaphone, `@channel in ${ch}`],
      ],
    };
  }
  return {
    label: 'Who hears about it', button: `Post to ${ch}`, icon: I.megaphone,
    description: `Nobody is on call right now, so this goes to ${ch}.`,
    steps: [['Now', I.megaphone, `@here in ${ch}`], [`Every ${2 * escalate} min`, I.repeat, `Remind ${ch} until someone takes it`]],
  };
}

/** An open incident on the home page: where its paging has got to, and what comes next. */
function incidentCard(user, inc, now) {
  const { repageEveryMinutes: repage, escalateAfterMinutes: escalate } = config;
  const ch = channel();
  const t0 = new Date(inc.created_at).getTime();
  const due = (min) => {
    const left = Math.ceil((t0 + min * MINUTE - now) / MINUTE);
    return left > 0 ? `in ${left} min` : 'any moment';
  };
  const level = Number(inc.escalation_level);
  let segs, done, stepNow, stepNext, who, faces;
  if (inc.status === 'acknowledged') {
    const took = inc.acked_at ? Math.max(1, Math.round((new Date(inc.acked_at) - t0) / MINUTE)) : null;
    [segs, done, faces] = [1, 1, inc.acked_by_name ? [inc.acked_by_name] : []];
    stepNow = took ? `Acknowledged in ${took} min` : 'Acknowledged';
    stepNext = 'Paging stopped';
    who = `${inc.acked_by_name || 'Someone'} is on it`;
  } else if (Number(inc.quiet)) {
    [segs, done, faces, stepNow, stepNext, who] = [1, 1, [], `Posted in ${ch}`, 'Nobody is called and it never escalates', 'Waiting for someone to take it'];
  } else if (Number(inc.test)) {
    [segs, done, faces, stepNow, stepNext, who] = [1, 1, [], 'Test page · called once', `Never escalates and stays out of ${ch}`, 'Only the people tested were called'];
  } else if (!inc.assigned_name && !inc.backup_name && level >= 2) {
    // A weekday page goes straight to the channel and reminds it until someone takes it. Only weekend pages get a
    // backup, so an empty weekend that reached @channel lands below.
    [segs, done, faces, stepNow, stepNext, who] = [1, 1, [], `Posted to ${ch} with @here`, `Reminds ${ch} every ${2 * escalate} min`, `Waiting for someone in ${ch} to take it`];
  } else {
    // A weekend page: the on-call (or the admins, on an empty weekend), then the backup, then @channel.
    segs = inc.backup_name ? 3 : 2;
    done = level === 0 ? 1 : level === 1 ? 2 : segs;
    faces = [inc.assigned_name, level >= 1 && inc.backup_name].filter(Boolean);
    stepNow = level === 0 ? `Re-paging every ${repage} min` : level === 1 ? `Paged ${inc.backup_name}, the backup` : `@channel in ${ch}`;
    stepNext = level === 0 ? (inc.backup_name ? `${inc.backup_name} is paged ${due(escalate)}` : `@channel ${due(escalate)}`)
      : level === 1 ? `@channel ${due(2 * escalate)}` : `Paging everyone every ${repage} min`;
    who = `${inc.assigned_name ? 'Paging the on-call' : 'Nobody is on call, so paging the admins'}${level >= 1 && inc.backup_name ? ` and ${inc.backup_name}, the backup` : ''}`;
  }
  const bars = Array.from({ length: segs }, (_, i) => `<span${i < done ? ' class="on"' : ''}></span>`).join('');
  return `<article class="inc">
    <div class="inc-top"><div>
      <div class="row"><span class="pill sm ${inc.status}">${statusLabel(inc.status)}</span><span class="small muted">#${inc.id} · via ${esc(inc.source)} · ${esc(ago(inc.created_at, now))}</span></div>
      <a class="inc-title" href="/incidents/${inc.id}">${esc(inc.title)}</a></div>
      ${incidentButtons(user, inc, 'home')}</div>
    <div class="track"><div class="segs" aria-hidden="true">${bars}</div>
      <div class="steps"><span class="small strong">${esc(stepNow)}</span><span class="small muted">${esc(stepNext)}</span></div></div>
    <div class="row" style="gap:10px">${faces.length ? avatarGroup(faces.map((name) => ({ name })), user, 'sm') : `<span class="avatar sm">${Number(inc.test) ? I.phone : I.megaphone}</span>`}<span>${esc(who)}</span></div>
  </article>`;
}

/** "Now · ends Mon 9:00 AM EST", "Tomorrow", "In 6 days", "In 3 weeks". */
function weekendWhen(shift, now) {
  if (shift.start <= now) return `Now · ends ${shortWhen(shift.end)}`;
  const days = Math.ceil((shift.start - now) / 86_400_000);
  return days <= 1 ? 'Tomorrow' : days < 14 ? `In ${days} days` : `In ${Math.round(days / 7)} weeks`;
}

function weekendCard(user, e, now) {
  const running = e.shift.start <= now;
  const mine = e.people.some((p) => p.id === user.id);
  const missing = Math.max(0, e.shift.count - e.people.length);
  const chip = missing ? `<span class="pill sm ${running ? 'danger' : 'warning'}">Needs ${missing}</span>`
    : `<span class="pill sm${mine ? ' accent' : ''}">${running ? 'Now' : `${e.people.length} of ${e.shift.count}`}</span>`;
  const people = e.people.map((p) => `<div class="p"><span class="avatar sm${p.id === user.id ? ' accent' : ''}">${initials(p.name)}</span>
      <span class="n">${esc(p.name)}${p.id === user.id ? ' (you)' : ''}</span>${e.joined.includes(p.id) ? '<span class="small muted">Joined</span>' : ''}</div>`).join('');
  const open = missing ? `<div class="p"><span class="avatar sm warning">${I.userPlus}</span><span class="n open-spot">${missing > 1 ? `${missing} open spots` : 'Open spot'}</span></div>` : '';
  const action = selfButton(user, e, '', now, true);
  return `<div class="wk-card${running ? ' now' : ''}">
    <div class="top"><div><h3>${esc(formatRange(e.shift, config.timezone))}</h3><span class="small muted">${esc(weekendWhen(e.shift, now))}</span></div>${chip}</div>
    <div class="people">${people}${open}</div>
    ${action ? `<div class="act">${action}</div>` : ''}
  </div>`;
}

export function dashboardPage({ user, now, onCall, runningShift, nextEntry, backup, schedule, coverage, balance, recentLog, openIncidents, phones = new Map(), flash }) {
  const tz = config.timezone;
  const ch = channel();
  const admins = balance.map((b) => b.user).filter(isAdmin);
  const plan = pagingPlan({ user, onCall, runningShift, backup, admins, phones });
  const isMe = (p) => Number(p.id) === Number(user.id);

  // Hero: who is on call now (or that nobody is), and whether pages can reach them.
  const shift = onCall?.shift ?? runningShift;
  let chip, kicker, headline, lede, reachTitle, reachNote, reachPeople, actions;
  if (onCall) {
    chip = '<span class="pill accent">On call now</span>';
    kicker = `Weekend of ${formatRange(shift, tz)}`;
    headline = esc(andList(onCall.people.map((p) => p.name)));
    lede = `On call until ${esc(fmt(shift.end))}.${backup ? ` ${esc(backup.name)} is the backup if nobody acknowledges in ${config.escalateAfterMinutes} minutes.` : ''}`;
    [reachTitle, reachNote] = ['Can we reach them?', 'From their Slack link and signed-in phones'];
    reachPeople = [...onCall.people.map((p) => [p, isMe(p) ? 'On call · you' : 'On call']),
      ...(backup ? [[backup, `Backup · paged at ${config.escalateAfterMinutes} min`]] : [])];
    actions = `<a class="btn primary" href="#page">${I.bell}<span>${esc(plan.button)}</span></a><a class="btn" href="/calendar">${I.swap}<span>Swap a weekend</span></a>`;
  } else if (runningShift) {
    chip = '<span class="pill danger">Uncovered</span>';
    kicker = `Weekend of ${formatRange(shift, tz)}`;
    headline = 'Nobody is on call this weekend';
    lede = `Pages start in ${esc(ch)} until ${esc(fmt(shift.end))}. This weekend needs ${shift.count} ${shift.count === 1 ? 'person' : 'people'}.`;
    [reachTitle, reachNote] = ['Who gets the page', 'Nobody is on call, so the admins are paged'];
    reachPeople = [...admins.map((a) => [a, isMe(a) ? 'Admin · you' : 'Admin']), ...(backup ? [[backup, `Backup · paged at ${config.escalateAfterMinutes} min`]] : [])];
    actions = `<form method="post" action="/weekends/${shift.key}/join" class="inline"><button class="primary">${I.userPlus}<span>Cover this weekend</span></button></form>`;
  } else {
    const people = nextEntry?.people ?? [];
    const missing = nextEntry ? Math.max(0, nextEntry.shift.count - people.length) : 0;
    chip = '<span class="pill">Weekday</span>';
    kicker = nextEntry ? `Next weekend starts ${fmt(nextEntry.shift.start)}` : '';
    headline = 'Nobody is on call right now';
    const who = andList(people.map((p) => (isMe(p) ? 'you' : p.name)));
    lede = `Weekday pages go to ${esc(ch)}. ${people.length
      ? `${esc(who[0].toUpperCase() + who.slice(1))} take${people.length === 1 && !isMe(people[0]) ? 's' : ''} the next weekend${missing ? `, and it needs ${missing} more` : ''}.`
      : 'The next weekend needs cover.'}`;
    [reachTitle, reachNote] = ['Next up', nextEntry ? `${formatRange(nextEntry.shift, tz)} · ${shiftSpan(nextEntry.shift)}` : ''];
    reachPeople = people.map((p) => [p, isMe(p) ? 'On call · you' : 'On call']);
    actions = `<a class="btn primary" href="#page">${I.megaphone}<span>${esc(plan.button)}</span></a><a class="btn" href="/calendar">${I.swap}<span>Swap a weekend</span></a>`;
  }
  const unregistered = reachPeople.map(([p]) => p).filter((p) => !phoneReach(phones.get(Number(p.id))).registered);
  const serverOff = reachPeople.map(([p]) => p).filter((p) => { const r = phoneReach(phones.get(Number(p.id))); return r.registered && !r.ready; });
  const hints = [
    unregistered.length && `${esc(andList(unregistered.map((p) => p.name)))} ${unregistered.length === 1 ? 'has' : 'have'} no phone signed in to the app, so pages reach them on Slack only. They can sign in by scanning the code on the Team page.`,
    serverOff.length && `Phone calls aren’t set up on this server, so pages reach ${esc(andList(serverOff.map((p) => p.name)))} on Slack only.`,
  ].filter(Boolean);
  const reachHtml = reachPeople.length ? reachPeople.map(([p, role]) => reachRow(p, role, user, phones)).join('')
    : '<p class="small muted" style="margin:0">Nobody yet. Add yourself below.</p>';
  const bar = shift && (onCall || runningShift) ? `<div class="shift-bar">${progress(elapsed(shift, now), onCall ? (onCall.needsCover ? 'warning' : '') : 'danger', "How much of this weekend's shift has passed", 'md')}
      <div class="ends"><span class="small muted">Started ${esc(shortWhen(shift.start))}</span><span class="small strong">${esc(timeLeft(shift.end, now))} left · ends ${esc(shortWhen(shift.end))}</span></div></div>` : '';
  const group = config.whatsappGroupUrl
    ? `<a class="link" href="${esc(config.whatsappGroupUrl)}" target="_blank" rel="noopener noreferrer" style="padding:0 8px;display:inline-flex;gap:4px;align-items:center">Join the team chat ${I.external}</a>` : '';
  const hero = `<section class="card hero" aria-label="On call">
    <div class="hero-main">
      <div class="row">${chip}<span class="muted">${esc(kicker)}</span></div>
      <div><h2 class="display">${headline}</h2><p class="lede">${lede}</p></div>
      ${bar}
      ${reachPeople.some(([p]) => isMe(p)) ? `<div class="your-phone">${I.smartphone}<span class="small strong">Your phone</span>
        <span class="small muted">${phoneLine(phones.get(Number(user.id)))}</span></div>` : ''}
      <div class="row hero-actions">${actions}${group}</div>
    </div>
    <div class="hero-side">
      <div><div class="strong">${reachTitle}</div>${reachNote ? `<div class="small muted">${esc(reachNote)}</div>` : ''}</div>
      ${reachHtml}
      ${hints.length ? `<div><p class="small muted" style="margin:0 0 4px">${hints.join(' ')}</p><a class="link small" href="/team">Phone app on the Team page</a></div>` : ''}
    </div></section>`;

  const incidents = openIncidents.length
    ? openIncidents.map((inc) => incidentCard(user, inc, now)).join('')
    : `<div class="quiet"><span class="avatar success">${I.check}</span><span class="title">All quiet</span>
        <span class="muted">No active incidents right now.</span><a class="btn ghost sm" href="/incidents">View history</a></div>`;
  const steps = plan.steps.filter(Boolean).map(([when, ic, text]) => `<li><span class="when">${esc(when)}</span>${ic}<span>${esc(text)}</span></li>`).join('');
  const composer = `<div class="card" id="page"><h2>Page on-call</h2><p class="card-desc">${esc(plan.description)}</p>${pageForm({ plan: { ...plan, steps } })}</div>`;

  const gap = schedule.find((e) => e.shift.start > now && e.needsCover);
  const gapMissing = gap ? Math.max(0, gap.shift.count - gap.people.length) : 0;
  const coverAlert = gap && gapMissing ? `<div class="alert warning">${I.alert}<div class="body">
      <div class="title">${esc(formatRange(gap.shift, tz))} needs ${gapMissing} more ${gapMissing === 1 ? 'person' : 'people'}</div>
      <p class="desc">${gap.people.length ? `Only ${esc(andList(gap.people.map((p) => p.name)))} so far.` : 'Nobody is on it yet.'}</p></div>
      ${gap.people.some(isMe) ? '' : `<div class="act"><form method="post" action="/weekends/${gap.shift.key}/join" class="inline"><button class="sm">Add me to ${esc(formatRange(gap.shift, tz))}</button></form></div>`}</div>` : '';
  const count = coverage.weekendCount === coverage.weekdayCount ? `${coverage.weekendCount}` : `${coverage.weekendCount} on weekend days and ${coverage.weekdayCount} on weekdays`;
  const rotation = `<section class="sec" aria-label="Weekend rotation">
    <div class="sec-head"><div><h2>Weekend rotation</h2>
      <p class="muted">Each shift (${esc(describeDays(coverage.days))}, ${esc(coverage.start)} → ${esc(coverage.end)}, ${esc(tz)}) gets ${count} people from the rotation, in turn. Add yourself to any weekend, and remove yourself from one of yours before it starts. Admins are optional.</p></div>
      <a class="link small" href="/calendar">Open calendar</a></div>
    ${coverAlert}
    <div class="wk-grid">${schedule.map((e) => weekendCard(user, e, now)).join('')}</div></section>`;

  const most = Math.max(1, ...balance.map((b) => b.weekends));
  const meters = balance.map((b) => `<div class="meter"><div class="top"><span>${esc(b.user.name)}${isMe(b.user) ? ' (you)' : ''}${isAdmin(b.user) ? ' <span class="muted">· Admin, optional</span>' : ''}</span>
      <span class="strong">${b.weekends}</span></div><div class="progress md" aria-hidden="true"><span style="width:${Math.round((b.weekends / most) * 100)}%"></span></div></div>`).join('');
  const changeIcon = { join: I.plus, leave: I.minus, swap: I.swap };
  const changes = recentLog.length
    ? `<ul class="changes">${recentLog.slice(0, 4).map((l) => `<li><span class="avatar md">${initials(l.user_name)}</span>
        <div class="body"><div>${logLine(l)}</div><div class="small muted">${esc(fmt(l.at))}</div></div>${changeIcon[l.action] || ''}</li>`).join('')}</ul>`
    : '<p class="muted" style="margin:0">No changes yet.</p>';

  const body = `<div class="head"><div><h1>On call</h1><p class="sub">${esc(fmt(now))}</p></div>
    <a class="btn primary" href="#page">${I.bell}<span>Page on-call</span></a></div>
  ${hero}
  <div class="duo">
    <section class="wide" aria-label="Active incidents"><div class="sec-head"><div class="row"><h2>Active incidents</h2>${openIncidents.length ? `<span class="badge">${openIncidents.length}</span>` : ''}</div>
      <a class="link small" href="/incidents">All incidents</a></div>${incidents}</section>
    ${composer}
  </div>
  ${rotation}
  <div class="duo">
    <div class="card"><h2>Fair share</h2><p class="card-desc">Weekends per person over the next ${schedule.length} weekends.</p>${meters || '<p class="muted" style="margin:0">Nobody in the rotation yet.</p>'}</div>
    <div class="card"><h2>Recent changes</h2><p class="card-desc">Every add, remove and swap is in the audit log.</p>${changes}
      <p style="margin:8px 0 0"><a class="link small" href="/log">Full audit log</a></p></div>
  </div>`;
  return layout({ title: 'On call', user, body, flash, active: 'home' });
}

/** "46 h", "35 min". */
function timeLeft(end, now) {
  const min = Math.max(0, Math.round((end - now) / MINUTE));
  return min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`;
}

/** The home page names the weekend in the sentence; the audit log shows it as a chip. */
const weekendOf = (key) => `the weekend of ${esc(weekendLabel(key))}`;

function logLine(l, weekend = weekendOf) {
  const wk = weekend(l.weekend_key);
  if (l.action === 'swap') {
    return `<strong>${esc(l.user_name)}</strong> took <strong>${esc(l.other_name)}</strong>'s spot on ${wk}${
      l.undone_at ? ' <span class="pill">Undone within 10 s</span>' : ''}`;
  }
  return `<strong>${esc(l.user_name)}</strong>
    ${l.action === 'join' ? 'added themselves to' : 'removed themselves from'} ${wk}`;
}

const timeOnly = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** "Today", "Yesterday", "Saturday, December 12", with the year when it isn't this year. */
function logDay(iso, now) {
  const day = dayLabel(iso, now);
  if (day === 'Today' || day === 'Yesterday') return day;
  const sameYear = dayKey(iso).slice(0, 4) === dayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
    .format(new Date(iso));
}

function weekendLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function logPage({ user, log, now = new Date(), flash }) {
  const days = [];
  for (const l of log) {
    const day = logDay(l.at, now);
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(l);
  }
  const icons = { join: I.plus, leave: I.minus, swap: I.swap };
  const chip = (key) => `<span class="pill sm">Weekend of ${esc(weekendLabel(key))}</span>`;
  const groups = days.map((d) => `<section class="log-group" aria-label="${esc(d.day)}"><h2 class="log-day">${esc(d.day)}</h2><ul class="log-items">${d.items.map((l) => `<li>
      <span class="avatar">${initials(l.user_name)}</span><span class="what">${logLine(l, chip)}</span>
      <span class="when">${icons[l.action] ?? ''}<span>${esc(timeOnly(l.at))}</span></span></li>`).join('')}</ul></section>`).join('');
  const body = `<div class="head"><div><h1>Audit log</h1>
    <p class="sub">Visible to everyone on the team: every time someone added themselves to a weekend, removed themselves, or swapped in for someone, newest first.</p></div></div>
  ${groups ? `<div class="card log">${groups}</div>`
    : `<div class="quiet" style="max-width:928px"><span class="avatar">${I.list}</span><span class="title">Nothing here yet</span><span class="muted">No changes yet.</span></div>`}`;
  return layout({ title: 'Audit log', user, body, flash, active: 'log' });
}

/** The page form: one line on the Incidents page; on the home page with who it reaches (`plan`). */
function pageForm({ compact = false, plan } = {}) {
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
          <textarea id="page-details" name="details" maxlength="4000" rows="3" placeholder="Links, dashboards, what you've tried (optional)"></textarea></div>
        <div class="plan"><span class="small strong muted">${esc(plan.label)}</span><ol>${plan.steps}</ol></div>
        <button class="primary lg block">${plan.icon}<span>${esc(plan.button)}</span></button>
      </form>`;
}

const statusLabel = (s) => ({ open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' })[s] || esc(s);

function incidentButtons(user, inc, back = '', size = 'sm') {
  if (inc.status === 'resolved' || !isResponder(user)) return '';
  return `<div class="row" style="justify-content:flex-end">
    ${inc.status === 'open' ? `<form method="post" action="/incidents/${inc.id}/ack" class="inline"><input type="hidden" name="back" value="${back}"><button class="${size ? `${size} ` : ''}primary">Acknowledge</button></form>` : ''}
    <form method="post" action="/incidents/${inc.id}/resolve" class="inline"><button${size ? ` class="${size}"` : ''}>Resolve</button></form></div>`;
}

const SOURCES = { web: ['Web', I.monitor], slack: ['Slack /page', I.chat], app: ['Phone app', I.smartphone], api: ['Alerts API', I.send] };
const sourceOf = (source) => SOURCES[source] ?? [`${String(source).charAt(0).toUpperCase()}${String(source).slice(1)}`, I.send];
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, dateStyle: 'short' }).format(new Date(d));

/** "Today", "Yesterday", "Thu, Nov 19", with the year when it isn't this year. */
function dayLabel(iso, now) {
  if (dayKey(iso) === dayKey(now)) return 'Today';
  if (dayKey(iso) === dayKey(now - 86_400_000)) return 'Yesterday';
  const sameYear = dayKey(iso).slice(0, 4) === dayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
    .format(new Date(iso));
}

/** "at 10:41 AM" today, "yesterday at 10:41 AM", or "on Thu, Nov 19 at 10:41 AM". */
function onAt(iso, now) {
  const day = dayLabel(iso, now);
  return `${day === 'Today' ? '' : day === 'Yesterday' ? 'yesterday ' : `on ${day} `}at ${timeOnly(iso)}`;
}

/** "8 sec", "6 min", "2 h 5 min", "3 d". */
function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sec`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `${Math.round(min / 1440)} d`;
}

/**
 * Who a page went to, for the incidents table: the on-call (`onCall`: everyone the first page went to) and the
 * backup once it escalated, the admins, or the channel.
 */
function pagedCell(inc, user, onCall) {
  const ch = channel();
  const level = Number(inc.escalation_level);
  const line = (lead, main, sub = '') => `<div class="cell">${lead}<div class="cell-text"><span>${esc(main)}</span>${sub ? `<span class="t-meta">${esc(sub)}</span>` : ''}</div></div>`;
  const icon = (ic) => `<span class="avatar sm">${ic}</span>`;
  if (Number(inc.test)) return line(icon(I.phone), 'Test page: called once');
  if (Number(inc.quiet)) return line(icon(I.megaphone), `Posted in ${ch}, nobody called`);
  const backup = level >= 1 ? inc.backup_name : null;
  const then = level >= 2 ? (backup ? ', the backup, then @channel' : ', then @channel') : backup ? ', then the backup' : '';
  if (onCall?.length || inc.assigned_name) {
    const faces = [...(onCall?.length ? onCall : [inc.assigned_name]), backup].filter(Boolean);
    return line(avatarGroup(faces.map((name) => ({ name })), user, 'sm'), andList(faces), `On call${then}`);
  }
  // A weekday page starts in the channel; an empty weekend pages the admins first.
  if (level >= 2 && !inc.backup_name) return line(icon(I.megaphone), ch, 'Nobody on call');
  return line(icon(I.shield), backup ? `The admins and ${backup}` : 'The admins', `Nobody on call${then}`);
}

export function incidentsPage({ user, incidents, status, stats, now, paged = new Map(), flash }) {
  const tiles = `<div class="stats">
    ${statTile(I.alert, 'Open now', stats.open, stats.open ? 'Waiting for someone to acknowledge' : 'Nobody is being paged')}
    ${statTile(I.eye, 'Acknowledged', stats.acknowledged, stats.acknowledged ? 'Someone is on it' : 'Nothing waiting on a fix')}
    ${statTile(I.clock, 'Median time to acknowledge', stats.medianAckMinutes === null ? '—' : `${stats.medianAckMinutes} min`, 'Last 30 days')}
    ${statTile(I.chart, 'Last 30 days', stats.last30Days, stats.last30Days === 1 ? 'incident' : 'incidents')}
  </div>`;
  const tab = (key, label, count) => `<a href="/incidents${key ? `?status=${key}` : ''}" class="tab"${status === key ? ' aria-current="page"' : ''}>${label} <span class="count">${count}</span></a>`;
  const tabs = `<nav class="tabs" aria-label="Filter by status">${tab(null, 'All', stats.open + stats.acknowledged + stats.resolved)}${
    tab('open', 'Open', stats.open)}${tab('acknowledged', 'Acknowledged', stats.acknowledged)}${tab('resolved', 'Resolved', stats.resolved)}</nav>`;
  const rows = incidents.map((inc) => {
    const t0 = new Date(inc.created_at);
    const acked = inc.acked_at
      ? `${esc(duration(new Date(inc.acked_at) - t0))}<div class="t-meta">${esc(inc.acked_by_name || 'Someone')}</div>`
      : `<span class="muted">Not yet</span><div class="t-meta">Waiting ${esc(duration(now - t0))}</div>`;
    return `<tr>
    <td><a class="t-title" href="/incidents/${inc.id}">${esc(inc.title)}</a><div class="t-meta">#${inc.id} · ${esc(sourceOf(inc.source)[0])}</div></td>
    <td><span class="pill sm ${inc.status}">${statusLabel(inc.status)}</span></td>
    <td>${pagedCell(inc, user, paged.get(Number(inc.id)))}</td>
    <td class="nowrap">${esc(timeOnly(inc.created_at))}<div class="t-meta">${esc(dayLabel(inc.created_at, now))}</div></td>
    <td class="nowrap">${acked}</td>
    <td class="actions">${incidentButtons(user, inc)}</td></tr>`;
  }).join('');
  const empty = status
    ? `<p class="empty">${{ open: 'No open incidents. All quiet.', acknowledged: 'Nothing acknowledged and waiting.', resolved: 'No resolved incidents yet.' }[status]}</p>`
    : `<div class="quiet"><span class="avatar">${I.bell}</span><span class="title">No incidents yet</span>
        <span class="muted" style="max-width:440px">When someone pages on-call from here, Slack, the phone app or an alert, it shows up here with who it reached and how fast they picked it up.</span></div>`;
  const body = `<div class="head"><div><h1>Incidents</h1><p class="sub">Every page, who it reached and how fast someone picked it up.</p></div>
    <a class="btn primary" href="#page">${I.bell}<span>Page on-call</span></a></div>
  ${tiles}
  ${tabs}
  <div class="card flush">${incidents.length
    ? `<div class="scroll"><table class="wide"><thead><tr><th>Incident</th><th>Status</th><th>Paged</th><th>Started</th><th>Time to acknowledge</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : empty}</div>
  <div class="card" id="page"><h2>Page on-call</h2><p class="card-desc">Pages whoever is on call, or posts in ${esc(channel())} when nobody is.</p>${pageForm({ compact: true })}</div>`;
  return layout({ title: 'Incidents', user, body, flash, active: 'incidents' });
}

// How a timeline event looks, by what it says (incidents.js writes these messages).
const EVENT_LOOK = [
  [/^(Acknowledged|Resolved) by /, I.check, 'success'],
  [/^(Triggered|Test page) via /, I.bell, ''],
  [/escalated to|\(backup\) now$/, I.shield, 'warning'],
  [/team channel/, I.megaphone, ''],
  [/^Re-paged /, I.repeat, ''],
  [/^Paged |^Called again|asked to call/, I.phone, ''],
];
const VIA = { web: 'on the web', slack: 'in Slack', app: 'in the app' };

/** The escalation track from escalationPlan(), or one line for incidents that never escalate. */
function escalationCard(inc, steps, now) {
  if (Number(inc.quiet) || Number(inc.test)) {
    const note = Number(inc.test) ? `Only the people tested were called, and ${channel()} isn’t told.` : 'Nobody’s phone rings and it never escalates. Anyone can pick it up.';
    return `<section class="card" aria-label="Escalation"><div class="cell"><span class="avatar lg">${Number(inc.test) ? I.phone : I.megaphone}</span>
      <div class="cell-text"><span class="strong">${esc(steps[0]?.label ?? '')}</span><span class="small muted">${esc(note)}</span></div></div></section>`;
  }
  const stopped = inc.status !== 'open';
  const t0 = new Date(inc.created_at).getTime();
  // A step that hadn't happened when someone acknowledged never will (the plan marks the second call done by age alone).
  const shown = steps.map((s) => (stopped && s.state === 'done' && inc.acked_at && new Date(s.at) > new Date(inc.acked_at) ? { ...s, state: 'skipped' } : s));
  const reached = (i) => i > 0 && i < shown.length && shown[i - 1].state === 'done' && ['done', 'next'].includes(shown[i].state);
  const items = shown.map((s, i) => {
    const min = Math.round((new Date(s.at) - t0) / MINUTE);
    const time = s.state === 'done' ? timeOnly(s.at) : s.state === 'skipped' ? (stopped ? 'Not needed' : 'Skipped')
      : new Date(s.at) > now ? `${s.state === 'next' ? 'Next at ' : ''}${timeOnly(s.at)}` : 'Now';
    return `<li class="${[s.state, reached(i) && 'l-on', reached(i + 1) && 'r-on'].filter(Boolean).join(' ')}">
      <span class="when">${min ? `${min} min` : 'Right away'}</span><span class="node" aria-hidden="true">${s.state === 'done' ? I.tick : ''}</span>
      <span class="title">${esc(s.label)}</span><span class="time">${esc(time)}</span></li>`;
  }).join('');
  const upcoming = shown.find((s) => ['next', 'later'].includes(s.state) && new Date(s.at) > now);
  const status = stopped ? `<span class="esc-now stopped">${I.check}${esc(`Paging stopped${inc.acked_at ? ` ${onAt(inc.acked_at, now)}` : ''}`)}</span>`
    : upcoming ? `<span class="esc-now">${I.clock}${esc(`${upcoming.label} at ${timeOnly(upcoming.at)}, in ${Math.ceil((new Date(upcoming.at) - now) / MINUTE)} min`)}</span>`
      : `<span class="esc-now">${I.repeat}Paging until someone acknowledges</span>`;
  return `<section class="card" aria-labelledby="esc-title"><div class="card-head"><h2 id="esc-title">Escalation</h2>${status}</div><ol class="esc">${items}</ol></section>`;
}

/** A notifications row's person (or channel) and, for a call, the phone: "Ana Admin (iPhone: Ana’s iPhone)". */
function recipientOf(n) {
  const r = String(n.recipient);
  const call = n.channel === 'push' && /^(.*?) \((?:iPhone|Android): (.*)\)$/.exec(r);
  if (call) return { name: call[1], device: call[2] };
  return { name: r.replace(/ \([^()]*\)$/, ''), post: r.startsWith('#') };
}
const deliveryPill = (rows, sent) => {
  const status = rows.some((n) => n.status === 'sent') ? 'sent' : rows.some((n) => n.status === 'failed') ? 'failed' : 'dry-run';
  return `<span class="pill sm ${status}">${status === 'sent' ? sent : status === 'failed' ? 'Failed' : 'Dry run'}</span>`;
};

/** Who the pages reached, per person and channel, from the incident's notifications rows. */
function reachTable({ user, inc, notifications, who }) {
  const ch = channel();
  // When each went out, and how many of them failed when some got through.
  const times = (rows) => {
    const t = [...new Set(rows.map((n) => timeOnly(n.at)))];
    const failed = rows.filter((n) => n.status === 'failed').length;
    return esc(`${t.length > 3 ? `${t[0]} to ${t[t.length - 1]}` : t.join(' · ')}${failed && failed < rows.length ? ` · ${failed} failed` : ''}`);
  };
  const people = new Map();
  const add = (name) => people.get(name) ?? people.set(name, { dm: [], calls: [] }).get(name);
  const roles = new Map();
  const paging = !Number(inc.quiet) && !Number(inc.test) ? who : null;
  const expected = paging ? [...paging.responders, paging.backup].filter(Boolean) : [];
  if (paging) {
    for (const p of paging.onCallPeople) roles.set(p.name, 'On call');
    if (!paging.onCallPeople.length) for (const p of paging.responders) roles.set(p.name, 'Admin');
    if (paging.backup && !roles.has(paging.backup.name)) roles.set(paging.backup.name, 'Backup');
  }
  for (const p of expected) add(p.name); // listed even when nothing reached them
  const posts = [];
  for (const n of [...notifications].reverse()) { // oldest first
    const { name, post } = recipientOf(n);
    if (post) posts.push(n);
    else if (n.channel !== 'push') add(name).dm.push(n);
    else if (!String(n.body).startsWith('Stop ringing')) add(name).calls.push(n);
  }
  if (!people.size && !posts.length) return '<p class="muted" style="margin:0">No messages went out for this incident.</p>';

  const backupAt = new Date(new Date(inc.created_at).getTime() + config.escalateAfterMinutes * MINUTE).toISOString();
  const rows = [...people].map(([name, { dm, calls }]) => {
    const u = expected.find((p) => p.name === name);
    // The backup is paged at the escalation; until then (or once someone acknowledged) nothing went to them.
    const waiting = paging?.backup?.name === name && Number(inc.escalation_level) < 1;
    const later = inc.status === 'open' ? 'Not called yet' : 'Not needed';
    const slack = dm.length ? `${deliveryPill(dm, 'Sent')}<div class="t-meta">${times(dm)}</div>`
      : waiting ? (inc.status === 'open' ? `<span class="pill sm">Waiting</span><div class="t-meta">At ${esc(timeOnly(backupAt))}</div>` : '<span class="small muted">Not needed</span>')
        : u && !u.slack_user_id ? '<span class="pill sm warning">No Slack</span>' : '<span class="small muted">None</span>';
    const phones = new Set(calls.map((n) => n.device_id)).size;
    const rang = new Set(calls.filter((n) => n.status === 'sent').map((n) => timeOnly(n.at))).size;
    const phone = calls.length ? `${deliveryPill(calls, `Rang ${rang}×`)}<div class="t-meta">${times(calls)}${phones > 1 ? ` · ${phones} phones` : ''}</div>`
      : `<span class="small muted">${waiting ? later : 'No phone in the app'}</span>`;
    const me = name === user.name;
    const role = roles.get(name) ?? (Number(inc.test) ? 'Test call' : '');
    return `<tr><td><div class="cell"><span class="avatar md${me ? ' accent' : ''}">${initials(name)}</span><div class="cell-text"><span class="strong">${esc(name)}</span><span class="small muted">${
      esc(me ? (role ? `${role} · you` : 'You') : role)}</span></div></div></td><td>${slack}</td><td>${phone}</td></tr>`;
  });
  if (posts.length) {
    rows.push(`<tr class="sep-top"><td><div class="cell"><span class="avatar md">${I.megaphone}</span><div class="cell-text"><span class="strong">${esc(ch)}</span><span class="small muted">Team channel</span></div></div></td>
      <td>${deliveryPill(posts, 'Posted')}<div class="t-meta">${times(posts)}</div></td><td><span class="small muted">Not called</span></td></tr>`);
  }
  return `<div class="scroll"><table class="plain reached"><thead><tr><th><span class="sr">Who</span></th><th>${I.chat}Slack DM</th><th>${I.phone}Phone call</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

export function incidentPage({ user, inc, now = new Date(), events, notes = [], who = null, escalation = [], notifications, names = {}, flash }) {
  const ch = channel();
  const t0 = new Date(inc.created_at);
  const paging = !Number(inc.quiet) && !Number(inc.test);
  const handled = (verb) => {
    const m = events.map((e) => new RegExp(`^${verb} by (.+) via (.+)$`).exec(e.message)).find(Boolean);
    return m ? { name: m[1], via: m[2] } : null;
  };
  const ack = handled('Acknowledged');
  const actor = (id, ev) => (Number(id) === Number(user.id) ? 'you' : ev?.name ?? 'someone');
  let line;
  if (inc.status === 'open') line = `Open for ${duration(now - t0)} · nobody has acknowledged yet`;
  else if (inc.status === 'acknowledged') {
    const by = actor(inc.acked_by, ack);
    line = `${ack?.via === 'phone call' ? `${by[0].toUpperCase()}${by.slice(1)} answered the call`
      : `Acknowledged by ${by}${VIA[ack?.via] ? ` ${VIA[ack.via]}` : ''}`} ${onAt(inc.acked_at, now)}${paging ? ' · paging stopped' : ''}`;
  } else {
    line = `Resolved by ${actor(inc.resolved_by, handled('Resolved'))} ${onAt(inc.resolved_at, now)}${
      ack ? ` · acknowledged after ${duration(new Date(inc.acked_at) - t0)}` : ''}`;
  }

  const same = (e) => e.message.startsWith('Same alert again');
  const repeats = events.filter(same);
  const creator = events.map((e) => /^(?:Triggered|Test page) via .+? by (.+?)(?:: called .*)?$/.exec(e.message)?.[1]).find(Boolean);
  const [sourceLabel, sourceIcon] = sourceOf(inc.source);
  const meta = [
    [sourceIcon, sourceLabel],
    creator && [I.user, `Triggered by ${creator}`],
    [I.clock, `${dayLabel(inc.created_at, now)} at ${timeOnly(inc.created_at)}`],
    repeats.length && [I.repeat, `Repeated ${repeats.length}× · grouped, not paged again`],
  ].filter(Boolean).map(([ic, text]) => `<span>${ic}<span>${esc(text)}</span></span>`).join('');

  // Times on the incident's own day; the date too after that.
  const stamp = (iso) => (dayKey(iso) === dayKey(t0) ? timeOnly(iso) : `${shortDate(iso)}, ${timeOnly(iso)}`);
  const last = repeats[repeats.length - 1];
  const feed = [
    ...events.filter((e) => !same(e)).map((e) => {
      const [, ic, tone] = EVENT_LOOK.find(([re]) => re.test(e.message)) ?? [null, I.info, ''];
      return { at: e.at, ic, tone, html: esc(e.message) };
    }),
    ...(repeats.length ? [{ at: repeats[0].at, ic: I.repeat, tone: '', chip: `Repeated ${repeats.length}×`,
      html: esc(`The same alert came in ${repeats.length === 1 ? 'again' : `${repeats.length} more times, last at ${stamp(last.at)}`}. Grouped here, nobody was paged again.`) }] : []),
    ...notes.map((n) => ({ at: n.at, ic: I.chat, tone: '', html: `Note from ${esc(n.user_name)}` })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (inc.status === 'open') feed.push({ at: now.toISOString(), ic: I.clock, tone: 'accent', html: 'Now. Waiting for someone to acknowledge.' });
  const timeline = `<section class="card"><h2>Timeline</h2><ol class="feed">${feed.map((f) => `<li><span class="time">${esc(stamp(f.at))}</span>
    <span class="node ${f.tone}" aria-hidden="true">${f.ic}</span><div class="body"><span>${f.html}</span>${f.chip ? `<span class="pill sm">${esc(f.chip)}</span>` : ''}</div></li>`).join('')}</ol></section>`;

  const noteList = notes.length ? `<ul class="changes">${notes.map((n) => `<li><span class="avatar md${Number(n.user_id) === Number(user.id) ? ' accent' : ''}">${initials(n.user_name)}</span>
      <div class="body"><div><span class="strong">${esc(n.user_name)}</span> <span class="muted">· ${esc(stamp(n.at))}</span></div>
      <div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(n.text)}</div></div></li>`).join('')}</ul>`
    : '<p class="muted" style="margin:0">No notes yet.</p>';
  const notesCard = `<section class="card"><h2>Notes</h2><p class="card-desc">Added from the phone app.${Number(inc.test) ? '' : ` Each note is posted in ${esc(ch)} too.`}</p>${noteList}</section>`;

  const failed = notifications.filter((n) => n.status === 'failed').length;
  const dry = notifications.filter((n) => n.status === 'dry-run').length;
  const count = `${notifications.length} message${notifications.length === 1 ? '' : 's'}`;
  const outcome = [failed && `${failed} failed`, dry && `${dry} dry run`].filter(Boolean).join(' · ') || 'all sent';
  const messages = `<section class="card"><details class="disclosure" open><summary><span class="avatar md">${I.send}</span>
      <span class="cell-text"><span class="strong">Messages sent</span><span class="small muted">${notifications.length ? `${count} · ${outcome}` : 'None yet'}</span></span><span class="chev">${I.next}</span></summary>
    ${notifications.length ? `<div style="margin-top:16px">${notificationTable(notifications, names, stamp)}</div>` : ''}</details></section>`;

  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/incidents">Incidents</a><span aria-hidden="true">/</span><span aria-current="page">#${inc.id}</span></nav>
  <div class="head top"><div class="head-main">
      <div class="row"><span class="pill ${inc.status}">${statusLabel(inc.status)}</span><span class="muted">${esc(line)}</span></div>
      <h1 class="display">${esc(inc.title)}</h1>
      <div class="meta">${meta}</div></div>
    ${incidentButtons(user, inc, '', '')}</div>
  ${escalationCard(inc, escalation, now)}
  <div class="duo">
    <div class="wide stack">${inc.details ? `<section class="card"><h2>What’s happening</h2><p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">${esc(inc.details)}</p></section>` : ''}${timeline}${notesCard}</div>
    <div class="stack" style="flex-basis:400px"><section class="card"><h2>Who it reached</h2><p class="card-desc">Every page, per person and channel.</p>${reachTable({ user, inc, notifications, who })}</section></div>
  </div>
  ${messages}`;
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

/** Messages newest first: Slack DMs, channel posts and phone calls, each with how it went. */
function notificationTable(rows, names = {}, when = fmt) {
  if (!rows.length) return '<p class="muted" style="margin:0">None.</p>';
  return `<div class="scroll"><table class="msgs"><thead><tr><th>Channel</th><th>To</th><th>Sent</th><th>Status</th><th>Detail</th></tr></thead><tbody>${rows.map((n) => {
    const { name, device, post } = recipientOf(n);
    const [kind, ic] = n.channel === 'push' ? [String(n.body).startsWith('Stop ringing') ? 'Call stopped' : 'Phone call', I.phone] : post ? ['Slack post', I.megaphone] : ['Slack DM', I.chat];
    const text = plainSlack(n.body, names);
    return `<tr><td class="nowrap"><span class="cell">${ic}<span class="strong">${kind}</span></span></td>
    <td class="nowrap">${esc(name)}${device ? `<div class="t-meta">${esc(device)}</div>` : ''}</td><td class="nowrap">${esc(when(n.at))}</td><td>${deliveryPill([n], 'Sent')}</td>
    <td class="muted">${esc(text.slice(0, 200))}${text.length > 200 ? '…' : ''}${n.error ? `<div class="t-meta" style="color:var(--danger-soft-fg)">${esc(n.error)}</div>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/** The Team table's Phone app column: the signed-in phones and whether a page can ring them. */
function phoneCell(devices = [], slack, paged) {
  if (!devices.length) return `<span class="muted">No phone</span>${paged ? `<div class="t-meta">${slack ? 'Slack DM only' : 'Can’t be paged directly'}</div>` : ''}`;
  const { ready, registered } = phoneReach(devices);
  return `${esc(devices.map((d) => d.name).join(', '))}<div class="t-meta">${ready ? 'Calls work'
    : registered ? 'Calls aren’t set up on this server' : 'Not registered for calls yet'}</div>`;
}

const ROLE_NOTES = { admin: 'Optional on call', engineer: 'In the rotation', non_technical: 'Never on call' };

export function teamPage({ user, members, inactive, role = '', phoneApp, phones = new Map(), flash }) {
  const admin = isAdmin(user);
  const counts = Object.fromEntries(ROLES.map((r) => [r, members.filter((m) => m.role === r).length]));
  const chip = (value, label, count) =>
    `<a class="tab" href="${value ? `/team?role=${value}` : '/team'}"${role === value ? ' aria-current="true"' : ''}>${esc(label)} <span class="count">${count}</span></a>`;
  const filter = `<nav class="tabs" aria-label="Filter by role">${chip('', 'All', members.length)}${
    ROLES.map((r) => chip(r, ROLE_LABELS[r], counts[r])).join('')}</nav>`;

  const responders = members.filter(isResponder);
  const withPhone = responders.filter((m) => phones.get(Number(m.id))?.length).length;
  const share = responders.length ? Math.round((withPhone / responders.length) * 100) : 0;
  const tiles = `<div class="stats">
    ${statTile(I.users, 'In the rotation', counts.engineer, 'Engineers get weekends in turn. Admins are optional.')}
    ${statTile(I.smartphone, 'Phone app signed in', `${withPhone} of ${responders.length}`,
    `${progress(share, '', `${withPhone} of ${responders.length} engineers and admins have the phone app signed in`)}<div style="margin-top:8px">Engineers and admins. Without it, pages reach them on Slack only.</div>`)}
  </div>`;

  const rows = members.map((m, i) => {
    if (role && m.role !== role) return '';
    const me = Number(m.id) === Number(user.id);
    const slack = slackLinked(m);
    return `<tr class="role-${esc(m.role)}">
    <td class="num">${i + 1}</td>
    <td><div class="cell"><span class="avatar md${me ? ' accent' : ''}">${initials(m.name)}</span><div class="cell-text">
      <span><span class="strong">${esc(m.name)}</span>${me ? '<span class="muted"> (you)</span>' : ''}</span>
      <span class="t-meta">${esc(m.email)}${m.whatsapp ? ` · ${esc(m.whatsapp)}` : ''}</span></div></div></td>
    <td><span class="pill sm${m.role === 'engineer' ? ' accent' : ''}">${esc(ROLE_LABELS[m.role] || m.role)}</span><div class="t-meta">${esc(ROLE_NOTES[m.role] || '')}</div></td>
    <td>${slack ? `<code>${esc(m.slack_user_id)}</code>` : `<span class="pill sm danger">Not linked</span>${m.slack_user_id ? `<div class="t-meta">${esc(m.slack_user_id)}</div>` : ''}`}</td>
    <td>${phoneCell(phones.get(Number(m.id)), slack, isResponder(m))}</td>
    ${admin ? `<td class="actions"><div class="row" style="justify-content:flex-end">
      <form method="post" action="/team/${m.id}/move" class="inline"><input type="hidden" name="dir" value="-1"><button class="sm icon ghost" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(m.name)} up">${I.up}</button></form>
      <form method="post" action="/team/${m.id}/move" class="inline"><input type="hidden" name="dir" value="1"><button class="sm icon ghost" ${i === members.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(m.name)} down">${I.down}</button></form>
      <form method="post" action="/team/${m.id}/role" class="inline"><select name="role" aria-label="Role for ${esc(m.name)}">${ROLES.map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${esc(ROLE_LABELS[r])}</option>`).join('')}</select><button class="sm">Set role</button></form>
      <form method="post" action="/team/${m.id}/active" class="inline"><input type="hidden" name="active" value="0"><button class="sm danger">Remove</button></form>
    </div></td>` : ''}</tr>`;
  }).join('');
  const cols = admin ? 6 : 5;
  const table = `<section class="sec" aria-labelledby="order-title">
    <div class="sec-head"><div><h2 id="order-title">Rotation order</h2>
      <p class="muted">${admin ? 'Move people up or down to change who comes next. Past weekends never change.' : 'Ask an admin to change the order or a role. Past weekends never change.'}</p></div>${filter}</div>
    <div class="card flush"><div class="scroll"><table class="team${admin ? ' wide' : ''}"><thead><tr><th class="num">#</th><th>Person</th><th>Role</th><th>${I.chat}Slack</th><th>${I.smartphone}Phone app</th>${admin ? '<th><span class="sr">Actions</span></th>' : ''}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${cols}" class="empty">Nobody has this role.</td></tr>`}</tbody></table></div></div></section>`;

  const shownInactive = inactive.filter((m) => !role || m.role === role);
  const removed = shownInactive.length ? `<section class="card" aria-labelledby="removed-title"><h2 id="removed-title">Removed from rotation</h2>
    <p class="card-desc">Removed people can't sign in until an admin adds them back.</p>
    <div class="items">${shownInactive.map((m) => `<div class="item"><span class="avatar">${initials(m.name)}</span>
      <div class="cell-text"><span class="strong">${esc(m.name)}</span><span class="t-meta">${esc(m.email)}</span></div>
      ${admin ? `<form method="post" action="/team/${m.id}/active" class="inline"><input type="hidden" name="active" value="1"><button class="sm">Add back</button></form>` : ''}</div>`).join('')}</div></section>` : '';

  const contact = `<section class="card wide" aria-labelledby="contact-title"><h2 id="contact-title">Your contact details</h2>
    <p class="card-desc">How the team reaches you. Pages come as a Slack DM and, with the phone app, a call.</p>
    <form method="post" action="/profile">
      ${field({ id: 'name', label: 'Name', value: user.name, attrs: 'required autocomplete="name"' })}
      ${field({ id: 'slack', label: 'Slack', value: user.slack_user_id || '', attrs: 'placeholder="Slack email or member ID"', hint: 'Your Slack member ID (U0123ABCD) or Slack email.' })}
      ${field({ id: 'whatsapp', label: 'Phone number', type: 'tel', value: user.whatsapp, attrs: 'required autocomplete="tel"', hint: 'With country code. The team sees it on this page.' })}
      <div class="row"><button class="primary">Save</button>
      <button formaction="/profile/test">${I.send}<span>Send me a test message</span></button></div>
    </form>
    <hr class="sep" style="margin:20px 0 16px">
    <div class="note">${I.phone}<div class="cell-text"><span>To test a call, type <code>/page test call me</code> and what broke in Slack.</span>
      <span class="small muted">Only your phones ring. It opens a test incident that calls once, never escalates and stays out of ${esc(channel())}.</span></div></div></section>`;

  const body = `<div class="head"><div><h1>Team</h1>
    <p class="sub">Each weekend goes to the next engineer in this list. Admins are optional, and non-technical people (C-level, support, product) are never on call: they can view the calendar and audit log and trigger an alert. ${admin ? 'You can reorder or remove people.' : 'Ask an admin to reorder.'}</p></div></div>
  ${tiles}
  ${table}
  <div class="duo">${contact}<div class="stack">${phoneApp ? phoneAppCard(phoneApp) : ''}${removed}</div></div>`;
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
  const push = pushEnabled();
  const rows = phones.map((d) => {
    const chip = !d.push_token ? '<span class="pill sm warning">Not registered for calls</span>'
      : !push[d.platform] ? '<span class="pill sm warning">Calls off on this server</span>' : '<span class="pill sm success">Calls work</span>';
    return `<div class="item"><span class="tile">${I.smartphone}</span>
      <div class="cell-text"><span class="row" style="gap:8px"><span class="strong">${esc(d.name)}</span>${chip}</span>
        <span class="t-meta">${d.platform === 'ios' ? 'iPhone' : 'Android'}${d.created_at ? ` · signed in ${esc(shortDate(d.created_at))}` : ''}</span>
        <span class="t-meta">${d.tested_at ? `Last test call answered ${esc(shortDate(d.tested_at))}` : 'Not tested yet'}</span></div>
      <form method="post" action="/devices/${Number(d.id)}/revoke" class="inline"><button class="sm" aria-label="Sign out of ${esc(d.name)}">Sign out</button></form></div>`;
  }).join('');
  return `<section class="card" aria-label="Phone app"><h2>Phone app</h2>
    <p class="card-desc">Pages ring your phone like a call. Scan this with the ${esc(config.appName)} app to sign in. The code works once, for 10 minutes.</p>
    <details>
      <summary class="btn">Show sign-in code</summary>
      <div class="qr-box"><div class="qr">${qr}</div>
        <ol><li>Open the ${esc(config.appName)} app on your phone.</li><li>Tap Scan code and point the camera at this code.</li></ol></div>
    </details>
    <hr class="sep" style="margin:20px 0 16px">
    <p class="small strong muted" style="margin:0 0 12px">Your signed-in phones</p>
    ${rows ? `<div class="items">${rows}</div>` : '<p class="muted" style="margin:0">No phones signed in yet.</p>'}</section>`;
}

export function settingsPage({ user, coverage, domains, ping, status, notifications, names = {}, flash }) {
  const admin = isAdmin(user);
  const ch = channel();
  const push = pushEnabled();
  const url = (p) => `<code>${esc(config.publicUrl + p)}</code>`;
  const pill = (tone, label) => `<span class="pill sm${tone ? ` ${tone}` : ''}">${label}</span>`;
  const head = (ic, title, sub, chip = '') => `<div class="int-head"><span class="tile">${ic}</span>
    <div class="cell-text"><h3>${title}</h3><span class="small muted">${sub}</span></div>${chip}</div><hr class="sep">`;
  const block = (label, body, hint = '') => `<div class="kv-block"><span class="strong">${label}</span>${body}${hint ? `<span class="small muted">${hint}</span>` : ''}</div>`;

  const slackCard = `<section class="card int" aria-label="Slack">${head(I.chat, 'Slack', `DMs, ${esc(ch)}, /page and /oncall`, status.slack ? pill('success', 'Connected') : pill('warning', 'Dry run'))}
    <div class="kv"><span class="muted">On-call channel</span>${config.slack.channel ? `<code>${esc(config.slack.channel)}</code>` : '<span class="muted">Not set</span>'}</div>
    ${block('Slash commands URL', url('/slack/commands'), 'Point <code>/oncall</code>, <code>/page</code> and <code>/ping</code> at the same URL.')}
    ${block('Interactivity URL', url('/slack/interactions'), 'For the Acknowledge and Resolve buttons.')}
    ${block('Bot scopes', `<div class="row" style="gap:6px">${['chat:write', 'users:read', 'users:read.email', 'im:write', 'commands'].map((sc) => pill('', sc)).join('')}</div>`)}</section>`;

  // Push keys per platform from the environment: without them that platform's calls are logged as dry runs.
  const platform = (on, name, onText, offText, envs) => `<div class="check-row${on ? '' : ' off'}">${on ? I.check : I.alert}
    <div class="cell-text"><span class="strong">${name} calls ${on ? 'on' : 'off'}</span><span class="small muted">${on ? onText : offText}</span>
      ${on ? '' : `<span class="codes">${envs.map((e) => `<code>${e}</code>`).join('')}</span>`}</div></div>`;
  const sandbox = config.push.apns.host.includes('sandbox');
  const phoneChip = push.ios && push.android ? pill('success', 'On') : push.ios ? pill('success', 'iPhone on')
    : push.android ? pill('success', 'Android on') : pill('warning', 'Dry run');
  const phoneCard = `<section class="card int" aria-label="Phone calls">${head(I.smartphone, 'Phone calls', `The ${esc(config.appName)} app rings like a call`, phoneChip)}
    ${platform(push.ios, 'iPhone', `Apple push (APNs), ${sandbox ? 'sandbox: only Xcode debug builds ring.' : 'production: TestFlight and App Store builds ring.'}`,
    'Calls to iPhones are logged as dry runs. Set an APNs key from Apple Developer:', ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY'])}
    ${platform(push.android, 'Android', 'Firebase Cloud Messaging (FCM).',
    'Calls to Android phones are logged as dry runs. Set the service account JSON from Firebase:', ['FCM_SERVICE_ACCOUNT'])}
    <p class="small muted">Push keys are environment settings: set them where the app runs, then restart it.</p></section>`;

  const apiCard = `<section class="card int" aria-label="Alerts API">${head(I.send, 'Alerts API', 'For Sentry, Coralogix, CI and scripts', status.api ? pill('success', 'Connected') : pill('', 'Disabled'))}
    ${status.api ? '' : '<p class="muted">Set <code>API_TOKEN</code> where the app runs to enable it.</p>'}
    ${block('Example request', `<pre class="code">${esc(`curl -X POST ${config.publicUrl}/api/incidents \\
  -H "Authorization: Bearer $API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"API 5xx spike","details":"..."}'`)}</pre>`)}
    <p class="small muted">An alert with the same title as an unresolved incident joins it instead of paging again.</p></section>`;

  const dayBoxes = DAY_NAMES.map((name, d) =>
    `<label class="check"><input type="checkbox" name="day_${d}" value="1" ${coverage.days.includes(d) ? 'checked' : ''}> ${name}</label>`).join('');
  const presetButtons = Object.entries(PRESETS).map(([key, p]) => `<button name="preset" value="${key}" class="sm">${esc(p.label)}</button>`).join('');
  const coverageCard = admin
    ? `<div class="card"><form method="post" action="/settings/coverage">
        <fieldset><legend>Days that need cover</legend><div class="row" style="gap:8px 24px">${dayBoxes}</div></fieldset>
        <div class="fields" style="gap:0 24px;margin-top:20px;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))">
          ${field({ id: 'start', label: 'Shift starts', type: 'time', value: coverage.start, attrs: 'required', hint: 'On the first day' })}
          ${field({ id: 'end', label: 'Shift ends', type: 'time', value: coverage.end, attrs: 'required', hint: 'The morning after the last day' })}
          ${field({ id: 'weekend_count', label: 'People on weekend days', type: 'number', value: coverage.weekendCount, attrs: 'min="1" max="10" required', hint: 'Saturdays and Sundays' })}
          ${field({ id: 'weekday_count', label: 'People on weekdays', type: 'number', value: coverage.weekdayCount, attrs: 'min="1" max="10" required', hint: 'Monday to Friday' })}
        </div>
        <p class="hint" style="margin:0 0 20px">A shift needs as many people as the busiest day it covers. Set both to the same number for "same all week".</p>
        <div class="row" style="gap:12px 16px"><button class="primary">Save coverage</button><span class="small muted" style="flex:1 1 260px">Times are in ${esc(config.timezone)}.</span></div>
        <hr class="sep" style="margin:20px 0 16px">
        <div class="row"><span class="small muted" style="flex:1 1 100%">Or start from a preset. It saves right away and keeps the times and counts above.</span>${presetButtons}</div>
      </form></div>`
    : `<div class="card"><p class="strong" style="font-size:16px;line-height:24px;margin:0">${esc(describeDays(coverage.days))}, ${esc(coverage.start)} → ${esc(coverage.end)}</p>
        <p class="muted" style="margin:2px 0 12px">${coverage.weekendCount} on weekend days, ${coverage.weekdayCount} on weekdays. Times are in ${esc(config.timezone)}.</p>
        <p class="small muted" style="margin:0">Ask an admin to change it.</p></div>`;

  const domainsCard = `<section class="card int" aria-label="Workspace">${head(I.shield, 'Workspace', 'Who can sign in')}
    <p>${domains.length ? `Only ${domains.map((d) => `@${esc(d)}`).join(', ')} accounts can sign in.` : 'Not restricted (local development).'}</p>
    <p class="small muted">Set by the <code>ALLOWED_EMAIL_DOMAINS</code> environment variable. Change it where the app is deployed and restart.</p></section>`;
  const pingCard = `<section class="card int" aria-label="/ping AI check">${head(I.eye, '/ping AI check', 'An AI look at what broke, from Slack',
    ping.mode === 'off' ? pill('warning', 'Off') : pill('success', esc(ping.mode)))}
    ${ping.mode === 'off'
    ? '<p>Off. Set <code>PING_ENABLED=true</code> with <code>ANTHROPIC_API_KEY</code> (or a routine) to let engineers run <code>/ping</code> in Slack.</p>'
    : ping.mode === 'api'
      ? `<p>Runs on the Claude API (<code>${esc(ping.model)}</code>) with your skill file <code>${esc(ping.skillFile)}</code>${ping.skillFound ? '' : ' <span class="pill sm failed">not found, using a short default</span>'}. ${ping.checkUrls} health URL${ping.checkUrls === 1 ? '' : 's'} probed.</p>`
      : '<p>Hands each request to your Claude Code routine, which replies in the thread.</p>'}
    <p class="small muted">Engineers and admins only. One check every ${ping.cooldownSeconds} s, at most ${ping.maxPerDay} a day. Configured by environment variables, see docs/ping.md.</p></section>`;
  const resend = admin
    ? `<section class="card int" aria-label="Weekend messages">${head(I.repeat, 'Weekend messages', 'The “you’re on call now” message')}
        <p class="muted">Re-send this weekend's "you're on call now" message to everyone on call, and post it in the on-call channel again. Useful if Slack was connected after the weekend started.</p>
        <form method="post" action="/admin/resend-weekend-start" class="inline"><button class="sm">Re-send this weekend's on-call messages</button></form></section>`
    : '';

  const body = `<div class="head"><div><h1>Settings</h1><p class="sub">How ${esc(config.appName)} reaches people, how alerts get in, and which days need cover.</p></div></div>
  <section class="sec" aria-labelledby="int-title"><div class="sec-head"><div><h2 id="int-title">Integrations</h2><p class="muted">Where pages go out and where they come in from.</p></div></div>
    <div class="grid">${slackCard}${phoneCard}${apiCard}</div></section>
  <section class="sec" aria-labelledby="coverage-title"><div class="sec-head"><div><h2 id="coverage-title">On-call coverage</h2>
    <p class="muted">Which days need someone on call. Back-to-back days make one shift, from the start time on its first day to the end time the morning after its last. Changes apply to the calendar and rotation right away.</p></div></div>
    ${coverageCard}</section>
  <div class="grid">${domainsCard}${pingCard}${resend}</div>
  <section class="sec" aria-labelledby="messages-title"><div class="sec-head"><div><h2 id="messages-title">Recent messages</h2>
    <p class="muted">The last 30 Slack messages and phone calls, newest first.</p></div></div>
    <div class="card${notifications.length ? ' flush' : ''}">${notificationTable(notifications, names)}</div></section>`;
  return layout({ title: 'Settings', user, body, flash, active: 'settings' });
}

export function messagePage({ user, title, message, link }) {
  const card = `<div class="card message"><span class="avatar lg warning">${I.info}</span><h1>${esc(title)}</h1>
    <p class="muted" style="margin:0">${esc(message)}</p>${link ? `<div><a class="btn primary" href="${esc(link.href)}">${esc(link.label)}</a></div>` : ''}</div>`;
  return layout({ title, user, body: user ? `<div style="max-width:560px">${card}</div>` : `<div class="auth-msg">${brand('div')}${card}</div>` });
}

/** Next to each name: "Remove me" on your own name, "Take spot" on others. */
function personAction(user, e, p) {
  if (e.shift.end <= new Date() || !isResponder(user)) return '';
  if (p.id === user.id) {
    if (e.shift.start <= new Date()) return ''; // can't leave a running weekend; someone takes the spot instead
    return `<form method="post" action="/weekends/${e.shift.key}/leave" class="inline"><input type="hidden" name="back" value="calendar"><button class="sm ghost">Remove me</button></form>`;
  }
  if (e.people.some((x) => x.id === user.id)) return ''; // you're already on this weekend
  return `<form method="post" action="/weekends/${e.shift.key}/swap" class="inline"><input type="hidden" name="user_id" value="${p.id}">
    <button class="sm" aria-label="Take spot from ${esc(p.name)}, ${esc(formatRange(e.shift, config.timezone))}">Take spot</button></form>`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayTime = (d) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);

/**
 * One week of the month grid: the day numbers, then each weekend as a band across the days it covers in this week.
 * Bands that share a day (a week-long shift ends the morning the next one starts) go in separate lanes.
 */
function calendarWeek(week, user, now) {
  const segs = [];
  week.forEach((d, col) => {
    for (const { entry, isStart, isEnd } of d.items) {
      const seg = segs.find((x) => x.entry.shift.key === entry.shift.key);
      if (seg) Object.assign(seg, { last: col, isEnd: seg.isEnd || isEnd });
      else segs.push({ entry, first: col, last: col, isStart, isEnd });
    }
  });
  const lanes = [];
  for (const seg of segs) {
    seg.lane = lanes.findIndex((last) => last < seg.first);
    if (seg.lane < 0) seg.lane = lanes.length;
    lanes[seg.lane] = seg.last;
  }
  const bands = segs.map(({ entry: e, first, last, lane, isStart, isEnd }) => {
    const missing = Math.max(0, e.shift.count - e.people.length);
    const tone = missing ? ' need' : e.people.some((p) => p.id === user.id) ? ' you' : '';
    const names = andList(e.people.map(firstName));
    const label = missing ? `${names ? `${names} · ` : ''}${missing} open spot${missing === 1 ? '' : 's'}` : names;
    const running = e.shift.start <= now && now < e.shift.end;
    const when = isStart && isEnd ? `${dayTime(e.shift.start)} → ${dayTime(e.shift.end)}`
      : isStart ? `${running ? 'now · ' : ''}from ${dayTime(e.shift.start)}` : isEnd ? `until ${dayTime(e.shift.end)}` : '';
    const title = `${formatRange(e.shift, config.timezone)}: ${andList(e.people.map((p) => p.name)) || 'nobody yet'}${missing ? `, needs ${missing} more` : ''}`;
    return `<a class="band${tone}" href="#wk-${e.shift.key}" style="grid-column:${first + 1} / span ${last - first + 1};grid-row:${lane + 2}" title="${esc(title)}">
      <span class="who">${e.people.length ? avatarGroup(e.people, user, 'xs') : ''}<span class="names">${esc(label)}</span></span>${when ? `<span class="when">${esc(when)}</span>` : ''}</a>`;
  }).join('');
  const days = week.map((d) => `<div class="d${d.inMonth ? '' : ' out'}"><span class="num"${d.today ? ' aria-current="date"' : ''}>${d.day}</span></div>`).join('');
  return `<div class="cal-week">${days}${bands}</div>`;
}

/** A weekend in the side list: who covers it and why, the open spots, and your actions. */
function weekendItem(user, e, now) {
  const tz = config.timezone;
  const missing = Math.max(0, e.shift.count - e.people.length);
  const running = e.shift.start <= now && now < e.shift.end;
  const chip = e.shift.end <= now ? '<span class="pill sm">Past</span>'
    : missing ? `<span class="pill sm ${running ? 'danger' : 'warning'}">Needs ${missing} more</span>`
      : running ? '<span class="pill sm accent">On call now</span>' : '<span class="pill sm">Covered</span>';
  const mine = e.people.some((p) => p.id === user.id);
  const add = mine ? '' : selfButton(user, e, 'calendar', now);
  const people = e.people.map((p) => `<div class="p"><span class="avatar md${p.id === user.id ? ' accent' : ''}">${initials(p.name)}</span>
      <div class="cell-text"><span><span class="strong">${esc(p.name)}</span>${p.id === user.id ? '<span class="muted"> (you)</span>' : ''}</span>
        <span class="small muted">${e.base.some((b) => b.id === p.id) ? 'From the rotation' : 'Joined'}</span></div>${personAction(user, e, p)}</div>`).join('');
  const open = missing ? `<div class="p"><span class="avatar md warning">${I.userPlus}</span>
      <div class="cell-text"><span class="open-spot">${missing > 1 ? `${missing} open spots` : 'Open spot'}</span></div>${add}</div>` : '';
  return `<article class="wk-item" id="wk-${e.shift.key}">
    <div class="top"><div><h3>${esc(formatRange(e.shift, tz))}</h3><span class="small muted">${esc(shiftSpan(e.shift))}</span></div>${chip}</div>
    <div class="people">${people}${open}</div>
    ${!missing && add ? `<div class="act">${add}</div>` : ''}</article>`;
}

export function calendarPage({ user, grid, prevMonth, nextMonth, thisMonth, feedUrl, flash }) {
  const now = new Date();
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<span>${d}</span>`).join('');
  const legend = [['you', 'You'], ['need', 'Needs cover'], ['', 'Covered']]
    .map(([tone, label]) => `<span><i class="${tone}" aria-hidden="true"></i>${label}</span>`).join('');
  const month = `<section class="card wide" aria-label="${MONTHS[grid.month - 1]} ${grid.year}">
    <div class="cal-legend">${legend}</div>
    <div class="cal"><div class="cal-dows" aria-hidden="true">${dows}</div>${grid.weeks.map((w) => calendarWeek(w, user, now)).join('')}</div></section>`;

  const list = grid.entries.length
    ? `<div class="wk-list">${grid.entries.map((e) => weekendItem(user, e, now)).join('')}</div>`
    : '<p class="muted" style="margin:0">No weekends scheduled this month yet.</p>';
  const googleAdd = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace(/^https?:/, 'webcal:'))}`;
  const side = `<div class="stack">
    <section class="card" aria-labelledby="weekends-title"><h2 id="weekends-title">Weekends this month</h2>${list}
      <p class="small muted" style="margin:16px 0 0">${isResponder(user)
    ? `<strong>Add me</strong> joins a weekend. <strong>Take spot</strong> takes that person's place, and you have 10 seconds to undo it before they and Slack are told. Every change is in the <a href="/log">audit log</a>.`
    : 'Need an engineer now? <a href="/incidents">Trigger an alert</a>. Every roster change is in the <a href="/log">audit log</a>.'}</p></section>
    <section class="card" aria-labelledby="feed-title"><h2 id="feed-title">In your calendar</h2>
      <p class="card-desc">Subscribe once and every on-call weekend shows up in your calendar, updated automatically.</p>
      <a class="btn block" href="${esc(googleAdd)}" target="_blank" rel="noopener">${I.calendar}<span>Add to Google Calendar</span>${I.external}</a>
      <div class="field" style="margin:16px 0 0"><label for="feed-url">Feed for other calendar apps</label>
        <input id="feed-url" readonly value="${esc(feedUrl)}" aria-describedby="feed-url-hint"><p class="hint" id="feed-url-hint">Keep this link inside the team.</p></div></section>
  </div>`;

  const body = `<div class="head"><div><h1>${MONTHS[grid.month - 1]} ${grid.year}</h1><p class="sub">Who's on call each weekend.</p></div>
    <div class="row"><a class="btn icon ghost" href="/calendar?month=${prevMonth}" aria-label="Previous month">${I.back}</a>
      <a class="btn sm" href="/calendar?month=${thisMonth}">Today</a>
      <a class="btn icon ghost" href="/calendar?month=${nextMonth}" aria-label="Next month">${I.next}</a></div></div>
  <div class="duo">${month}${side}</div>`;
  return layout({ title: 'Calendar', user, body, flash, active: 'calendar' });
}
