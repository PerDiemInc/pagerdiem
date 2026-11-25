# <img src="docs/images/logo.svg" alt="" width="40" height="40" align="top"> PagerDiem

[![ci](https://github.com/PerDiemInc/pagerdiem/actions/workflows/ci.yml/badge.svg)](https://github.com/PerDiemInc/pagerdiem/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[Project site](https://perdieminc.github.io/pagerdiem/)

**Self-hosted weekend on-call for small engineering teams.** A fair rotation, Slack paging with
escalation, a phone app whose pages ring like a phone call, a shared calendar, and sign-in locked
to your Google Workspace. One Node.js process, one database, no per-seat pricing.

![On-call dashboard](docs/images/dashboard.jpg)

## Why

Paging tools are built for large incident-response orgs and priced per seat. Many small teams just
need: *who's on call this weekend, and how do we reach them when something breaks?* PagerDiem does
exactly that, and you can run it for free.

It runs on-prem or in your own cloud account. There is no subscription and no per-seat price, so it costs nothing at any team size, including over 100 people. You only pay for the server it runs on.

## Features

| | |
|---|---|
| **Fair rotation, your days** | People take turns so everyone gets the same share. By default two people cover the weekend, Friday 18:00 → Monday 09:00 in your time zone. An admin can change the days that need cover, the start and end time, and how many people go on weekend days and on weekdays, from **Settings** (presets: weekends, weekdays, all week). |
| **Self-service** | Anyone can **add themselves** to a weekend (no limit) or **remove themselves** before it starts (once it has started, someone takes their spot instead). Weekends below the target are flagged *needs cover*. |
| **Swap with undo** | On the calendar, **Swap** next to a name takes that person's spot. You get 10 seconds to undo before they and Slack are told. |
| **Slack paging** | Page from the web app, `/page <what broke>` in Slack, or the HTTP API. Everyone on call gets a DM with **Acknowledge / Resolve** buttons; the channel is told, with on-call people @-tagged. |
| **Phone app** | Pages ring your iPhone like a phone call, even when the app is closed or the phone is locked. Answering acknowledges the page and stops paging for everyone. From the app you can also page on-call, acknowledge, resolve and add notes, see the schedule and swap weekends. Android is next. See [Phone app](#phone-app). |
| **Escalation** | No acknowledgement → call the phones again at 2 min, so the call gets through Do Not Disturb → re-page every 5 min → page the backup at 15 min → `@channel` at 30 min → keep paging everyone every 5 min until someone acknowledges (automatic paging stops after 24 h). A weekend with nobody on call pages the admins instead. On weekdays pages go to the channel, with a reminder every 30 min. API alerts with the same title as an unresolved incident join it instead of paging again. |
| **Reminders** | DM 24 hours before your weekend, a "you're on call now" DM when it starts, and a hand-off summary in the channel when it ends. |
| **Calendar** | Month view of who's on call, plus a feed you can subscribe to from Google Calendar. |
| **Audit log** | Every add, remove and swap, grouped by day, visible to the whole team. |
| **Ask an AI (optional)** | Off by default. Engineers type `/ping checkout is failing` in Slack and an AI looks into it and replies in a thread: what it thinks is wrong and what to do. Bring your own Claude API key and skill file, or hand requests to a Claude Code routine that can open a pull request. See [docs/ping.md](docs/ping.md). |
| **Your team only** | Google sign-in restricted to your Workspace domain. Personal Gmail and other companies are refused. |
| **Roles** | *Admin* and *Engineer* can be on call and respond. *Non-technical* teammates (leadership, support, product) can view everything and raise an alert, but are never put on call. |

<table>
<tr>
<td><img src="docs/images/calendar.jpg" alt="Calendar view"></td>
<td><img src="docs/images/audit-log.jpg" alt="Audit log"></td>
</tr>
<tr>
<td align="center">Calendar: two people per weekend, colour-coded</td>
<td align="center">Audit log: every add, remove and swap</td>
</tr>
</table>

![Incident with timeline](docs/images/incident.jpg)

<table>
<tr>
<td><img src="docs/images/app-on-call.jpg" alt="Phone app: your shift and the incidents that need you" width="200"></td>
<td><img src="docs/images/app-page.jpg" alt="Phone app: a page you answered, with the time it took to acknowledge" width="200"></td>
<td><img src="docs/images/app-compose.jpg" alt="Phone app: paging on-call, with a hold-to-call button" width="200"></td>
<td><img src="docs/images/app-schedule.jpg" alt="Phone app: the weekend schedule" width="200"></td>
</tr>
<tr>
<td align="center">On call</td>
<td align="center">A page you answered</td>
<td align="center">Page on-call</td>
<td align="center">Schedule</td>
</tr>
</table>

## Quick start (local)

Requires Node.js 22.13+ and Docker for the default local PostgreSQL (or bring your own PostgreSQL, below).

```bash
git clone https://github.com/PerDiemInc/pagerdiem && cd pagerdiem
./init.sh          # a few questions; starts PostgreSQL in Docker, writes .env, installs
npm start          # http://localhost:3000
npm test           # quick, in memory; npm run test:pg runs them on PostgreSQL
```

`./init.sh` asks for your company email domain, time zone, the days that need someone on call and how many people, and (optionally) your Slack details and the `/ping` AI check. It generates the session secret and API token for you, saves `.env` readable only by you, runs `npm install` and offers to start the app. Press Enter to accept any default. It never overwrites an existing `.env` unless you pass `--force`.

**PostgreSQL is the default database, and `init.sh` never asks about it.** It starts one in Docker for you (`docker compose up -d --wait db`, also `npm run db`). Use your own PostgreSQL with `./init.sh --database-url postgres://user:password@host:5432/dbname`. SQLite is only for a quick try without Docker and only if you ask: `./init.sh --sqlite` (or `DATABASE_PATH=data/pagerdiem.db`). `docker compose --profile app up` runs the database and the app together.

| Option | |
|---|---|
| `--yes` | Accept every default, ask nothing (good for scripts) |
| `--force` | Replace an existing `.env` |
| `--database-url URL` | Use your own PostgreSQL instead of the Docker one |
| `--sqlite` | Use a SQLite file instead of PostgreSQL (a quick try, not for real use) |
| `--no-install` | Skip `npm install` and starting PostgreSQL |
| `--env-file PATH` | Write somewhere other than `.env` |

It needs bash, so on Windows use WSL. Prefer to do it by hand? `cp .env.example .env`, edit it, `npm run db` (starts PostgreSQL), `npm install`, `npm start`.

Locally, without Google or Slack keys, PagerDiem uses email + password sign-in and runs Slack in
**dry-run mode**: every message is recorded under **Settings → Recent messages** instead of being
sent. The first person to sign up becomes an admin.

## Deploy

| Guide | What you get | Cost |
|---|---|---|
| [Render + Neon + Slack](docs/deploy-render-slack.md) | Easiest. Docker web service on Render, Postgres on Neon, the Slack app, Google sign-in. | Free tiers |
| [AWS (ECS Fargate + RDS)](docs/deploy-aws.md) | Always-on container behind a load balancer, managed Postgres, secrets in Secrets Manager. | About $35–45/month |

Run **exactly one instance**: the scheduler (reminders, escalation) runs inside the web process.

## Configuration

Everything company-specific is an environment variable. See [.env.example](.env.example).

| Variable | Required | Description |
|---|---|---|
| `ALLOWED_EMAIL_DOMAINS` | production | Your Google Workspace email domain(s), comma-separated, e.g. `example.com`. Set only here: change it and restart to change who can sign in. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | production | Google OAuth client (Web application). Without them, production lets nobody in. |
| `DATABASE_URL` | production | PostgreSQL connection string, required in production. Locally it defaults to the Docker database in `docker-compose.yml`. |
| `DATABASE_PATH` | | Opt into a SQLite file for a quick local try, e.g. `data/pagerdiem.db`. Production refuses to start with neither this nor `DATABASE_URL`. |
| `SESSION_SECRET` | production | Long random string (signs sessions; also derives the calendar feed link unless `CALENDAR_FEED_SECRET` is set) |
| `PING_ENABLED` | | Default `false`. Turns on the optional `/ping` AI check; also needs `ANTHROPIC_API_KEY` or a routine. See [docs/ping.md](docs/ping.md). |
| `ANTHROPIC_API_KEY`, `PING_SKILL_FILE`, `PING_MODEL` | | Your Claude API key, the file of instructions the AI follows (default `skills/ping.md`) and the model (default `claude-sonnet-5-5`) |
| `PING_CHECK_URLS` | | Comma-separated health URLs the check probes, e.g. `https://api.example.com/health` |
| `PING_COOLDOWN_SECONDS`, `PING_MAX_PER_DAY` | | One check at a time, this far apart (default `120`), and a daily cap (default `30`) |
| `PING_ROUTINE_URL`, `PING_ROUTINE_TOKEN` | | Hand `/ping` to a Claude Code routine instead of calling the API |
| `CALENDAR_FEED_SECRET` | | Secret behind the calendar feed link. Change it to revoke every existing link without logging anyone out. |
| `PORT` | | Default `3000` |
| `PUBLIC_URL` | | The app's public URL. Set automatically on Render. |
| `TEAM_NAME`, `APP_NAME` | | Shown on the sign-in page and calendar feed |
| `TEAM_TIMEZONE`, `SHIFT_START`, `SHIFT_END` | | Defaults: `America/New_York`, `FRI 18:00`, `MON 09:00`. These, and `PEOPLE_PER_WEEKEND`, are only the starting coverage: once an admin saves **Settings → On-call coverage**, the saved days, times and counts win. |
| `PEOPLE_PER_WEEKEND` | | Default `2` |
| `ON_CALL_DAYS`, `ON_CALL_START`, `ON_CALL_END` | | Days that need cover, e.g. `FRI,SAT,SUN`, and the shift's start and end time (`18:00`, `09:00`). Win over `SHIFT_START` / `SHIFT_END` when set. |
| `PEOPLE_ON_WEEKEND_DAYS`, `PEOPLE_ON_WEEKDAYS` | | People per shift on weekend days and on weekdays. Default `PEOPLE_PER_WEEKEND`. |
| `REMINDER_HOURS_BEFORE`, `REPAGE_EVERY_MINUTES`, `ESCALATE_AFTER_MINUTES` | | Defaults `24`, `5`, `15` |
| `SECOND_CALL_AFTER_MINUTES` | | Default `2`. When the phone app calls again, so the second call gets through Do Not Disturb. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_ENV`, `APNS_BUNDLE_ID` | for iPhone calls | Push keys for the phone app. See [Phone app](#phone-app). |
| `FCM_SERVICE_ACCOUNT` | for Android calls | Firebase service account JSON. See [Phone app](#phone-app). |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | for Slack | From your Slack app |
| `SLACK_ONCALL_CHANNEL` | for Slack | Channel ID for on-call posts (invite the bot) |
| `SLACK_ONCALL_CHANNEL_NAME` | | The channel's name, shown in messages (default `on-call`) |
| `SLACK_TEAM_ID` | production with Slack | Your Slack workspace ID. Requests from other workspaces are rejected. The app refuses to start in production with Slack connected and no workspace ID, unless `ALLOW_ANY_SLACK_WORKSPACE=true`. |
| `ALLOW_ANY_SLACK_WORKSPACE` | | `true` lets production run with Slack connected and no `SLACK_TEAM_ID`. Not recommended. |
| `SLACK_ENGINEERS_GROUP_ID` | | Slack user group (e.g. @engineers) tagged when an incident starts |
| `API_TOKEN` | | Bearer token for the HTTP API |
| `WHATSAPP_GROUP_URL` | | Optional team chat invite link, shown as a Join button |
| `KEEP_AWAKE` | | Self-ping every 10 min to stop free hosts from sleeping. On by default on Render. |

## Using it

- **Slack:** `/oncall` shows who's on call now and the next weekends. `/page checkout is down` pages them. `/page test call me checkout is down` calls only you with a test incident, and `/page test call everyone …` calls every engineer and admin; a test page calls once, never escalates and stays out of the channel. Optional `/ping checkout is failing` asks an AI to look into it and reply in a thread (off by default; bring your own Claude API key and skill, see [docs/ping.md](docs/ping.md)).
- **API:**

  ```bash
  curl -X POST "$PUBLIC_URL/api/incidents" \
    -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
    -d '{"title":"API 5xx spike","details":"p95 > 2s on /orders","source":"monitoring"}'

  curl "$PUBLIC_URL/api/oncall" -H "Authorization: Bearer $API_TOKEN"
  ```

  Point Sentry, Datadog, Grafana or CI alerts at `POST /api/incidents`.
- **Phone app:** see [Phone app](#phone-app) below.

## Phone app

The PagerDiem app (in [`mobile/`](mobile/), built with Expo) makes a page ring like a phone call,
next to the Slack DM.

- **Sign in** by scanning the **Phone app** code on the web Team page with the app. The code works
  once, for 10 minutes. You can also sign in with Google from the app.
- **When you're paged,** your phone rings with the incident as the caller. Answer to acknowledge:
  paging stops for everyone, and a notification opens the page. Nobody answering means a second
  call at 2 minutes (it gets through Do Not Disturb), then the normal escalation.
- **Wake-up checks** on the **You** tab make sure calls can reach you: notifications, Focus, and a
  test call (**Ring me now**).
- **Everything else on the go:** who's on call and for how long, page on-call (hold to call, or post
  in the channel without waking anyone), acknowledge, resolve, notes, the schedule, swaps and the team.

**Calls need the push keys of whoever publishes the app.** Set them on the server; without them,
calls are only logged as `dry-run` under **Settings → Recent messages**. Where to get each one is in
[docs/deploy-render-slack.md](docs/deploy-render-slack.md#6-phone-calls-optional).

| Variable | For |
|---|---|
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` | iPhone: an APNs key from Apple Developer, and its `.p8` contents |
| `APNS_ENV` | `production` (default) for TestFlight and App Store builds; `development` for Xcode builds |
| `APNS_BUNDLE_ID` | Only if your build uses another bundle id (default `com.tryperdiem.pagerdiem`) |
| `FCM_SERVICE_ACCOUNT` | Android: the Firebase service account JSON |

**Build your own.** Push keys belong to the app's publisher, so a team running its own PagerDiem
publishes its own build. The app's name, bundle id and Apple team come from the environment; see
[mobile/README.md](mobile/README.md) and the [release checklist](mobile/docs/release-checklist.md).

## How the rotation works

- The order is the **Team** page list; admins can reorder people, change roles or remove someone. Removing someone also signs them out and blocks sign-in until they're added back.
- Each weekend takes the next two engineers in order, so over a full cycle everyone gets the same number of weekends. The **Balance** box on the home page shows the counts.
- When a weekend starts, its picks are saved. Future weekends are projected from the last saved one, so people joining, leaving or being reordered never reshuffle past weekends.
- Adding yourself, removing yourself or swapping only changes that one weekend.
- The backup for a weekend is the first person on the next weekend who isn't already on call.

## Roles

Every person has one role, set by an admin on the **Team** page. The first person to sign up is an admin; everyone after starts as *non-technical* until an admin changes it.

| | Admin | Engineer | Non-technical |
|---|---|---|---|
| View the calendar, audit log and incidents | ✅ | ✅ | ✅ |
| Trigger an alert (web, `/page`, API) | ✅ | ✅ | ✅ |
| On the automatic rotation | optional | ✅ | never |
| Add or remove yourself, swap weekends | ✅ | ✅ | ❌ |
| Acknowledge or resolve incidents | ✅ | ✅ | ❌ |
| Open Team and Settings | ✅ | ✅ | ❌ |
| Change roles, reorder or remove people | ✅ | ❌ | ❌ |

Databases created before roles existed are migrated on first start: admins stay admin and everyone else becomes an engineer.

## Security model

- Production sign-in is Google only, restricted to `ALLOWED_EMAIL_DOMAINS` on a Workspace-managed account. Set the OAuth consent screen to **Internal** for a second lock at Google's end.
- Slack requests are verified with the signing secret and, with `SLACK_TEAM_ID`, restricted to your workspace.
- Each phone signed in to the app gets its own random token, stored only as a hash. Sign a phone out from the Team page or the app; removing someone signs out all their phones. Sign-in codes work once and expire after 10 minutes, and Google sign-in from the app only completes in the app that started it.
- The API requires a bearer token. The calendar feed uses an unguessable link; set a new `CALENDAR_FEED_SECRET` to revoke it, for example after someone leaves.
- See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Development

- Plain Node.js, no framework. The only runtime dependency is `pg`.
- The phone app lives in [`mobile/`](mobile/) (Expo, React Native). See [mobile/README.md](mobile/README.md).
- PostgreSQL is the database. The SQL also runs on SQLite, which keeps `npm test` fast and free of dependencies. `npm run test:pg` runs the same tests on the Docker PostgreSQL (against a separate `pagerdiem_test` database that it wipes).
- Tests: `npm test`, or against Postgres with `TEST_DATABASE_URL=postgres://… npm test` (wipes that database).

| File | What it does |
|---|---|
| `src/server.js`, `src/config.js` | Startup, the database connection, and every setting read from the environment |
| `src/db.js` | PostgreSQL (and SQLite) behind one small async API, plus schema and migrations |
| `src/time.js` | Shift windows in the team time zone (DST-safe), built from the covered days |
| `src/rotation.js` | Rotation, add/remove yourself, swaps, audit log |
| `src/incidents.js` | Page → re-page → backup → channel escalation |
| `src/scheduler.js` | Once a minute: reminders, weekend start/end, escalation, swap announcements |
| `src/settings.js` | On-call coverage: validation, presets, and the saved value an admin sets |
| `src/roles.js` | Admin, engineer and non-technical, and what each can do |
| `src/calendar.js` | The month grid and the Google Calendar feed |
| `src/ping.js` | The optional `/ping` AI check |
| `src/auth.js`, `src/google.js` | Sessions, and Google sign-in restricted to your Workspace |
| `src/actions.js` | Sign-up, profile, weekend, team and settings changes shared by the web and the phone app |
| `src/devices.js` | Phones signed in to the app: sign-in codes, tokens, push tokens and wake-up checks |
| `src/notify/` | Slack client, phone calls (APNs for iPhone, FCM for Android) and dry-run logging |
| `src/app.js` | Routes: web pages, Slack commands and buttons, API |
| `src/routes/app/`, `src/app-api.js` | The phone app's JSON API (`/api/app/*`): one file of routes per resource, and the shape of each reply |
| `mobile/` | The phone app |
| `src/views.js`, `src/http.js` | HTML pages and styles; routing and request handling |

CI runs the tests on Node 22 and 24 with SQLite, and on Postgres 16, plus the phone app's typecheck and Jest tests whenever `mobile/` changes. The project site in `docs/` is published to GitHub Pages by `.github/workflows/pages.yml`.

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Built at [Per Diem](https://tryperdiem.com) for our own weekend rotation.
