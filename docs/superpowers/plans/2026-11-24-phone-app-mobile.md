# Phone app: iOS and Android, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PagerDiem phone app from the canvas. Pages ring like a phone call, and everything the web app does is on the phone.

**Architecture:**
- One Expo app in `mobile/` inside the pagerdiem repo. It uses a development build (not Expo Go) and expo-router for screens.
- Server data comes through TanStack Query over the `/api/app/*` contract.
- Calls come in two ways:
  - iOS: PushKit VoIP pushes, reported to CallKit natively in `AppDelegate`.
  - Android: high-priority FCM data messages shown as a full-screen call notification.
- Answering acknowledges (D1).

**Tech Stack:**
- Base: Expo SDK (the latest stable when Task 2 starts, pinned exactly), React Native New Architecture, TypeScript strict, expo-router.
- UI: NativeWind and React Native Reusables (the shadcn/ui token model the canvas uses), lucide-react-native, Geist and Geist Mono via `@expo-google-fonts`.
- Data and device: TanStack Query, expo-secure-store, expo-camera (QR), expo-web-browser (Google), expo-notifications (permissions and the missed-page notification), react-native-gesture-handler and Reanimated.
- Calls: react-native-callkeep and react-native-voip-push-notification (iOS), @react-native-firebase/messaging and @notifee/react-native (Android).
- Tests: Jest (jest-expo) with @testing-library/react-native, and Maestro end-to-end.

**Spec:** `docs/superpowers/specs/2026-11-24-phone-app-design.md` and the canvas https://claude.ai/artifact/2c9yyuvF24tixP8kouskQp (version 19). The server side is `docs/superpowers/plans/2026-11-24-phone-app-server.md`. Tasks here say which server task they need.

## Global Constraints

- **Gate:** Doron agreed on 2026-11-24. Task 1 (the ring spike) passes before any screen work.
- **Apple team:** "Per Diem Subscriptions, Inc." (`NDXNQ5M4K4`), already signed in to Xcode 26.4.1 on Saad's Mac, with Apple Development and Distribution certificates.
  - Xcode's automatic signing creates the App ID and its push capability on the first device build.
- **Testing:**
  - Use an Expo development build (`npx expo run:ios --device` / `npx expo run:android`), not Expo Go. Expo Go can't receive VoIP pushes or show CallKit calls.
  - The server is the local pagerdiem on the Mac, never production.
  - Pushes travel Mac → Apple or Google → phone. To answer and acknowledge, the phone reaches the Mac over the same Wi-Fi (`http://<Mac LAN IP>:3000`), or through a tunnel (`cloudflared tunnel --url http://localhost:3000`) when it's on mobile data.
- **Branch:** `feature/phone-app-mobile`, cut from `feature/phone-app-server` until that merges, then rebased on `origin/main`.
  - Draft PR only.
  - Commit only when Saad has said to for this run.
  - No co-author or "generated with" lines.
- **App identity:**
  - Bundle id and application id: `com.tryperdiem.pagerdiem`.
  - URL scheme: `pagerdiem`.
  - Display name: "PagerDiem".
  - iOS 17.0 or later. Android 10 (API 29) or later, targeting the SDK that the pinned Expo SDK sets.
- **Design:**
  - Colours, radii and type come from the canvas `kit.css` tokens, light and dark. The canvas default is dark, and the app follows the system unless You → Appearance overrides it.
  - Icons are Lucide only, with the canvas's choices.
  - Copy is sentence case, word for word from the canvas, with D6's "Team" in place of "You" in the connect copy.
  - Two copy fixes, because the canvas promises more than an iPhone call can do (spec D15). Calls only vibrate when the silent switch is on. Whether they get through Sleep Focus is what Task 1 finds out.
    - Welcome: "Even with your phone on silent or in Sleep Focus." becomes "Even when the app is closed."
    - Wake-up checks: keep "Keep the ringer on" as a required step on iPhone.
- **Accessibility:**
  - Text contrast is at least 4.5:1, checked in tests.
  - Touch targets are at least 44 pt.
  - Every icon-only button has an `accessibilityLabel`.
  - Every gesture has a visible alternative: swipe rows also have a long-press menu, and slide and hold also respond to the screen-reader "activate" action.
  - Reduced motion turns off pulses and staggers.
