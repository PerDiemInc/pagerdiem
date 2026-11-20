// Slack Web API calls with a bot token (chat:write, users:read, users:read.email, im:write).
import crypto from 'node:crypto';
import { config } from '../config.js';

async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${config.slack.botToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

/** Post to a channel ID, or to a user ID (Slack opens the DM with the bot). */
export function postMessage(channel, text, blocks) {
  return slackApi('chat.postMessage', { channel, text, blocks, unfurl_links: false });
}

/** Find a Slack member ID from their Slack email. Returns null if not found. */
export async function lookupUserIdByEmail(email) {
  const url = `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.slack.botToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  return data.ok ? data.user.id : null;
}

/**
 * Verify a request really came from Slack (v0 signing secret scheme).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(headers, rawBody, now = Date.now()) {
  const secret = config.slack.signingSecret;
  if (!secret) return false;
  const ts = headers['x-slack-request-timestamp'];
  const sig = headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 60 * 5) return false; // replay protection
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const mention = (user) =>
  (/^[UW][A-Z0-9]{6,}$/.test(user?.slack_user_id || '') ? `<@${user.slack_user_id}>` : user?.name ?? 'nobody');

export const engineersTag = (fallback = '') =>
  (config.slack.engineersGroupId ? `<!subteam^${config.slack.engineersGroupId}>` : fallback);
