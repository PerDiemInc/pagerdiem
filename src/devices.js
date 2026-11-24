// Phones signed in to the PagerDiem app: sign-in tokens, push tokens and wake-up checks.
// A phone signs in by scanning a one-time pairing code from the web Team page.
import crypto from 'node:crypto';
import { signPayload, readPayload, safeEqual } from './auth.js';
import { claimOnce } from './db.js';
import { HttpError } from './http.js';

const HOUR = 3_600_000;
const PAIRING_SECONDS = 600;
export const PLATFORMS = ['ios', 'android'];
const CHECKS = ['notifications', 'focus', 'ringer', 'fullScreen', 'dndAccess'];

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const cleanDeviceName = (value) => String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 60) || 'Phone';

/** What the app sends when it starts a sign-in: base64url(sha256(verifier)), as in OAuth PKCE. */
export const challengeFor = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Does the verifier the app sent match the challenge it started the sign-in with? */
export const verifierMatches = (challenge, verifier) => Boolean(verifier) && safeEqual(challengeFor(verifier), challenge);

/**
 * A one-time code that signs this person's phone in. Valid for 10 minutes. A code that travels
 * back to the app through a pagerdiem:// link carries the app's challenge, so another app that
 * catches the link can't use it without the verifier only the real app holds.
 */
export function pairingCode(userId, { challenge } = {}) {
  return signPayload({ uid: userId, nonce: crypto.randomBytes(12).toString('hex'), ...(challenge ? { ch: challenge } : {}) }, PAIRING_SECONDS);
}

/** The user id a pairing code was made for, or null if it's invalid, expired, already used or the verifier is wrong. */
export async function redeemPairingCode(db, code, verifier) {
  const payload = readPayload(code);
  if (!payload?.uid || !payload.nonce) return null;
  if (payload.ch && !verifierMatches(payload.ch, verifier)) return null; // checked before the code is spent
  if (!(await claimOnce(db, `pair:${payload.nonce}`))) return null;
  return Number(payload.uid);
}

export function makeDevices(db) {
  const get = (id) => db.get('SELECT * FROM devices WHERE id = ?', [id]);

  /** Sign a phone in. Returns the stored row and the token, which only the phone keeps. */
  async function create(userId, { platform, name }, now = new Date()) {
    if (!PLATFORMS.includes(platform)) throw new HttpError(400, 'Unknown platform. Use ios or android.');
    const token = crypto.randomBytes(32).toString('base64url');
    const iso = now.toISOString();
    const { id } = await db.get(`INSERT INTO devices (user_id, platform, name, token_hash, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`, [userId, platform, cleanDeviceName(name), hash(token), iso, iso]);
    return { device: await get(Number(id)), token };
  }

  /** The phone and its person for a sign-in token, or null when signed out or removed from the team. */
  async function authenticate(token, now = new Date()) {
    if (!token) return null;
    const device = await db.get('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL', [hash(token)]);
    if (!device) return null;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [device.user_id]);
    if (!user?.active) return null;
    // At most one write an hour, so a busy phone doesn't keep a serverless database awake.
    if (now - new Date(device.last_seen_at) > HOUR) {
      await db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [now.toISOString(), device.id]);
    }
    return { device, user };
  }

  async function update(id, { pushToken, checks } = {}) {
    if (pushToken !== undefined) {
      const value = pushToken ? String(pushToken).slice(0, 4096) : null;
      // A push token belongs to one install. After a reinstall only the newest sign-in keeps it.
      if (value) await db.run('UPDATE devices SET push_token = NULL WHERE push_token = ? AND id != ?', [value, id]);
      await db.run('UPDATE devices SET push_token = ? WHERE id = ?', [value, id]);
    }
    if (checks && typeof checks === 'object') {
      const current = JSON.parse((await get(id)).checks || '{}');
      for (const key of CHECKS) if (typeof checks[key] === 'boolean') current[key] = checks[key];
      await db.run('UPDATE devices SET checks = ? WHERE id = ?', [JSON.stringify(current), id]);
    }
    return get(id);
  }

  /** Signed-in phones that can be called. */
  const forUser = (userId) => db.all(
    'SELECT * FROM devices WHERE user_id = ? AND revoked_at IS NULL AND push_token IS NOT NULL ORDER BY id', [userId]);
  /** Every signed-in phone, for the Team page. */
  const listForUser = (userId) => db.all('SELECT * FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY id', [userId]);
  const clearPushToken = (pushToken) => db.run('UPDATE devices SET push_token = NULL WHERE push_token = ?', [pushToken]);
  const revoke = (id, now = new Date()) => db.run(
    'UPDATE devices SET revoked_at = ?, push_token = NULL WHERE id = ? AND revoked_at IS NULL', [now.toISOString(), id]);
  const markTested = (id, at = new Date()) => db.run('UPDATE devices SET tested_at = ? WHERE id = ?', [at.toISOString(), id]);

  function toJson(device) {
    const checks = Object.fromEntries(CHECKS.map((key) => [key, false]));
    Object.assign(checks, JSON.parse(device.checks || '{}'));
    return { id: Number(device.id), platform: device.platform, pushReady: Boolean(device.push_token), testedAt: device.tested_at ?? null, checks };
  }

  return { get, create, authenticate, update, forUser, listForUser, clearPushToken, revoke, markTested, toJson };
}