- **Times:** everything shows in the team's timezone (`me.team.timezone`), not the phone's.
- **Security, phone to server:**
  - **HTTPS only in release builds.** `http://` is allowed only in development builds, and only for `localhost`, `10.0.2.2` and private IPs.
  - **Storing the sign-in token:** expo-secure-store with `keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. That way it never syncs to iCloud or backups, and a call answered on the lock screen can still acknowledge.
    - Set Android `allowBackup: false`.
    - Nothing else stores the token.
  - **Google sign-in binds the result to this app, the same way OAuth PKCE does:**
    - Make a verifier from 32 random bytes (`expo-crypto`), base64url-encoded.
    - Open `/auth/google?app=1&challenge=<base64url(SHA-256(verifier))>`.
    - Send `verifier` with `POST /api/app/pair` or `/signup`.
    - The server rejects a code from that flow without the right verifier, so another app that catches the `pagerdiem://` link gets nothing.
  - **Pushes from other servers are ignored:** if a push's `server` isn't the server this phone signed in to, the app ignores it.
  - **No tokens, push tokens or push payloads in logs**, and no analytics or crash SDK that records request bodies.
  - **Any 401 signs the phone out** (Review Focus 4).
- **Tests:**
  - Each task passes `npm run typecheck && npm test` in `mobile/`.
  - Maestro flows run against a local pagerdiem seeded by `mobile/e2e/server.mjs`.
  - No test-only code paths in the app: calls are tested by unit tests with injected collaborators, and the real ring on devices (Tasks 1 and 12).

## Review Focus

1. **A call for a page that someone already acknowledged** (a late push). iOS must still report the call. The phone then ends it within 3 s as "answered elsewhere" and never posts an acknowledgement. Test in Task 9.
2. **The server is asleep or unreachable** (a self-hosted server on a free tier). Requests time out after 10 s. Screens show "Can't reach {host}" with Retry instead of spinning forever. Acknowledging from a call retries 3 times over 20 s, then shows "Couldn't acknowledge — open the incident to try again". Test in Tasks 4 and 9.
3. **The phone is in another timezone from the team.** "Fri 6:00 PM to Mon 9:00 AM" and every clock time are in the team's timezone. Test in Task 4, with the phone set to `Asia/Karachi` and the team on `America/New_York`.
4. **The sign-in was revoked, or the person was removed from the team.** Any 401 signs the phone out at once and goes to Welcome with "You were signed out. Scan a new code on the web Team page to sign in again." Test in Task 4.
5. **The push token changes** (iOS reissues PushKit tokens, and a reinstall gives a new FCM token). The new token is posted to `POST /api/app/device` every time it changes, and also on every cold start. Test in Tasks 9 and 10.

---

### Task 1: Ring spike on real phones (gate, throwaway code)

**Needs:** server Tasks 2, 4 and 5 running locally on the Mac, with `APNS_*` set (and `FCM_SERVICE_ACCOUNT` for the Android half).
**Files:** `mobile/docs/ring-spike.md` (findings only). The spike app itself lives outside the repo and is thrown away.

- [ ] **Step 1: Set up the keys. Saad does this.**
  - **Apple:** an APNs auth key (.p8) for team `NDXNQ5M4K4`. One key works for every app on the team, so reuse the team's existing one if its .p8 is stored somewhere. Otherwise create one under Certificates, Identifiers & Profiles → Keys. Apple only lets you download it once.
  - **Firebase** (only for the Android half): a project with an Android app `com.tryperdiem.pagerdiem`, giving `google-services.json`, plus a service account key.
- [ ] **Step 2: Build the smallest Expo dev build that registers for VoIP and FCM pushes.**
  - It reports calls through CallKit and shows a full-screen call notification.
  - Pin the Expo SDK now.
  - Install the four call libraries listed in the Tech Stack, with New Architecture on.
  - If a library won't build, record the replacement you used.
- [ ] **Step 3: Run each case from `POST /api/app/device/test-call`** and record the result in `ring-spike.md`, in a table with one row per case:

  | Phone state | Rings? | Volume | Over the lock screen? |
  |---|---|---|---|
  | iPhone locked, ringer on | | | |
  | iPhone with the app killed | | | |
  | iPhone in Sleep Focus, PagerDiem not allowed | | | |
  | iPhone in Sleep Focus, PagerDiem allowed | | | |
  | iPhone, a second call within 2 min with Repeated Calls on | | | |
  | iPhone with the silent switch on | | | |
  | Pixel locked | | | |
  | Pixel with the app killed | | | |
  | Pixel in Do Not Disturb, with and without DND access | | | |
  | Pixel in Doze (`adb shell dumpsys deviceidle force-idle`) | | | |

