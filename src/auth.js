// Password hashing (scrypt) and stateless signed-cookie sessions.
import crypto from 'node:crypto';
import { config } from './config.js';

const SESSION_COOKIE = 'pd_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sign = (value) => crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');

export function sessionCookie(userId) {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const value = `${userId}.${expires}`;
  const attrs = [
    `${SESSION_COOKIE}=${value}.${sign(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86_400}`,
  ];
  if (config.publicUrl.startsWith('https://')) attrs.push('Secure');
  return attrs.join('; ');
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Returns the user id from a valid session cookie, or null. */
export function sessionUserId(cookieHeader) {
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!raw) return null;
  const [id, expires, sig] = raw.split('.');
  if (!id || !expires || !sig) return null;
  const expected = Buffer.from(sign(`${id}.${expires}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (Number(expires) < Date.now()) return null;
  return Number(id);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
