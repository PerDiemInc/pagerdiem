// The phone app's Activity log: every change to the rotation, the team and settings, plus who
// acknowledged and resolved incidents. Rotation changes come from roster_log and swaps,
// incident actions from incident_events, and everything else from admin_log.
import { config } from './config.js';
import { formatRange } from './time.js';

const VIA = { 'phone call': 'app', app: 'app', slack: 'slack', web: 'web', api: 'api' };

/** Record a team, settings or app change for the activity log. */
export async function record(db, { user, via = null, icon, text, now = new Date() }) {
  await db.run('INSERT INTO admin_log (at, user_id, via, icon, text) VALUES (?, ?, ?, ?, ?)',
    [now.toISOString(), user?.id ?? null, via, icon, text]);
}

/** Newest first: [{ at, text, via, icon }]. */
export async function activityFeed({ db, rotation, shifts, limit = 200 }) {
  const items = [];
  for (const l of await rotation.log({ limit })) {
    const range = formatRange(shifts.forKey(l.weekend_key), config.timezone);
    if (l.action === 'swap') {
      items.push({ at: l.at, text: `${l.user_name} took ${l.other_name}'s spot for ${range}${l.undone_at ? ' (undone)' : ''}`, via: null, icon: 'swap' });
    } else {
      items.push({ at: l.at, text: `${l.user_name} ${l.action === 'join' ? 'added themselves to' : 'left'} ${range}`, via: null, icon: l.action });
    }
  }
  const handled = await db.all(`SELECT e.at, e.message, i.id, i.title FROM incident_events e JOIN incidents i ON i.id = e.incident_id
    WHERE e.message LIKE 'Acknowledged by %' OR e.message LIKE 'Resolved by %' ORDER BY e.id DESC LIMIT ?`, [limit]);
  for (const e of handled) {
    const m = /^(Acknowledged|Resolved) by (.+) via (.+)$/.exec(e.message);
    if (!m) continue;
    const verb = m[1] === 'Acknowledged' ? 'acknowledged' : 'resolved';
    items.push({ at: e.at, text: `${m[2]} ${verb} #${e.id} ${e.title}`, via: VIA[m[3]] ?? null, icon: verb === 'acknowledged' ? 'ack' : 'resolve' });
  }
  for (const a of await db.all('SELECT at, via, icon, text FROM admin_log ORDER BY id DESC LIMIT ?', [limit])) {
    items.push({ at: a.at, text: a.text, via: a.via ?? null, icon: a.icon });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}
