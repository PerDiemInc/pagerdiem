// Team members: sign-up and profile rules shared by the web app and the phone app.
import { slackEnabled } from './config.js';
import { lookupUserIdByEmail, mention } from './notify/slack.js';
import { normalizePhone } from './phone.js';
import { DEFAULT_ROLE, isResponder } from './roles.js';

export const cleanName = (value) => String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REMOVED = "You've been removed from the on-call rotation, so you can't sign in. Ask an admin to add you back.";

export function makeMembers({ db, rotation, notify }) {
  const userCount = async () => (await db.get('SELECT COUNT(*) AS n FROM users')).n;
  const userByEmail = async (email) => (await db.get('SELECT * FROM users WHERE email = ?', [email]));
  const userBySlack = async (id) => (id ? (await db.get('SELECT * FROM users WHERE slack_user_id = ?', [id])) : null);
  const userByPhone = async (phone) => (phone ? (await db.get('SELECT * FROM users WHERE whatsapp = ?', [phone])) : null);

  /** Turn "U0123ABCD" or an email into a Slack member ID (when Slack is connected). */
  async function resolveSlack(value, fallbackEmail) {
    const v = String(value || '').trim() || fallbackEmail;
    if (SLACK_ID.test(v.toUpperCase())) return v.toUpperCase();
    if (!slackEnabled()) return v || null; // dry-run: keep what they typed, relinked once Slack is connected
    return EMAIL.test(v) ? lookupUserIdByEmail(v) : null;
  }

  /** Someone else already uses this Slack account or phone number? Returns { field, message } or null. */
  async function contactClash({ slackId, whatsapp, exceptId = null }) {
    const bySlack = await userBySlack(slackId);
    if (bySlack && bySlack.id !== exceptId) return { field: 'slack', message: `That Slack account already belongs to ${bySlack.name}. Use your own Slack account.` };
    const byPhone = await userByPhone(whatsapp);
    if (byPhone && byPhone.id !== exceptId) return { field: 'whatsapp', message: `That phone number already belongs to ${byPhone.name}. Use your own number.` };
    return null;
  }

  /**
   * Validate and add a team member. Each person must have their own Slack account and
   * phone number. Returns { user, isFirst } or { error }.
   */
  async function createMember({ name, email, slack, whatsapp: rawPhone, passwordHash }) {
    name = cleanName(name);
    const whatsapp = normalizePhone(rawPhone);
    if (!name) return { error: { field: 'name', message: 'Please enter your name.' } };
    if (!whatsapp) return { error: { field: 'whatsapp', message: 'Please enter your phone number with country code, e.g. +1 415 555 0123.' } };
    if (await userByEmail(email)) return { error: { field: 'email', message: 'That email is already signed up — log in instead.' } };
    const slackId = await resolveSlack(slack, email);
    if (!slackId) return { error: { field: 'slack', message: "We couldn't find you on Slack. Enter your Slack member ID (Slack profile → ⋮ → Copy member ID)." } };
    const clash = await contactClash({ slackId, whatsapp });
    if (clash) return { error: clash };

    const isFirst = (await userCount()) === 0;
    const role = isFirst ? 'admin' : DEFAULT_ROLE;
    const { id } = await db.get(`INSERT INTO users (name, email, password_hash, slack_user_id, whatsapp, is_admin, role, rotation_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [name, email, passwordHash, slackId, whatsapp, isFirst ? 1 : 0, role, await rotation.nextRotationOrder()]);
    const user = await rotation.userById(Number(id));
    if (isResponder(user)) await notify.channel({ text: `:wave: ${mention(user)} joined the weekend on-call rotation.` });
    return { user, isFirst };
  }

  /** Change your own name, phone number and Slack account. Returns { user } or { error }. */
  async function updateProfile(user, { name, slack, phone }) {
    name = cleanName(name);
    const whatsapp = normalizePhone(phone);
    if (!name || !whatsapp) {
      return { error: { field: name ? 'phone' : 'name', message: 'Name and a phone number with country code are required.' } };
    }
    const slackId = await resolveSlack(slack, user.email);
    if (!slackId) return { error: { field: 'slack', message: "Couldn't find that Slack account. Paste your Slack member ID instead." } };
    const clash = await contactClash({ slackId, whatsapp, exceptId: user.id });
    if (clash) return { error: { ...clash, field: clash.field === 'whatsapp' ? 'phone' : clash.field } };
    await db.run('UPDATE users SET name = ?, whatsapp = ?, slack_user_id = ? WHERE id = ?', [name, whatsapp, slackId, user.id]);
    return { user: await rotation.userById(user.id) };
  }

  return { createMember, contactClash, resolveSlack, updateProfile, userCount, userByEmail, userBySlack, userByPhone };
}
