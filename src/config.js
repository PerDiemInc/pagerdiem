// All settings come from the environment (twelve-factor). See .env.example.
import crypto from 'node:crypto';
import { coverageFromEnv } from './settings.js';

const env = process.env;

function int(name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got "${v}"`);
  return n;
}

// "FRI 18:00" -> { day: 5, hour: 18, minute: 0 }
const DAYS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
export function parseDayTime(value) {
  const m = /^(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(\d{1,2}):(\d{2})$/i.exec(String(value).trim());
  if (!m) throw new Error(`Expected a value like "FRI 18:00", got "${value}"`);
  return { day: DAYS[m[1].toUpperCase()], hour: Number(m[2]), minute: Number(m[3]) };
}

const isProd = env.NODE_ENV === 'production';

/** The Postgres that `docker compose up -d db` starts (see docker-compose.yml). */
export const LOCAL_POSTGRES = 'postgres://pagerdiem:pagerdiem@localhost:5432/pagerdiem';

/**
 * PagerDiem uses PostgreSQL. SQLite is an explicit opt-in (DATABASE_PATH) for a quick local try;
 * production needs DATABASE_URL because a SQLite file on a host's disk is lost on redeploy.
 */
export function databaseProblem(source) {
  if (source.NODE_ENV === 'production' && !source.DATABASE_URL && !source.DATABASE_PATH) {
    return 'DATABASE_URL is required in production (a PostgreSQL connection string, like postgres://user:password@host:5432/dbname).';
  }
  return null;
}

/**
 * In production, a connected Slack must be pinned to your workspace: without SLACK_TEAM_ID any
 * workspace holding a valid signature is accepted. ALLOW_ANY_SLACK_WORKSPACE=true opts out.
 */
/** The /ping AI check is off unless PING_ENABLED=true, and then it needs a Claude API key or a routine. */
export function pingProblem(source) {
  if (source.PING_ENABLED !== 'true') return null;
  const api = Boolean(source.ANTHROPIC_API_KEY);
  const routine = Boolean(source.PING_ROUTINE_URL && source.PING_ROUTINE_TOKEN);
  if (!api && !routine) {
    return 'PING_ENABLED=true needs ANTHROPIC_API_KEY (your Claude API key) or PING_ROUTINE_URL with PING_ROUTINE_TOKEN.';
  }
  return null;
}

export function slackTeamProblem(source) {
  const slackOn = Boolean(source.SLACK_BOT_TOKEN || source.SLACK_SIGNING_SECRET);
  if (source.NODE_ENV === 'production' && slackOn && !source.SLACK_TEAM_ID && source.ALLOW_ANY_SLACK_WORKSPACE !== 'true') {
    return 'SLACK_TEAM_ID is required in production when Slack is connected (your workspace ID, like T0123456789). Set ALLOW_ANY_SLACK_WORKSPACE=true only if you really want to accept any workspace.';
  }
  return null;
}
/** Push keys for the phone app. All optional: without them calls are logged as dry-run. */
export function readPushConfig(source) {
  const privateKey = (source.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n'); // a key pasted with \n instead of line breaks
  let validKey = false;
  try {
    validKey = Boolean(privateKey) && crypto.createPrivateKey(privateKey).asymmetricKeyType === 'ec';
  } catch { /* reported by pushWarnings */ }
  let serviceAccount = null;
  try {
    const parsed = JSON.parse(source.FCM_SERVICE_ACCOUNT || 'null');
    if (parsed?.project_id && parsed.client_email && parsed.private_key) serviceAccount = parsed;
  } catch { /* reported by pushWarnings */ }
  return {
    apns: {
      keyId: source.APNS_KEY_ID || '',
      teamId: source.APNS_TEAM_ID || '',
      privateKey,
      enabled: Boolean(source.APNS_KEY_ID && source.APNS_TEAM_ID && validKey),
      bundleId: source.APNS_BUNDLE_ID || 'com.tryperdiem.pagerdiem',
      // TestFlight and App Store builds use production; only Xcode debug builds use the sandbox.
      host: source.APNS_ENV === 'development' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com',
    },
    fcm: { serviceAccount },
  };
}

/** Half-configured push keys turn that platform's calls off. Shown at startup; never fatal. */
export function pushWarnings(source) {
  const warnings = [];
  const apns = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY'].filter((k) => source[k]);
  if (apns.length && apns.length < 3) warnings.push('Phone calls on iPhone are off: set APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY.');
  else if (apns.length === 3 && !readPushConfig(source).apns.enabled) warnings.push('Phone calls on iPhone are off: APNS_PRIVATE_KEY is not a valid .p8 key.');
  if (source.FCM_SERVICE_ACCOUNT && !readPushConfig(source).fcm.serviceAccount) {
    warnings.push('Phone calls on Android are off: FCM_SERVICE_ACCOUNT must be the service account JSON from Firebase.');
  }
  return warnings;
}

{
  const problem = databaseProblem(env) || slackTeamProblem(env) || pingProblem(env);
  if (problem) throw new Error(problem);
}

if (isProd && !env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

// The app is for one company's team: production must name the allowed email domain(s).
if (isProd && !(env.ALLOWED_EMAIL_DOMAINS || '').trim()) {
  throw new Error('ALLOWED_EMAIL_DOMAINS must be set in production (e.g. yourcompany.com)');
}

export const config = {
  port: int('PORT', 3000),
  // Render sets RENDER_EXTERNAL_URL automatically, so PUBLIC_URL is optional there.
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${int('PORT', 3000)}`).replace(/\/$/, ''),
  // Free hosts (Render) sleep after ~15 idle minutes, which would stop reminders and escalation.
  // When on, the app requests its own public URL every 10 minutes to stay awake.
  keepAwake: (env.KEEP_AWAKE ?? (env.RENDER ? 'true' : 'false')) === 'true',
  // PostgreSQL by default (the local Docker one, or DATABASE_URL, e.g. Neon in production).
  // A SQLite file only when someone asks for it with DATABASE_PATH.
  database: env.DATABASE_URL || env.DATABASE_PATH || LOCAL_POSTGRES,
  isProd,
  // Branding: shown in the header, sign-in page and calendar feed.
  appName: env.APP_NAME || 'PagerDiem',
  teamName: env.TEAM_NAME || 'the team',
  // A random secret is fine locally; sessions just reset when the server restarts.
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),

  // Only Google Workspace accounts on these domains can sign in (comma-separated).
  // Empty = anyone, which is allowed only for local development.
  allowedEmailDomains: (env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),

  // The weekend shift, in the team's time zone.
  timezone: env.TEAM_TIMEZONE || 'America/New_York',
  shiftStart: parseDayTime(env.SHIFT_START || 'FRI 18:00'),
  shiftEnd: parseDayTime(env.SHIFT_END || 'MON 09:00'),
  // Or set ON_CALL_DAYS (e.g. FRI,SAT,SUN) with ON_CALL_START / ON_CALL_END and
  // PEOPLE_ON_WEEKEND_DAYS / PEOPLE_ON_WEEKDAYS. An admin can still change these in Settings.
  coverage: coverageFromEnv(env),
  reminderHoursBefore: int('REMINDER_HOURS_BEFORE', 24),
  // How many people the rotation puts on each weekend (anyone can add themselves on top).
  perWeekend: int('PEOPLE_PER_WEEKEND', 2),

  // Escalation: page the on-call, then the backup, then the whole channel.
  escalateAfterMinutes: int('ESCALATE_AFTER_MINUTES', 15),
  repageEveryMinutes: int('REPAGE_EVERY_MINUTES', 5),
  // Phone app: call again this soon after the first page, so a repeated call gets through Do Not Disturb.
  secondCallAfterMinutes: int('SECOND_CALL_AFTER_MINUTES', 2),
  push: readPushConfig(env),

  apiToken: env.API_TOKEN || '',

  // Optional AI check behind the /ping Slack command. Off by default.
  ping: {
    enabled: env.PING_ENABLED === 'true',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    model: env.PING_MODEL || 'claude-sonnet-5-5',
    skillFile: env.PING_SKILL_FILE || 'skills/ping.md',
    cooldownSeconds: int('PING_COOLDOWN_SECONDS', 120),
    maxPerDay: int('PING_MAX_PER_DAY', 30),
    checkUrls: (env.PING_CHECK_URLS || '').split(',').map((u) => u.trim()).filter(Boolean),
    routineUrl: env.PING_ROUTINE_URL || '',
    routineToken: env.PING_ROUTINE_TOKEN || '',
  },

  // Secret behind the calendar feed link. Change it to revoke every existing link. Defaults to a key
  // derived from SESSION_SECRET, so old links keep working until you set one.
  calendarFeedSecret: env.CALENDAR_FEED_SECRET || '',

  // Google sign-in. When set, Google (limited to allowedEmailDomains) is the only way in.
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },

  slack: {
    botToken: env.SLACK_BOT_TOKEN || '',
    signingSecret: env.SLACK_SIGNING_SECRET || '',
    channel: env.SLACK_ONCALL_CHANNEL || '', // channel ID, e.g. C0123456789
    channelName: (env.SLACK_ONCALL_CHANNEL_NAME || 'on-call').replace(/^#/, ''), // only shown in messages and logs
    // Only accept slash commands / button clicks from this Slack workspace (team ID, e.g. T0123456).
    teamId: env.SLACK_TEAM_ID || '',
    engineersGroupId: /^S[A-Z0-9]{6,}$/.test(env.SLACK_ENGINEERS_GROUP_ID || '') ? env.SLACK_ENGINEERS_GROUP_ID : '',
  },

  // Team WhatsApp group invite link, shown to signed-in teammates as a "Join" button.
  whatsappGroupUrl: /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(env.WHATSAPP_GROUP_URL || '') ? env.WHATSAPP_GROUP_URL : '',
};

export const googleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);
export const slackEnabled = () => Boolean(config.slack.botToken);
export const pushEnabled = () => ({
  ios: config.push.apns.enabled,
  android: Boolean(config.push.fcm.serviceAccount),
});

