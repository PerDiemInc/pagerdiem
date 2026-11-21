# PagerDiem 📟

A small, self-hosted, PagerDuty-style on-call tool for one engineering team. Each weekend gets two
people from a fair rotation, anyone can add themselves, and pages reach whoever is on call on
**Slack and WhatsApp**. Sign-in is limited to your company's Google Workspace.

Built at [Per Diem](https://tryperdiem.com) for our own weekend rotation, and open-sourced so any team can run it.

## Features

- **Your team only:** sign in with Google, limited to your Google Workspace email domain (`ALLOWED_EMAIL_DOMAINS`). Personal Gmail and other companies' accounts are refused. New teammates add their own Slack account and WhatsApp number; no two people can share either.
- **Weekend rotation:** by default Friday 18:00 → Monday 09:00 in your time zone. The rotation puts **2 people** on each weekend (`PEOPLE_PER_WEEKEND`), taking turns so everyone gets the same number of weekends. Admins are optional: they aren't assigned automatically but can add themselves.
- **Self-service:** anyone can **add themselves** to any weekend (no limit) and **remove themselves** from one. A weekend with fewer than 2 people is flagged "needs cover".
- **Swap:** on the calendar, "Swap" next to someone's name takes their spot. You can undo it for 10 seconds; they and Slack are told only after that.
- **Audit log:** every add, remove and swap, grouped by date, visible to the whole team.
- **Calendar:** month view plus a feed you can subscribe to in Google Calendar.
- **Reminders:** each on-call person gets a Slack and WhatsApp heads-up 24 hours before, and a message when the weekend starts. The channel gets a hand-off summary when it ends.
- **Paging:** from the web app, Slack (`/page checkout is down`) or the API (Sentry, Coralogix, CI…).
  1. Everyone on call is paged by Slack DM and WhatsApp, and the page is posted in your on-call channel.
  2. If nobody acknowledges, they're paged again every 5 minutes.
  3. After 15 minutes the **backup** (next weekend's first person) is paged too.
  4. After 30 minutes the whole channel gets an `@channel` alert.
  5. On weekdays nobody is on call, so a page goes to the channel with `@here`.
- **Acknowledge** from the Slack button, by replying `ACK` on WhatsApp, with the link in the WhatsApp message, or in the web app. `RESOLVE` closes an incident and `WHO` shows who's on call.

Node 22.13+. Local runs use the built-in `node:sqlite`; the only package is `pg`, for Postgres in production.

## Run it locally

```bash
cp .env.example .env
npm start
```

Open http://localhost:3000 and sign up (locally, without Google keys, it uses email + password). The first person to sign up is an admin.
With no Slack or Twilio credentials the app runs in **dry-run mode**: messages are logged to the console and shown under **Settings → Recent messages**.

```bash
npm test
```

## Configuration

Everything about your company lives in environment settings; nothing is hard-coded. See [.env.example](.env.example) for the full list.

| Setting | Required | What it is |
|---|---|---|
| `ALLOWED_EMAIL_DOMAINS` | in production | Your Google Workspace email domain(s), e.g. `example.com` |
| `TEAM_NAME` | | Shown on the sign-in page and calendar feed, e.g. `Example Engineering` |
| `APP_NAME` | | Defaults to `PagerDiem` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | in production | Google sign-in (below) |
| `DATABASE_URL` | in production | Postgres connection string |
| `SESSION_SECRET` | in production | Long random string |
| `PUBLIC_URL` | | The app's public address (set automatically on Render) |
| `TEAM_TIMEZONE`, `SHIFT_START`, `SHIFT_END` | | Defaults `America/New_York`, `FRI 18:00`, `MON 09:00` |
| `PEOPLE_PER_WEEKEND` | | Defaults to `2` |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_ONCALL_CHANNEL`, `SLACK_TEAM_ID` | | Slack (below) |
| `TWILIO_*` | | WhatsApp (below) |
| `WHATSAPP_GROUP_URL` | | Your team's WhatsApp group invite link, shown as a Join button to signed-in teammates |
| `API_TOKEN` | | Bearer token for the API |

## Google sign-in (required in production)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), under your company's organization, set the **OAuth consent screen** audience to **Internal**. Google then only lets your Workspace accounts sign in.
2. **Create credentials → OAuth client ID → Web application.** Add the redirect URI `{PUBLIC_URL}/auth/google/callback`.
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

The app also checks every sign-in itself: a verified email on one of `ALLOWED_EMAIL_DOMAINS`, on a Workspace-managed account. Without Google keys, production shows "Sign-in isn't set up yet" and lets nobody in.

## Connect Slack

1. https://api.slack.com/apps → **Create New App → From a manifest**, paste [slack-app-manifest.yml](slack-app-manifest.yml) after replacing `https://YOUR-APP.example.com` with your `PUBLIC_URL`.
2. Install it to your workspace (the manifest turns on the app's Messages tab, which Slack requires for DMs). Copy the **Bot User OAuth Token** to `SLACK_BOT_TOKEN` and the **Signing Secret** (Basic Information) to `SLACK_SIGNING_SECRET`.
3. Pick an on-call channel, run `/invite @PagerDiem` in it, and put its channel ID in `SLACK_ONCALL_CHANNEL`.
4. Set `SLACK_TEAM_ID` to your workspace ID (it starts with `T`) so requests from any other workspace are rejected.

## Connect WhatsApp (Twilio)

1. In Twilio, enable WhatsApp: the [Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) for testing, or a registered sender for real use.
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_FROM` (e.g. `whatsapp:+14155238886`).
3. On the sender, set **"When a message comes in"** to `POST {PUBLIC_URL}/whatsapp/incoming` so people can reply `ACK` / `RESOLVE` / `WHO`.

**WhatsApp's 24-hour rule:** WhatsApp only delivers free-form messages to someone who messaged your number in the last 24 hours. For pages outside that window, create two approved templates in Twilio's Content Template Builder:

| Setting | Example template | Variables |
|---|---|---|
| `TWILIO_PAGE_TEMPLATE_SID` | `🚨 Incident #{{1}}: {{2}}. Acknowledge: {{3}}` | id, title, acknowledge link |
| `TWILIO_SHIFT_TEMPLATE_SID` | `📟 You're on call from {{1}} to {{2}}. Keep notifications on.` | start, end |

The WhatsApp business API can't post into WhatsApp groups, so pages go to each person directly. `WHATSAPP_GROUP_URL` only adds a "Join the group" button.

## API

```bash
# Page whoever is on call
curl -X POST "$PUBLIC_URL/api/incidents" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"API 5xx spike","details":"p95 > 2s on /orders","source":"monitoring"}'

# Who's on call now and next
curl "$PUBLIC_URL/api/oncall" -H "Authorization: Bearer $API_TOKEN"
```

## Deploy for free (Render + Neon)

1. **Database:** create a free project at https://neon.tech and copy its connection string (`postgresql://…?sslmode=require`).
2. **App:** on https://dashboard.render.com create a **Web Service** from your fork (Docker, Free plan), or use **New → Blueprint** with [render.yaml](render.yaml). Set the settings above; Render's **Generate** button works for `SESSION_SECRET` and `API_TOKEN`.
3. Render's free plan sleeps after 15 idle minutes, which would delay reminders and escalation. The app pings its own URL every 10 minutes to stay awake (`KEEP_AWAKE`, on by default on Render).

With `DATABASE_URL` set the app uses Postgres; without it, a local SQLite file. Run the tests against Postgres with `TEST_DATABASE_URL=postgres://… npm test` (it wipes that database).

Docker works anywhere with a persistent volume:

```bash
docker build -t pagerdiem .
docker run -d -p 3000:3000 -v pagerdiem-data:/data --env-file .env pagerdiem
```

## How the rotation works

- The order is the **Team** page list; admins can reorder people or take them out.
- Each weekend takes the next 2 non-admin people in order, so over a full cycle everyone gets the same number of weekends. The **Balance** box on the home page shows the counts.
- When a weekend starts, the rotation's picks are saved. Future weekends are worked out from the last saved one, so people joining, leaving or being reordered never skips anyone or changes past weekends.
- Adding yourself, removing yourself or swapping changes only that weekend.

## Code map

| File | What it does |
|---|---|
| `src/time.js` | Weekend windows in the team time zone (DST-safe) |
| `src/rotation.js` | Who's on call each weekend, add/remove yourself, swaps, audit log |
| `src/incidents.js` | Page → re-page → backup → channel escalation, acknowledge, resolve |
| `src/scheduler.js` | Every minute: reminders, weekend start/end messages, escalation, swap announcements |
| `src/google.js` | Google sign-in limited to your Workspace domain |
| `src/notify/` | Slack and Twilio WhatsApp clients, dry-run logging |
| `src/app.js` | Web pages, Slack commands and buttons, WhatsApp replies, API |
| `src/views.js` | HTML pages |

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
