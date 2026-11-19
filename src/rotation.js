// Who is on call each weekend.
//
// The rotation walks the active members in `rotation_order`, one weekend each.
// When a shift starts it is "locked" into the shifts table, and future weekends are
// projected forward from the last locked shift. That way adding, removing or reordering
// people never skips anyone or reshuffles weekends that already happened.
// Overrides (swaps) replace the person for one weekend without moving the rotation.

export function makeRotation(db, shifts) {
  const activeMembers = () => db.all('SELECT * FROM users WHERE active = 1 ORDER BY rotation_order, id');
  const userById = async (id) => (id == null ? null : (await db.get('SELECT * FROM users WHERE id = ?', [id])) ?? null);

  /** The active member after `prevUser` in rotation order (wrapping), or the first member. */
  function nextAfter(prevUser, members) {
    if (members.length === 0) return null;
    if (!prevUser) return members[0];
    const later = members.find((m) =>
      m.rotation_order > prevUser.rotation_order || (m.rotation_order === prevUser.rotation_order && m.id > prevUser.id));
    return later || members[0];
  }

  const lockedShift = (key) => db.get('SELECT * FROM shifts WHERE weekend_key = ?', [key]);
  const lastLockedBefore = (key) =>
    db.get('SELECT * FROM shifts WHERE weekend_key < ? ORDER BY weekend_key DESC LIMIT 1', [key]);
  const overrideFor = (key) => db.get('SELECT * FROM overrides WHERE weekend_key = ?', [key]);

  /** The first weekend of the rotation, fixed the first time anyone looks at the schedule. */
  async function rotationStartKey() {
    const row = await db.get("SELECT value FROM settings WHERE key = 'rotation_start'");
    if (row) return row.value;
    const key = shifts.currentOrNext(new Date()).key;
    await db.run("INSERT INTO settings (key, value) VALUES ('rotation_start', ?) ON CONFLICT (key) DO NOTHING", [key]);
    return (await db.get("SELECT value FROM settings WHERE key = 'rotation_start'")).value;
  }

  /**
   * The schedule for `count` weekends starting with `fromShift`.
   * Each entry: { shift, base, user, override, locked }.
   * The rotation is projected from the last locked shift (or the rotation start),
   * so asking about any single weekend gives the same answer as the full list.
   */
  async function schedule(fromShift, count) {
    const members = await activeMembers();
    let prevBase = null;
    let cursor = fromShift;
    const last = await lastLockedBefore(fromShift.key);
    if (last) {
      prevBase = await userById(last.base_user_id);
      cursor = shifts.following(shifts.forKey(last.weekend_key));
    } else {
      const start = await rotationStartKey();
      if (start < fromShift.key) cursor = shifts.forKey(start);
    }
    for (let guard = 0; cursor.key < fromShift.key && guard < 520; guard++) {
      prevBase = nextAfter(prevBase, members) ?? prevBase;
      cursor = shifts.following(cursor);
    }

    const out = [];
    let shift = fromShift;
    for (let i = 0; i < count; i++) {
      const locked = await lockedShift(shift.key);
      let base, user, override = null;
      if (locked) {
        base = await userById(locked.base_user_id);
        user = await userById(locked.user_id);
      } else {
        base = nextAfter(prevBase, members);
        override = (await overrideFor(shift.key)) || null;
        const overrideUser = override ? await userById(override.user_id) : null;
        user = overrideUser?.active ? overrideUser : base;
      }
      out.push({ shift, base, user, override, locked: Boolean(locked) });
      prevBase = base ?? prevBase;
      shift = shifts.following(shift);
    }
    return out;
  }

  /** Who covers a given shift (projected if it hasn't started). */
  async function forShift(shift) {
    return (await schedule(shift, 1))[0];
  }

  /**
   * Freeze the assignment for a shift that has started. Idempotent.
   * Returns the locked entry, or null if there is nobody to put on call.
   */
  async function lock(shift) {
    if (await lockedShift(shift.key)) return forShift(shift);
    const entry = await forShift(shift);
    if (!entry.user) return null;
    await db.run('INSERT INTO shifts (weekend_key, base_user_id, user_id) VALUES (?, ?, ?) ON CONFLICT (weekend_key) DO NOTHING',
      [shift.key, entry.base.id, entry.user.id]);
    return forShift(shift);
  }

  /** The person on call right now, or null on weekdays / with an empty team. */
  async function onCallNow(now = new Date()) {
    const shift = shifts.current(now);
    if (!shift) return null;
    const entry = await lock(shift);
    return entry ? { ...entry, shift } : null;
  }

  /** The backup for a shift: whoever has the following weekend (if it's a different person). */
  async function backupFor(shift) {
    const [current, next] = await schedule(shift, 2);
    if (next?.user && next.user.id !== current?.user?.id) return next.user;
    const others = (await activeMembers()).filter((m) => m.id !== current?.user?.id);
    return others[0] || null;
  }

  async function setOverride(key, userId, setBy) {
    // If the shift is already running, this swaps who covers it right now.
    await db.run('UPDATE shifts SET user_id = ? WHERE weekend_key = ?', [userId, key]);
    await db.run(`INSERT INTO overrides (weekend_key, user_id, set_by, created_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT (weekend_key) DO UPDATE SET user_id = excluded.user_id,
                  set_by = excluded.set_by, created_at = excluded.created_at`,
    [key, userId, setBy, new Date().toISOString()]);
  }

  async function clearOverride(key) {
    await db.run('UPDATE shifts SET user_id = base_user_id WHERE weekend_key = ?', [key]);
    await db.run('DELETE FROM overrides WHERE weekend_key = ?', [key]);
  }

  /** Move a member one place up (-1) or down (+1) in the rotation. */
  async function move(userId, direction) {
    const members = await activeMembers();
    const i = members.findIndex((m) => m.id === userId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= members.length) return;
    // Renumber densely so swapping two neighbours is always a clean exchange.
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
    activeMembers, userById, schedule, rotationStartKey, forShift, lock, onCallNow, backupFor,
    setOverride, clearOverride, move, nextRotationOrder,
  };
}
