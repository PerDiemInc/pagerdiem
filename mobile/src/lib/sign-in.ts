// Signing this phone in to a pagerdiem server: by a code from the web Team page, or with Google.
// Google sign-in is bound to this app the way OAuth PKCE is: the app sends a challenge, and the
// code that comes back only works with the verifier only this app holds.
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { createClient, type Me } from '@/lib/api';

export type ConnectLink = { server?: string; code?: string; pending?: string; error?: string };
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The parts of a pagerdiem://connect link, or null if it's anything else. */
export function parseConnectLink(url: string): ConnectLink | null {
  const match = /^pagerdiem:\/\/\/?connect\/?\?(.*)$/.exec(url);
  if (!match) return null;
  const link: ConnectLink = {};
  for (const pair of match[1].split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key === 'server' || key === 'code' || key === 'pending' || key === 'error') {
      link[key] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }
  return link;
}

const base64url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newVerifier() {
  return base64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32))));
}

export async function challengeFor(verifier: string) {
  return base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
}

type SignedIn = { token: string; me: Me };
const device = () => ({ platform: Platform.OS as 'ios' | 'android', deviceName: Device.deviceName ?? 'Phone' });

export function pairPhone({ server, code, verifier }: { server: string; code: string; verifier?: string }, fetchImpl?: Fetch) {
  return createClient({ server, fetchImpl }).post<SignedIn>('/api/app/pair', { code, ...device(), ...(verifier ? { verifier } : {}) });
}

export function signUp(
  { server, pending, name, slack, phone, verifier }: { server: string; pending: string; name: string; slack: string; phone: string; verifier?: string },
  fetchImpl?: Fetch,
) {
  return createClient({ server, fetchImpl }).post<SignedIn>('/api/app/signup', { pending, name, slack, phone, ...device(), ...(verifier ? { verifier } : {}) });
}

/** Name and email from a signed pending sign-up, to fill in About you. Null if unreadable. */
export function readPendingIdentity(pending: string): { email: string; name: string } | null {
  try {
    const json = JSON.parse(atob(pending.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.email === 'string' ? { email: json.email, name: String(json.name ?? '') } : null;
  } catch {
    return null;
  }
}

/**
 * A Google sign-up being finished on About you: set only by Sign in, in memory, never read from a
 * route URL, so a crafted link can't open About you for someone else's server.
 */
export const pendingSignUp: { server?: string; pending?: string; verifier?: string } = {};

/** Opens the server's Google sign-in in a browser sheet. Null if the person closed it. */
export async function googleSignIn(server: string) {
  const verifier = newVerifier();
  const challenge = await challengeFor(verifier);
  const result = await WebBrowser.openAuthSessionAsync(`${server}/auth/google?app=1&challenge=${challenge}`, 'pagerdiem://connect');
  if (result.type !== 'success') return null;
  return { link: parseConnectLink(result.url), verifier };
}
