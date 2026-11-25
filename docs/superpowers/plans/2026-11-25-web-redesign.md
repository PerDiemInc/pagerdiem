# Web redesign build plan

**Goal:** the PagerDiem web app looks and works like the approved Claude Design canvas "PagerDiem Web"
(https://claude.ai/artifact/Sp1X2UPCibbZitpyKu55pu), on HeroUI V3, with the bell logo.

**Design source:** the canvas boards (Sidebar, SignIn, Welcome, Main = On call, PageComposer, Incidents, Incident,
Calendar, Team, Settings, AuditLog). They are React-on-canvas mockups with sample data; the app renders the same
layouts as plain server HTML with real data. HeroUI V3 rules come from the HeroUI V3 design system's README.

**Architecture (unchanged):** every page is a function in `src/views.js` returning an HTML string, styled by the one
`CSS` constant there (HeroUI V3 tokens in light and dark, `data-theme` on `<html>`), icons as inline 24px stroke SVGs
in the `I` map. Routes in `src/app.js` pass data to the views. No new dependencies, no build step, no client framework.
Only tiny inline scripts where a page already has one (undo toast).

## Global constraints

- Keep every feature, route, form field name, permission and redirect exactly as today. No new routes, no schema changes.
- `src/app.js` changes only to pass data that already exists to a view (one query, outside loops; Map lookups).
- Every existing test keeps passing. Anything newly shown from data gets a test first (red, then green) in the existing
  spec for that route (`test/http.test.js`, `test/features.test.js`). Tests run with
  `PATH=~/.nvm/versions/node/v24.22.2/bin:$PATH npm test` (and must also pass `npm run test:pg` in CI; keep SQL portable).
- Logo: the bell-ring mark (white Lucide bell-ring on a `#1E1B4B → #09090B` rounded square), as an inline SVG constant in
  `views.js` (unique gradient id) next to the word PagerDiem in the sidebar and on the auth pages, and as the favicon
  (an encoded `data:image/svg+xml` URI). Source: `docs/images/logo.svg`.
- HeroUI V3 look: sentence case, no emoji, flat fills, surfaces separated by tone, radius 24 cards / 12 fields / pills
  for buttons and chips, Inter, one accent `#006FEE`. Text 4.5:1 in light and dark; coloured text on soft fills uses the
  `*-soft-fg` tokens. Works at phone width (sidebar stacks, tables scroll in a box).
- Leave out the canvas's NEW proposals that need server work: find/ask for cover, holiday markers, calendar list view,
  only-my-weekends filter, ⌘K search, More actions on the web incident page (call again, page the backup), editing
  escalation minutes, the role dialog (keep the role select), weekly shift preview, "Page the admins too", audit-log
  filters, sign-in states the app doesn't have. Build the proposals that only present data the app already has:
  reachability (Slack linked, phone signed in), "Your phone" line, the escalation track (`escalationPlan` in
  `src/app-api.js`), who it reached (the incident's `notifications` rows, channels `slack` and `push`), stat tiles.
- Don't commit. Don't touch README.md or docs/.

## Tasks (sequential: they all edit `src/views.js`)

1. **Shell, auth pages, On call.** Boards: Sidebar, SignIn, Welcome, Main (+ PageComposer for the page form on the home
   page). Sidebar: logo, the on-call panel (who is on call now and until when, or next weekend, or nobody), nav with the
   open-incident badge, theme switch, account card. Home: the canvas's On call hero, reachability per on-call person,
   "Your phone", paging plan, open incidents, rotation, balance. Data plumbing: the on-call summary for the sidebar is
   computed once per request where `openIncidents` is set today; reachability from one devices query.
2. **Incidents and Incident.** Boards: Incidents, Incident. Stat tiles, tabs, table with status chips and paged people,
   Acknowledge/Resolve forms; incident status header, escalation track, who it reached (Slack DM / phone call / channel
   per person, from notifications), timeline, notes, messages sent.
3. **Calendar, Team, Settings, Audit log, message page.** Boards: Calendar, Team, Settings, AuditLog. Calendar: weekend
   bands across the month grid; Team: Slack and Phone app columns, phone app card; Settings: Phone calls card (iPhone /
   Android from `pushEnabled()`), coverage form, recent messages; Audit log: day-grouped timeline.

After the three tasks: check every page in light and dark at desktop and phone width on the seeded local server, then a
fresh-reviewer pass over the whole diff, then refresh `docs/images/{dashboard,calendar,incident,audit-log}.jpg`.
