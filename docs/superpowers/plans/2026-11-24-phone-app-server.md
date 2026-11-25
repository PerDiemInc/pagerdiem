# Phone app: server side, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give pagerdiem everything the phone app needs: phone sign-in, a JSON API for every screen, and pages that ring phones through APNs VoIP and FCM.

**Architecture:**
- Web routes in `src/app.js` mix rules with flash-and-redirect. The rules move into `src/members.js` and `src/actions.js`, so web routes and a new `src/app-api.js` share them.
- Phones authenticate with a per-device bearer token stored hashed in a new `devices` table.
- `notify.call()` sends calls next to the existing Slack DMs, through two zero-dependency senders (`src/notify/apns.js`, `src/notify/fcm.js`).

**Tech Stack:** Node ≥ 22.13 (ES modules), the repo's own router (`src/http.js`), SQLite (`node:sqlite`) and Postgres (`pg`), `node:test`, `node:http2`, `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-11-24-phone-app-design.md` (decisions D1–D14, the `/api/app/*` contract, the push payload). The phone app's own plan is `docs/superpowers/plans/2026-11-24-phone-app-mobile.md`. It consumes this contract.

## Global Constraints

- **Gate: passed.** Doron agreed to the phone app on 2026-11-24.
- **Testing:** test on a local pagerdiem on the Mac, with fake seed data. Never test against production pagerdiem: a test page there would wake the real team.
- **Branch:** `feature/phone-app-server`, cut from `origin/main`. Local `main` is old history that `origin/main` no longer shares.
  - Draft PR only.
  - Commit only when Saad has said to for this run.
  - No co-author or "generated with" lines.
- **Dependencies:** no new runtime dependencies. `package.json` `dependencies` stays `{ "pg": … }`. The QR encoder is vendored, with its MIT licence header (D8).
- **SQL:**
  - Only the `?`-placeholder subset both SQLite and Postgres understand.
  - New tables go into `SQLITE_SCHEMA` in `src/db.js` as `CREATE TABLE IF NOT EXISTS`. `PG_SCHEMA` is derived from it.
  - New columns on existing tables use the same "check, then `ALTER TABLE`" pattern as `role`, for both dialects.
- **Tests:** every task passes `npm test` (SQLite) and `npm run test:pg` (`npm run db` first).
  - Incident and scheduler behaviour goes in `test/core.test.js`.
  - Web route behaviour goes in `test/http.test.js`.
  - The new modules get `test/app-api.test.js` and `test/push.test.js`.
  - No tests on log lines, and no test-only hooks. Inject collaborators the way `createApp` already takes `pingFetch`.
- **Push credentials are optional (D9).** Missing or partial config logs one `console.warn` at startup and falls back to `dry-run`. It never throws.
- **Copy:** sentence case and plain words. When the canvas has the copy, the canvas copy wins.
- **API errors:** JSON `{ error, field? }`. The existing `handle()` already does this for `/api/*`, and `/api/*` is already exempt from the same-origin check.

## Review Focus

1. **Two people act on one page at once.** For example, one answers the call while another taps Acknowledge in Slack. The response is 200 `{ changed: false }`, not an error, and #on-call hears it once. Test in Task 7.
2. **A phone that was wiped or reinstalled.** APNs 410 or `BadDeviceToken`, or FCM `UNREGISTERED`, clears that device's `push_token`. The next page skips it instead of failing again every 5 min. Test in Task 5.
3. **A removed teammate, or a phone that was signed out.** Its token gets 401 on every `/api/app/*` route at once, including routes that only read. Test in Task 2.
4. **A pairing code that is reused or older than 10 minutes.** It gets 401 "This code has expired or was already used. Make a new one on the Team page." Test in Task 2.
5. **A page while nobody has the app.** Slack paging behaves exactly as before. No push rows are written, and no "called again" event appears. Test in Task 5.

---

### Task 1: Move member and team rules out of `app.js` (no behaviour change)

