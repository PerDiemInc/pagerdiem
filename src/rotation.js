// Who is on call each weekend.
//
// - The rotation assigns the shift's people (the coverage setting, default 2) to every shift, walking the
//   team in `rotation_order` so everyone gets the same share. Admins are not assigned
//   automatically; they can add themselves to any weekend. Non-technical people (C-level,
//   support, product) are never on call.
// - Anyone can add themselves to any weekend (no limit) and remove themselves from one.
//   Nobody can add or remove someone else. Every add/remove is written to roster_log.
// - When a weekend starts, the rotation's picks are frozen in shift_people, and future
//   weekends are projected from the last frozen one. People joining, leaving the team or
//   being reordered therefore never reshuffle weekends that already happened.

import { config } from './config.js';
import { isResponder } from './roles.js';

export function makeRotation(db, shifts) {
  const activeMembers = () => db.all('SELECT * FROM users WHERE active = 1 ORDER BY rotation_order, id');
  /** People the rotation assigns automatically: active engineers (admins are optional, non-technical never). */
  const rotationMembers = () =>
    db.all("SELECT * FROM users WHERE active = 1 AND role = 'engineer' ORDER BY rotation_order, id");
  const userById = async (id) => (id == null ? null : (await db.get('SELECT * FROM users WHERE id = ?', [id])) ?? null);

  /** The rotation member after `prev` in order (wrapping), or the first one. */
  function nextAfter(prev, members) {
    if (members.length === 0) return null;
    if (!prev) return members[0];
    const later = members.find((m) =>
      m.rotation_order > prev.rotation_order || (m.rotation_order === prev.rotation_order && m.id > prev.id));
    return later || members[0];
  }

  /** The next `k` distinct members after `prev`. */
  function takeAfter(prev, members, k) {
    const out = [];
    let cur = prev;
    for (let i = 0; i < Math.min(k, members.length); i++) {
      cur = nextAfter(cur, members);
      out.push(cur);
    }
    return out;
  }

  const frozenBase = (key) =>
    db.all('SELECT user_id FROM shift_people WHERE weekend_key = ? ORDER BY position', [key]);
  const lastFrozenBefore = (key) => db.get(
    'SELECT weekend_key FROM shift_people WHERE weekend_key < ? ORDER BY weekend_key DESC LIMIT 1', [key]);
  const changesFor = (key) =>
    db.all('SELECT * FROM weekend_members WHERE weekend_key = ? ORDER BY updated_at, user_id', [key]);

  /** The first weekend of the rotation, fixed the first time anyone looks at the schedule. */
  async function rotationStartKey() {
    const row = await db.get("SELECT value FROM settings WHERE key = 'rotation_start'");
    if (row) return row.value;
    const key = shifts.currentOrNext(new Date()).key;
    await db.run("INSERT INTO settings (key, value) VALUES ('rotation_start', ?) ON CONFLICT (key) DO NOTHING", [key]);
    return (await db.get("SELECT value FROM settings WHERE key = 'rotation_start'")).value;
  }

  async function usersByIds(ids) {
    const out = [];
    for (const id of ids) {
      const u = await userById(id);
      if (u) out.push(u);
    }
    return out;
  }

  /**
   * The schedule for `count` weekends starting with `fromShift`.
   * Each entry: { shift, base: [users the rotation picked], people: [who is actually on call],
   *               joined: [ids who added themselves], left: [ids who removed themselves],
   *               locked, needsCover }.
   */
  async function schedule(fromShift, count) {
    const members = await rotationMembers();
    const startKey = await rotationStartKey();
    let prev = null; // the last person the rotation used
    let cursor = fromShift;
    const last = await lastFrozenBefore(fromShift.key);
    if (last) {
      const ids = (await frozenBase(last.weekend_key)).map((r) => r.user_id);
      prev = await userById(ids[ids.length - 1]);
      cursor = shifts.following(shifts.forKey(last.weekend_key));
    } else if (startKey < fromShift.key) {
      cursor = shifts.forKey(startKey);
    }
    for (let guard = 0; cursor.key < fromShift.key && guard < 520; guard++) {
      const picked = takeAfter(prev, members, cursor.count);
      prev = picked[picked.length - 1] ?? prev;
      cursor = shifts.following(cursor);
    }

    const out = [];
    let shift = fromShift;
    for (let i = 0; i < count; i++) {
      const frozen = (await frozenBase(shift.key)).map((r) => r.user_id);
      // Weekends before the rotation began have no automatic picks (only people who added themselves).
      const beforeStart = !frozen.length && shift.key < startKey;
      const base = frozen.length ? await usersByIds(frozen) : beforeStart ? [] : takeAfter(prev, members, shift.count);
      if (base.length) prev = base[base.length - 1];

      const changes = await changesFor(shift.key);
      const left = changes.filter((c) => c.status === 'out').map((c) => c.user_id);
      const joined = changes.filter((c) => c.status === 'in').map((c) => c.user_id);
      const people = base.filter((u) => u.active && isResponder(u) && !left.includes(u.id));
      for (const id of joined) {
        if (people.some((p) => p.id === id)) continue;
        const u = await userById(id);
        if (u?.active && isResponder(u)) people.push(u);
      }
      out.push({ shift, base, people, joined, left, locked: frozen.length > 0, needsCover: people.length < shift.count });
      shift = shifts.following(shift);
    }
    return out;
  }

  /** Who covers a given weekend (projected if it hasn't started). */
  async function forShift(shift) {
    return (await schedule(shift, 1))[0];
  }

  /** Freeze the rotation's picks for a weekend that has started. Idempotent. */
  async function lock(shift) {
    const entry = await forShift(shift);
    if (!entry.locked && entry.base.length) {
      for (const [position, u] of entry.base.entries()) {
        await db.run('INSERT INTO shift_people (weekend_key, position, user_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          [shift.key, position, u.id]);
      }
      return forShift(shift);
    }
    return entry;
  }

  /** The weekend in progress with its people, or null on weekdays. */
  async function onCallNow(now = new Date()) {
    const shift = shifts.current(now);
    if (!shift) return null;
    const entry = await lock(shift);
    return { ...entry, shift };
  }

  /** Backup for a weekend: the first person on the following weekend who isn't already on call. */
  async function backupFor(shift) {
    const [current, next] = await schedule(shift, 2);
    const onCallIds = new Set(current.people.map((p) => p.id));
    const fromNext = next.people.find((p) => !onCallIds.has(p.id));
    if (fromNext) return fromNext;
    return (await activeMembers()).find((m) => isResponder(m) && !onCallIds.has(m.id)) || null;
  }

  /** Add yourself to a weekend. Returns { changed }. */
  async function join(shift, user, now = new Date()) {
    if (shift.end <= now) throw Object.assign(new Error('That weekend is already over.'), { status: 400 });
    const entry = await forShift(shift);
    if (entry.people.some((p) => p.id === user.id)) return { changed: false, entry };
    await setStatus(shift.key, user.id, 'in', now);
    await db.run('INSERT INTO roster_log (at, weekend_key, user_id, action) VALUES (?, ?, ?, ?)',
      [now.toISOString(), shift.key, user.id, 'join']);
    return { changed: true, entry: await forShift(shift) };
  }

  /** Remove yourself from a weekend. Returns { changed }. */
  async function leave(shift, user, now = new Date()) {
    if (shift.end <= now) throw Object.assign(new Error('That weekend is already over.'), { status: 400 });
    // Dropping out mid-weekend would leave it uncovered with nobody told; someone has to take the spot instead.
    if (shift.start <= now) {
      throw Object.assign(new Error(`That weekend has already started. Ask in #${config.slack.channelName} for cover — someone can take your spot.`), { status: 400 });
    }
    const entry = await forShift(shift);
    if (!entry.people.some((p) => p.id === user.id)) return { changed: false, entry };
    await setStatus(shift.key, user.id, 'out', now);
    await db.run('INSERT INTO roster_log (at, weekend_key, user_id, action) VALUES (?, ?, ?, ?)',
      [now.toISOString(), shift.key, user.id, 'leave']);
    return { changed: true, entry: await forShift(shift) };
  }

  function setStatus(key, userId, status, now) {
    return db.run(`INSERT INTO weekend_members (weekend_key, user_id, status, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT (weekend_key, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    [key, userId, status, now.toISOString()]);
  }

  const UNDO_MS = 10_000;
  const UNDO_GRACE_MS = 2_000; // network latency allowance on top of the 10 seconds shown

  /**
   * Take someone's spot on a weekend: they're out, you're in. Returns the swap row.
   * Undoable by you for 10 seconds.
   */
  async function swap(shift, taker, replacedId, now = new Date()) {
    if (shift.end <= now) throw Object.assign(new Error('That weekend is already over.'), { status: 400 });
    const entry = await forShift(shift);
    if (!entry.people.some((p) => p.id === replacedId)) {
      throw Object.assign(new Error("That person isn't on call that weekend."), { status: 400 });
    }
    if (entry.people.some((p) => p.id === taker.id)) {
      throw Object.assign(new Error("You're already on call that weekend."), { status: 400 });
    }
    const status = async (uid) =>
      (await db.get('SELECT status FROM weekend_members WHERE weekend_key = ? AND user_id = ?', [shift.key, uid]))?.status ?? null;
    const prevBy = await status(taker.id);
    const prevReplaced = await status(replacedId);
    await setStatus(shift.key, replacedId, 'out', now);
    await setStatus(shift.key, taker.id, 'in', now);
    const { id } = await db.get(`INSERT INTO swaps (at, weekend_key, by_user_id, replaced_user_id, prev_by_status, prev_replaced_status)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`, [now.toISOString(), shift.key, taker.id, replacedId, prevBy, prevReplaced]);
    return db.get('SELECT * FROM swaps WHERE id = ?', [id]);
  }

  /**
   * Trade weekends: you take their spot on their weekend and they take yours on yours. Two swap
   * rows linked by trade_id, undoable together by either person for 10 seconds.
   */
  async function trade(myShift, theirShift, me, otherId, now = new Date()) {
    const refuse = (message) => Object.assign(new Error(message), { status: 409 });
    if (myShift.key === theirShift.key) throw refuse('Pick a different weekend to trade with.');
    if (myShift.end <= now || theirShift.end <= now) throw refuse('That weekend is already over.');
    const mine = await forShift(myShift);
    const theirs = await forShift(theirShift);
    if (!mine.people.some((p) => p.id === me.id)) throw refuse("You're not on call that weekend.");
    if (!theirs.people.some((p) => p.id === otherId)) throw refuse("That person isn't on call that weekend.");
    if (theirs.people.some((p) => p.id === me.id)) throw refuse("You're already on call their weekend.");
    if (mine.people.some((p) => p.id === otherId)) throw refuse("They're already on call your weekend.");
    const other = await userById(otherId);
    const a = await swap(theirShift, me, otherId, now);
    const b = await swap(myShift, other, me.id, now);
    await db.run('UPDATE swaps SET trade_id = ? WHERE id = ?', [b.id, a.id]);
    await db.run('UPDATE swaps SET trade_id = ? WHERE id = ?', [a.id, b.id]);
    return [{ ...a, trade_id: b.id }, { ...b, trade_id: a.id }];
  }

  /** Undo your own swap (or either half of a trade you're in) within 10 seconds. Returns true if undone. */
  async function undoSwap(id, user, now = new Date()) {
    const s = await db.get('SELECT * FROM swaps WHERE id = ?', [id]);
    const pair = s?.trade_id ? await db.get('SELECT * FROM swaps WHERE id = ?', [s.trade_id]) : null;
    if (!s || ![s.by_user_id, pair?.by_user_id].includes(user.id)) throw Object.assign(new Error('Not your swap.'), { status: 403 });
    if (s.undone_at) return false;
    if (now - new Date(s.at) > UNDO_MS + UNDO_GRACE_MS) {
      throw Object.assign(new Error('The 10 seconds to undo have passed.'), { status: 400 });
    }
    for (const row of [s, pair].filter((r) => r && !r.undone_at)) {
      const restore = async (uid, prev) => (prev
        ? setStatus(row.weekend_key, uid, prev, now)
        : db.run('DELETE FROM weekend_members WHERE weekend_key = ? AND user_id = ?', [row.weekend_key, uid]));
      await restore(row.by_user_id, row.prev_by_status);
      await restore(row.replaced_user_id, row.prev_replaced_status);
      await db.run('UPDATE swaps SET undone_at = ? WHERE id = ?', [now.toISOString(), row.id]);
    }
    return true;
  }

  /** Swaps whose undo window has passed and that haven't been announced yet. Marks them announced. */
  async function claimSwapsToAnnounce(now = new Date()) {
    const due = await db.all('SELECT * FROM swaps WHERE undone_at IS NULL AND notified_at IS NULL AND at <= ?',
      [new Date(now.getTime() - UNDO_MS - UNDO_GRACE_MS).toISOString()]);
    const out = [];
    for (const s of due) {
      const r = await db.run('UPDATE swaps SET notified_at = ? WHERE id = ? AND notified_at IS NULL', [now.toISOString(), s.id]);
      if (r.changes === 1) out.push(s);
    }
    return out;
  }

  /** Public history: self adds/removes and swaps, newest first. */
  async function log({ limit = 200 } = {}) {
    const roster = await db.all(`SELECT l.id, l.at, l.weekend_key, l.action, u.name AS user_name, NULL AS other_name, NULL AS undone_at
      FROM roster_log l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ?`, [limit]);
    const swaps = await db.all(`SELECT s.id, s.at, s.weekend_key, 'swap' AS action, b.name AS user_name, r.name AS other_name, s.undone_at
      FROM swaps s JOIN users b ON b.id = s.by_user_id JOIN users r ON r.id = s.replaced_user_id ORDER BY s.id DESC LIMIT ?`, [limit]);
    return [...roster, ...swaps].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  }

  /** Weekends per person over a list of schedule entries, for the balance view. */
  async function balance(entries) {
    const counts = new Map((await activeMembers()).filter(isResponder).map((m) => [m.id, { user: m, weekends: 0 }]));
    for (const e of entries) for (const p of e.people) if (counts.has(p.id)) counts.get(p.id).weekends += 1;
    return [...counts.values()].sort((a, b) => b.weekends - a.weekends || a.user.name.localeCompare(b.user.name));
  }

  /** Move a member one place up (-1) or down (+1) in the rotation. */
  async function move(userId, direction) {
    const members = await activeMembers();
    const i = members.findIndex((m) => m.id === userId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= members.length) return;
    const ordered = members.map((m) => m.id);
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    for (const [idx, id] of ordered.entries()) {
      await db.run('UPDATE users SET rotation_order = ? WHERE id = ?', [(idx + 1) * 10, id]);
    }
  }

  async function nextRotationOrder() {
    const row = await db.get('SELECT MAX(rotation_order) AS m FROM users');
    return (row?.m ?? 0) + 10;
  }

  return {
    activeMembers, rotationMembers, userById, schedule, rotationStartKey, forShift, lock, onCallNow,
    backupFor, join, leave, swap, trade, undoSwap, claimSwapsToAnnounce, UNDO_MS, log, balance, move, nextRotationOrder,
  };
}
