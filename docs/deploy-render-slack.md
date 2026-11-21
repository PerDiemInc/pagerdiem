# Deploy on Render + Neon, with Slack and Google sign-in

This is the free setup: Render runs the Docker container, Neon hosts Postgres, Google handles
sign-in, and Slack delivers pages. Allow about 30 minutes.

You'll need admin access to your Google Workspace's Google Cloud organization and to your
Slack workspace, plus a GitHub account.

Free-tier notes:

- Render's free web services sleep after 15 idle minutes. PagerDiem pings itself every
  10 minutes (`KEEP_AWAKE`, on by default on Render), so reminders and escalation keep running.
- Render's free disk is wiped on restart, which is why the data lives in Neon.
- Run **one** instance. The scheduler runs inside the web process.

## 1. Fork the repository

Fork this repo into your GitHub account or organization. Render deploys from it, and every
push to `main` redeploys.

## 2. Database: Neon

1. Sign in at <https://neon.tech> and create a project (Postgres 16 or newer). Pick the region
   closest to where you'll run Render. Oregon pairs with Render's Oregon region.
2. Open **Connect** and copy the connection string. It looks like
   `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require`.

PagerDiem creates its tables on first start. No migration step needed.

## 3. Web service: Render

1. Sign in at <https://dashboard.render.com> with GitHub, and let Render's GitHub app access your fork.
2. **New → Web Service** and pick your fork.
   - **Language:** Docker (detected from the `Dockerfile`)
   - **Region:** same as Neon
   - **Instance type:** Free
3. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the Neon connection string |
   | `SESSION_SECRET` | click **Generate** |
   | `API_TOKEN` | click **Generate** |
   | `ALLOWED_EMAIL_DOMAINS` | your Workspace email domain, e.g. `example.com` |
   | `TEAM_NAME` | e.g. `Example Engineering` |
   | `TEAM_TIMEZONE` | e.g. `America/New_York` |

4. **Deploy web service.** Note the address Render gives you, e.g. `https://your-app.onrender.com`.
   That's your `PUBLIC_URL`; Render sets it automatically, so you don't need to add it.

Once deployed, opening the site shows *"Sign-in isn't set up yet."* That's expected:
production lets nobody in until Google sign-in is configured.

> Prefer infrastructure-as-code? [render.yaml](../render.yaml) is a Blueprint with the same
> settings: **New → Blueprint**, pick your fork, and fill in the values it asks for.

## 4. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/projectcreate), create a project
   (e.g. `pagerdiem`) **under your company's organization**.
2. **Google Auth Platform → Get started**:
   - App name: `PagerDiem`; support email: a team address
   - **Audience: Internal**. Only accounts in your Workspace can sign in.
   - Contact email, accept the policy, **Create**.
3. **Clients → Create client → Web application**:
   - Authorized redirect URI: `https://your-app.onrender.com/auth/google/callback`
   - **Create**, then copy the **Client ID** and **Client secret**.
4. In Render → your service → **Environment**, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`,
   then **Save, rebuild, and deploy**.

The sign-in page now shows **Sign in with Google**. Sign in first: the first person becomes the admin.

## 5. Slack app

1. Open [slack-app-manifest.yml](../slack-app-manifest.yml) and replace every
   `https://YOUR-APP.example.com` with your Render address.
2. Go to <https://api.slack.com/apps> → **Create New App → From a manifest**, choose your workspace,
   paste the manifest (YAML tab), then **Create** and **Install to workspace**.
   The manifest turns on the app's **Messages tab**. Slack refuses bot DMs without it
   (error `messages_tab_disabled`).
3. Copy two values into Render's **Environment**:

   | Key | Where in the Slack app |
   |---|---|
   | `SLACK_BOT_TOKEN` | **OAuth & Permissions → Bot User OAuth Token** (`xoxb-…`) |
   | `SLACK_SIGNING_SECRET` | **Basic Information → App Credentials → Signing Secret** |

4. Pick the channel for on-call posts. Get its ID from Slack (channel name → **About**, at the bottom,
   starts with `C`) and add:

   | Key | Value |
   |---|---|
   | `SLACK_ONCALL_CHANNEL` | the channel ID |
   | `SLACK_TEAM_ID` | your workspace ID, starting with `T`. It's in the URL of your Slack app settings page. |
   | `SLACK_ENGINEERS_GROUP_ID` | optional: a user group ID (`S…`) to tag when an incident starts |

5. **Save, rebuild, and deploy.**
6. In Slack, run `/invite @PagerDiem` in that channel. Without this, channel posts fail with `not_in_channel`.

## 6. Check it

1. **Settings** should show **Slack: connected**.
2. **Team → Send me a test message**: you should get a Slack DM, and the note should read *Slack sent*.
3. In Slack, run `/oncall` to see who's on call.
4. Ask the team to sign in. Each person enters their own Slack account and phone number.
   An admin sets roles on the **Team** page: *Engineer* puts someone in the rotation.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `/page` says *"app did not respond"* | `SLACK_SIGNING_SECRET` missing or wrong, a wrong `SLACK_TEAM_ID` (403), or the free instance was asleep. The first request after a cold start can take ~50 s. |
| Test DM fails with `messages_tab_disabled` | Slack app → **App Home → Show Tabs → Messages Tab**: turn it on. |
| Channel posts fail with `not_in_channel` | Run `/invite @PagerDiem` in the on-call channel. |
| Google says *redirect_uri_mismatch* | The redirect URI in the Google client must exactly match `https://your-app.onrender.com/auth/google/callback`. |
| *"Only … Google Workspace accounts can use PagerDiem"* | The account isn't on `ALLOWED_EMAIL_DOMAINS`, or it's a personal Gmail. |
| Settings still says *dry-run* after adding Slack keys | The variables weren't saved: Render only applies them after **Save, rebuild, and deploy**. |
| Messages sent before Slack was connected | **Settings → Re-send this weekend's on-call messages** (admins). |
