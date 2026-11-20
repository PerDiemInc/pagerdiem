import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TEAM_TIMEZONE = 'America/New_York';
process.env.SHIFT_START = 'FRI 18:00';
process.env.SHIFT_END = 'MON 09:00';
process.env.ESCALATE_AFTER_MINUTES = '15';
process.env.REPAGE_EVERY_MINUTES = '5';

const { config } = await import('../src/config.js');
const { makeShifts } = await import('../src/time.js');
const { freshDb } = await import('./helpers.js');
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
  await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [ana.id]);
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

  const anaPhone = await addUserPhone(db, 'Ana');
  const inc = await incidents.create({ title: 'Checkout down' }, t0);
  assert.equal((await rotation.userById(inc.assigned_user_id)).name, 'Ana');
  assert.equal((await rotation.userById(inc.backup_user_id)).name, 'Cal');
  assert.ok(sent.some((m) => m.ch === 'whatsapp' && m.to === anaPhone && m.text.includes('Checkout down')));
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
