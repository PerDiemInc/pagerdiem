import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TEAM_TIMEZONE = 'America/New_York';
process.env.SHIFT_START = 'FRI 18:00';
process.env.SHIFT_END = 'MON 09:00';
process.env.ESCALATE_AFTER_MINUTES = '15';
process.env.REPAGE_EVERY_MINUTES = '5';

const { config } = await import('../src/config.js');
const { makeShifts } = await import('../src/time.js');
const { normalizeCoverage, normalizeDomains, describeDays, coverageFromEnv } = await import('../src/settings.js');
const { freshDb } = await import('./helpers.js');
const { openDb } = await import('../src/db.js');
const { DatabaseSync } = await import('node:sqlite');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { makeRotation } = await import('../src/rotation.js');
const { makeNotifier } = await import('../src/notify/index.js');
const { makeIncidents } = await import('../src/incidents.js');
const { makeScheduler } = await import('../src/scheduler.js');

const shifts = makeShifts(config);
const at = (iso) => new Date(iso);

test('weekend shift boundaries in the team time zone', () => {
  assert.equal(shifts.current(at('2026-11-19T17:00:00Z')), null, 'Thursday is not a shift');
  const next = shifts.next(at('2026-11-19T17:00:00Z'));
  assert.equal(next.key, '2026-11-20');
  assert.equal(next.start.toISOString(), '2026-11-20T23:00:00.000Z'); // Fri 18:00 EST
  assert.equal(next.end.toISOString(), '2026-11-23T14:00:00.000Z'); // Mon 09:00 EST

  assert.equal(shifts.current(at('2026-11-20T22:59:00Z')), null, 'Fri 17:59');
  assert.equal(shifts.current(at('2026-11-20T23:00:00Z')).key, '2026-11-20', 'Fri 18:00');
  assert.equal(shifts.current(at('2026-11-22T03:00:00Z')).key, '2026-11-20', 'Sat night');
  assert.equal(shifts.current(at('2026-11-23T13:59:00Z')).key, '2026-11-20', 'Mon 08:59');
  assert.equal(shifts.current(at('2026-11-23T14:00:00Z')), null, 'Mon 09:00');
  assert.equal(shifts.next(at('2026-11-20T23:30:00Z')).key, '2026-11-27', 'next while one is running');
});

test('shifts that cross a daylight-saving change keep local wall-clock times', () => {
  const s = shifts.forKey('2026-03-06'); // DST starts Sunday March 8 2026
  assert.equal(s.start.toISOString(), '2026-03-06T23:00:00.000Z'); // 18:00 EST
  assert.equal(s.end.toISOString(), '2026-03-09T13:00:00.000Z'); // 09:00 EDT
  const fall = shifts.forKey('2026-10-30'); // DST ends Sunday Nov 1 2026
  assert.equal(fall.start.toISOString(), '2026-10-30T22:00:00.000Z'); // 18:00 EDT
  assert.equal(fall.end.toISOString(), '2026-11-02T14:00:00.000Z'); // 09:00 EST
});

async function setup() {
  const db = await freshDb();
  await db.run("INSERT INTO settings (key, value) VALUES ('rotation_start', '2026-11-20')");
  const rotation = makeRotation(db, shifts);
  const sent = [];
  const notify = makeNotifier(db, {
    slack: async (to, text) => { sent.push({ ch: 'slack', to, text }); },
    whatsapp: async (to, text) => { sent.push({ ch: 'whatsapp', to, text }); },
  });
  const addUser = async (name) => {
    await db.run(`INSERT INTO users (name, email, password_hash, slack_user_id, whatsapp, rotation_order)
      VALUES (?, ?, 'x', ?, ?, ?)`, [name, `${name.toLowerCase()}@example.com`, `U${name.toUpperCase()}000000`,
      `+1555000${String(name.charCodeAt(0)).padStart(4, '0')}`, await rotation.nextRotationOrder()]);
    return db.get('SELECT * FROM users WHERE name = ?', [name]);
  };
  const addUsers = async (...names) => { const out = []; for (const n of names) out.push(await addUser(n)); return out; };
  return { db, rotation, notify, sent, addUser, addUsers };
}

const namesOf = (sched) => sched.map((e) => e.people.map((p) => p.name).join('+'));

test('rotation puts 2 people on each weekend, in turn, balanced', async () => {
  const { rotation, addUsers } = await setup();
  await addUsers('Ana', 'Ben', 'Cal');
  const sched = await rotation.schedule(shifts.forKey('2026-11-20'), 6);
  assert.deepEqual(namesOf(sched), ['Ana+Ben', 'Cal+Ana', 'Ben+Cal', 'Ana+Ben', 'Cal+Ana', 'Ben+Cal']);
  // Looking from weeks before the rotation started gives the same answer (those weekends are empty).
  const fromEarlier = await rotation.schedule(shifts.forKey('2026-10-30'), 5);
  assert.deepEqual(namesOf(fromEarlier), ['', '', '', 'Ana+Ben', 'Cal+Ana']);
  const counts = Object.fromEntries((await rotation.balance(sched)).map((b) => [b.user.name, b.weekends]));
  assert.deepEqual(counts, { Ana: 4, Ben: 4, Cal: 4 }, 'everyone gets the same number of weekends');
});

