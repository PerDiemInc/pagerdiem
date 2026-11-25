// Apple Push Notification service, VoIP pushes only: each one makes the iPhone app show an
// incoming call (CallKit). Plain HTTP/2 and an ES256 token signed with the team's .p8 key.
import http2 from 'node:http2';
import crypto from 'node:crypto';

// Apple rejects tokens older than an hour and throttles refreshing more often than every 20 minutes.
const TOKEN_REUSE_MS = 50 * 60_000;
// A ring that arrives more than a minute late does more harm than good.
const EXPIRE_SECONDS = 60;
// Wrong APNS_ENV or APNS_BUNDLE_ID makes Apple answer these for every phone: a setup mistake,
// not a dead phone, so the phone's token is kept.
const CONFIG_HINTS = {
  BadDeviceToken: 'check APNS_ENV (production for TestFlight and App Store builds, development for Xcode builds)',
  DeviceTokenNotForTopic: 'check APNS_BUNDLE_ID matches the app',
};
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/**
 * host: https://api.push.apple.com, or https://api.sandbox.push.apple.com for Xcode debug builds.
 * Pages are rare, and NATs and firewalls quietly forget idle connections, so a connection idle
 * for longer than idleMs is replaced, and a page that dies on a reused connection is sent again
 * on a fresh one.
 */
export function makeApns({ keyId, teamId, privateKey, bundleId, host, connect = http2.connect, timeoutMs = 10_000, idleMs = 60_000 }) {
  let token = null;
  let tokenAt = 0;
  let session = null;
  let lastUsedAt = 0;

  function authToken(now = Date.now()) {
    if (token && now - tokenAt < TOKEN_REUSE_MS) return token;
    const unsigned = `${b64url({ alg: 'ES256', kid: keyId })}.${b64url({ iss: teamId, iat: Math.floor(now / 1000) })}`;
    const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    token = `${unsigned}.${signature.toString('base64url')}`;
    tokenAt = now;
    return token;
  }

  const live = (s) => s && !s.closed && !s.destroyed;

  function drop(s) {
    if (session === s) session = null;
    s.destroy();
  }

  function openSession() {
    if (live(session) && Date.now() - lastUsedAt > idleMs) drop(session);
    if (live(session)) return { s: session, reused: true };
    const s = connect(host);
    s.on('error', () => { if (session === s) session = null; });
    s.on('goaway', () => { if (session === s) session = null; });
    session = s;
    return { s, reused: false };
  }

  /** One try. retry: it failed on a reused connection before Apple answered, so a fresh one may work. */
  function attempt(deviceToken, payload) {
    return new Promise((resolve) => {
      let s;
      let reused;
      let req;
      try {
        ({ s, reused } = openSession());
        lastUsedAt = Date.now();
        req = s.request({
          ':method': 'POST',
          ':path': `/3/device/${encodeURIComponent(deviceToken)}`,
          authorization: `bearer ${authToken()}`,
          'apns-topic': `${bundleId}.voip`,
          'apns-push-type': 'voip',
          'apns-priority': '10',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + EXPIRE_SECONDS),
          'content-type': 'application/json',
        });
      } catch (err) {
        if (s) drop(s);
        resolve({ result: { ok: false, gone: false, reason: err.message }, retry: Boolean(reused) });
        return;
      }
      let status = 0;
      let body = '';
      const failed = (reason) => {
        drop(s); // don't send the next page down a broken connection
        resolve({ result: { ok: false, gone: false, reason }, retry: reused && !status });
      };
      req.setEncoding('utf8');
      req.on('response', (headers) => { status = headers[':status']; });
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (status === 200) return resolve({ result: { ok: true } });
        if (!status) return failed('Connection closed');
        let reason = `HTTP ${status}`;
        try { reason = JSON.parse(body).reason || reason; } catch { /* empty or non-JSON body: keep the status */ }
        const gone = status === 410 || reason === 'Unregistered';
        resolve({ result: { ok: false, gone, reason: CONFIG_HINTS[reason] ? `${reason}: ${CONFIG_HINTS[reason]}` : reason } });
      });
      req.on('error', (err) => failed(err.message));
      req.setTimeout(timeoutMs, () => {
        req.close(http2.constants.NGHTTP2_CANCEL);
        failed('Timed out');
      });
      req.end(JSON.stringify(payload));
    });
  }

  /** Resolves { ok: true } or { ok: false, gone, reason }. gone: this phone's token will never work again. */
  async function sendVoip(deviceToken, payload) {
    const first = await attempt(deviceToken, payload);
    if (!first.retry) return first.result;
    return (await attempt(deviceToken, payload)).result;
  }

  function close() {
    session?.close();
    session = null;
  }

  return { sendVoip, close };
}
