// Which pagerdiem server this phone is signed in to, and its sign-in token. Kept in this phone's
// keychain (Android Keystore), readable after the first unlock so a call answered on the lock
// screen can still acknowledge, and never restored onto another phone from a backup (Android
// backups are off in app.config.ts). The team's public address and timezone are kept with it so a
// call can be handled before the app has reached the server.
import * as SecureStore from 'expo-secure-store';

export type Session = { server: string; token: string; publicUrl?: string; timezone?: string };

const KEY = 'pd.session';
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY, options);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    return s.server && s.token ? s : null;
  } catch {
    return null;
  }
}

export const saveSession = (s: Session) => SecureStore.setItemAsync(KEY, JSON.stringify(s), options);

export const clearSession = () => SecureStore.deleteItemAsync(KEY, options);

// Plain http is only for a pagerdiem running on the developer's own machine or network.
const LOCAL = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/** "pd.example.com/team" → "https://pd.example.com". Null if it isn't an address. */
export function normalizeServer(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || (!host.includes('.') && host !== 'localhost')) return null;
  // Release builds always use https; development builds may talk to a local server over http.
  const protocol = __DEV__ && url.protocol === 'http:' && LOCAL.test(host) ? 'http:' : 'https:';
  return `${protocol}//${host}${url.port ? `:${url.port}` : ''}`;
}