test('admins are optional: not auto-assigned, but can add themselves', async () => {
  const { db, rotation, addUsers } = await setup();
  const [ana] = await addUsers('Ana', 'Ben', 'Cal', 'Dee');
  await db.run("UPDATE users SET role = 'admin' WHERE id = ?", [ana.id]);
  const sched = await rotation.schedule(shifts.forKey('2026-11-20'), 3);
  assert.deepEqual(namesOf(sched), ['Ben+Cal', 'Dee+Ben', 'Cal+Dee']);
  await rotation.join(shifts.forKey('2026-11-20'), ana, at('2026-11-19T12:00:00Z'));
  assert.deepEqual(namesOf(await rotation.schedule(shifts.forKey('2026-11-20'), 1)), ['Ben+Cal+Ana']);
});

test('people who join the team later slot in without reshuffling past weekends', async () => {
  const { rotation, addUser, addUsers } = await setup();
  await addUsers('Ana', 'Ben', 'Cal');
  await rotation.lock(shifts.forKey('2026-11-20')); // Ana+Ben's weekend happened
  await addUser('Dee');
  const sched = await rotation.schedule(shifts.forKey('2026-11-20'), 3);
  assert.deepEqual(namesOf(sched), ['Ana+Ben', 'Cal+Dee', 'Ana+Ben']);
});

test('anyone can add themselves (no limit) and remove only themselves; every change is logged', async () => {
  const { rotation, addUsers } = await setup();
  const [ana, ben, cal, dee] = await addUsers('Ana', 'Ben', 'Cal', 'Dee');
  const wk = shifts.forKey('2026-11-20');
  const t = at('2026-11-19T12:00:00Z');

  assert.ok((await rotation.join(wk, cal, t)).changed);
  assert.ok((await rotation.join(wk, dee, t)).changed);
  let e = await rotation.forShift(wk);
  assert.deepEqual(e.people.map((p) => p.name), ['Ana', 'Ben', 'Cal', 'Dee'], 'no limit per weekend');
  assert.equal((await rotation.join(wk, cal, t)).changed, false, 'joining twice is a no-op');

  await rotation.leave(wk, ana, t);
  await rotation.leave(wk, ben, t);
  await rotation.leave(wk, cal, t);
  e = await rotation.forShift(wk);
  assert.deepEqual(e.people.map((p) => p.name), ['Dee']);
  assert.ok(e.needsCover, 'fewer than 2 people = needs cover');

  // The rest of the rotation is untouched by changes to one weekend.
  assert.deepEqual(namesOf(await rotation.schedule(shifts.forKey('2026-11-27'), 1)), ['Cal+Dee']);

  const log = await rotation.log();
  assert.deepEqual(log.map((l) => `${l.user_name} ${l.action}`).reverse(),
    ['Cal join', 'Dee join', 'Ana leave', 'Ben leave', 'Cal leave']);
  await assert.rejects(rotation.join(shifts.forKey('2026-11-13'), ana, t), /already over/);
});

test('removed teammates are skipped', async () => {
  const { db, rotation, addUsers } = await setup();
  const [, ben] = await addUsers('Ana', 'Ben', 'Cal');
  await db.run('UPDATE users SET active = 0 WHERE id = ?', [ben.id]);
  assert.deepEqual(namesOf(await rotation.schedule(shifts.forKey('2026-11-20'), 2)), ['Ana+Cal', 'Ana+Cal']);
});

test('backup is the first person on the next weekend who is not already on call', async () => {
  const { rotation, addUsers } = await setup();
  await addUsers('Ana', 'Ben', 'Cal');
  assert.equal((await rotation.backupFor(shifts.forKey('2026-11-20'))).name, 'Cal');
});

