// WhatsApp messages through Twilio's Messages API.
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Send a WhatsApp message. If `template` is given ({ sid, variables }) it is sent as an
 * approved Content Template, which WhatsApp requires when the person hasn't messaged
 * the business number in the last 24 hours. Otherwise a free-form body is sent.
 */
export async function sendWhatsApp(toE164, body, template) {
  const { accountSid, authToken, apiKeySid, apiKeySecret, from } = config.whatsapp;
  const [user, pass] = apiKeySid && apiKeySecret ? [apiKeySid, apiKeySecret] : [accountSid, authToken];
  const form = new URLSearchParams({ From: from, To: `whatsapp:${toE164}` });
  if (template?.sid) {
    form.set('ContentSid', template.sid);
    form.set('ContentVariables', JSON.stringify(template.variables || {}));
  } else {
    form.set('Body', body);
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${data.message || res.statusText}`);
  return data;
}

/**
 * Verify X-Twilio-Signature on an incoming webhook.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function verifyTwilioSignature(url, params, signature) {
  const token = config.whatsapp.authToken;
  if (!token || !signature) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Normalise user input to E.164 (+ and digits). Returns null if it doesn't look valid. */
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  // Assume US/Canada for 10-digit numbers typed without a country code.
  if (!raw.startsWith('+') && digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}
