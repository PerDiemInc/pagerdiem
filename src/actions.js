// Weekend, team and settings changes shared by the web app and the phone app. Each action
// checks who may do it, makes the change, tells Slack, and returns the message to show.
// A rule violation throws HttpError(status, message).
import { config } from './config.js';
import { HttpError } from './http.js';
import { formatRange, parseKey } from './time.js';
import { mention } from './notify/slack.js';
import { PRESETS, normalizeCoverage, writeSetting, describeDays } from './settings.js';
import { isAdmin, isResponder, isRole } from './roles.js';
import { record } from './activity.js';

export function makeActions({ db, shifts, rotation, notify, scheduler }) {
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
    const replaced = await rotation.userById(Number(replacedId));
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
    const other = await rotation.userById(Number(otherId));
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
    const id = Number(targetId);
    const target = await rotation.userById(id);
    if (!target) throw new HttpError(404, 'Person not found');
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
    const target = await rotation.userById(Number(targetId));
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
    const target = await rotation.userById(Number(targetId));
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
      days: preset ? preset.days : input.days,
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
    askCover, joinWeekend, leaveWeekend, swapWeekend, tradeWeekends, undoSwap, announceSwaps, announceMissedSwaps,
    setActive, setRole, moveMember, saveCoverage, resendWeekendStart,
  };
}