**Files:**
- Create: `src/members.js`, `src/actions.js`
- Modify: `src/app.js`. Its `createMember`, `contactClash`, `resolveSlack`, `rosterChange`, swap and undo routes, `announceSwaps`, the `/team/:id/*` routes, `/profile`, `/settings/coverage` and `/admin/resend-weekend-start` delegate to the new modules.
- Test: `test/core.test.js` (new tests), plus the existing `test/http.test.js` unchanged as the regression net.

**Interfaces:**
- Produces `makeMembers({ db, rotation, notify })`, returning:
  - `createMember({ name, email, slack, whatsapp, passwordHash })` → `{ user, isFirst } | { error: { field, message } }`
  - `contactClash({ slackId, whatsapp, exceptId })` → `{ field, message } | null`
  - `resolveSlack(value, fallbackEmail)` → `Promise<string | null>`
  - `updateProfile(user, { name, slack, phone })` → `{ user } | { error: { field, message } }`
- Produces `makeActions({ db, shifts, rotation, notify, scheduler, members })`. Every function takes the acting `user` first and `via` (`'web' | 'app'`) last, and returns `{ message, undo? }`. A rule violation throws `HttpError(status, message)`.
  - `joinWeekend(user, key, via)`
  - `leaveWeekend(user, key, via)`
  - `swapWeekend(user, key, replacedId, via)`. Its `undo` is `{ ids: [swapId], until }`, where `until` is ISO.
  - `undoSwap(user, ids, via)`. The web route passes `[id]`.
  - `announceSwaps(now)`
  - `setActive(user, targetId, active, via)`
  - `setRole(user, targetId, role, via)`
  - `moveMember(user, targetId, dir, via)`
  - `saveCoverage(user, input, via)`
  - `resendWeekendStart(user, via)`
  - Admin-only actions throw 403 "Only admins can do that".

- [ ] **Step 1:** Cut the branch: `git fetch origin && git switch -c feature/phone-app-server origin/main`. Run `npm ci && npm test`. Expected: all tests pass.
- [ ] **Step 2: Write failing tests in `test/core.test.js`.**
  ```js
  test('actions: leaving a weekend returns the message the web flashes and posts once', async () => {
    // setup(); addUsers('Ana','Ben','Cal'); actions = makeActions({...}) for 2026-11-27
    const r = await actions.leaveWeekend(ana, '2026-11-27', 'app');
    assert.match(r.message, /^You're off /);
    assert.equal(sent.filter((m) => m.to === 'CONCALL').length, 1);
  });
  test('actions: the last admin cannot be removed or demoted', async () => {
    await assert.rejects(actions.setActive(admin, admin.id, false, 'app'), { status: 409, message: /at least one admin/ });
    await assert.rejects(actions.setRole(admin, admin.id, 'engineer', 'app'), { status: 409 });
  });
  test('actions: non-admins get 403 from admin actions', async () => {
    await assert.rejects(actions.saveCoverage(engineer, { days: [5, 6, 0], start: '18:00', end: '09:00' }, 'app'), { status: 403 });
  });
  ```
- [ ] **Step 3:** Run `node --test --test-concurrency=1 test/core.test.js`. Expected: FAIL, because `makeActions` is not defined.
- [ ] **Step 4:** Implement both modules by moving code out of `app.js`. Web routes keep their exact flash text and redirects: they catch `HttpError` from an action and flash its message where they flash an error today. The "at least one admin" cases become 409.
- [ ] **Step 5:** Run `npm test && npm run test:pg`. Expected: PASS, with every existing http test unchanged.
- [ ] **Step 6:** Commit: `refactor: move member and team rules out of app.js so the phone API can share them`.

### Task 2: Devices, pairing codes and bearer auth

**Files:**
- Modify: `src/db.js` (add the `devices` table), `src/app.js` (`handle()` resolves a bearer user for `/api/app/*`; call `registerAppApi`)
- Create: `src/devices.js`, `src/app-api.js`
- Test: `test/app-api.test.js` (new; same `before` and `after` server pattern as `test/http.test.js`)

**Interfaces:**
- Table:
  ```sql
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
    platform TEXT NOT NULL CHECK (platform IN ('ios','android')), name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, push_token TEXT, checks TEXT NOT NULL DEFAULT '{}',
    tested_at TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT);
  CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
  ```
