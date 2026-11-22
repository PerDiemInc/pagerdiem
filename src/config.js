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

/**
 * In production, a connected Slack must be pinned to your workspace: without SLACK_TEAM_ID any
 * workspace holding a valid signature is accepted. ALLOW_ANY_SLACK_WORKSPACE=true opts out.
 */
export function slackTeamProblem(source) {
  const slackOn = Boolean(source.SLACK_BOT_TOKEN || source.SLACK_SIGNING_SECRET);
  if (source.NODE_ENV === 'production' && slackOn && !source.SLACK_TEAM_ID && source.ALLOW_ANY_SLACK_WORKSPACE !== 'true') {
    return 'SLACK_TEAM_ID is required in production when Slack is connected (your workspace ID, like T0123456789). Set ALLOW_ANY_SLACK_WORKSPACE=true only if you really want to accept any workspace.';
  }
  return null;
}
{
  const problem = slackTeamProblem(env);
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
  // Postgres URL in production (e.g. Neon); otherwise a local SQLite file.
  database: env.DATABASE_URL || env.DATABASE_PATH || 'data/pagerdiem.db',
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

  apiToken: env.API_TOKEN || '',

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

