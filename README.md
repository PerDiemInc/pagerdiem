# PagerDiem 📟

A small PagerDuty-style on-call tool for the Per Diem engineering team. One person is on call each
weekend, the rotation moves on automatically, and pages reach the on-call person on **Slack and WhatsApp**.

- **Sign up** with your work email, your Slack account and your WhatsApp number. Only `@tryperdiem.com` emails can sign up by default.
- **Weekend rotation:** Friday 18:00 → Monday 09:00 (team time zone, configurable). Each weekend goes to the next person in the list.
- **Reminders:** the on-call person gets a Slack + WhatsApp heads-up 24h before their weekend, a "you're on call now" message when it starts, and the channel gets a hand-off summary when it ends.
- **Swaps:** anyone can swap a weekend from the dashboard. The swap only changes that weekend, and both people are told.
- **Paging:** start a page from the web app, from Slack (`/page checkout is down`) or from the API (Sentry, Coralogix, CI…).
  1. The on-call person is paged on Slack DM + WhatsApp, and the page is posted in `#on-call`.
  2. If nobody acknowledges, they're paged again every 5 min.
  3. After 15 min, the **backup** (next weekend's person) is paged too.
  4. After 30 min, the whole channel gets an `@channel` alert.
  5. On weekdays nobody is on call, so a page goes to the channel with `@here`.
- **Acknowledge** from the Slack button, by replying `ACK` on WhatsApp, with the link in the WhatsApp message, or in the web app. Reply `RESOLVE` to close it, or `WHO` to see who's on call.

Node 22.13+. Local runs use the built-in `node:sqlite`; the only package is `pg`, for Postgres in production.

## Run it locally

```bash
cp .env.example .env
npm start
```

Open http://localhost:3000 and sign up. The first person to sign up is an admin.
With no Slack or Twilio credentials the app runs in **dry-run mode**: every message is logged to the console and shown
under **Settings → Recent messages**, so you can try the whole flow first.

```bash
npm test
```

## Connect Slack

1. Go to https://api.slack.com/apps → **Create New App → From a manifest**, paste [slack-app-manifest.yml](slack-app-manifest.yml) after replacing `https://oncall.example.com` with your `PUBLIC_URL`.
2. Install it to the workspace. Copy the **Bot User OAuth Token** to `SLACK_BOT_TOKEN` and the **Signing Secret** to `SLACK_SIGNING_SECRET`.
3. Create (or pick) an on-call channel, run `/invite @PagerDiem` in it, and put its channel ID in `SLACK_ONCALL_CHANNEL`.

People are linked to Slack by the Slack email or member ID they enter when they sign up. Anyone who signed up during dry-run is linked automatically the next time the server starts with a Slack token.

## Connect WhatsApp (Twilio)

1. In Twilio, enable WhatsApp: the [WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) for testing, or a registered WhatsApp sender for real use.
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_FROM` (e.g. `whatsapp:+14155238886`).
3. On the WhatsApp sender, set **"When a message comes in"** to `POST {PUBLIC_URL}/whatsapp/incoming` so people can reply `ACK` / `RESOLVE` / `WHO`.

**About WhatsApp's 24-hour rule:** WhatsApp only delivers free-form messages to someone who messaged your number in the last 24 hours.
A page on a quiet Saturday night usually falls outside that window, so for production create two approved
templates in Twilio's Content Template Builder and set their Content SIDs:

| Env var | Example template | Variables |
|---|---|---|
| `TWILIO_PAGE_TEMPLATE_SID` | `🚨 PagerDiem incident #{{1}}: {{2}}. Acknowledge: {{3}}` | id, title, acknowledge link |
| `TWILIO_SHIFT_TEMPLATE_SID` | `📟 You're on call from {{1}} to {{2}}. Keep notifications on.` | start, end |

With the sandbox, each person must first send the sandbox join code to the sandbox number.

## Page from monitoring tools

Set `API_TOKEN`, then:

```bash
curl -X POST "$PUBLIC_URL/api/incidents" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"API 5xx spike","details":"p95 > 2s on /orders","source":"coralogix"}'
```

`GET /api/oncall` returns who's on call now and next (no auth, names only).

## Deploy (free: Render + Neon)

The app needs a database that survives restarts and a server that doesn't sleep, so the free setup is:

1. **Database:** create a free project at https://neon.tech and copy its connection string (`postgresql://…?sslmode=require`).
2. **App:** in https://dashboard.render.com choose **New → Blueprint**, pick this repo, and paste the Neon string when asked for `DATABASE_URL`. [render.yaml](render.yaml) sets up the rest, including generated `SESSION_SECRET` and `API_TOKEN` values.
3. Render's free plan sleeps after 15 idle minutes. The app pings its own URL every 10 minutes to stay awake (`KEEP_AWAKE`, on by default on Render). A free UptimeRobot check on `/healthz` is a good backup.
4. Add the Slack and Twilio values under **Environment** in Render when you're ready, and use the Render URL as `PUBLIC_URL` in the Slack manifest and the Twilio webhook.

With `DATABASE_URL` set the app uses Postgres; without it, it uses a local SQLite file. Run the tests against Postgres with `TEST_DATABASE_URL=postgres://… npm test` (it wipes that database).

Docker also works anywhere with a persistent volume:

```bash
docker build -t pagerdiem .
docker run -d -p 3000:3000 -v pagerdiem-data:/data --env-file .env pagerdiem
```

## How the rotation works

- The order is the **Team** page list. Admins can move people up and down or take them out of the rotation.
- When a weekend starts, who's on call is saved. Future weekends are worked out from the last saved weekend, so people joining, leaving or being reordered never skips anyone or changes past weekends.
- Swaps replace the person for one weekend only; the next weekend still goes to whoever was next.
- The backup for a weekend is next weekend's person.

## Code map

| File | What it does |
|---|---|
| `src/time.js` | Weekend shift windows in the team time zone (DST-safe) |
| `src/rotation.js` | Who's on call each weekend, swaps, ordering |
| `src/incidents.js` | Page → re-page → backup → channel escalation, acknowledge, resolve |
| `src/scheduler.js` | Every minute: reminders, shift start/end messages, escalation |
| `src/notify/` | Slack and Twilio WhatsApp clients, dry-run logging |
| `src/app.js` | Web pages, Slack commands and buttons, WhatsApp replies, API |
| `src/views.js` | HTML pages |