test('incident pages on-call, re-pages, escalates to backup, then the channel', async () => {
  const { db, rotation, notify, sent, addUser, addUsers } = await setup();
  await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const t0 = at('2026-11-21T15:00:00Z'); // Saturday: Ana + Ben on call, Cal is backup

  const inc = await incidents.create({ title: 'Checkout down' }, t0);
  assert.equal((await rotation.userById(inc.assigned_user_id)).name, 'Ana');
  assert.equal((await rotation.userById(inc.backup_user_id)).name, 'Cal');
  assert.ok(!sent.some((m) => m.ch === 'whatsapp'), 'Slack only');
  assert.ok(sent.some((m) => m.ch === 'slack' && m.to === 'UANA000000'));
  assert.ok(sent.some((m) => m.ch === 'slack' && m.to === 'UBEN000000'), 'both on-call people are paged');
  assert.ok(sent.some((m) => m.to === 'CONCALL'));

  sent.length = 0;
  await incidents.tick(new Date(t0.getTime() + 5 * 60_000));
  assert.ok(sent.some((m) => m.to === 'UANA000000' && m.text.includes('Reminder')), 're-page at 5 min');
  assert.ok(sent.some((m) => m.to === 'UBEN000000' && m.text.includes('Reminder')));
  assert.ok(!sent.some((m) => m.to === 'UCAL000000'), 'backup not paged yet');

  sent.length = 0;
  await incidents.tick(new Date(t0.getTime() + 15 * 60_000));
  assert.equal((await incidents.get(inc.id)).escalation_level, 1);
  assert.ok(sent.some((m) => m.to === 'UCAL000000'), 'backup paged at 15 min');

  sent.length = 0;
  await incidents.tick(new Date(t0.getTime() + 30 * 60_000));
  assert.equal((await incidents.get(inc.id)).escalation_level, 2);
  assert.ok(sent.some((m) => m.to === 'CONCALL' && m.text.includes('<!channel>')));

  const ben = await rotation.userById(inc.backup_user_id);
  const { changed } = await incidents.acknowledge(inc.id, ben, 'whatsapp');
  assert.ok(changed);
  assert.equal((await incidents.get(inc.id)).status, 'acknowledged');

  sent.length = 0;
  await incidents.tick(new Date(t0.getTime() + 60 * 60_000));
  assert.equal(sent.length, 0, 'no more paging after ack');
});

test('weekday incidents go to the team channel', async () => {
  const { db, rotation, notify, sent, addUser, addUsers } = await setup();
  await addUser('Ana');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const inc = await incidents.create({ title: 'Slow API' }, at('2026-11-18T15:00:00Z')); // Wednesday
  assert.equal(inc.assigned_user_id, null);
  assert.deepEqual(sent.map((m) => m.to), ['CONCALL']);
  assert.ok(sent[0].text.includes('<!here>'));
});

test('the engineers user group is tagged when configured', async () => {
  const { db, rotation, notify, sent, addUser } = await setup();
  await addUser('Ana');
  config.slack.channel = 'CONCALL';
  config.slack.engineersGroupId = 'S0ENGINEERS';
  try {
    const incidents = makeIncidents({ db, rotation, notify });
    await incidents.create({ title: 'Slow API' }, at('2026-11-18T15:00:00Z'));
    assert.ok(sent[0].text.includes('<!subteam^S0ENGINEERS>'));
    assert.ok(!sent[0].text.includes('<!here>'));
  } finally {
    config.slack.engineersGroupId = '';
  }
});

test('scheduler sends the reminder and shift start once each', async () => {
  const { db, rotation, notify, sent, addUser, addUsers } = await setup();
  await addUsers('Ana', 'Ben');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const scheduler = makeScheduler({ db, shifts, rotation, notify, incidents });

  await scheduler.runOnce(at('2026-11-19T12:00:00Z')); // Thu 07:00 ET: before the 24h window
  assert.equal(sent.length, 0);

  await scheduler.runOnce(at('2026-11-20T00:00:00Z')); // Thu 19:00 ET: inside it
  await scheduler.runOnce(at('2026-11-20T00:01:00Z'));
  const reminders = sent.filter((m) => m.to === 'UANA000000');
  assert.equal(reminders.length, 1, 'one reminder');
  assert.match(reminders[0].text, /on call this weekend.*With Ben/);
  assert.equal(sent.filter((m) => m.to === 'UBEN000000').length, 1, 'both people get a reminder');

  sent.length = 0;
  await scheduler.runOnce(at('2026-11-20T23:00:00Z')); // Fri 18:00 ET
  await scheduler.runOnce(at('2026-11-20T23:01:00Z'));
  assert.equal(sent.filter((m) => m.to === 'UANA000000').length, 1, 'one shift-start DM');
  assert.equal(sent.filter((m) => m.to === 'UBEN000000').length, 1);
  assert.ok(await db.get("SELECT * FROM shift_people WHERE weekend_key = '2026-11-20'"), 'weekend frozen');

  sent.length = 0;
  await scheduler.runOnce(at('2026-11-23T14:05:00Z')); // Mon 09:05 ET
  assert.ok(sent.some((m) => m.to === 'CONCALL' && m.text.includes('Next up')), 'hand-off message');
});

async function addUserPhone(db, name) {
  return (await db.get('SELECT whatsapp FROM users WHERE name = ?', [name])).whatsapp;
}

