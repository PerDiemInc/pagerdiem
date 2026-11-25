# PagerDiem phone app: design spec

Visual design (source of truth for layout, colour, type and copy): the "PagerDiem Mobile" canvas,
https://claude.ai/artifact/2c9yyuvF24tixP8kouskQp (version 19, 14 screens, light and dark).
This file records what the canvas can't show: decisions, behaviour, and the server contract.

## Why

Slack DMs don't wake anyone at 3 AM. The phone app makes a page ring like a phone call, even on
silent and in Sleep Focus, and lets people do on the phone everything they can do on the web.

## Decisions

- **D1 Answering the call acknowledges the page** (the user's choice, "option A"). Ringing is the
  alarm. Answering stops paging for everyone, then the app goes to the page. No audio is sent.
  iOS never brings an app forward from a call, so a notification ("Acknowledged · {title}",
  "Paging stopped. Tap to open.") confirms it and opens the page when tapped (checked on an iPhone
  on 2026-11-24).
  The canvas's "Slide to acknowledge" is for opening a page without taking the call (from a
  missed-page notification, the lock screen or the app).
- **D2 Declining or missing the call does not acknowledge.** Paging carries on as it does today. The
  phone shows "Missed page" and the next call time.
- **D3 Calls are sent alongside Slack, never instead of it.** Every page still DMs on Slack. People
  without the app get exactly what they get today.
- **D4 A second call goes out 2 minutes after the first page** (phone only, no extra Slack DM), so iOS
  "Repeated Calls" and Android's repeat-caller rule can get through Do Not Disturb. After that, the
  existing schedule applies: call again every 5 min, backup at 15 min, @channel at 30 min.
- **D5 Same first-acknowledgement-wins rule as web and Slack.** Every app action goes through
  `incidents.acknowledge` and `incidents.resolve`.
- **D6 Connect by QR code.** The web Team page shows a "Phone app" code holding
  `pagerdiem://connect?server=<PUBLIC_URL>&code=<pairing code>`. Scanning it signs the phone in
  as that person. Fallback: type the server address, then "Sign in with Google" in a browser
  sheet. That flow is bound to the app the same way OAuth PKCE is: the app sends a challenge, and the
  code that comes back only works with the app's verifier. The canvas says "go to You". The web app has no You page, so the copy is "go to Team".
- **D7 One app for every self-hosted team.** The server address is per install. The app stores
  `server` and a device token per sign-in. The app's name, icon and bundle id are PerDiem's:
  `com.tryperdiem.pagerdiem`, URL scheme `pagerdiem`.
- **D7a The push keys belong to whoever publishes the app.**
  - The App Store and Play builds are PerDiem's, under the Apple team "Per Diem Subscriptions, Inc." (`NDXNQ5M4K4`), and work with PerDiem's own pagerdiem.
  - Another team self-hosting pagerdiem builds `mobile/` under its own Apple team and Firebase project. Bundle id, name and scheme come from env in `app.config.ts`.
  - A shared push relay for other teams is a later option, not v1.
- **D8 The server stays zero-dependency** (only `pg`). APNs runs over `node:http2`, FCM over `fetch`, JWTs
  are signed with `node:crypto`, and the QR encoder is vendored.
- **D9 Push credentials are optional.** Without them, calls are logged as `dry-run` in Recent
  messages, the same way Slack works locally. They never block startup.
- **D10 Post-only incidents.** In Compose, "Post in #on-call" creates an incident that nobody is called
  about and that never escalates. "Hold to call" pages as today.
- **D11 Whoever pages skips themselves.** If the creator is on call and someone else is too, only
  the others are paged. If the creator is the only one on call, they are paged as today.
- **D12 Quick picks are the team's 3 most recent incident titles**, not hard-coded PerDiem strings
  (pagerdiem is open source).
- **D13 "Open Slack" opens the #on-call channel** for v1. Thread links come later.
- **D14 Live Activity ships after v1**, once the ring is proven on real phones.
- **D15 Push routes, confirmed by Saad on 2026-11-24.**
  - Android: Firebase (FCM).
  - iPhone: Apple's push service directly, with VoIP pushes and CallKit.
  - No WebRTC and no audio.
  - Neither route needs special approval: Critical Alerts are not used.