- [ ] **Step 4: Decide, and write each decision in `ring-spike.md`.**
  - (a) Do the Focus steps in the Wake-up checks copy match what happened? Adjust the copy if not.
  - (b) If CallKit can't get through Sleep Focus even with the app allowed, request Apple's Critical Alerts entitlement and add a "critical alert alongside the call" task before Task 9.
  - (c) How Android plays on the alarm stream at full volume: a notifee channel, or a short native module.
- [ ] **Step 5:** Commit only `mobile/docs/ring-spike.md`: `docs: phone ring spike results`.

### Task 2: Scaffold, theme tokens and checks

**Files:**
- Create in `mobile/`:
  - project files: `package.json`, `app.config.ts`, `tsconfig.json` (strict), `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `global.css`
  - screens: `app/_layout.tsx`, `app/(tabs)/_layout.tsx` with five placeholder tabs
  - theme: `src/theme/tokens.ts`, `src/theme/ThemeProvider.tsx`
  - tests: `jest.config.js`, `src/theme/tokens.test.ts`
- Create `.github/workflows/mobile.yml`. It runs on `pull_request` with paths `mobile/**`, using Node 22: `npm ci && npm run typecheck && npm test`.

**Interfaces:**
- `tokens: Record<'light' | 'dark', Record<TokenName, string>>`. Copy `TokenName` and values one for one from `kit.css` (`bg`, `card`, `label`, `label-2`, `primary`, `tint`, `tint-text`, `red-text`, `green-text`, `orange-text`, and so on).
- `tailwind.config.js` maps them to CSS variables in the NativeWind style.
- `useTheme()` → `{ scheme: 'light' | 'dark', t: tokens[scheme], setOverride(s: 'system' | 'light' | 'dark') }`. The override is stored in SecureStore as `pd.appearance`.
- `app.config.ts`:
  - identity: bundle id, scheme and name from the Global Constraints
  - `ios.infoPlist.UIBackgroundModes: ['voip', 'remote-notification']`
  - `android.permissions`: `USE_FULL_SCREEN_INTENT`, `ACCESS_NOTIFICATION_POLICY`, `POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK`
  - `plugins`: expo-router, expo-font, expo-camera, expo-secure-store, `@react-native-firebase/app`, `./plugins/with-voip-callkit` (added in Task 9)

- [ ] **Step 1: Write the failing test.**
  ```ts
  test.each(['light', 'dark'] as const)('%s text tokens meet 4.5:1 on bg and card', (s) => {
    for (const fg of ['label', 'label-2', 'tint-text', 'red-text', 'green-text', 'orange-text'] as const)
      for (const bg of ['bg', 'card'] as const) expect(contrast(tokens[s][fg], tokens[s][bg])).toBeGreaterThanOrEqual(4.5);
  });
  ```
- [ ] **Step 2:** Run `npm test`. Expected: FAIL, because `tokens` is missing.
- [ ] **Step 3:** Scaffold with `npx create-expo-app@latest mobile --template default`, pinned to Task 1's SDK. Add NativeWind and Reusables following their Expo guides, and the Geist fonts. Write the tokens.
- [ ] **Step 4:** Run `npm run typecheck && npm test`. Expected: PASS. Also run `npx expo run:ios` and `npx expo run:android`: both boot to the tab placeholders in dark.
- [ ] **Step 5:** Commit: `feat(mobile): Expo app scaffold with the canvas theme`.

### Task 3: UI kit

**Files:** `mobile/src/ui/`:
- `Button.tsx`, `Card.tsx`, `ListRow.tsx`, `Pill.tsx`, `Avatar.tsx`, `Segmented.tsx`, `Sheet.tsx`, `AlertDialog.tsx`, `Toast.tsx`, `TabBar.tsx`, `EmptyState.tsx`, `Skeleton.tsx`
- the three gesture controls: `SlideToAcknowledge.tsx`, `HoldButton.tsx`, `SwipeRow.tsx`
- one `*.test.tsx` each for the behaviour-heavy ones: the three gesture controls, `Toast` and `TabBar`

**Interfaces:**
- `SlideToAcknowledge({ label, onAcknowledge, disabled? })`:
  - Fires once when the knob is released at 85% or more of the track. Otherwise it springs back.
  - A tap only nudges the knob and fires nothing.
  - The accessibility action `activate` fires.
- `HoldButton({ label, holdMs = 1000, onFire, tone? })`:
  - Fires once after `holdMs` of continuous press, with a progress ring.
  - Releasing early cancels and shows the hint "Hold the button for a second. It stops accidental pages."
  - `activate` fires.
- `SwipeRow({ actions: { label, icon, tone, onPress }[], children })`: a left swipe reveals the actions, and a long press opens the same actions in a menu.
- `Toast.show({ text, action?: { label, onPress }, durationMs = 4000 })`. With `action.label === 'Undo'`, it stays for the `until` passed.
- `TabBar({ active, openCount })`: tabs On call, Incidents, Schedule, Team, You, with Lucide `house`, `bell`, `calendar`, `users` and `user`. A badge shows when `openCount > 0`.

- [ ] **Step 1: Write failing tests.**
  - The slide fires only past 85%, and a tap doesn't fire.
  - The hold fires at 1000 ms and not at 900 ms (fake timers).
  - Both respond to the `activate` action.
  - The swipe row's long press shows the actions.
  - The Undo toast stays until `until`.
  - The tab badge shows "1".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with Reusables primitives, gesture-handler and Reanimated. Haptics: light on the hold's start, success when it fires, medium when the slide completes.
- [ ] **Step 4:** Run `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): UI kit with slide, hold and swipe controls`.

### Task 4: API client, session and time formatting

**Needs:** server Task 2 (the contract can be faked until then).
**Files:** `mobile/src/api/{types.ts, client.ts, hooks.ts, client.test.ts}`, `mobile/src/session.ts`, `mobile/src/session.test.ts`, `mobile/src/lib/time.ts`, `mobile/src/lib/time.test.ts`.

**Interfaces:**
- `types.ts`: the spec's TypeScript block, verbatim.
- `createClient({ server, token, fetchImpl = fetch, timeoutMs = 10000, onUnauthorized })` → `{ get<T>(path): Promise<T>, post<T>(path, body?): Promise<T> }`.
  - It throws `ApiError { status: number; message: string; field?: string }`.
  - A timeout or network failure gives `status: 0` with message "Can't reach {host}".
  - A 401 calls `onUnauthorized()` and then throws.
- `session.ts`:
  - `loadSession()` → `{ server, token } | null`
  - `saveSession(s)`
  - `clearSession(reason?: 'revoked')`
  - `normalizeServer(input)` → `'https://host[:port]'`. It adds `https://` and drops any path or trailing slash. It keeps `http://` only for `localhost`, `10.0.2.2` and private IPs.
- `hooks.ts`: `useMe`, `useHome`, `useIncidents(status)`, `useIncident(id)`, `useSchedule`, `useTeam` and `useActivity`, plus one `useAction(path)` mutation.
  - Invalidations: incidents → `home`, `incidents` and `incident:id`; weekends and swaps → `home` and `schedule`; team → `team`; profile and coverage → `me`.
  - `useIncident` refetches every 5 s while the incident is `open` and the screen is focused.
- `time.ts`, every function taking `tz`:
  - `formatLeft(untilIso, now)`: "1 day 22 hr left", "3 hr left", "12 min left"
  - `formatClock(iso, tz)`: "10:36 AM"
  - `formatDay(iso, tz)`: "Saturday, December 12"
  - `formatRange(startIso, endIso, tz)`: "Dec 18 to 21", or "Dec 25 to Jan 1" across months
  - `formatShiftHours(coverage)`: "Fri 6:00 PM to Mon 9:00 AM"
  - `formatTimer(ms)`: "06:13", or "1:02:09" past an hour
  - `formatAckIn(ms)`: "Acknowledged in 4 min"

- [ ] **Step 1: Write failing tests.**
  - With `process.env.TZ = 'Asia/Karachi'` in `jest.setup`, `formatClock('2026-12-12T15:36:00Z', 'America/New_York') === '10:36 AM'` (Review Focus 3).
  - A timeout gives `ApiError(0, "Can't reach pd.example.com")`.
  - A 401 calls `onUnauthorized` once.
  - `normalizeServer` cases: `'pd.example.com/team'` → `'https://pd.example.com'`; `'http://10.0.2.2:3000'` is kept; `'http://evil.com'` → `'https://evil.com'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The root layout wires `onUnauthorized` to `clearSession('revoked')` and routes to Welcome (Review Focus 4).
- [ ] **Step 4:** Run `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): API client, session and team-timezone formatting`.

### Task 5: Welcome, connect, sign in and About you

**Needs:** server Tasks 2 and 3.
**Files:** `mobile/app/(auth)/{welcome,connect,sign-in,about-you}.tsx`, `mobile/app/connect.tsx` (deep-link entry for `pagerdiem://connect`), `mobile/src/auth/{pair.ts, pair.test.ts}`, `mobile/e2e/server.mjs`, `mobile/e2e/flows/connect.yaml`.

**Interfaces:**
- `handleConnectLink(params, deps)` → `{ route: '/setup' | '/(auth)/about-you' | '/(auth)/sign-in', error?: string }`:
  - `code`: pair and save the session.
  - `pending`: go to About you with `pending`.
  - `error`: go to Sign in, showing the error.
- Sign in: `WebBrowser.openAuthSessionAsync(server + '/auth/google?app=1&challenge=' + challenge, 'pagerdiem://connect')`. Keep the verifier in memory for that sign-in, and send it as `verifier` with `pair` or `signup`.
- A `pagerdiem://connect` link that arrives any other way than the app's own scanner or its Google sign-in sheet (for example, tapped in a message) asks "Connect to {host}?" before pairing. Without that, a crafted link could sign the phone in to someone else's account.
- `e2e/server.mjs`:
  - Starts pagerdiem with `node ../src/server.js` on port 3000, using a temp SQLite file.
  - Env: `TEAM_TIMEZONE=America/New_York`, `SESSION_SECRET=e2e-secret`, `ALLOWED_EMAIL_DOMAINS=example.com`, and coverage on every day, so someone is always on call.
  - Seeds the canvas cast: Ben (you, admin), Ana, Eli, Hana, Cal, Dee and Iris.
  - Incidents: #14 "Checkout failing for all stores" (open), #13 "API 5xx above 2% on /orders" (acknowledged by Ana), plus resolved history.
  - Prints two pairing links: `PAIR_IOS` (localhost) and `PAIR_ANDROID` (10.0.2.2).

- [ ] **Step 1: Write failing tests.**
  - A code link pairs and routes to `/setup`.
  - A pending link routes to About you.
  - An error link shows "That account isn't allowed".
  - The unreachable address shows "We couldn't reach pd.nowhere.test. Check the address on the web app's Team page."
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the screens per the canvas boards Welcome, Connect, Sign in and About you, including the `errors` tweak states. The scanner uses `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}` and accepts only `pagerdiem://connect` links.
- [ ] **Step 4:** Run `npm test`. Then run `node e2e/server.mjs`, and in another shell `maestro test e2e/flows/connect.yaml -e LINK=$PAIR_IOS`. Expected: the flow ends on "Make sure pages wake you".
- [ ] **Step 5:** Commit: `feat(mobile): connect by QR code or Google and sign in`.

### Task 6: On call and Compose

**Needs:** server Tasks 6 and 7.
**Files:** `mobile/app/(tabs)/index.tsx`, `mobile/app/compose.tsx` (modal sheet), `mobile/src/screens/home.test.tsx`, `mobile/src/screens/compose.test.tsx`, `mobile/e2e/flows/home.yaml`, `mobile/e2e/flows/compose.yaml`.

**Interfaces:**
- Home renders `useHome()` and `useMe()` with the canvas states: you on call (shift ring with `formatLeft`), someone else, nobody, weekday, and "Focus may silence calls" when the `me.device.checks.focus` check is false.
  - "Needs you" rows have Acknowledge, which posts `ack { via: 'app' }` and shows the toast "Acknowledged. Paging stopped."
- Compose:
  - Takes `title` (required) and `details`. Quick picks come from `recentTitles` (D12).
  - "How loud" offers "Call their phones" (the default when someone is on call), which uses `HoldButton` ("Hold to call {first name}"), and "Post in #on-call", which sends on a tap.
  - The sent state shows the canvas copy for each mode, plus "Open incident #{id}".

- [ ] **Step 1: Write failing tests.**
  - Each Home state renders its canvas headline from a fixture.
  - Compose in call mode posts `{ mode: 'call' }` only after the hold.
  - Post mode posts `{ mode: 'post' }` on a tap.
  - An empty title disables both.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, then the two Maestro flows. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): On call home and Page on-call sheet`.

### Task 7: Incidents, Incident and Page

**Needs:** server Tasks 6 and 7.
**Files:** `mobile/app/(tabs)/incidents.tsx`, `mobile/app/incident/[id].tsx`, `mobile/app/page/[id].tsx`, tests for each in `mobile/src/screens/`, and `mobile/e2e/flows/{incidents,incident,page}.yaml`.

**Interfaces:**
- **Incidents:**
  - Segments Active, Resolved and All, with search over titles.
  - `SwipeRow` actions Acknowledge and Resolve. Resolve asks first: "Resolve incident #{id}?"
  - Empty states use the canvas copy.
- **Incident:**
  - Header and a responders strip (from `onCall`, `reached` and `ackedBy`).
  - Acknowledge and Resolve.
  - Tabs: Activity (`feed`, with notes as bubbles), Who it reached (`reached`), Escalation (`escalation` steps).
  - A note box pinned to the bottom posts `notes` and shows the toast "Note posted. #on-call sees it too."
  - The ⋯ menu has Call everyone again, Call the backup now, Copy link (`{publicUrl}/incidents/{id}`) and Open in Slack (`slack://open`, then the web fallback of the channel, D13).
- **Page** (route `page/[id]`):
  - Timer hero `formatTimer(now − createdAt)`, the escalation track, and who's ringing.
  - States: open, acknowledged by you, someone else has it, resolved.
  - Controls: `SlideToAcknowledge`, Pass to backup (confirm "Call {backup} now?"), Open Slack, Resolve, and "Open incident and add a note".
  - The timer stops at the acknowledgement time.
- **Acknowledging an incident that's already acknowledged** (`changed: false`) shows the toast "Already acknowledged by {name}". It is never shown as an error.

- [ ] **Step 1: Write failing tests.**
  - A swipe acknowledgement calls the API and shows the toast.
  - `changed: false` shows "Already acknowledged by Ana".
  - On Page, a slide acknowledges and freezes the timer.
  - Call the backup now, on a server 409, shows "The backup has already been called".
  - The escalation tab renders states from the fixture.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the three flows. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): incidents list, incident detail and the page screen`.

### Task 8: Schedule, Team, You and Activity

**Needs:** server Tasks 7 and 8.
**Files:** `mobile/app/(tabs)/{schedule,team}.tsx`, `mobile/app/(tabs)/you/{index,activity,profile,coverage}.tsx`, tests in `mobile/src/screens/`, and `mobile/e2e/flows/{schedule,team,you}.yaml`.

**Interfaces:**
- **Schedule:**
  - A list of 12 weekends grouped by month, with filters "All weekends" and "Only mine". The header shows `formatShiftHours`.
  - Your weekend opens a sheet with three actions:
    - Swap… (pick a person on another weekend, which calls `trade`)
    - Leave (with the canvas confirm copy)
    - Ask #on-call for cover
  - Someone else's weekend opens "Take this weekend" (`join`, when it needs cover) or "Take {name}'s spot" (`swap`).
  - Swaps and trades show an Undo toast until `undo.until`. Undo posts `swaps/undo { ids }`.
  - "Add weekends to calendar" opens `calendarFeedUrl` with `webcal://`.
- **Team:**
  - Members show their app status lines from the canvas ("Has the app · can be woken", "Has the app · Focus may silence it", "Slack only · no app yet").
  - Admins get a per-member sheet: Make admin or Remove admin, Remove from rotation or Add to rotation, and Move up or Move down.
  - "Copy sign-up link" is available.
- **You:**
  - A profile card with an Edit profile sheet (Slack name and phone, the server's field errors shown under each field).
  - Waking you up: Wake-up checks, Ring me now (`device/test-call`), Ringtone, Ring at full volume (Android only), Vibrate. The ring settings are stored on the phone in SecureStore as `pd.ring`.
  - Appearance.
  - More: Add weekends to calendar, Activity log.
  - Admin: Coverage editor (days, start, end, steppers for weekend and weekday counts) and Resend weekend message.
  - Sign out, with confirm copy, posts `signout` then clears the session.
  - The footer reads "Connected to {host} · Version {x}".
- **Activity:** `activity.items` with icons and "· in Slack", "· in the app" or "· on the web" from `via`.

- [ ] **Step 1: Write failing tests.**
  - A trade shows "Swapped. You take Dec 25", and Undo posts both ids.
  - An engineer sees no admin actions on Team or You.
  - Saving coverage with no days shows "Pick at least one day that needs someone on call."
  - Sign out clears the session and lands on Welcome.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the three flows. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): schedule, team, settings and activity`.

### Task 9: iOS calls (PushKit and CallKit)

**Needs:** server Task 5. Uses Task 1's findings.
**Files:**
- Create: `mobile/plugins/with-voip-callkit.js` (config plugin), `mobile/src/calls/{payload.ts, payload.test.ts, ringing.ts, ringing.test.ts, answer.ts, answer.test.ts, ios.ts}`, `mobile/assets/ringtones/{rising,classic,beeps}.caf`
- Modify: `mobile/app/_layout.tsx` (start the call listener once you're signed in)

**Interfaces:**
- **The config plugin** adds PushKit registration to `AppDelegate`.
  - In `didReceiveIncomingPushWithPayload`, it reports the call natively through `RNCallKeep.reportNewIncomingCall`, before JS has loaded. The call uses UUID `callId`, handle `"Incident #" + incidentId`, caller name `title`, and no video.
  - It then hands the payload to `RNVoipPushNotificationManager.didReceiveIncomingPush`.
- `parsePagePayload(raw)` → `PagePayload | null`.
  - It needs `type` to be page, test or cancel, and `incidentId` digits.
  - For page and test it also needs `callId` to be a UUID and a non-empty `title`. The server sends cancel as `{ type, incidentId }` only.
  - It accepts strings from FCM and numbers from APNs.
- `watchRinging({ payload, fetchIncident, endCall, notifyMissed, now, timeoutMs = 45000, intervalMs = 3000 })` → `stop()`:
  - It ends the call as `answeredElsewhere` once the incident isn't `open`.
  - At the timeout it ends the call as `unanswered` and calls `notifyMissed`. The missed notification reads "Missed page · {title}. We'll call you again at {formatClock(nextCallAt)}."
- `onAnswer(payload, { post, endCall, navigate, retries = 3 })`:
  - Page: post `incidents/{id}/ack { via: 'call' }` with backoff of 1, 4 and 15 s. End the CallKit call right after answering (there is no audio). Navigate to `/page/{id}`. If every retry fails, show the toast "Couldn't acknowledge — open the incident to try again".
  - Test: post `device/test-call/answered`, then go to `/setup?tested=1`.
- `ios.ts` posts `device { pushToken }` on every PushKit token event and on every cold start (Review Focus 5). Configure the ringtone from `pd.ring.tone`, setting it up again when it changes.

- [ ] **Step 1: Write failing tests.**
  - Payload validation cases.
  - A late push for an acknowledged incident ends the call within 3 s as `answeredElsewhere` and never posts an ack (Review Focus 1, fake timers).
  - At 45 s the call is missed and the notification shows the next call time in the team timezone.
  - Answering posts `via: 'call'` and navigates.
  - Three failures show the toast.
  - The test-call path posts `answered`.
  - A new PushKit token, and every cold start, posts `device { pushToken }` once (Review Focus 5).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Then, on a physical iPhone, press "Ring me now": it rings while locked, and answering it lands on Wake-up checks with the test call ticked. A page from web Compose rings, and answering it opens the Page screen as acknowledged.
- [ ] **Step 5:** Commit: `feat(mobile): pages ring on iPhone through CallKit; answering acknowledges`.

### Task 10: Android calls (FCM and a full-screen notification)

**Needs:** server Task 5. Uses Task 1's decision (c).
**Files:** `mobile/index.js` (register `setBackgroundMessageHandler` before the app), `mobile/src/calls/{android.ts, android.test.ts}`, `mobile/assets/ringtones/{rising,classic,beeps}.ogg`. Reuses `payload.ts`, `ringing.ts` and `answer.ts` from Task 9.

**Interfaces:**
- `callNotification(payload, ring)` → a notifee notification config:
  - channel `pd-ring-${ring.tone}${ring.vibrate ? '' : '-novib'}`
  - `android.category: CALL`, `fullScreenAction: { id: 'default' }`, `ongoing: true`, `loopSound: true`, `timeoutAfter: 45000`
  - actions Accept (opens the app) and Decline
- `ensureChannels()` creates the six channels with `importance: HIGH` and `bypassDnd: true`, plus the alarm-stream approach from Task 1.
- A `cancel` payload cancels that incident's call notification.
- Accept runs `onAnswer`. Decline and the timeout run the missed-page path.
- Post `device { pushToken }` on `messaging().onTokenRefresh` and on every cold start.

- [ ] **Step 1: Write failing tests.**
  - The config has a full-screen action and a 45 s timeout.
  - The channel follows the ring settings.
  - A `cancel` removes the notification.
  - Accept posts `via: 'call'`.
  - `onTokenRefresh` posts `device { pushToken }` (Review Focus 5).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Then on an Android emulator with Google Play: run `node e2e/server.mjs` with `FCM_SERVICE_ACCOUNT` set, then `maestro test e2e/flows/ring-android.yaml`. That flow presses "Ring me now", asserts the full-screen call, taps Accept, and asserts "It rang and you answered. You're set." Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): pages ring on Android as a full-screen call`.

### Task 11: Wake-up checks

**Needs:** server Task 5.
**Files:** `mobile/app/(auth)/setup.tsx` (also opened from You), `mobile/src/screens/setup.test.tsx`, `mobile/e2e/flows/setup.yaml`.

**Interfaces:**
- iPhone steps, copy from the canvas:
  1. Allow notifications. Uses `expo-notifications` `requestPermissionsAsync`.
  2. Let PagerDiem through Focus. Uses `Linking.openSettings()`, and is marked done when the person returns and confirms.
  3. Keep the ringer on. Informational, done on "Got it".
  4. Answer a test call.
- Android steps:
  1. Allow notifications.
  2. Allow full-screen calls. Opens `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` on Android 14 and later, and is skipped below that.
  3. Allow Do Not Disturb access. Opens `ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`.
  4. Answer a test call.
- Every change posts `device { checks }`.
- "Skip for now" asks first, with the canvas dialog copy.
- Finish: "Go to On call".

- [ ] **Step 1: Write failing tests.**
  - The steps differ by platform.
  - The done count reads "2 of 4".
  - The test-call step goes from "Ringing your phone…" to done when it is opened with `tested=1`.
  - The skip dialog appears.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and `setup.yaml`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mobile): wake-up checks`.

### Task 12: End-to-end suite and release checks

**Files:** `mobile/e2e/flows/*.yaml` (complete the set), `mobile/e2e/README.md`, `mobile/docs/release-checklist.md`, `.github/workflows/mobile-e2e.yml` (`workflow_dispatch`: macOS runner, iOS simulator, `node e2e/server.mjs`, then every flow except `ring-android`).

- [ ] **Step 1: Cover every canvas flow with Maestro, one flow file per screen.** This is the same list the canvas was checked with (72 flows in the render harness). It includes:
  - acknowledge from Home
  - Compose: hold to call, and post-only
  - swipe to acknowledge and to resolve
  - add a note
  - call everyone again, and call the backup
  - slide to acknowledge on Page, and resolve
  - trade and undo, leave, ask for cover, take a weekend
  - admin role and rotation changes
  - edit profile, coverage, resend, sign out
  - the activity log
  - wake-up checks: skip, and finish
  - light and dark on one screen
- [ ] **Step 2:** Run `maestro test e2e/flows/` on the iOS simulator and the Android emulator. Expected: every flow passes on both.
- [ ] **Step 3:** In `release-checklist.md`, repeat Task 1's table on release builds (TestFlight and an internal testing track) for every release. The release can ship only when every "Rings?" cell is yes for the allowed-Focus and DND-access rows.
- [ ] **Step 4:** Add store submission notes to `release-checklist.md` (spec D16):
  - **App Review notes:** "PagerDiem wakes on-call engineers when production breaks. Every VoIP push is a real incoming page shown as a CallKit call. Answering acknowledges the page, and no audio is exchanged."
  - **Demo account:** a pairing link to a demo server.
  - **Play Console:** the full-screen intent declaration (alarm-style app), plus a demo video of a page ringing.
- [ ] **Step 5:** Commit: `test(mobile): end-to-end flows and the release ring checklist`. Open the draft PR "Phone app", linking the spec, both plans and the canvas.

### Task 13 (after v1, D14): Live Activity

**Needs:** server Task 9.
**Files:** `mobile/targets/live-activity/` (SwiftUI widget through `@bacons/apple-targets`), `mobile/modules/live-activity/` (Expo module: `start(state)`, `update(state)`, `end()`, `onPushToken(cb)`), an App Intent for Acknowledge that calls the API with the device token from a shared keychain group, and tests for the JS module wrapper.
- Content: the canvas Lock board. It shows the shift time left when quiet, and the page with timer, ringing names, the backup time and Acknowledge when paging.
- Same five-step shape as the other tasks.