test('swap: take someone\'s spot, undo within 10 seconds, announced only after the window', async () => {
  const { rotation, addUsers } = await setup();
  const [ana, ben, cal] = await addUsers('Ana', 'Ben', 'Cal');
  const wk = shifts.forKey('2026-11-20'); // Ana + Ben
  const t0 = at('2026-11-19T12:00:00Z');

  const s1 = await rotation.swap(wk, cal, ana.id, t0);
  assert.deepEqual((await rotation.forShift(wk)).people.map((p) => p.name), ['Ben', 'Cal']);
  assert.deepEqual(await rotation.claimSwapsToAnnounce(new Date(t0.getTime() + 5_000)), [], 'not announced inside the undo window');

  await assert.rejects(rotation.undoSwap(s1.id, ben, new Date(t0.getTime() + 3_000)), /Not your swap/);
  assert.equal(await rotation.undoSwap(s1.id, cal, new Date(t0.getTime() + 8_000)), true);
  assert.deepEqual((await rotation.forShift(wk)).people.map((p) => p.name), ['Ana', 'Ben'], 'undo restores exactly');
  assert.deepEqual(await rotation.claimSwapsToAnnounce(new Date(t0.getTime() + 60_000)), [], 'undone swaps are never announced');

  const s2 = await rotation.swap(wk, cal, ana.id, t0);
  await assert.rejects(rotation.undoSwap(s2.id, cal, new Date(t0.getTime() + 13_000)), /10 seconds/);
  const due = await rotation.claimSwapsToAnnounce(new Date(t0.getTime() + 13_000));
  assert.deepEqual(due.map((s) => s.id), [s2.id]);
  assert.deepEqual(await rotation.claimSwapsToAnnounce(new Date(t0.getTime() + 20_000)), [], 'announced once');

  await assert.rejects(rotation.swap(wk, cal, ben.id, t0), /already on call/);
  const log = await rotation.log();
  assert.equal(log.filter((l) => l.action === 'swap').length, 2);
  assert.ok(log.some((l) => l.action === 'swap' && l.undone_at), 'undone swap stays in the audit log, marked undone');
});

test('existing databases get a role: admins stay admin, everyone else becomes an engineer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-migrate-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, slack_user_id TEXT, whatsapp TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, rotation_order INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT 'x')`);
  old.exec(`INSERT INTO users (name, email, password_hash, whatsapp, is_admin, rotation_order) VALUES
    ('Ana', 'a@x.com', 'x', '+1', 1, 10), ('Ben', 'b@x.com', 'x', '+2', 0, 20)`);
  old.close();

  const db = await openDb(file);
  const roles = Object.fromEntries((await db.all('SELECT name, role FROM users')).map((u) => [u.name, u.role]));
  assert.deepEqual(roles, { Ana: 'admin', Ben: 'engineer' });

  await db.run("UPDATE users SET role = 'non_technical' WHERE name = 'Ana'");
  await db.close();
  const reopened = await openDb(file);
  assert.equal((await reopened.get("SELECT role FROM users WHERE name = 'Ana'")).role, 'non_technical', 'migration runs once');
  await reopened.close();
  fs.rmSync(dir, { recursive: true });
});

test('admin re-send of weekend-start messages reaches everyone on call again', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  await addUsers('Ana', 'Ben');
  const incidents = makeIncidents({ db, rotation, notify });
  const scheduler = makeScheduler({ db, shifts, rotation, notify, incidents });
  await scheduler.runOnce(at('2026-11-20T23:00:00Z')); // weekend starts
  sent.length = 0;
  const people = await scheduler.resendWeekendStart(at('2026-11-21T12:00:00Z'));
  assert.deepEqual(people.map((p) => p.name), ['Ana', 'Ben']);
  assert.ok(sent.some((m) => m.to === 'UANA000000' && /on call now/.test(m.text)));
  assert.ok(sent.some((m) => m.to === 'UBEN000000' && /on call now/.test(m.text)));
  assert.equal(await scheduler.resendWeekendStart(at('2026-11-25T12:00:00Z')), null, 'nothing on a weekday');
});

test('channel messages tag whoever is on call', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  const [ana, ben, cal] = await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const inc = await incidents.create({ title: 'Down' }, at('2026-11-21T15:00:00Z'));
  assert.ok(sent.some((m) => m.to === 'CONCALL' && m.text.includes('<@UANA000000>') && m.text.includes('<@UBEN000000>')));
  sent.length = 0;
  await incidents.acknowledge(inc.id, cal, 'web');
  const ack = sent.find((m) => m.to === 'CONCALL');
  assert.match(ack.text, /acknowledged by <@UCAL000000>.*cc <@UANA000000> <@UBEN000000> \(on call\)/);
  sent.length = 0;
  await incidents.resolve(inc.id, ana, 'web');
  assert.match(sent.find((m) => m.to === 'CONCALL').text, /resolved by <@UANA000000>\. cc <@UBEN000000> \(on call\)/);
});

