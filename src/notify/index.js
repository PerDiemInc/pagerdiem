// Slack delivery. Every message is recorded in the notifications table.
// When a channel isn't configured the message is logged as "dry-run" instead of sent,
// so the whole app can be tried locally without any credentials.
import { config, slackEnabled } from '../config.js';
import * as slack from './slack.js';

export function makeNotifier(db, overrides = {}) {
  const send = {
    slack: overrides.slack ?? (slackEnabled() ? (to, text, blocks) => slack.postMessage(to, text, blocks) : null),
  };
  const insert = (...values) => db.run(`INSERT INTO notifications (at, channel, recipient, body, status, error, incident_id)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)`, values);

  async function deliver(channel, recipient, body, fn, incidentId) {
    const at = new Date().toISOString();
    if (!fn) {
      await insert(at, channel, recipient, body, 'dry-run', null, incidentId ?? null);
      console.log(`[dry-run ${channel} -> ${recipient}] ${body.replace(/\n/g, ' | ')}`);
      return { ok: true, dryRun: true };
    }
    try {
      await fn();
      await insert(at, channel, recipient, body, 'sent', null, incidentId ?? null);
      return { ok: true };
    } catch (err) {
      await insert(at, channel, recipient, body, 'failed', String(err.message || err), incidentId ?? null);
      console.error(`[${channel} -> ${recipient}] failed:`, err.message || err);
      return { ok: false, error: err };
    }
  }

  /** DM a person on Slack. */
  async function user(u, { text, blocks, incidentId }) {
    if (!u.slack_user_id) return [];
    return [await deliver('slack', `${u.name} (${u.slack_user_id})`, text,
      send.slack && (() => send.slack(u.slack_user_id, text, blocks)), incidentId)];
  }

  /** Post to the team's on-call Slack channel. */
  async function channel({ text, blocks, incidentId }) {
    const target = config.slack.channel;
    if (send.slack && target) {
      return deliver('slack', `#${config.slack.channelName} (${target})`, text, () => send.slack(target, text, blocks), incidentId);
    }
    if (send.slack) return { ok: false, skipped: true }; // Slack is set up but no channel chosen
    return deliver('slack', `#${config.slack.channelName}`, text, null, incidentId);
  }

  return { user, channel };
}
