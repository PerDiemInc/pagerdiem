// Sign-up, profile, weekend, team and settings changes shared by the web app and the phone app.
// Each action checks who may do it, makes the change, tells Slack, and returns the message to
// show. A rule violation throws HttpError(status, message).
import { config, slackEnabled } from './config.js';
import { HttpError } from './http.js';
import { formatRange, parseKey } from './time.js';
import { lookupUserIdByEmail, mention } from './notify/slack.js';
import { normalizePhone } from './phone.js';
import { PRESETS, normalizeCoverage, writeSetting, describeDays } from './settings.js';
import { DEFAULT_ROLE, isAdmin, isResponder, isRole } from './roles.js';

const cleanName = (value) => String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REMOVED = "You've been removed from the on-call rotation, so you can't sign in. Ask an admin to add you back.";

/** Record a team, settings or app change for the activity log. */
export async function record(db, { user, via = null, icon, text, now = new Date() }) {
  await db.run('INSERT INTO admin_log (at, user_id, via, icon, text) VALUES (?, ?, ?, ?, ?)',
    [now.toISOString(), user?.id ?? null, via, icon, text]);
}

export function makeActions({ db, shifts, rotation, notify, scheduler }) {
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

  const requireAdmin = (user) => {
    if (!isAdmin(user)) throw new HttpError(403, 'Only admins can do that');
  };
  const requireResponder = (user) => {
    if (!isResponder(user)) throw new HttpError(403, 'Only engineers and admins can do that');
  };
  const shiftFor = (key) => {
    try {
      parseKey(String(key));
    } catch {
      throw new HttpError(400, 'That weekend does not exist.');
    }
    return shifts.forKey(key);
  };
  // Rotation rules throw plain errors with a status; keep the status and the message.
  const asHttp = (err) => (err instanceof HttpError ? err : new HttpError(err.status || 500, err.message));
  const range = (shift) => formatRange(shift, config.timezone);
  // Ids come from URLs and JSON bodies: anything that isn't a whole number is nobody.
  const personById = async (id) => (Number.isSafeInteger(Number(id)) ? rotation.userById(Number(id)) : null);
  const activeAdmins = async () => (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")).n;

  // Add or remove YOURSELF for a weekend. There is deliberately no way to change anyone else.
  async function rosterChange(user, key, action, now) {
    requireResponder(user);
    const shift = shiftFor(key);
    const fn = action === 'join' ? rotation.join : rotation.leave;
    let result;
    try {
      result = await fn(shift, user, now);
    } catch (err) {
      throw asHttp(err);
    }
    if (!result.changed) {
      return { changed: false, message: action === 'join' ? `You're already on call for ${range(shift)}.` : `You're not on call for ${range(shift)}.` };
    }
    const { entry } = result;
    const short = entry.needsCover ? ` :warning: Now ${entry.people.length}/${entry.shift.count} — needs cover.` : '';
    await notify.channel({
      text: action === 'join'
        ? `:raised_hand: ${mention(user)} added themselves to the weekend of ${range(shift)}. On call: ${entry.people.map(mention).join(', ')}.`
        : `:wave: ${mention(user)} removed themselves from the weekend of ${range(shift)}. On call: ${entry.people.map(mention).join(', ') || 'nobody'}.${short}`,
    });
    return {
      changed: true,
      message: action === 'join' ? `You're on call for ${range(shift)}.` : `You're off ${range(shift)}.${entry.needsCover ? ' That weekend now needs cover.' : ''}`,
    };
  }

  const joinWeekend = (user, key, via, now = new Date()) => rosterChange(user, key, 'join', now);
  const leaveWeekend = (user, key, via, now = new Date()) => rosterChange(user, key, 'leave', now);

  // Each swap announces itself after its undo window. The scheduler only catches what a restart
  // or a missed timer left behind: once at startup and for a couple of minutes after each swap.
  let checkSwapsUntil = null;
  function scheduleAnnouncement() {
    setTimeout(() => announceSwaps().catch((err) => console.error('announce swaps failed:', err)), rotation.UNDO_MS + 2_500).unref?.();
    checkSwapsUntil = Date.now() + 2 * 60_000;
  }

  /** "Take their spot": you're in, they're out. Undoable by you for 10 seconds. */
  async function swapWeekend(user, key, replacedId, via, now = new Date()) {
    requireResponder(user);
    const shift = shiftFor(key);
    const replaced = await personById(replacedId);
    if (!replaced) throw new HttpError(400, 'Pick someone on that weekend.');
    let row;
    try {
      row = await rotation.swap(shift, user, replaced.id, now);
    } catch (err) {
      throw asHttp(err);
    }
    scheduleAnnouncement();
    return {
      message: `You took ${replaced.name}'s spot for ${range(shift)}.`,
      undo: { ids: [row.id], until: new Date(new Date(row.at).getTime() + rotation.UNDO_MS).toISOString() },
    };
  }

  async function undoSwap(user, ids, via, now = new Date()) {
    if (!ids.length || !ids.every((id) => Number.isSafeInteger(Number(id)))) throw new HttpError(400, 'Nothing to undo.');
    let undone = false;
    try {
      for (const id of ids) undone = (await rotation.undoSwap(Number(id), user, now)) || undone;
    } catch (err) {
      throw asHttp(err);
    }
    return { message: undone ? 'Swap undone. Nothing changed and nobody was notified.' : 'Already undone.' };
  }

  /** Two-way trade: you take their spot on their weekend, they take yours. Undoable by either for 10 seconds. */
  async function tradeWeekends(user, myKey, theirKey, otherId, via, now = new Date()) {
    requireResponder(user);
    const mine = shiftFor(myKey);
    const theirs = shiftFor(theirKey);
    const other = await personById(otherId);
    if (!other) throw new HttpError(400, 'Pick someone to trade with.');
    let rows;
    try {
      rows = await rotation.trade(mine, theirs, user, other.id, now);
    } catch (err) {
      throw asHttp(err);
    }
    scheduleAnnouncement();
    return {
      message: `Swapped. You take ${range(theirs)}.`,
      undo: { ids: rows.map((r) => r.id), until: new Date(new Date(rows[0].at).getTime() + rotation.UNDO_MS).toISOString() },
    };
  }

  /** Tell Slack and the replaced person about swaps and trades whose undo window has passed. */
  async function announceSwaps(now = new Date()) {
    const due = await rotation.claimSwapsToAnnounce(now);
    const announced = new Set();
    for (const s of due) {
      if (announced.has(s.id)) continue;
      if (s.trade_id) {
        // One message per trade, posted by whichever run claimed its first half (the lower id),
        // so two overlapping announcers can't both skip it or both post it.
        if (s.id > s.trade_id) continue;
        const pair = due.find((x) => x.id === s.trade_id) ?? await db.get('SELECT * FROM swaps WHERE id = ?', [s.trade_id]);
        announced.add(s.id).add(pair.id);
        const [first, second] = [s, pair];
        const starter = await rotation.userById(first.by_user_id);
        const other = await rotation.userById(first.replaced_user_id);
        const theirs = range(shifts.forKey(first.weekend_key));
        const mine = range(shifts.forKey(second.weekend_key));
        await notify.user(other, { text: `:repeat: ${starter.name} traded weekends with you: you take ${mine}, they take ${theirs}.` });
        await notify.channel({ text: `:repeat: ${mention(starter)} and ${mention(other)} traded weekends: ${starter.name} takes ${theirs}, ${other.name} takes ${mine}.` });
        continue;
      }
      const shift = shifts.forKey(s.weekend_key);
      const by = await rotation.userById(s.by_user_id);
      const replaced = await rotation.userById(s.replaced_user_id);
      await notify.user(replaced, { text: `:repeat: ${by.name} took your on-call spot for the weekend of ${range(shift)}. You're off that weekend.` });
      await notify.channel({ text: `:repeat: ${mention(by)} took ${mention(replaced)}'s spot for the weekend of ${range(shift)}.` });
    }
  }

  async function announceMissedSwaps(now) {
    checkSwapsUntil ??= now.getTime();
    if (now.getTime() <= checkSwapsUntil) await announceSwaps(now);
  }

  async function setActive(user, targetId, active, via) {
    requireAdmin(user);
    const target = await personById(targetId);
    if (!target) throw new HttpError(404, 'Person not found');
    const { id } = target;
    if (!active && target.role === 'admin' && target.active && (await activeAdmins()) <= 1) {
      throw new HttpError(409, 'There must be at least one admin. Make someone else an admin first.');
    }
    if (active) await db.run('UPDATE users SET active = 1, rotation_order = ? WHERE id = ?', [await rotation.nextRotationOrder(), id]);
    else await db.run('UPDATE users SET active = 0 WHERE id = ?', [id]);
    await record(db, { user, via, icon: 'team', text: active ? `${user.name} added ${target.name} back to the rotation` : `${user.name} removed ${target.name} from the rotation` });
    return { message: active ? 'Added back to the end of the rotation.' : 'Removed from the rotation.' };
  }

  async function setRole(user, targetId, role, via) {
    requireAdmin(user);
    role = String(role || '');
    if (!isRole(role)) throw new HttpError(400, 'Pick a role.');
    const target = await personById(targetId);
    if (!target) throw new HttpError(404, 'Person not found');
    if (target.role === 'admin' && role !== 'admin' && (await activeAdmins()) <= 1) {
      throw new HttpError(409, 'There must be at least one admin.');
    }
    await db.run('UPDATE users SET role = ?, is_admin = ? WHERE id = ?', [role, role === 'admin' ? 1 : 0, target.id]);
    const as = { admin: 'an admin', engineer: 'an engineer', non_technical: 'non-technical' }[role];
    await record(db, { user, via, icon: 'team', text: `${user.name} made ${target.name} ${as}` });
    return { message: `${target.name} is now ${role.replace('_', '-')}.` };
  }

  async function moveMember(user, targetId, dir, via) {
    requireAdmin(user);
    const target = await personById(targetId);
    if (!target) throw new HttpError(404, 'Person not found');
    const step = Number(dir) < 0 ? -1 : 1;
    await rotation.move(target.id, step);
    await record(db, { user, via, icon: 'team', text: `${user.name} moved ${target.name} ${step < 0 ? 'up' : 'down'} the rotation` });
    return { message: `Moved ${target.name} ${step < 0 ? 'up' : 'down'}.` };
  }

  /** input: { preset } or { days, start, end, weekendCount, weekdayCount }. */
  async function saveCoverage(user, input, via) {
    requireAdmin(user);
    const preset = PRESETS[input.preset];
    const { coverage, error } = normalizeCoverage({
      days: preset ? preset.days : Array.isArray(input.days) ? input.days : [],
      start: input.start, end: input.end, weekendCount: input.weekendCount, weekdayCount: input.weekdayCount,
    });
    if (error) throw new HttpError(400, error);
    await writeSetting(db, 'coverage', JSON.stringify(coverage));
    shifts.setCoverage(coverage);
    await record(db, { user, via, icon: 'settings', text: `${user.name} changed coverage to ${describeDays(coverage.days)}, ${coverage.start} to ${coverage.end}` });
    await notify.channel({
      text: `:gear: ${mention(user)} changed on-call coverage: ${describeDays(coverage.days)}, ${coverage.start} → ${coverage.end}, ` +
        `${coverage.weekendCount} on weekend days and ${coverage.weekdayCount} on weekdays.`,
    });
    return { message: 'On-call coverage saved. The calendar and rotation now follow it.' };
  }

  /** Re-send this weekend's "you're on call now" messages. */
  async function resendWeekendStart(user, via, now = new Date()) {
    requireAdmin(user);
    const people = await scheduler.resendWeekendStart(now);
    if (!people) throw new HttpError(409, 'No weekend is in progress, so there is nothing to re-send.');
    await record(db, { user, via, icon: 'settings', text: `${user.name} re-sent the weekend message`, now });
    return { message: `Re-sent "you're on call now" to ${people.map((p) => p.name).join(', ') || 'nobody (no one is on call)'}.` };
  }

  /** Ask #on-call for someone to take your weekend. You stay on until someone does. */
  async function askCover(user, key, via, now = new Date()) {
    requireResponder(user);
    const shift = shiftFor(key);
    if (shift.end <= now) throw new HttpError(400, 'That weekend is already over.');
    const entry = await rotation.forShift(shift);
    if (!entry.people.some((p) => p.id === user.id)) throw new HttpError(409, "You're not on call that weekend.");
    await notify.channel({
      text: `:sos: ${mention(user)} needs cover for the weekend of ${range(shift)}. Take it: ${config.publicUrl}/calendar?month=${shift.key.slice(0, 7)}`,
    });
    await record(db, { user, via, icon: 'cover', text: `${user.name} asked for cover for ${range(shift)}`, now });
    return { message: `Asked for cover in #${config.slack.channelName}` };
  }

  return {
    createMember, contactClash, resolveSlack, updateProfile, userCount, userByEmail, userBySlack,
    askCover, joinWeekend, leaveWeekend, swapWeekend, tradeWeekends, undoSwap, announceSwaps, announceMissedSwaps,
    setActive, setRole, moveMember, saveCoverage, resendWeekendStart,
  };
}
