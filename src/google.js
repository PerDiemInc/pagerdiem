// "Sign in with Google" (OpenID Connect, authorization-code flow), limited to your company's
// Google Workspace domain(s) in ALLOWED_EMAIL_DOMAINS. No dependencies.
// https://developers.google.com/identity/openid-connect/openid-connect
import { config } from './config.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const redirectUri = () => `${config.publicUrl}/auth/google/callback`;

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

/**
 * Exchange the code for tokens and return the verified identity { email, name }.
 * The ID token comes straight from Google's token endpoint over TLS, so per Google's docs
 * its signature doesn't need re-checking; we still validate its claims.
 */
export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);

  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8'));
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) throw new Error('Unexpected token issuer');
  if (claims.aud !== config.google.clientId) throw new Error('Token was not issued for this app');
  if (claims.exp * 1000 < Date.now()) throw new Error('Token expired');
  if (claims.email_verified !== true) throw new Error('Google has not verified this email');

  const email = String(claims.email).toLowerCase();
  const domain = email.split('@')[1];
  // Only accounts managed by a Google Workspace carry `hd` (personal Gmail doesn't), and only
  // your Workspace can hold verified addresses on your domain. `hd` itself may be the
  // organization's primary domain rather than the email's, so the email domain is what we match.
  const allowed = config.allowedEmailDomains;
  if (!claims.hd || (allowed.length && !allowed.includes(domain))) {
    const err = new Error(`Only @${allowed.join(' / @')} Google Workspace accounts can use PagerDiem.`);
    err.status = 403;
    throw err;
  }
  return { email, name: claims.name || email.split('@')[0] };
}
