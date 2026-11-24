# Release checklist

PagerDiem's job is to wake someone. Before every App Store or Play release, check that a page really
rings, on **release builds** (TestFlight, and Play's internal testing track) pointed at a real server
with push keys.

## 1. The ring table

Send a page from the web app's Compose (or `curl`, see `e2e/README.md`) for each row. The release
ships only when **Rings?** is yes on every row marked *must ring*.

| Phone state | Must ring? | Rings? | Volume | Over the lock screen? | Answering acknowledges? |
|---|---|---|---|---|---|
| iPhone locked, ringer on | must ring | | | | |
| iPhone with the app killed (swiped away) | must ring | | | | |
| iPhone in Sleep Focus, PagerDiem allowed | must ring | | | | |
| iPhone in Sleep Focus, PagerDiem not allowed | (expected not to) | | | | |
| iPhone, second call within 2 min, Repeated Calls on | must ring | | | | |
| iPhone with the silent switch on | (vibrates only) | | | | |
| Android locked | must ring | | | | |
| Android with the app killed | must ring | | | | |
| Android in Do Not Disturb, DND access allowed | must ring | | | | |
| Android in Do Not Disturb, DND access not allowed | (expected not to) | | | | |
| Android in Doze (`adb shell dumpsys deviceidle force-idle`) | must ring | | | | |

Also check on each platform:

- Declining shows "Missed page · {title}. We’ll call you again at {time}." and the next call comes.
- Acknowledging on the web while the phone rings stops the ringing within a few seconds.
- After answering, the "Acknowledged" notification opens the incident.
- Answer with the phone locked, the app killed (swiped away) and the server unreachable (Wi-Fi and
  cellular off): the call stays up while the app retries for about 20 s, then "Couldn’t acknowledge"
  appears. Turn the network back on during the retries and it acknowledges.
- Signed out: a page sent to this phone's old token (sign out with no network) rings at most a
  moment and ends by itself.
- "Ring me now" on Wake-up checks rings, and answering it ticks the last step.

## 2. Push keys for the release

- iPhone: `APNS_ENV=production` on the server for TestFlight and App Store builds (`development` only
  for builds installed from Xcode). One `.p8` key works for every app on the team.
- Android: `FCM_SERVICE_ACCOUNT` from the same Firebase project as the build's `google-services.json`.

## 3. Store submission notes (spec D16)

**App Store — App Review notes**

> PagerDiem wakes on-call engineers when production breaks. Every VoIP push is a real incoming page
> shown as a CallKit call. Answering acknowledges the page, and no audio is exchanged.

**Demo account:** a sign-in link (or QR code) for a demo server with a seeded team. The reviewer
needs a way to receive a page: give them a test account that is on call, and steps to press
"Ring me now" in You › Wake-up checks.

If App Review rejects VoIP for pages, the fallback is Time Sensitive alerts with an Acknowledge
button: the same Apple key, with `apns-push-type: alert` instead of `voip` (spec D16).

**Google Play**

- Declare the full-screen intent permission (Android 14 and later) as an alarm-style app, in Play
  Console › App content.
- Attach a short screen recording of a page ringing over the lock screen and being answered.