- Produces `makeDevices(db)`, returning:
  - `create(userId, { platform, name })` → `{ device, token }`. `token` is 32 random bytes as base64url. Only its sha256 hex is stored.
  - `authenticate(token)` → `{ device, user } | null`. It returns null when the device is revoked or the user is inactive. It updates `last_seen_at` only when the stored value is more than 1 h old.
  - `update(id, { pushToken, checks })` → device
  - `forUser(userId)` → devices that aren't revoked and have a `push_token`
  - `clearPushToken(pushToken)`
  - `revoke(id)`
  - `markTested(id, at)`
  - `toJson(device)` → the spec's `Device`
- Produces `pairingCode(userId)` → `signPayload({ uid, nonce }, 600)`, and `redeemPairingCode(db, code)` → `userId | null`, which uses `readPayload` and `claimOnce(db, 'pair:' + nonce)`. Both live in `src/devices.js`.
- Produces `registerAppApi(deps)` in `src/app-api.js`. It takes `{ router, db, config, shifts, rotation, incidents, notify, actions, members, devices, scheduler, calendar }` and registers this task's routes: `POST /api/app/pair`, `POST /api/app/signout`, `GET /api/app/me`, `POST /api/app/device`.
- `ctx.device` is set for bearer requests. `requireAppUser(ctx)` throws `HttpError(401, 'Sign in again')`.

- [ ] **Step 1: Write failing tests in `test/app-api.test.js`.**
  ```js
  test('a pairing code signs a phone in once', async () => {
    const code = pairingCode(ana.id);
    let res = await postJson('/api/app/pair', { code, platform: 'ios', deviceName: 'Ana’s iPhone' });
    assert.equal(res.status, 200);
    const { token, me } = await res.json();
    assert.equal(me.user.email, 'ana@example.com');
    assert.equal(me.device.platform, 'ios');
    res = await postJson('/api/app/pair', { code, platform: 'ios', deviceName: 'again' });
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /expired or was already used/);
  });
  test('a pairing code older than 10 minutes is refused', async () => {
    const old = signPayload({ uid: ana.id, nonce: 'n1' }, -1); // ttl in the past: already expired
    assert.equal((await postJson('/api/app/pair', { code: old, platform: 'android', deviceName: 'Pixel' })).status, 401);
  });
  test('removed teammates and signed-out phones get 401 everywhere', async () => { /* GET /me 200 → deactivate → 401; new token → signout 204 → /me 401 */ });
  test('POST /api/app/device stores the push token and checks', async () => {
    const res = await postJson('/api/app/device', { pushToken: 'abc', checks: { notifications: true } }, token);
    assert.deepEqual((await res.json()).pushReady, true);
  });
  test('requests without a bearer token get 401 JSON, not a redirect', async () => { /* GET /api/app/me → 401, content-type json */ });
  ```
- [ ] **Step 2:** Run `node --test --test-concurrency=1 test/app-api.test.js`. Expected: FAIL with 404s.
- [ ] **Step 3:** Implement the table, `src/devices.js`, `src/app-api.js` and the bearer branch in `handle()`. The bearer branch applies only when the path starts with `/api/app/` and there is an `Authorization: Bearer` header. Cookie sessions stay as they are.
- [ ] **Step 4:** Run `npm test && npm run test:pg`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: devices table, pairing codes and bearer sign-in for the phone app`.

### Task 3: "Phone app" code on the Team page, and Google sign-in from the app

**Files:**
- Create: `src/vendor/qrcodegen.js` (Project Nayuki QR Code generator, MIT, licence header kept), `src/qr.js`
- Modify: `src/views.js` (`teamPage` gets a "Phone app" card above "Your contact details"), `src/app.js`, `src/app-api.js`, `README.md` (a "Phone app" section: scan from Team, push env vars)
- Test: `test/core.test.js` (`qrSvg`, `appSignInRedirect`), `test/http.test.js` (Team page card, `POST /devices/:id/revoke`), `test/app-api.test.js` (signup)

**Interfaces:**
- Produces `qrSvg(text)` → an `<svg>` string with a 4-module quiet zone, `fill="currentColor"`, and `role="img"` with an `aria-label`.
- Produces `appSignInRedirect({ publicUrl, user, identity, error })` → a `pagerdiem://connect?...` string:
  - existing active user: `server` and `code`
  - new person: `server` and `pending` (`signPayload(identity, 1800)`)
  - failure: `error`
