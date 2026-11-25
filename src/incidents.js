// Incidents: trigger -> page on-call -> re-page -> escalate to backup -> alert channel.
import crypto from 'node:crypto';
import { config } from './config.js';
import { claimOnce } from './db.js';
import { HttpError } from './http.js';
import { mention, engineersTag, slackText } from './notify/slack.js';

const MINUTE = 60_000;
// Automatic paging gives up on an incident nobody acknowledged within a day: by then it has been
// paged hundreds of times, and a forgotten one must not page people (or keep the database awake) forever.
const PAGE_FOR = 24 * 60 * MINUTE;

export function makeIncidents({ db, rotation, notify }) {
  const get = async (id) => (Number.isSafeInteger(id) ? (await db.get('SELECT * FROM incidents WHERE id = ?', [id])) ?? null : null);
  const userById = async (id) => (id ? rotation.userById(id) : null);
  const incUrl = (inc) => `${config.publicUrl}/incidents/${inc.id}`;

  // The scheduler calls tick() every minute. Querying each time keeps a serverless database (Neon)
  // awake around the clock, so once a tick finds nothing open we stop asking until an incident is
  // created in this process. `created` guards against one being created while a tick is reading.
  let idle = false;
  let created = 0;

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

  /** What a phone needs to ring for a page (spec: push payload). */
  function callPayload(inc, { reason, attempt, nextCallAt, pagedBy, now }) {
    return {
      type: 'page', callId: crypto.randomUUID(), incidentId: String(inc.id), title: inc.title, reason,
      pagedBy: pagedBy ?? '', attempt, nextCallAt: nextCallAt ? nextCallAt.toISOString() : '', server: config.publicUrl, sentAt: now.toISOString(),
    };
  }

  /** The call number for a page sent at `now`: 1 at the start, 2 at the second call, then one per re-page. */
  const attemptAt = (inc, now) => 2 + Math.floor((now - new Date(inc.created_at)) / (config.repageEveryMinutes * MINUTE));

  /**
   * Page one person about an incident: the Slack DM now, and a returned `ring` that calls every
   * phone they have the app on. Callers send every Slack message first and then ring all phones
   * together (ringAll), so a slow push service never holds up Slack.
   */
  async function page(inc, user, reason, { attempt, nextCallAt, now = new Date() }) {
    const details = inc.details ? `\n${slackText(inc.details)}` : '';
    const text = `:rotating_light: *Incident #${inc.id}: ${slackText(inc.title)}*${details}\n${reason}`;
    await notify.user(user, { text, blocks: pageBlocks(inc, text), incidentId: inc.id });
    const pagedBy = (await userById(inc.created_by))?.name ?? inc.source;
    return () => notify.call(user, { payload: callPayload(inc, { reason, attempt, nextCallAt, pagedBy, now }), incidentId: inc.id });
  }
  async function ringAll(rings) {
    for (const r of await Promise.allSettled(rings.map((ring) => ring()))) {
      if (r.status === 'rejected') console.error('phone call failed:', r.reason);
    }
  }

  /** The people to page minus whoever paged, unless that would leave nobody. */
  const skipCreator = (people, creatorId) => (creatorId && people.length > 1 && people.some((p) => p.id === creatorId)
    ? people.filter((p) => p.id !== creatorId) : people);

  /**
   * Who an unacknowledged weekend incident pages: the people on call when it started (minus
   * whoever paged it), or the admins when nobody was. Null on weekdays, when nobody is on call.
   */
  async function responsibleFor(inc) {
    const onCallThen = await rotation.onCallNow(new Date(inc.created_at));
    if (!onCallThen) return null;
    const assigned = await userById(inc.assigned_user_id);
    const backup = await userById(inc.backup_user_id);
    // Everyone on call that weekend (including anyone who added themselves since).
    const onCallPeople = onCallThen.people.length ? onCallThen.people : [assigned].filter(Boolean);
    const responders = onCallPeople.length ? skipCreator(onCallPeople, inc.created_by)
      : await db.all("SELECT * FROM users WHERE active = 1 AND role = 'admin' ORDER BY id");
    return { onCallPeople, responders, backup };
  }

  /**
   * Take one escalation step on the incident as it was read. If someone acknowledged it meanwhile,
   * or another scheduler run already took this step, nothing changes and the caller sends nothing.
   */
  const claimLevel = async (inc, level, now) => (await db.run(
    `UPDATE incidents SET escalation_level = ?, last_paged_at = ?
     WHERE id = ? AND status = 'open' AND escalation_level = ? AND last_paged_at = ?`,
    [level, now.toISOString(), inc.id, inc.escalation_level, inc.last_paged_at])).changes === 1;

  async function alertWholeChannel(inc, minutes, now) {
    if (!(await claimLevel(inc, 2, now))) return false;
    await event(inc.id, `Not acknowledged after ${minutes} min — alerted the whole team channel`, now);
    await notify.channel({
      text: `${engineersTag('<!channel>')} :fire: Incident #${inc.id} *${slackText(inc.title)}* has not been acknowledged for ${minutes} min. ` +
        `Can anyone take it? ${incUrl(inc)}`,
      blocks: pageBlocks(inc, `${engineersTag('<!channel>')} :fire: *Incident #${inc.id}: ${slackText(inc.title)}*\nNot acknowledged for ${minutes} min. Can anyone take it?`),
      incidentId: inc.id,
    });
    return true;
  }

  /**
   * `dedupe` is for monitors that fire the same alert every minute: while an incident with the
   * same title is still unresolved, the repeat is noted on it and nobody is paged again.
   */
  async function create({ title, details = '', source = 'web', createdBy = null, dedupe = false, quiet = false }, now = new Date()) {
    title = String(title || '').trim().slice(0, 200);
    if (!title) throw new Error('A title is required');
    details = String(details || '').trim().slice(0, 4000);

    if (dedupe) {
      const same = await db.get(`SELECT id FROM incidents WHERE status != 'resolved' AND created_at >= ? AND LOWER(title) = LOWER(?)
                                 ORDER BY id DESC LIMIT 1`, [new Date(now.getTime() - PAGE_FOR).toISOString(), title]);
      if (same) {
        await event(same.id, `Same alert again via ${source}`, now);
        return { ...(await get(same.id)), repeat: true };
      }
    }

    const onCall = await rotation.onCallNow(now); // null on weekdays
    const people = onCall?.people ?? [];
    const assigned = people[0] ?? null; // shown as "on call"; everyone in `people` is paged
    // A weekend with nobody on call still escalates (admins, then the backup); weekdays go straight to the channel.
    const backup = onCall ? await rotation.backupFor(onCall.shift) : null;
    const iso = now.toISOString();

    const { id: newId } = (await db.get(`
      INSERT INTO incidents (title, details, source, assigned_user_id, backup_user_id, escalation_level,
                             ack_token, created_by, created_at, last_paged_at, quiet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [title, details, source, assigned?.id ?? null, backup?.id ?? null, onCall ? 0 : 2,
      crypto.randomBytes(16).toString('hex'), createdBy, iso, iso, quiet ? 1 : 0]));
    created += 1;
    idle = false;
    const inc = await get(Number(newId));
    const creator = await userById(createdBy);
    await event(inc.id, `Triggered via ${source}${creator ? ` by ${creator.name}` : ''}`, now);

    if (quiet) {
      // Posted, not paged: nobody's phone rings and it never escalates. Anyone can pick it up.
      await event(inc.id, 'Posted in the team channel — nobody was called', now);
      const text = `:mega: Incident #${inc.id}: *${slackText(inc.title)}* — posted by ${creator ? mention(creator) : source}. Nobody was called.`;
      await notify.channel({ text: `${text} ${incUrl(inc)}`, blocks: pageBlocks(inc, text), incidentId: inc.id });
      return { ...(await get(inc.id)), paged: [] };
    }

    // Whoever paged already knows: when someone else is on call too, only they are paged.
    const paged = skipCreator(people, createdBy);
    if (paged.length) {
      await event(inc.id, `Paged ${paged.map((p) => p.name).join(' and ')} (on call)`, now);
      const firstCall = { attempt: 1, nextCallAt: new Date(now.getTime() + config.secondCallAfterMinutes * MINUTE), now };
      const rings = [];
      for (const p of paged) rings.push(await page(inc, p, 'You are on call. Please acknowledge.', firstCall));
      await notify.channel({
        text: `${engineersTag()}${engineersTag() ? ' ' : ''}:rotating_light: Incident #${inc.id}: *${slackText(inc.title)}* — paging ${paged.map(mention).join(' and ')} (on call). ${incUrl(inc)}`,
        incidentId: inc.id,
      });
      await ringAll(rings);
    } else {
      // Weekday or empty weekend: nobody is on call, so the whole team gets it.
      const when = onCall ? 'this weekend' : 'right now';
      await event(inc.id, `Nobody is on call ${when} — alerted the team channel`, now);
      await notify.channel({
        text: `${engineersTag('<!here>')} :rotating_light: Incident #${inc.id}: *${slackText(inc.title)}* — nobody is on call ${when}, ` +
          `can someone take it? ${incUrl(inc)}`,
        blocks: pageBlocks(inc, `${engineersTag('<!here>')} :rotating_light: *Incident #${inc.id}: ${slackText(inc.title)}*\nNobody is on call ${when} — can someone take it?`),
        incidentId: inc.id,
      });
    }
    return { ...(await get(inc.id)), paged };
  }

  /**
   * A test page from `/page test call me|everyone`: a real incident, titled "[Test] …", that calls
   * these people once. It never calls again or escalates, and stays out of the team channel.
   * Returns the incident and each person's call results.
   */
  async function testPage({ title, by, people, source = 'slack' }, now = new Date()) {
    title = `[Test] ${String(title || '').trim() || 'Test page'}`.slice(0, 200);
    const iso = now.toISOString();
    const { id } = await db.get(`
      INSERT INTO incidents (title, details, source, escalation_level, ack_token, created_by, created_at, last_paged_at, test)
      VALUES (?, '', ?, 0, ?, ?, ?, ?, 1) RETURNING id`, [title, source, crypto.randomBytes(16).toString('hex'), by.id, iso, iso]);
    const inc = await get(Number(id));
    await event(inc.id, `Test page via ${source} by ${by.name}: called ${people.map((p) => p.name).join(', ')} once`, now);
    const reason = `Test page from ${by.name}. Answer it to try PagerDiem; it won't call again.`;
    const rings = [];
    for (const p of people) rings.push(await page(inc, p, reason, { attempt: 1, nextCallAt: null, now }));
    const calls = await Promise.all(rings.map((ring) => ring()));
    return { incident: inc, called: people.map((user, i) => ({ user, calls: calls[i] })) };
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
    // Two people can tap Acknowledge at once: only the one whose update lands announces it.
    const { changes } = await db.run(`UPDATE incidents SET status = 'acknowledged', acked_at = ?, acked_by = ? WHERE id = ? AND status = 'open'`, [now.toISOString(), user?.id ?? null, id]);
    if (!changes) return { incident: await get(id), changed: false };
    await event(id, `Acknowledged by ${user?.name ?? 'someone'} via ${via}`, now);
    if (!inc.test) await notify.channel({
      text: `:eyes: Incident #${id} *${slackText(inc.title)}* acknowledged by ${mention(user)}.${await onCallTags(inc, user)}`, incidentId: id,
    });
    await notify.cancelCalls(id);
    return { incident: await get(id), changed: true };
  }

  async function resolve(id, user, via = 'web', now = new Date()) {
    const inc = await get(id);
    if (!inc) throw new Error('Incident not found');
    if (inc.status === 'resolved') return { incident: inc, changed: false };
    const { changes } = await db.run(`UPDATE incidents SET status = 'resolved', resolved_at = ?, resolved_by = ?,
                acked_at = COALESCE(acked_at, ?), acked_by = COALESCE(acked_by, ?) WHERE id = ? AND status != 'resolved'`, [now.toISOString(), user?.id ?? null, now.toISOString(), user?.id ?? null, id]);
    if (!changes) return { incident: await get(id), changed: false };
    await event(id, `Resolved by ${user?.name ?? 'someone'} via ${via}`, now);
    if (!inc.test) await notify.channel({
      text: `:white_check_mark: Incident #${id} *${slackText(inc.title)}* resolved by ${mention(user)}.${await onCallTags(inc, user)}`, incidentId: id,
    });
    await notify.cancelCalls(id);
    return { incident: await get(id), changed: true };
  }

  /**
   * Called every minute: re-page and escalate incidents nobody has acknowledged.
   * Weekend: on-call (or the admins, if nobody is on call) -> backup at 15 min -> @channel at 30 min,
   * then everyone so far is paged again every 5 min until someone acknowledges.
   * Weekday: nobody is on call, so the channel is reminded every 30 min instead.
   */
  async function tick(now = new Date()) {
    if (idle) return;
    const seen = created;
    const open = (await db.all(`SELECT * FROM incidents WHERE status = 'open' AND quiet = 0 AND test = 0 AND created_at >= ?`,
      [new Date(now.getTime() - PAGE_FOR).toISOString()]));
    if (!open.length && seen === created) idle = true;
    for (const inc of open) {
      const age = now - new Date(inc.created_at);
      const sincePage = now - new Date(inc.last_paged_at);
      const minutes = Math.round(age / MINUTE);
      const escalateAfter = config.escalateAfterMinutes * MINUTE;

      const claim = (level) => claimLevel(inc, level, now);
      const who = await responsibleFor(inc);
      if (!who) {
        if (sincePage < 2 * escalateAfter || !(await claim(2))) continue;
        await event(inc.id, `Still not acknowledged after ${minutes} min — reminded the team channel`, now);
        await notify.channel({
          text: `${engineersTag('<!here>')} :rotating_light: Incident #${inc.id} *${slackText(inc.title)}* is still not acknowledged after ${minutes} min. ` +
            `Can someone take it? ${incUrl(inc)}`,
          blocks: pageBlocks(inc, `${engineersTag('<!here>')} :rotating_light: *Incident #${inc.id}: ${slackText(inc.title)}*\nStill not acknowledged after ${minutes} min. Can someone take it?`),
          incidentId: inc.id,
        });
        continue;
      }

      const { onCallPeople, responders, backup } = who;
      const names = onCallPeople.map((p) => p.name).join(' and ');
      const repage = { attempt: attemptAt(inc, now), nextCallAt: new Date(now.getTime() + config.repageEveryMinutes * MINUTE), now };

      // Phones only, once, a couple of minutes in: a repeated call gets through Do Not Disturb.
      if (inc.escalation_level === 0 && age >= config.secondCallAfterMinutes * MINUTE
          && sincePage < config.repageEveryMinutes * MINUTE && (await claimOnce(db, `second-call:${inc.id}`))) {
        const secondCall = callPayload(inc, {
          reason: `Still not acknowledged after ${minutes} min.`, attempt: 2, now,
          nextCallAt: new Date(new Date(inc.last_paged_at).getTime() + config.repageEveryMinutes * MINUTE),
          pagedBy: (await userById(inc.created_by))?.name ?? inc.source,
        });
        const called = (await Promise.all(responders.map((u) => notify.call(u, {
          payload: { ...secondCall, callId: crypto.randomUUID() }, incidentId: inc.id,
        })))).flat().length;
        if (called) await event(inc.id, 'Called again so it rings through Do Not Disturb', now);
      }

      // Step 1: on-call didn't respond -> page the backup (or the channel if there is none).
      if (inc.escalation_level === 0 && age >= escalateAfter) {
        if (!backup) { await alertWholeChannel(inc, minutes, now); continue; }
        if (!(await claim(1))) continue;
        await event(inc.id, `Not acknowledged after ${minutes} min — escalated to ${backup.name} (backup)`, now);
        const rings = [await page(inc, backup, onCallPeople.length
          ? `${names} hasn't acknowledged in ${minutes} min. You're the backup.`
          : `Nobody is on call this weekend and nobody has acknowledged in ${minutes} min. You're the backup.`, repage)];
        for (const p of responders) rings.push(await page(inc, p, `Still not acknowledged after ${minutes} min — escalated to ${backup.name}.`, repage));
        await notify.channel({
          text: `:warning: Incident #${inc.id} *${slackText(inc.title)}* not acknowledged${responders.length ? ` by ${responders.map(mention).join(' or ')}` : ''} after ${minutes} min — ` +
            `escalating to ${mention(backup)}.`,
          incidentId: inc.id,
        });
        await ringAll(rings);
        continue;
      }

      // Step 2: backup didn't respond either -> @channel.
      if (inc.escalation_level === 1 && age >= 2 * escalateAfter) { await alertWholeChannel(inc, minutes, now); continue; }

      // In between, and after the @channel: keep re-paging everyone responsible so far.
      if (sincePage >= config.repageEveryMinutes * MINUTE) {
        const targets = (inc.escalation_level === 0 ? responders : [...responders, backup]).filter(Boolean);
        if (!targets.length || !(await claim(inc.escalation_level))) continue;
        const rings = [];
        for (const u of targets) {
          await event(inc.id, `Re-paged ${u.name}`, now);
          rings.push(await page(inc, u, onCallPeople.length || inc.escalation_level > 0
            ? `Reminder: still not acknowledged after ${minutes} min.`
            : `Nobody is on call this weekend and this isn't acknowledged after ${minutes} min. You're an admin — can you take it?`, repage));
        }
        await ringAll(rings);
      }
    }
  }

  /** An incident someone may still act on: 404 if missing, 409 once resolved. */
  async function getActive(id) {
    const inc = await get(id);
    if (!inc) throw new HttpError(404, 'Incident not found');
    if (inc.status === 'resolved') throw new HttpError(409, 'This incident is resolved');
    return inc;
  }

  async function getPaging(id) {
    const inc = await getActive(id);
    if (inc.status !== 'open') throw new HttpError(409, 'This incident is already acknowledged, so paging has stopped.');
    if (inc.quiet) throw new HttpError(409, 'This incident was posted without calling anyone.');
    if (inc.test) throw new HttpError(409, 'This is a test page, so nobody is called again.');
    return inc;
  }

  /** Add a note to an incident. It's posted in the on-call channel too. */
  async function addNote(id, user, text, via = 'web', now = new Date()) {
    const inc = await getActive(id);
    text = String(text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 2000);
    if (!text) throw new HttpError(400, 'Write a note first.');
    const { id: noteId } = await db.get('INSERT INTO incident_notes (incident_id, user_id, at, text) VALUES (?, ?, ?, ?) RETURNING id',
      [id, user.id, now.toISOString(), text]);
    if (!inc.test) await notify.channel({ text: `:memo: Note on #${id} from ${mention(user)}: ${slackText(text)}`, incidentId: id });
    return { id: Number(noteId), at: now.toISOString(), text, user };
  }

  const notes = (id) => db.all(`SELECT n.*, u.name AS user_name, u.role AS user_role FROM incident_notes n
    JOIN users u ON u.id = n.user_id WHERE n.incident_id = ? ORDER BY n.id`, [id]);

  /** Page everyone responsible right now instead of waiting for the next re-page. */
  async function callAgain(id, user, now = new Date()) {
    const inc = await getPaging(id);
    if (now - new Date(inc.last_paged_at) < MINUTE) throw new HttpError(429, 'Everyone was called less than a minute ago.');
    const who = await responsibleFor(inc);
    if (!who || !who.responders.length) throw new HttpError(409, 'Nobody is on call right now, so there is nobody to call.');
    const targets = (inc.escalation_level === 0 ? who.responders : [...who.responders, who.backup]).filter(Boolean);
    await db.run("UPDATE incidents SET last_paged_at = ? WHERE id = ? AND status = 'open'", [now.toISOString(), id]);
    await event(id, `${user.name} asked to call everyone again`, now);
    const opts = { attempt: attemptAt(inc, now), nextCallAt: new Date(now.getTime() + config.repageEveryMinutes * MINUTE), now };
    const rings = [];
    for (const u of targets) rings.push(await page(inc, u, `${user.name} asked to call you again. Still not acknowledged.`, opts));
    await ringAll(rings);
    idle = false;
    return { paged: targets };
  }

  /** Call the backup now instead of waiting for the escalation (the whole channel if there is no backup). */
  async function callBackupNow(id, user, now = new Date()) {
    const inc = await getPaging(id);
    if (inc.escalation_level >= 1) throw new HttpError(409, 'The backup has already been called');
    const who = await responsibleFor(inc);
    if (!who) throw new HttpError(409, 'Nobody is on call right now, so there is no backup to call.');
    const minutes = Math.round((now - new Date(inc.created_at)) / MINUTE);
    idle = false;
    if (!who.backup) {
      if (!(await alertWholeChannel(inc, minutes, now))) throw new HttpError(409, 'The backup has already been called');
      return { paged: [] };
    }
    if (!(await claimLevel(inc, 1, now))) throw new HttpError(409, 'The backup has already been called');
    await event(id, `${user.name} asked to call ${who.backup.name} (backup) now`, now);
    const ring = await page(inc, who.backup, `${user.name} asked for the backup. You're the backup.`,
      { attempt: attemptAt(inc, now), nextCallAt: new Date(now.getTime() + config.repageEveryMinutes * MINUTE), now });
    await notify.channel({
      text: `:warning: Incident #${id} *${slackText(inc.title)}*: ${mention(user)} asked for the backup early — calling ${mention(who.backup)}.`,
      incidentId: id,
    });
    await ringAll([ring]);
    return { paged: [who.backup] };
  }

  /** The newest distinct incident titles, for the phone app's quick picks. */
  async function recentTitles(limit = 3) {
    const seen = new Set();
    const titles = [];
    for (const { title } of await db.all('SELECT title FROM incidents ORDER BY id DESC LIMIT 50')) {
      if (seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      titles.push(title);
      if (titles.length === limit) break;
    }
    return titles;
  }

  /** Open incidents someone should act on: theirs first, else the newest open one. */
  async function latestOpenFor(user) {
    return (await db.get(`SELECT * FROM incidents WHERE status = 'open'
                       ORDER BY CASE WHEN assigned_user_id = ? OR backup_user_id = ? THEN 1 ELSE 0 END DESC, id DESC LIMIT 1`, [user.id, user.id]));
  }

  async function list({ limit = 50, status = null } = {}) {
    return (await db.all(`
      SELECT i.*, a.name AS assigned_name, b.name AS backup_name, k.name AS acked_by_name, r.name AS resolved_by_name
      FROM incidents i
      LEFT JOIN users a ON a.id = i.assigned_user_id
      LEFT JOIN users b ON b.id = i.backup_user_id
      LEFT JOIN users k ON k.id = i.acked_by
      LEFT JOIN users r ON r.id = i.resolved_by
      ${status ? 'WHERE i.status = ?' : ''}
      ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, i.id DESC LIMIT ?`, status ? [status, limit] : [limit]));
  }

  /** Counts per status, plus incidents and the median wait for an acknowledgement over the last 30 days. */
  async function stats(now = new Date()) {
    const byStatus = Object.fromEntries((await db.all('SELECT status, COUNT(*) AS n FROM incidents GROUP BY status'))
      .map((r) => [r.status, Number(r.n)]));
    const recent = await db.all('SELECT created_at, acked_at FROM incidents WHERE created_at >= ?',
      [new Date(now.getTime() - 30 * 24 * 60 * MINUTE).toISOString()]);
    const waits = recent.filter((r) => r.acked_at).map((r) => (new Date(r.acked_at) - new Date(r.created_at)) / MINUTE).sort((a, b) => a - b);
    const mid = Math.floor(waits.length / 2);
    const median = !waits.length ? null : waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2;
    return {
      open: byStatus.open ?? 0, acknowledged: byStatus.acknowledged ?? 0, resolved: byStatus.resolved ?? 0,
      last30Days: recent.length, medianAckMinutes: median === null ? null : Math.round(median),
    };
  }

  return {
    create, testPage, acknowledge, resolve, tick, get, events, list, stats, latestOpenFor,
    addNote, notes, callAgain, callBackupNow, recentTitles, responsibleFor,
  };
}