- **D16 Store review.**
  - App Review expects VoIP pushes to be real incoming calls. The review notes say every VoIP push is a real incoming page call, answering it acknowledges the page, and no audio is needed.
  - If Apple rejects that, iPhone falls back to Time Sensitive alerts with an Acknowledge button. That's the same Apple sender with `apns-push-type: alert` instead of `voip`.
  - On Google Play, the full-screen call permission (Android 14 and later) needs the Play Console declaration as an alarm-style app.

## Paging timeline (weekend, someone on call)

| When | What happens |
|---|---|
| 0 min | Call every on-call phone and DM them on Slack. Post in #on-call. |
| 2 min | Call the same phones again ("rings through Do Not Disturb"). Phone only. |
| every 5 min | Call and DM again (existing `REPAGE_EVERY_MINUTES`). |
| 15 min | Call and DM the backup (existing `ESCALATE_AFTER_MINUTES`). |
| 30 min | @channel in #on-call, then keep calling everyone. |

On weekdays nobody is called. The behaviour stays as it is today (channel reminders).

## On the phone

- **The call** (iOS CallKit, Android full-screen call notification). The caller name is the incident title.
  The handle is "Incident #14". The call rings for up to 45 s.
  - Answer: acknowledges (D1), goes to the Page screen, and posts the "Acknowledged" notice that
    opens it ("Already acknowledged" if someone was first, "Couldn't acknowledge" after retries).
  - Decline or timeout: ends the call and posts a local "Missed page" notification naming the next
    call time.
  - While ringing, the phone checks the incident every 3 s. If someone else acknowledges or resolves it,
    the call ends ("answered elsewhere").
- **Lock screen and Live Activity (after v1):** shift time left, or the live page with Acknowledge.
- **Screens.** The canvas sets content, states and copy. The tweaks in brackets are the canvas states
  each screen must support.
  - Welcome, Connect, Sign in, About you [errors]
  - Wake-up checks [iPhone or Android]
  - On call [you, someone else or nobody on call; weekday; Focus may silence calls]
  - Incidents [empty; swipe to acknowledge or resolve]
  - Incident [open, acknowledged or resolved; tabs Activity, Who it reached, Escalation; note box]
  - Page [open, acknowledged by you, someone else has it, resolved]
  - Compose sheet [sent]
  - Schedule [your weekends: swap, leave, ask for cover; others: take; undo 10 s]
  - Team [admin view]
  - You [admin view: coverage, resend weekend message]
  - Activity
- **Ring settings live on the phone.** Ringtone (Loud and rising, Normal call, Short beeps that get
  louder), Ring at full volume (Android only), Vibrate.

## Server contract (`/api/app/*`)

These are JSON in and out. Errors come back as `{ "error": string, "field"?: string }` with
status 400, 401, 403, 404 or 409.
Every route except `pair` and `signup` needs `Authorization: Bearer <device token>`. A revoked device
or a removed teammate gets 401.

```ts
type Role = 'admin' | 'engineer' | 'non_technical';
type Person = { id: number; name: string; initials: string; role: Role };
type Coverage = { days: number[]; start: string; end: string; weekendCount: number; weekdayCount: number };
type DeviceChecks = { notifications: boolean; focus: boolean; ringer: boolean; fullScreen: boolean; dndAccess: boolean };
type Device = { id: number; platform: 'ios' | 'android'; pushReady: boolean; testedAt: string | null; checks: DeviceChecks };
type Team = { appName: string; teamName: string; timezone: string; publicUrl: string; slackChannelName: string };
type Me = { user: Person & { email: string; slack: string | null; phone: string }; team: Team;
            coverage: Coverage; calendarFeedUrl: string; device: Device };
type Weekend = { key: string; start: string; end: string; people: Person[]; count: number; needsCover: boolean; mine: boolean };
type OnCall = { people: Person[]; start: string; until: string; backup: Person | null };
type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
type IncidentSummary = { id: number; title: string; status: IncidentStatus; source: string; quiet: boolean;
  createdAt: string; createdBy: Person | null; assigned: Person | null; ackedBy: Person | null;
  ackedAt: string | null; resolvedAt: string | null; repeats: number };
type FeedItem = { at: string; kind: 'event' | 'note'; text: string; author: Person | null };
type Reach = { at: string; channel: 'slack' | 'push'; recipient: string; status: 'sent' | 'failed' | 'dry-run' };
type EscalationStep = { at: string; label: string; state: 'done' | 'next' | 'later' | 'skipped' };
type TeamMember = Person & { email: string; phone: string; slack: string | null; order: number;
  nextWeekend: string | null; app: 'woken' | 'focus-risk' | 'none' };
type ActivityItem = { at: string; text: string; via: 'web' | 'slack' | 'app' | 'api' | null;
  icon: 'ack' | 'resolve' | 'join' | 'leave' | 'swap' | 'cover' | 'team' | 'settings' | 'test' };
type Done = { ok: true; message: string; undo?: { ids: number[]; until: string } };
```