- The web route `POST /devices/:id/revoke` lets a signed-in user revoke their own device.
- `GET /auth/google?app=1` puts `app: true` into the OAuth cookie payload. On callback with `app`, the server redirects (302) to `appSignInRedirect(...)` instead of setting a cookie.
- `POST /api/app/signup` takes `{ pending, name, slack, phone, platform, deviceName }` → 201 `{ token, me }`, or 400 `{ error, field }` from `members.createMember`.

- [ ] **Step 1: Write failing tests.**
  ```js
  test('qrSvg encodes the connect link', () => { const svg = qrSvg('pagerdiem://connect?server=https%3A%2F%2Fx&code=abc');
    assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/); assert.match(svg, /aria-label="Phone app sign-in code"/); });
  test('appSignInRedirect: existing user gets a code, new person a pending signup, failures an error', () => {
    assert.match(appSignInRedirect({ publicUrl: 'https://pd.example.com', user: ana }), /^pagerdiem:\/\/connect\?server=https%3A%2F%2Fpd\.example\.com&code=/);
    assert.match(appSignInRedirect({ publicUrl: 'https://pd.example.com', identity: { email: 'new@example.com', name: 'New' } }), /&pending=/);
    assert.equal(appSignInRedirect({ publicUrl: 'https://pd.example.com', error: 'Nope' }), 'pagerdiem://connect?error=Nope');
  });
  test('Team page shows the Phone app code and your phones', async () => { /* GET /team → /Phone app/, /<svg/, device name, a revoke form */ });
  test('signup from the app adds the person and signs the phone in', async () => { /* POST /api/app/signup with signPayload(identity) → 201, users row, device row */ });
  ```
- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Card copy:
  - Title "Phone app".
  - Text "Pages ring your phone like a call, even on silent. Scan this with the PagerDiem app to sign in. The code works once, for 10 minutes."
  - A list of the user's phones: name, platform, "Tested {date}" or "Not tested yet", and a "Sign out" button.
- [ ] **Step 4:** Run `npm test && npm run test:pg`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: phone app sign-in by QR code or Google`.

### Task 4: APNs VoIP and FCM senders

**Files:**
- Create: `src/notify/apns.js`, `src/notify/fcm.js`
- Modify:
  - `src/config.js`: the `push` block, `pushEnabled()`, `secondCallAfterMinutes`.
  - `.env.example`: document every new key.
  - `render.yaml`:
    - Add `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` and `FCM_SERVICE_ACCOUNT` as `sync: false`.
    - Add `APNS_ENV` with value `production`. TestFlight and App Store builds use production APNs. Only Xcode debug builds need `development`.
    - Add `buildFilter.ignoredPaths: ['mobile/**', 'docs/**']`, so phone-only commits don't redeploy the server.
  - `docs/deploy-render-slack.md`: add a "Phone calls" section covering where each key comes from. `APNS_PRIVATE_KEY` can be pasted with real newlines or `\n`.
- Test: `test/push.test.js` (new)

**Interfaces:**
- Config:
  - `config.push.apns = { keyId, teamId, privateKey, bundleId, production }`, from `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (PEM, `\n` unescaped), `APNS_BUNDLE_ID` (default `com.tryperdiem.pagerdiem`) and `APNS_ENV` (`production` by default, or `development`).
  - `config.push.fcm = { serviceAccount }`, the parsed `FCM_SERVICE_ACCOUNT` JSON, or null.
  - `config.secondCallAfterMinutes = int('SECOND_CALL_AFTER_MINUTES', 2)`.
  - `pushEnabled()` → `{ ios: boolean, android: boolean }`.
