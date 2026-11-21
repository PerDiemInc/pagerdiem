// Incidents: trigger -> page on-call -> re-page -> escalate to backup -> alert channel.
import crypto from 'node:crypto';
import { config } from './config.js';
import { mention, engineersTag } from './notify/slack.js';

const MINUTE = 60_000;

export function makeIncidents({ db, rotation, notify }) {
  const get = async (id) => (await db.get('SELECT * FROM incidents WHERE id = ?', [id])) ?? null;
  const userById = async (id) => (id ? rotation.userById(id) : null);
  const incUrl = (inc) => `${config.publicUrl}/incidents/${inc.id}`;

  async function event(incidentId, message, at = new Date()) {
    (await db.run('INSERT INTO incident_events (incident_id, at, message) VALUES (?, ?, ?)', [incidentId, at.toISOString(), message]));
  }

  async function events(incidentId) {
    return (await db.all('SELECT * FROM incident_events WHERE incident_id = ? ORDER BY id', [incidentId]));
  }

  function pageBlocks(inc, text) {
    return [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: [
          { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Acknowledge' },
            action_id: 'ack', value: String(inc.id) },
          { type: 'button', text: { type: 'plain_text', text: 'Resolve' },
            action_id: 'resolve', value: String(inc.id) },
          { type: 'button', text: { type: 'plain_text', text: 'Open' }, action_id: 'open', url: incUrl(inc) },
        ],
      },
    ];
  }

  /** Page one person about an incident by Slack DM. */
  async function page(inc, user, reason) {
    const details = inc.details ? `\n${inc.details}` : '';
    const text = `:rotating_light: *Incident #${inc.id}: ${inc.title}*${details}\n${reason}`;
    await notify.user(user, { text, blocks: pageBlocks(inc, text), incidentId: inc.id });
  }

  async function create({ title, details = '', source = 'web', createdBy = null }, now = new Date()) {
    title = String(title || '').trim().slice(0, 200);
    if (!title) throw new Error('A title is required');
    details = String(details || '').trim().slice(0, 4000);

    const onCall = await rotation.onCallNow(now);
    const people = onCall?.people ?? [];
    const assigned = people[0] ?? null; // shown as "on call"; everyone in `people` is paged
    const backup = people.length ? await rotation.backupFor(onCall.shift) : null;
    const iso = now.toISOString();

    const { id: newId } = (await db.get(`
      INSERT INTO incidents (title, details, source, assigned_user_id, backup_user_id, escalation_level,
                             ack_token, created_by, created_at, last_paged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [title, details, source, assigned?.id ?? null, backup?.id ?? null, assigned ? 0 : 2,
      crypto.randomBytes(16).toString('hex'), createdBy, iso, iso]));
    const inc = await get(Number(newId));
    const creator = await userById(createdBy);
    await event(inc.id, `Triggered via ${source}${creator ? ` by ${creator.name}` : ''}`, now);

    if (people.length) {
      await event(inc.id, `Paged ${people.map((p) => p.name).join(' and ')} (on call)`, now);
      for (const p of people) await page(inc, p, 'You are on call. Please acknowledge.');
      await notify.channel({
        text: `${engineersTag()}${engineersTag() ? ' ' : ''}:rotating_light: Incident #${inc.id}: *${inc.title}* — paging ${people.map(mention).join(' and ')} (on call). ${incUrl(inc)}`,
        incidentId: inc.id,
      });
    } else {
      // Weekday or empty rotation: nobody is on call, so the whole team gets it.
      await event(inc.id, 'Nobody is on call right now — alerted the team channel', now);
      await notify.channel({
        text: `${engineersTag('<!here>')} :rotating_light: Incident #${inc.id}: *${inc.title}* — nobody is on call right now, ` +
          `can someone take it? ${incUrl(inc)}`,
        blocks: pageBlocks(inc, `${engineersTag('<!here>')} :rotating_light: *Incident #${inc.id}: ${inc.title}*\nNobody is on call right now — can someone take it?`),
        incidentId: inc.id,
      });
    }
    return get(inc.id);
  }

  /** " cc @a @b" for the people on call when the incident started (minus whoever acted). */
  async function onCallTags(inc, actor) {
    const onCall = await rotation.onCallNow(new Date(inc.created_at));
    const others = (onCall?.people ?? []).filter((p) => p.id !== actor?.id);
    return others.length ? ` cc ${others.map(mention).join(' ')} (on call)` : '';
  }

  async function acknowledge(id, user, via = 'web', now = new Date()) {
    const inc = await get(id);
    if (!inc) throw new Error('Incident not found');
    if (inc.status !== 'open') return { incident: inc, changed: false };
    (await db.run(`UPDATE incidents SET status = 'acknowledged', acked_at = ?, acked_by = ? WHERE id = ? AND status = 'open'`, [now.toISOString(), user?.id ?? null, id]));
    await event(id, `Acknowledged by ${user?.name ?? 'someone'} via ${via}`, now);
    await notify.channel({
      text: `:eyes: Incident #${id} *${inc.title}* acknowledged by ${mention(user)}.${await onCallTags(inc, user)}`, incidentId: id,
    });
    return { incident: await get(id), changed: true };
  }

  async function resolve(id, user, via = 'web', now = new Date()) {
    const inc = await get(id);
    if (!inc) throw new Error('Incident not found');
    if (inc.status === 'resolved') return { incident: inc, changed: false };
    (await db.run(`UPDATE incidents SET status = 'resolved', resolved_at = ?, resolved_by = ?,
                acked_at = COALESCE(acked_at, ?), acked_by = COALESCE(acked_by, ?) WHERE id = ?`, [now.toISOString(), user?.id ?? null, now.toISOString(), user?.id ?? null, id]));
    await event(id, `Resolved by ${user?.name ?? 'someone'} via ${via}`, now);
    await notify.channel({
      text: `:white_check_mark: Incident #${id} *${inc.title}* resolved by ${mention(user)}.${await onCallTags(inc, user)}`, incidentId: id,
    });
    return { incident: await get(id), changed: true };
  }

  /** Called every minute: re-page and escalate incidents nobody has acknowledged. */
  async function tick(now = new Date()) {
    const open = (await db.all(`SELECT * FROM incidents WHERE status = 'open' AND escalation_level < 2`));
    for (const inc of open) {
      const age = now - new Date(inc.created_at);
      const sincePage = now - new Date(inc.last_paged_at);
      const assigned = await userById(inc.assigned_user_id);
      const backup = await userById(inc.backup_user_id);
      // Everyone on call that weekend (including anyone who added themselves since).
      const onCallThen = await rotation.onCallNow(new Date(inc.created_at));
      const onCallPeople = onCallThen?.people?.length ? onCallThen.people : [assigned].filter(Boolean);
      const names = onCallPeople.map((p) => p.name).join(' and ') || 'The on-call';
      const minutes = Math.round(age / MINUTE);

      const escalateAfter = config.escalateAfterMinutes * MINUTE;

      const alertWholeChannel = async () => {
        (await db.run('UPDATE incidents SET escalation_level = 2, last_paged_at = ? WHERE id = ?', [now.toISOString(), inc.id]));
        await event(inc.id, `Not acknowledged after ${minutes} min — alerted the whole team channel`, now);
        await notify.channel({
          text: `${engineersTag('<!channel>')} :fire: Incident #${inc.id} *${inc.title}* has not been acknowledged for ${minutes} min. ` +
            `Can anyone take it? ${incUrl(inc)}`,
          blocks: pageBlocks(inc, `${engineersTag('<!channel>')} :fire: *Incident #${inc.id}: ${inc.title}*\nNot acknowledged for ${minutes} min. Can anyone take it?`),
          incidentId: inc.id,
        });
      };

      // Step 1: on-call didn't respond -> page the backup (or the channel if there is none).
      if (inc.escalation_level === 0 && age >= escalateAfter) {
        if (!backup) { await alertWholeChannel(); continue; }
        (await db.run('UPDATE incidents SET escalation_level = 1, last_paged_at = ? WHERE id = ?', [now.toISOString(), inc.id]));
        await event(inc.id, `Not acknowledged after ${minutes} min — escalated to ${backup.name} (backup)`, now);
        await page(inc, backup, `${names} hasn't acknowledged in ${minutes} min. You're the backup.`);
        for (const p of onCallPeople) await page(inc, p, `Still not acknowledged after ${minutes} min — escalated to ${backup.name}.`);
        await notify.channel({
          text: `:warning: Incident #${inc.id} *${inc.title}* not acknowledged by ${onCallPeople.map(mention).join(' or ')} after ${minutes} min — ` +
            `escalating to ${mention(backup)}.`,
          incidentId: inc.id,
        });
        continue;
      }

      // Step 2: backup didn't respond either -> @channel.
      if (inc.escalation_level === 1 && age >= 2 * escalateAfter) { await alertWholeChannel(); continue; }

      // In between: keep re-paging whoever is currently responsible.
      if (sincePage >= config.repageEveryMinutes * MINUTE) {
        (await db.run('UPDATE incidents SET last_paged_at = ? WHERE id = ?', [now.toISOString(), inc.id]));
        const targets = inc.escalation_level === 0 ? onCallPeople : [...onCallPeople, backup];
        for (const u of targets.filter(Boolean)) {
          await event(inc.id, `Re-paged ${u.name}`, now);
          await page(inc, u, `Reminder: still not acknowledged after ${minutes} min.`);
        }
      }
    }
  }

  /** Open incidents someone should act on: theirs first, else the newest open one. */
  async function latestOpenFor(user) {
    return (await db.get(`SELECT * FROM incidents WHERE status = 'open'
                       ORDER BY CASE WHEN assigned_user_id = ? OR backup_user_id = ? THEN 1 ELSE 0 END DESC, id DESC LIMIT 1`, [user.id, user.id]));
  }

  async function list({ limit = 50 } = {}) {
    return (await db.all(`
      SELECT i.*, a.name AS assigned_name, b.name AS backup_name, k.name AS acked_by_name, r.name AS resolved_by_name
      FROM incidents i
      LEFT JOIN users a ON a.id = i.assigned_user_id
      LEFT JOIN users b ON b.id = i.backup_user_id
      LEFT JOIN users k ON k.id = i.acked_by
      LEFT JOIN users r ON r.id = i.resolved_by
      ORDER BY CASE WHEN i.status = 'resolved' THEN 1 ELSE 0 END, i.id DESC LIMIT ?`, [limit]));
  }

  return { create, acknowledge, resolve, tick, get, events, list, latestOpenFor };
}