test('two acknowledgements at the same moment announce it once', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  const [ana, ben] = await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const inc = await incidents.create({ title: 'Checkout down' }, at('2026-11-21T15:00:00Z'));

  sent.length = 0;
  const [a, b] = await Promise.all([incidents.acknowledge(inc.id, ana, 'web'), incidents.acknowledge(inc.id, ben, 'slack')]);
  assert.equal([a, b].filter((r) => r.changed).length, 1, 'only one acknowledgement wins');
  assert.equal(sent.filter((m) => m.to === 'CONCALL').length, 1, 'one "acknowledged" post');
  assert.equal((await incidents.events(inc.id)).filter((e) => e.message.startsWith('Acknowledged')).length, 1);
});

test('two scheduler runs escalating at the same moment page the backup once', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const t0 = at('2026-11-21T15:00:00Z');
  await incidents.create({ title: 'Checkout down' }, t0);

  sent.length = 0;
  const t15 = new Date(t0.getTime() + 15 * 60_000);
  await Promise.all([incidents.tick(t15), incidents.tick(t15)]);
  assert.equal(sent.filter((m) => m.to === 'UCAL000000').length, 1, 'backup paged once');
});

test('a tick never pages for an incident acknowledged while it was running', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  const [ana] = await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const t0 = at('2026-11-21T15:00:00Z');
  const inc = await incidents.create({ title: 'Checkout down' }, t0);

  // Someone acknowledges after the tick has read the open incidents but before it acts on them.
  const racing = { ...db, all: async (sql, params) => {
    const rows = await db.all(sql, params);
    if (sql.includes("FROM incidents WHERE status = 'open'")) await incidents.acknowledge(inc.id, ana, 'web');
    return rows;
  } };
  sent.length = 0;
  await makeIncidents({ db: racing, rotation, notify }).tick(new Date(t0.getTime() + 15 * 60_000));
  assert.equal(sent.filter((m) => m.to === 'UCAL000000').length, 0, 'backup not paged after the ack');
});

test('the same alert while an incident is still open joins it instead of paging again', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  const [ana] = await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const t0 = at('2026-11-21T15:00:00Z');
  const first = await incidents.create({ title: 'Checkout down', source: 'api', dedupe: true }, t0);

  sent.length = 0;
  const again = await incidents.create({ title: '  checkout DOWN ', source: 'api', dedupe: true }, new Date(t0.getTime() + 60_000));
  assert.equal(again.id, first.id, 'same incident');
  assert.equal(again.repeat, true);
  assert.equal(sent.length, 0, 'nobody paged again');
  assert.ok((await incidents.events(first.id)).some((e) => e.message === 'Same alert again via api'));

  await incidents.acknowledge(first.id, ana, 'slack');
  assert.equal((await incidents.create({ title: 'Checkout down', source: 'api', dedupe: true }, t0)).id, first.id, 'still joins while acknowledged');

  await incidents.resolve(first.id, ana, 'web');
  const fresh = await incidents.create({ title: 'Checkout down', source: 'api', dedupe: true }, new Date(t0.getTime() + 120_000));
  assert.notEqual(fresh.id, first.id, 'a resolved incident starts over');
  assert.notEqual(fresh.repeat, true);

  const manual = await incidents.create({ title: 'Checkout down', source: 'web', createdBy: ana.id }, new Date(t0.getTime() + 180_000));
  assert.notEqual(manual.id, fresh.id, 'a person paging on purpose always pages');
});

test('after the @channel, paging keeps going every 5 min until someone acknowledges', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  const [ana] = await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const t0 = at('2026-11-21T15:00:00Z');
  const inc = await incidents.create({ title: 'Checkout down' }, t0);
  const after = (min) => new Date(t0.getTime() + min * 60_000);
  for (const min of [5, 10, 15, 20, 25, 30]) await incidents.tick(after(min));
  assert.equal((await incidents.get(inc.id)).escalation_level, 2);

  sent.length = 0;
  await incidents.tick(after(35));
  for (const id of ['UANA000000', 'UBEN000000', 'UCAL000000']) assert.ok(sent.some((m) => m.to === id), `${id} paged again at 35 min`);
  sent.length = 0;
  await incidents.tick(after(37));
  assert.equal(sent.length, 0, 'not before the next 5 minutes');
  await incidents.tick(after(40));
  assert.ok(sent.some((m) => m.to === 'UCAL000000'), 'and again at 40 min');

  await incidents.acknowledge(inc.id, ana, 'web');
  sent.length = 0;
  await incidents.tick(after(45));
  assert.equal(sent.length, 0);
});