- Produces `makeApns({ keyId, teamId, privateKey, bundleId, host, connect = http2.connect })` → `{ sendVoip(deviceToken, payload), close() }`.
  - `host` is `https://api.push.apple.com` or `https://api.sandbox.push.apple.com`.
  - `sendVoip` resolves `{ ok: true }` or `{ ok: false, gone, reason }`.
  - Request: `POST /3/device/<token>`, `apns-topic: <bundleId>.voip`, `apns-push-type: voip`, `apns-priority: 10`, `apns-expiration: <now + 60 s>`, `authorization: bearer <ES256 JWT {iss: teamId, iat}, kid: keyId>`.
  - The JWT is reused for 50 min. Sign with `crypto.sign('sha256', …, { key, dsaEncoding: 'ieee-p1363' })`.
  - `gone` is true for status 410, and for 400 with reason `BadDeviceToken` or `DeviceTokenNotForTopic`.
- Produces `makeFcm({ serviceAccount, fetchImpl = fetch })` → `{ send(token, data) }`, resolving `{ ok: true }` or `{ ok: false, gone, reason }`.
  - Access token: from `https://oauth2.googleapis.com/token`. Use grant `urn:ietf:params:oauth:grant-type:jwt-bearer` and an RS256 JWT with scope `https://www.googleapis.com/auth/firebase.messaging`. Cache it until 60 s before `expires_in` runs out.
  - Send: `POST https://fcm.googleapis.com/v1/projects/<project_id>/messages:send` with body `{ message: { token, data, android: { priority: 'HIGH', ttl: '60s' } } }`.
  - `gone` is true for 404, and for an error detail `errorCode: 'UNREGISTERED'`.

