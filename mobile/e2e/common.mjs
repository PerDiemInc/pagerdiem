// Settings shared by the e2e server and the sign-in link helper.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DB = path.join(os.tmpdir(), 'pagerdiem-e2e.db');
export const ENV = {
  PORT: '3000',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_PATH: DB,
  SESSION_SECRET: 'e2e-secret',
  API_TOKEN: 'e2e-token',
  ALLOWED_EMAIL_DOMAINS: 'example.com',
  TEAM_NAME: 'Acme Engineering',
  TEAM_TIMEZONE: 'America/New_York',
  ON_CALL_DAYS: 'MON,TUE,WED,THU,FRI,SAT,SUN',
  ON_CALL_START: '00:00',
  ON_CALL_END: '23:59',
};

/** A fresh pagerdiem://connect link for someone on the e2e server (codes last 10 minutes). */
export async function link(firstName, platform = 'ios') {
  Object.assign(process.env, ENV);
  const { openDb } = await import(path.join(ROOT, 'src/db.js'));
  const { pairingCode } = await import(path.join(ROOT, 'src/devices.js'));
  const db = await openDb(DB);
  const user = await db.get('SELECT id FROM users WHERE email = ?', [`${firstName.toLowerCase()}@example.com`]);
  await db.close();
  if (!user) throw new Error(`No one called ${firstName} on the e2e server`);
  const server = platform === 'android' ? 'http://10.0.2.2:3000' : ENV.PUBLIC_URL;
  return `pagerdiem://connect?server=${encodeURIComponent(server)}&code=${encodeURIComponent(pairingCode(user.id))}`;
}
