// Slack delivery and phone app calls. Every message is recorded in the notifications table.
// When a channel isn't configured the message is logged as "dry-run" instead of sent,
// so the whole app can be tried locally without any credentials.
import { config, slackEnabled, pushEnabled } from '../config.js';
import * as slack from './slack.js';
import { makeApns } from './apns.js';
import { makeFcm } from './fcm.js';
import { makeDevices } from '../devices.js';

export function makeNotifier(db, overrides = {}) {
  const devices = makeDevices(db);
  const send = {
    slack: overrides.slack ?? (slackEnabled() ? (to, text, blocks) => slack.postMessage(to, text, blocks) : null),
  };
  const insert = (...values) => db.run(`INSERT INTO notifications (at, channel, recipient, body, status, error, incident_id, device_id)
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, values);

  // Push senders are created on first use, so a server with no phones never opens a connection.
  let apns = null;
  let fcm = null;
  async function realPush(device, payload) {
    if (device.platform === 'ios') {
      apns ??= makeApns(config.push.apns);
      return apns.sendVoip(device.push_token, payload);
    }
    fcm ??= makeFcm({ serviceAccount: config.push.fcm.serviceAccount });
    // FCM data messages carry string values only. A cancel reaches a phone that's ringing, so awake.
    return fcm.send(device.push_token, Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])),
      { priority: payload.type === 'cancel' ? 'NORMAL' : 'HIGH' });
  }
  const pushSender = (device) => overrides.push ?? (pushEnabled()[device.platform] ? realPush : null);

  async function deliver(channel, recipient, body, fn, incidentId, deviceId = null) {
    const at = new Date().toISOString();
    if (!fn) {
      await insert(at, channel, recipient, body, 'dry-run', null, incidentId ?? null, deviceId);
      console.log(`[dry-run ${channel} -> ${recipient}] ${body.replace(/\n/g, ' | ')}`);
      return { ok: true, dryRun: true };
    }
    try {
      await fn();
      await insert(at, channel, recipient, body, 'sent', null, incidentId ?? null, deviceId);
      return { ok: true };
    } catch (err) {
      await insert(at, channel, recipient, body, 'failed', String(err.message || err), incidentId ?? null, deviceId);
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

  /** Ring one phone. A phone whose push token is gone for good stops being called. */
  async function callDevice(device, u, { payload, incidentId = null }) {
    const sender = pushSender(device);
    const label = `${u.name} (${device.platform === 'ios' ? 'iPhone' : 'Android'}: ${device.name})`;
    const body = payload.type === 'cancel' ? `Stop ringing for incident #${payload.incidentId}`
      : `${payload.type === 'test' ? 'Test call' : 'Call'}: ${payload.title}`;
    const result = await deliver('push', label, body, sender && (async () => {
      const r = await sender(device, payload);
      if (r && r.ok === false) throw Object.assign(new Error(r.gone ? 'Phone is no longer registered' : `Push failed: ${r.reason}`), { gone: r.gone });
    }), incidentId, Number(device.id));
    if (result.error?.gone) await devices.clearPushToken(device.push_token);
    return result;
  }

  /** Ring every phone this person has signed in to the app, all at once. */
  async function call(u, { payload, incidentId }) {
    return Promise.all((await devices.forUser(u.id)).map((device) => callDevice(device, u, { payload, incidentId })));
  }

  /**
   * Stop the Android phones that rang for an incident someone picked up. iPhones check the
   * incident while ringing instead, because Apple requires every VoIP push to show a call.
   */
  async function cancelCalls(incidentId) {
    const rang = await db.all(`SELECT DISTINCT d.id, d.platform, d.name, d.push_token, u.name AS user_name
      FROM notifications n JOIN devices d ON d.id = n.device_id JOIN users u ON u.id = d.user_id
      WHERE n.incident_id = ? AND n.channel = 'push' AND d.platform = 'android' AND d.revoked_at IS NULL AND d.push_token IS NOT NULL`,
    [incidentId]);
    await Promise.all(rang.filter((device) => pushSender(device)) // nothing rings on a dry-run server
      .map((device) => callDevice(device, { name: device.user_name }, { payload: { type: 'cancel', incidentId: String(incidentId) } })));
  }

  return { user, channel, call, callDevice, cancelCalls };
}