- [ ] **Step 1: Write failing tests in `test/push.test.js`.**
  ```js
  test('APNs: VoIP push with the right headers and a verifiable token', async () => {
    // EC P-256 key pair from crypto.generateKeyPairSync; local http2.createServer() (h2c) records the request
    const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey, bundleId: 'com.tryperdiem.pagerdiem', host: `http://localhost:${port}` });
    assert.deepEqual(await apns.sendVoip('tok', { type: 'page', incidentId: '14' }), { ok: true });
    assert.equal(seen[':path'], '/3/device/tok');
    assert.equal(seen['apns-topic'], 'com.tryperdiem.pagerdiem.voip');
    assert.equal(seen['apns-push-type'], 'voip');
    assert.equal(seen['apns-priority'], '10');
    assert.ok(Number(seen['apns-expiration']) <= Math.floor(Date.now() / 1000) + 61);
    assert.ok(verifyEs256(seen.authorization.slice(7), publicKey));
  });
  test('APNs: 410 and BadDeviceToken are gone, 500 is not', async () => { /* server replies 410 / 400 {reason} / 500 */ });
  test('APNs: one token is reused across sends', async () => { /* two sends → same authorization */ });
  test('FCM: high priority data message with a cached OAuth token', async () => { /* fake fetchImpl: 1 token call for 2 sends; URL has project_id; body.message.android = { priority: 'HIGH', ttl: '60s' } */ });
  test('FCM: UNREGISTERED is gone', async () => {});
  ```
- [ ] **Step 2:** Run `node --test test/push.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the senders and the config. If only some APNs or FCM vars are set, warn once: "Phone calls on iOS are off: set APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY." Use the Android equivalent for FCM.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: APNs VoIP and FCM senders with no new dependencies`.

### Task 5: Pages ring phones, with a second call at 2 minutes

**Files:**
- Modify: `src/notify/index.js`, `src/incidents.js`, `src/app-api.js` (test-call routes), `src/views.js` (Recent messages shows `push` rows like Slack rows)
- Test: `test/core.test.js`, `test/app-api.test.js`

**Interfaces:**
- `makeNotifier(db, overrides)` adds `overrides.push(device, payload)`. Without an override, it uses the real senders when `pushEnabled()` allows the platform. Otherwise the row is recorded as `dry-run`.
- New notifier functions:
  - `notify.call(user, { payload, incidentId })` → one result per push-ready device. A `gone` result clears that `push_token` and records a `failed` row with error "Phone is no longer registered".
  - `notify.callDevice(device, user, { payload })`
  - `notify.cancelCalls(incidentId)` sends `{ type: 'cancel', incidentId }` to every Android device with a push token. Phones that aren't ringing ignore it.
- `callPayload(inc, user, { type, reason, attempt, now })` → the spec's push payload. Values:
  - `callId`: `crypto.randomUUID()`
  - `nextCallAt`: `now + secondCallAfterMinutes` when `attempt === 1`, else `now + repageEveryMinutes`
  - `server`: `config.publicUrl`
- `page()` in `src/incidents.js` calls `notify.call` next to `notify.user` (D3). `acknowledge` and `resolve` call `notify.cancelCalls` when `changed`.
- New `tick()` step, run before the existing steps: an open, non-quiet incident at `escalation_level === 0` gets a second call. It needs:
  - age ≥ `secondCallAfterMinutes`
  - `claimOnce(db, 'second-call:' + id)`
  - at least one target with a push-ready device

  The targets are the same people the 5-minute re-page would hit. The step calls them only, with no Slack DM and `attempt: 2`. It logs the event "Called again so it rings through Do Not Disturb".
- Routes:
  - `POST /api/app/device/test-call` → `{ callId }`. Sends `type: 'test'` to this device only.
  - `POST /api/app/device/test-call/answered` takes `{ callId }`, calls `markTested`, and returns `Device`.

- [ ] **Step 1: Write failing tests in `test/core.test.js`.** Use the existing `setup()` with Saturday `t0`, where Ana and Ben are on call. Give Ana an iOS device.
  ```js
  test('a page calls every on-call phone, then once more at 2 min, then with each re-page', async () => {
    // notifier override push: (device, payload) => calls.push({ device, payload })
    const inc = await incidents.create({ title: 'Checkout down' }, t0);
    assert.equal(calls.length, 1); assert.equal(calls[0].payload.type, 'page'); assert.equal(calls[0].payload.attempt, 1);
    assert.equal(calls[0].payload.nextCallAt, new Date(t0.getTime() + 2 * 60_000).toISOString());
    await incidents.tick(new Date(t0.getTime() + 2 * 60_000));
    assert.equal(calls.length, 2); assert.equal(calls[1].payload.attempt, 2);
    assert.ok(!sent.some((m) => m.text?.includes('Reminder')), 'no Slack DM with the second call');
    assert.ok((await incidents.events(inc.id)).some((e) => e.message === 'Called again so it rings through Do Not Disturb'));
    await incidents.tick(new Date(t0.getTime() + 3 * 60_000)); assert.equal(calls.length, 2);
    await incidents.tick(new Date(t0.getTime() + 5 * 60_000)); assert.equal(calls.length, 3);
  });
  test('nobody has the app: paging is exactly as before', async () => { /* no push rows, no second-call event */ });
  test('a phone that is gone is cleared and skipped next time', async () => { /* override returns { ok:false, gone:true } → push_token null, notifications row failed */ });
  test('acknowledging stops Android phones ringing', async () => { /* android device; ack → calls has { type: 'cancel', incidentId } */ });
  test('quiet incidents never call', async () => {}); // fails until Task 6 adds quiet; keep it here so Task 6 turns it green
  ```
  In `test/app-api.test.js`: the test call reaches only this phone, and answering it marks the device tested.
- [ ] **Step 2:** Run the tests. Expected: FAIL. ("quiet" stays red until Task 6. Mark it `{ todo: 'Task 6' }`.)
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run test:pg`. Expected: PASS, apart from the one `todo`.
- [ ] **Step 5:** Commit: `feat: pages ring the on-call phones, with a second call at 2 minutes`.

### Task 6: Incident features the phone needs

**Files:**
- Modify: `src/db.js` (the `incidents.quiet` column and the `incident_notes` table), `src/incidents.js`, `src/views.js` (incident page shows notes in the activity list)
- Test: `test/core.test.js`