test('a weekend with nobody on call pages the admins, then the backup, then the channel', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  const [ana, ben, cal] = await addUsers('Ana', 'Ben', 'Cal', 'Dee');
  await db.run("UPDATE users SET role = 'admin', is_admin = 1 WHERE id = ?", [ana.id]);
  const wk = shifts.forKey('2026-11-20'); // Ben + Cal, until they both drop out before it starts
  await rotation.leave(wk, ben, at('2026-11-19T12:00:00Z'));
  await rotation.leave(wk, cal, at('2026-11-19T12:00:00Z'));
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const t0 = at('2026-11-21T15:00:00Z');
  const after = (min) => new Date(t0.getTime() + min * 60_000);

  const inc = await incidents.create({ title: 'Checkout down' }, t0);
  assert.deepEqual(sent.map((m) => m.to), ['CONCALL']);
  assert.match(sent[0].text, /<!here>.*nobody is on call this weekend/);

  sent.length = 0;
  await incidents.tick(after(5));
  assert.ok(sent.some((m) => m.to === 'UANA000000'), 'admin paged at 5 min');

  const backup = await rotation.userById((await incidents.get(inc.id)).backup_user_id);
  assert.ok(backup, 'there is a backup');
  sent.length = 0;
  await incidents.tick(after(15));
  assert.ok(sent.some((m) => m.to === backup.slack_user_id), 'backup paged at 15 min');

  sent.length = 0;
  await incidents.tick(after(30));
  assert.ok(sent.some((m) => m.to === 'CONCALL' && m.text.includes('<!channel>')));
  sent.length = 0;
  await incidents.tick(after(35));
  assert.ok(sent.some((m) => m.to === 'UANA000000') && sent.some((m) => m.to === backup.slack_user_id), 'still paging after the @channel');
});

test('weekday incidents get a channel reminder every 30 min until someone takes them', async () => {
  const { db, rotation, notify, sent, addUser } = await setup();
  await addUser('Ana');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  const t0 = at('2026-11-18T15:00:00Z'); // Wednesday
  const after = (min) => new Date(t0.getTime() + min * 60_000);
  await incidents.create({ title: 'Slow API' }, t0);

  sent.length = 0;
  await incidents.tick(after(29));
  assert.equal(sent.length, 0);
  await incidents.tick(after(30));
  assert.deepEqual(sent.map((m) => m.to), ['CONCALL']);
  assert.match(sent[0].text, /<!here>.*still/);
  sent.length = 0;
  await incidents.tick(after(45));
  assert.equal(sent.length, 0, 'every 30 min, not every 5');
  await incidents.tick(after(60));
  assert.equal(sent.length, 1);
});

test('nobody can remove themselves from a weekend that has already started', async () => {
  const { rotation, addUsers } = await setup();
  const [ana, ben, cal] = await addUsers('Ana', 'Ben', 'Cal');
  const wk = shifts.forKey('2026-11-20'); // Ana + Ben
  await assert.rejects(rotation.leave(wk, ana, at('2026-11-21T15:00:00Z')), /already started/);
  assert.deepEqual((await rotation.forShift(wk)).people.map((p) => p.name), ['Ana', 'Ben']);
  // Someone else can still take the spot, and joining a running weekend is fine.
  await rotation.swap(wk, cal, ana.id, at('2026-11-21T15:00:00Z'));
  assert.deepEqual((await rotation.forShift(wk)).people.map((p) => p.name), ['Ben', 'Cal']);
});

