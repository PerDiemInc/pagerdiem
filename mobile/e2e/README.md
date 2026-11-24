# Trying the app against a local PagerDiem

The `e2e/` scripts run a real PagerDiem server on this machine with a seeded team, so the app can be
driven end to end: on the iOS Simulator, or on a phone on the same network.

## Start the server

```bash
node e2e/server.mjs
```

It wipes and seeds a SQLite database in the system temp folder: Acme Engineering in New York time,
engineers Ben, Ana, Eli, Hana, Cal and Dee, admin Iris, and a few open and resolved incidents. Slack is
dry-run (messages are printed). It listens on port 3000 and prints sign-in links for Ben and Iris.

To make calls really ring, give it the push keys first (never commit them):

```bash
export APNS_KEY_ID=… APNS_TEAM_ID=… APNS_ENV=development
export APNS_PRIVATE_KEY="$(cat /path/to/AuthKey_….p8)"
export FCM_SERVICE_ACCOUNT="$(cat /path/to/firebase-service-account.json)"
node e2e/server.mjs
```

`APNS_ENV=development` is for builds installed from Xcode or the simulator; TestFlight and the App
Store use `production`.

## Sign a phone in

```bash
node e2e/pair.mjs ben            # a pagerdiem://connect link for the iOS Simulator (localhost)
node e2e/pair.mjs ben android    # the same for the Android emulator (10.0.2.2)
```

Open the link on the simulator with `xcrun simctl openurl booted "<link>"`. Links last 10 minutes.

A physical phone can't reach `localhost`: make a link with this machine's network address as the
server (for example `http://192.168.1.20:3000`) and show it as a QR code to scan with the app. Debug
builds accept plain `http://` only for local network addresses; release builds always use https.

## Page someone

```bash
curl -X POST localhost:3000/api/incidents -H 'Authorization: Bearer e2e-token' \
  -H 'Content-Type: application/json' -d '{"title":"Checkout failing","details":"Testing"}'
```

The same title again within the grouping window is treated as a repeat of the open incident, so use a
new title for each test page.

## What the iOS Simulator can and can't show

VoIP pushes reach the simulator, and the app reports the call to CallKit, but the simulator has no
incoming-call screen: answering, the ringtone and ringing while locked can only be checked on an
iPhone (see `docs/release-checklist.md`).