**Interfaces:**
- Schema:
  - `ALTER TABLE incidents ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0`, guarded like `role`.
  - `CREATE TABLE IF NOT EXISTS incident_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER NOT NULL REFERENCES incidents(id), user_id INTEGER NOT NULL REFERENCES users(id), at TEXT NOT NULL, text TEXT NOT NULL)`.
- `incidents.create({ …, quiet = false })`:
  - When `quiet`: post in #on-call ("…posted by {name}. Nobody was called."), page nobody, and never escalate in `tick` (D10).
  - When the creator is on call and someone else is too, page only the others (D11).
  - Returns the incident plus `paged: Person[]`.
- `incidents.addNote(id, user, text, via)` → `{ id, at, text, user }`. Trims text to 2,000 characters. Posts `:memo: Note on #14 from {name}: {text}` in #on-call. Logs nothing in `incident_events`: notes have their own table.
- `incidents.notes(id)` → the notes, oldest first.
- `incidents.callAgain(id, user)` pages everyone currently responsible now, with Slack and calls, through the existing `page()`. Logs "{name} asked to call everyone again". Returns `{ paged: Person[] }`.
- `incidents.callBackupNow(id, user)` claims level 1 through the existing `claim` logic and pages the backup now. If there is no backup, it does the @channel. If the level is already ≥ 1, it throws `HttpError(409, 'The backup has already been called')`.
- `incidents.recentTitles(limit = 3)` → distinct titles of the newest incidents (D12).
- Acting on a resolved incident: `acknowledge` and `resolve` stay idempotent with `{ changed: false }`. `callAgain`, `callBackupNow` and `addNote` throw 409 "This incident is resolved".

- [ ] **Step 1: Write failing tests** (`test/core.test.js`).
  - Quiet incidents post once, call nobody and never escalate (ticks at 2, 5, 15 and 30 min send nothing).
  - Whoever pages is skipped when someone else is on call.
  - A note is stored and posted once.
  - Call again pages Ana and Ben now.
  - Call the backup now pages Cal and moves to level 1, and a second time gives 409.
  - `recentTitles` returns the three newest distinct titles.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Remove the `todo` from Task 5's quiet test.
- [ ] **Step 4:** Run `npm test && npm run test:pg`. Expected: PASS, with no todos left.
- [ ] **Step 5:** Commit: `feat: post-only incidents, notes, call again and call the backup now`.

### Task 7: The `/api/app/*` read and write routes

**Files:**
- Modify: `src/app-api.js`, `src/db.js` (`admin_log` table), `src/actions.js` (record admin actions)
- Create: `src/activity.js`
- Test: `test/app-api.test.js`

**Interfaces:**
- Every remaining route in the spec's contract table, with exactly those shapes. Convert rows to the spec types in one place: `toPerson(user)` and `toIncident(row)`. A person's `initials` are the first letters of the first two words of their name, uppercase.
- The `GET /api/app/incidents/:id` fields:
  - `feed`: `incident_events` plus notes, sorted by `at`.
  - `reached`: `notifications` rows for the incident, both Slack and push.
  - `escalation`: built by `escalationPlan(inc, now, { secondCall, repage, escalateAfter, backup })`. It returns the canvas steps:
    - Call {names}
    - Slack DMs and #on-call post
    - Rings through Do Not Disturb
    - Keep calling every 5 min
    - Call {backup}, the backup
    - @channel in #on-call
    - Then keep calling everyone

    Each step has its `at` time and a state: `done`, `next`, `later`, or `skipped`. Steps are `skipped` after an acknowledgement.
- `GET /api/app/team` adds `app` to each member:
  - `woken`: a push-ready device with `tested_at`.
  - `focus-risk`: a push-ready device that hasn't been tested, or whose checks have `focus: false`.
  - `none`: otherwise.
- Table: `CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id INTEGER REFERENCES users(id), via TEXT, icon TEXT NOT NULL, text TEXT NOT NULL)`. Actions write to it: role and active changes, coverage, resend, ask-cover, answered test calls.
- `activityFeed(db, { limit = 200 })` → `ActivityItem[]`. It merges four sources, newest first:
  - `rotation.log()`, with `via: null`
  - acknowledgements and resolutions from `incidents`, with `via` parsed from the "via X" event text
  - `admin_log`
  - nothing for notes