test('the home page says a running weekend has nobody on call, and offers no Remove me on it', async () => {
  const views = await import('../src/views.js');
  const now = at('2026-11-21T15:00:00Z');
  const running = shifts.current(now);
  const user = { id: 1, name: 'Ana', is_admin: 0 };
  const html = views.dashboardPage({
    user, now, onCall: null, runningShift: running,
    nextEntry: { shift: running, people: [], joined: [], needsCover: true },
    backup: null, schedule: [{ shift: running, people: [user], joined: [], needsCover: true }],
    coverage: shifts.coverage(), balance: [], recentLog: [], openIncidents: [], flash: null,
  });
  assert.doesNotMatch(html, /it's a weekday/);
  assert.match(html, /Nobody is on call this weekend/);
  assert.doesNotMatch(html, /Remove me/);
});

test('when nothing is going on, the scheduler leaves the database alone so it can sleep', async () => {
  const { db: realDb, addUsers } = await setup();
  let queries = 0;
  const db = Object.fromEntries(['get', 'all', 'run'].map((k) => [k, async (...a) => { queries += 1; return realDb[k](...a); }]));
  Object.assign(db, { dialect: realDb.dialect, close: realDb.close });
  await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  const { createApp } = await import('../src/app.js');
  const app = createApp({ db, notifierOverrides: { slack: async () => {} } });
  const quietMinutes = async (startIso) => {
    const t = at(startIso);
    await app.scheduler.runOnce(t); // first look after a (re)start, or the moment something is due
    queries = 0;
    for (let m = 1; m <= 5; m++) await app.scheduler.runOnce(new Date(t.getTime() + m * 60_000));
    return queries;
  };

  assert.equal(await quietMinutes('2026-11-18T15:00:00Z'), 0, 'a quiet Wednesday');
  assert.equal(await quietMinutes('2026-11-20T00:00:00Z'), 0, 'after the Thursday reminders went out');
  assert.equal(await quietMinutes('2026-11-21T15:00:00Z'), 0, 'a quiet Saturday after the shift started');

  // An open incident is checked every minute until someone acknowledges it.
  const inc = await app.incidents.create({ title: 'Checkout down' }, at('2026-11-21T16:00:00Z'));
  queries = 0;
  await app.scheduler.runOnce(at('2026-11-21T16:01:00Z'));
  assert.ok(queries > 0, 'open incident is checked');
  const ana = await app.rotation.userById(inc.assigned_user_id);
  await app.incidents.acknowledge(inc.id, ana, 'web');
  assert.equal(await quietMinutes('2026-11-21T16:02:00Z'), 0, 'quiet again once acknowledged');
});

test('incidents left open for over a day stop paging and stop waking the database', async () => {
  const { db, rotation, notify, sent, addUsers } = await setup();
  await addUsers('Ana', 'Ben', 'Cal');
  config.slack.channel = 'CONCALL';
  let queries = 0;
  const counted = Object.fromEntries(['get', 'all', 'run'].map((k) => [k, async (...a) => { queries += 1; return db[k](...a); }]));
  const incidents = makeIncidents({ db: counted, rotation, notify });
  const t0 = at('2026-11-21T15:00:00Z');
  await incidents.create({ title: 'Forgotten test page' }, t0);
  await incidents.create({ title: 'Old weekday alert' }, at('2026-11-18T15:00:00Z'));

  sent.length = 0;
  const later = new Date(t0.getTime() + 25 * 3_600_000);
  await incidents.tick(later);
  assert.equal(sent.length, 0, 'nobody is paged about day-old incidents');
  queries = 0;
  await incidents.tick(new Date(later.getTime() + 60_000));
  assert.equal(queries, 0, 'and the next tick does not query');
});

test('incident text cannot inject Slack mentions or links', async () => {
  const { db, rotation, notify, sent, addUser } = await setup();
  await addUser('Ana');
  config.slack.channel = 'CONCALL';
  const incidents = makeIncidents({ db, rotation, notify });
  await incidents.create({ title: '<!channel> <https://evil.example/login|Re-authenticate> & more' }, at('2026-11-18T15:00:00Z'));
  const text = sent[0].text;
  assert.ok(text.includes('&lt;!channel&gt; &lt;https://evil.example/login|Re-authenticate&gt; &amp; more'));
  assert.ok(!text.includes('<https://evil.example'));
  assert.ok(!text.includes('<!channel>'));
});

test('API dedupe stops matching once the old incident is no longer being paged', async () => {
  const { db, rotation, notify, addUser } = await setup();
  await addUser('Ana');
  const incidents = makeIncidents({ db, rotation, notify });
  const first = await incidents.create({ title: 'Checkout 5xx', dedupe: true }, at('2026-11-18T15:00:00Z'));
  const soon = await incidents.create({ title: 'checkout 5xx', dedupe: true }, at('2026-11-18T16:00:00Z'));
  assert.equal(soon.id, first.id);
  assert.ok(soon.repeat);
  const later = await incidents.create({ title: 'Checkout 5xx', dedupe: true }, at('2026-11-20T09:00:00Z'));
  assert.notEqual(later.id, first.id, 'a day-old unacknowledged incident does not swallow a new alert');
  assert.ok(!later.repeat);
});

const tz = 'America/New_York';
const cover = (days, extra = {}) => makeShifts({ timezone: tz, coverage: { days, start: '18:00', end: '09:00', weekendCount: 2, weekdayCount: 3, ...extra } });

test('weekday coverage: Mon-Fri is one shift from Monday evening to Saturday morning', () => {
  const s = cover([1, 2, 3, 4, 5]);
  const shift = s.forKey('2026-11-23');
  assert.equal(shift.start.toISOString(), '2026-11-23T23:00:00.000Z');
  assert.equal(shift.end.toISOString(), '2026-11-28T14:00:00.000Z');
  assert.equal(shift.count, 3, 'weekdays use the weekday count');
  assert.equal(s.current(at('2026-11-26T12:00:00Z')).key, '2026-11-23');
  assert.equal(s.current(at('2026-11-29T12:00:00Z')), null, 'Sunday is not covered');
  assert.equal(s.following(shift).key, '2026-11-30');
  assert.equal(s.previous(shift).key, '2026-11-16');
});

test('two shifts a week: Mon-Thu and Sat, each with its own people count', () => {
  const s = cover([1, 2, 3, 4, 6]);
  const keys = [];
  for (let sh = s.forKey('2026-11-23'); keys.length < 4; sh = s.following(sh)) keys.push(`${sh.key}:${sh.count}`);
  assert.deepEqual(keys, ['2026-11-23:3', '2026-11-28:2', '2026-11-30:3', '2026-12-05:2']);
  assert.equal(s.next(at('2026-11-25T12:00:00Z')).key, '2026-11-28');
  assert.equal(s.current(at('2026-11-27T15:00:00Z')), null, 'Friday daytime is a gap');
});

test('a shift needs as many people as the busiest day it covers', () => {
  assert.equal(cover([5, 6, 0], { weekendCount: 2, weekdayCount: 4 }).forKey('2026-11-20').count, 4, 'Fri-Sun includes a weekday');
  assert.equal(cover([6, 0], { weekendCount: 2, weekdayCount: 4 }).forKey('2026-11-21').count, 2);
});

test('all week coverage is one continuous weekly shift', () => {
  const s = cover([0, 1, 2, 3, 4, 5, 6]);
  const shift = s.forKey('2026-11-23');
  assert.equal(shift.end.toISOString(), '2026-11-30T23:00:00.000Z');
  assert.ok(s.current(at('2026-11-25T03:00:00Z')));
  assert.equal(s.current(at('2026-11-30T22:59:00Z')).key, '2026-11-23');
  assert.equal(s.current(at('2026-11-30T23:00:00Z')).key, '2026-11-30');
});

test('changing coverage while running changes the shifts', () => {
  const s = cover([5, 6, 0]);
  assert.equal(s.next(at('2026-11-18T12:00:00Z')).key, '2026-11-20');
  s.setCoverage({ days: [1, 2, 3, 4, 5], start: '17:00', end: '08:00', weekendCount: 2, weekdayCount: 2 });
  assert.equal(s.next(at('2026-11-18T12:00:00Z')).key, '2026-11-23');
});

test('the rotation puts the shift count of people on each shift', async () => {
  const { db, addUsers } = await setup();
  await addUsers('Ana', 'Ben', 'Cal', 'Dee');
  const three = cover([5, 6, 0], { weekendCount: 3, weekdayCount: 3 });
  const sched = await makeRotation(db, three).schedule(three.forKey('2026-11-20'), 2);
  assert.deepEqual(sched.map((e) => e.people.length), [3, 3]);
  assert.ok(sched.every((e) => !e.needsCover));
});

test('coverage and domain settings are validated', () => {
  const ok = { days: [5, 6, 0], start: '18:00', end: '09:00', weekendCount: 2, weekdayCount: 2 };
  assert.ok(normalizeCoverage(ok).coverage);
  assert.match(normalizeCoverage({ ...ok, days: [] }).error, /at least one day/);
  assert.match(normalizeCoverage({ ...ok, start: '25:00' }).error, /Start time/);
  assert.match(normalizeCoverage({ ...ok, end: '9am' }).error, /End time/);
  assert.match(normalizeCoverage({ ...ok, weekendCount: 0 }).error, /1 to 10/);
  assert.match(normalizeCoverage({ ...ok, weekdayCount: 11 }).error, /1 to 10/);
  assert.deepEqual(normalizeDomains('@Example.com, example.org  example.com').domains, ['example.com', 'example.org']);
  assert.match(normalizeDomains('').error, /at least one/);
  assert.match(normalizeDomains('not a domain!, x').error, /not a valid domain/);
  assert.equal(describeDays([5, 6, 0]), 'Fri–Sun');
  assert.equal(describeDays([1, 3, 6]), 'Mon, Wed, Sat');
  assert.equal(describeDays([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'every day');
});

test('the channel name shown in messages comes from the environment setting', async () => {
  const { rotation, addUser } = await setup();
  const ana = await addUser('Ana');
  config.slack.channelName = 'incidents';
  try {
    await assert.rejects(rotation.leave(shifts.forKey('2026-11-20'), ana, at('2026-11-21T12:00:00Z')), /Ask in #incidents for cover/);
  } finally {
    config.slack.channelName = 'on-call';
  }
});

test('coverage can be set from environment variables', () => {
  assert.equal(coverageFromEnv({}), null, 'unset means the SHIFT_START / SHIFT_END defaults apply');
  assert.deepEqual(coverageFromEnv({ ON_CALL_DAYS: 'mon, Tue,wednesday', ON_CALL_START: '17:30', ON_CALL_END: '08:00', PEOPLE_ON_WEEKDAYS: '3', PEOPLE_PER_WEEKEND: '2' }),
    { days: [1, 2, 3], start: '17:30', end: '08:00', weekendCount: 2, weekdayCount: 3 });
  assert.deepEqual(coverageFromEnv({ ON_CALL_DAYS: 'FRI,SAT,SUN' }), { days: [0, 5, 6], start: '18:00', end: '09:00', weekendCount: 2, weekdayCount: 2 });
  assert.throws(() => coverageFromEnv({ ON_CALL_DAYS: 'FRI,FUNDAY' }), /FUNDAY/);
  assert.throws(() => coverageFromEnv({ ON_CALL_DAYS: 'FRI', ON_CALL_START: '6pm' }), /Start time/);
});