| Method and path | Body | Response |
|---|---|---|
| POST `/api/app/pair` | `{ code, platform, deviceName, verifier? }` | `{ token, me: Me }` |
| POST `/api/app/signup` | `{ pending, name, slack, phone, platform, deviceName, verifier }` | 201 `{ token, me: Me }` |
| POST `/api/app/signout` | none | 204 |
| GET `/api/app/me` | none | `Me` |
| POST `/api/app/device` | `{ pushToken?, checks? }` | `Device` |
| POST `/api/app/device/test-call` | none | `{ callId }` |
| POST `/api/app/device/test-call/answered` | `{ callId }` | `Device` |
| GET `/api/app/home` | none | `{ now, onCall: OnCall \| null, next: Weekend \| null, needsYou: IncidentSummary[], comingUp: Weekend[] }` |
| GET `/api/app/incidents?status=` | none | `{ incidents: IncidentSummary[], stats, recentTitles: string[] }` |
| GET `/api/app/incidents/:id` | none | `{ incident: IncidentSummary & { details, backup, escalationLevel }, feed: FeedItem[], reached: Reach[], escalation: EscalationStep[], onCall: Person[] }` |
| POST `/api/app/incidents` | `{ title, details, mode: 'call' \| 'post' }` | 201 `{ incident: IncidentSummary, paged: Person[] }` |
| POST `/api/app/incidents/:id/ack` | `{ via: 'call' \| 'app' }` | `{ changed, incident: IncidentSummary }` |
| POST `/api/app/incidents/:id/resolve` | none | `{ changed, incident: IncidentSummary }` |
| POST `/api/app/incidents/:id/notes` | `{ text }` | 201 `FeedItem` |
| POST `/api/app/incidents/:id/call-again` | none | `Done` |
| POST `/api/app/incidents/:id/call-backup` | none | `Done` |
| GET `/api/app/schedule` | none | `{ coverage: Coverage, weekends: Weekend[] }` (next 12) |
| POST `/api/app/weekends/:key/join`, `/leave`, `/ask-cover` | none | `Done` |
| POST `/api/app/weekends/:key/swap` | `{ userId }` (take their spot on this weekend) | `Done` (with `undo`) |
| POST `/api/app/weekends/:key/trade` | `{ theirKey, userId }` (you take theirs, they take yours) | `Done` (with `undo`) |
| POST `/api/app/swaps/undo` | `{ ids }` | `Done` |
| GET `/api/app/team` | none | `{ members: TeamMember[], inactive: TeamMember[], signupUrl }` |
| POST `/api/app/team/:id/role`, `/active`, `/move` | `{ role }`, `{ active }`, `{ dir }` | `Done` (admin) |
| POST `/api/app/profile` | `{ name, slack, phone }` | `Me` |
| POST `/api/app/coverage` | `Coverage` | `Done` (admin) |
| POST `/api/app/resend-weekend-start` | none | `Done` (admin) |
| GET `/api/app/activity` | none | `{ items: ActivityItem[] }` (last 200) |

**Push payload** (APNs VoIP body and FCM `data`; FCM values are all strings):
`{ type: 'page' | 'test' | 'cancel', callId, incidentId, title, reason, pagedBy, attempt, nextCallAt, server, sentAt }`.
- `cancel` is sent on Android only, to stop ringing when someone else acknowledges.
- On iOS every VoIP push must report a CallKit call, so iOS learns about a cancel by checking the incident
  while ringing.
- A push is dropped if it isn't delivered within 60 s (APNs `apns-expiration`, FCM `ttl`). A stale ring
  is worse than none.

## Copy rules

Sentence case, plain words, no jargon. The canvas copy wins. Times are shown in the team's timezone
(`Team.timezone`), not the phone's.

## Later (not in v1)

Live Activity (D14), Slack thread links (D13), Critical Alerts entitlement (only if the ring spike
shows CallKit can't get through Sleep Focus), iPad layout.