- New action `askCover(user, key, via)`. It posts `:sos: {name} needs cover for the weekend of {range}. Take it: {publicUrl}/calendar?month={yyyy-mm}`, records the request, and changes nobody's spot. Message: "Asked for cover in #{channel}".

- [ ] **Step 1: Write failing tests** (`test/app-api.test.js`). Cover one route per group, plus these edge cases:
  - `GET /home` on a Saturday shows `onCall` with Ana and Ben and `backup` Cal. On a Thursday, `onCall` is null and `next` is set.
  - Acknowledging twice at once gives two 200s, exactly one `changed: true`, and one #on-call post (Review Focus 1).
  - `POST /incidents { mode: 'post' }` → 201, with `paged: []` and `quiet: true`.
  - `POST /incidents/:id/notes` on a resolved incident → 409.
  - `POST /weekends/:key/swap` returns `undo.until` 10 s ahead. `POST /swaps/undo { ids }` → "Swap undone…".
  - `POST /team/:id/role` from an engineer → 403.
  - `GET /team` shows `app: 'woken'` for a tested phone.
  - `GET /activity` includes "answered a test call".
  - `GET /incidents/:id` escalation at 6 min after the start: steps 1–3 `done`, step 4 `next`, the backup step `later`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run test:pg`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: JSON API for every phone app screen`.
- [ ] **Step 6:** Open the draft PR, titled "Phone app: server side". In the body, link the spec and the canvas, and list the env vars from Task 4.

### Task 8: Trade weekends

The canvas Schedule flow goes "Jan 8 to 11" → "Swap…" → "Cal Reyes" → "Swapped. You take Dec 25" → Undo. That is a trade of two weekends, which today's one-way "take their spot" can't express.

**Files:**
- Modify: `src/db.js` (`swaps.trade_id INTEGER`, guarded add), `src/rotation.js`, `src/actions.js`, `src/app.js` (`announceSwaps` posts one message per trade), `src/app-api.js`
- Test: `test/core.test.js`, `test/app-api.test.js`

**Interfaces:**
- `rotation.trade(myShift, theirShift, me, otherId, now)` → `[mySwapRow, theirSwapRow]`. It writes two swap rows that point at each other through `trade_id`:
  - On `theirShift`, `me` takes `otherId`'s spot.
  - On `myShift`, `otherId` takes `me`'s spot.
- It throws 409 when `me` isn't on `myShift`, when `otherId` isn't on `theirShift`, or when either person is already on the other weekend.
- `rotation.undoSwap(id, user)` undoes a trade pair together. Either person in the pair may undo inside the 10 s window.
- `actions.tradeWeekends(user, myKey, theirKey, otherId, via)` → `{ message: 'Swapped. You take {their range}.', undo: { ids: [a, b], until } }`.
- After the window, `announceSwaps` posts one channel message, `:repeat: {me} and {other} traded weekends: {me} takes {their range}, {other} takes {my range}.`, and DMs the other person once.
- Route: `POST /api/app/weekends/:key/trade { theirKey, userId }`.

- [ ] **Step 1: Write failing tests.**
  - The trade moves both people.
  - Undoing either row restores both.
  - The announcement is posted once, after 10 s.
  - Trading a weekend you're not on gives 409.
  - The route returns `undo.ids` with two ids.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run test:pg`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: trade weekends from the phone, undoable for 10 seconds`.

### Task 9 (after v1, D14): Live Activity updates

**Files:** `src/db.js` (`devices.activity_token`), `src/notify/apns.js` (`sendLiveActivity(token, contentState, { event: 'update' | 'end' })` with `apns-push-type: liveactivity` and topic `<bundleId>.push-type.liveactivity`), `src/incidents.js`, `src/app-api.js` (`POST /api/app/device { activityToken }`), and tests in `test/push.test.js` and `test/core.test.js`.
Same five-step shape as Task 4.
- Content state: `{ incidentId, title, status, startedAt, backupAt, ringing: string[] }`.
- Send an update on page, acknowledge and resolve, and an `end` on resolve.
