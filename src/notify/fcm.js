// Firebase Cloud Messaging (HTTP v1) for Android: high-priority data messages that wake the app
// to show a full-screen incoming call. Signs in with the service account's key; no Firebase SDK.
import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** serviceAccount: the JSON key from Firebase → Project settings → Service accounts. */
export function makeFcm({ serviceAccount, fetchImpl = fetch }) {
  let access = null;
  let expiresAt = 0;
  let signingIn = null; // one sign-in shared by sends that start at the same moment

  function accessToken(now = Date.now()) {
    if (access && now < expiresAt) return access;
    signingIn ??= signIn(now).finally(() => { signingIn = null; });
    return signingIn;
  }

  async function signIn(now) {
    const iat = Math.floor(now / 1000);
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      iss: serviceAccount.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
    })}`;
    const signature = crypto.sign('sha256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Google sign-in for FCM failed: ${json.error_description || json.error || `HTTP ${res.status}`}`);
    access = json.access_token;
    expiresAt = now + (Number(json.expires_in || 3600) - 60) * 1000;
    return access;
  }

  /**
   * data: string values only (FCM's rule). priority NORMAL is for messages to a phone that is
   * already awake (stop ringing): FCM demotes apps that send HIGH messages nobody sees.
   * Resolves { ok: true } or { ok: false, gone, reason }.
   */
  async function send(token, data, { priority = 'HIGH' } = {}) {
    try {
      const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        // A ring that arrives more than a minute late does more harm than good.
        body: JSON.stringify({ message: { token, data, android: { priority, ttl: '60s' } } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true };
      const error = (await res.json().catch(() => ({}))).error || {};
      const code = (error.details || []).map((d) => d.errorCode).find(Boolean);
      if (res.status === 401) access = null; // the access token was rejected: sign in again next time
      return { ok: false, gone: res.status === 404 || code === 'UNREGISTERED', reason: code || error.status || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, gone: false, reason: err.message };
    }
  }

  return { send };
}
