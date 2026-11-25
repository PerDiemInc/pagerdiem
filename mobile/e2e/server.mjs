// A local pagerdiem for trying the app on a simulator or emulator, seeded with the canvas cast:
// Ben (you) and Ana on call, Eli the backup, a live page, an acknowledged incident and history.
// Every day is covered so someone is on call whenever you run it.
//
//   node e2e/server.mjs            (from mobile/; Node 22.13+)
//   node e2e/pair.mjs ben          a fresh sign-in link (codes last 10 minutes)
//
// Then open the link on the simulator: xcrun simctl openurl booted "<link>"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { DB, ENV, ROOT, link } from './common.mjs';

async function seed() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  Object.assign(process.env, ENV);
  const { openDb } = await import(path.join(ROOT, 'src/db.js'));
  const { config } = await import(path.join(ROOT, 'src/config.js'));
  const { makeShifts } = await import(path.join(ROOT, 'src/time.js'));
  const db = await openDb(DB);
  const people = [
    ['Ben Carter', 'engineer', 'U0BEN00001', '+14155550102'], ['Ana Gomez', 'engineer', 'U0ANA00001', '+14155550103'],
    ['Eli Brooks', 'engineer', 'U0ELI00001', '+14155550104'], ['Hana Ito', 'engineer', 'U0HAN00001', '+14155550105'],
    ['Cal Reyes', 'engineer', 'U0CAL00001', '+14155550106'], ['Dee Patel', 'engineer', 'U0DEE00001', '+14155550107'],
    ['Iris Lane', 'admin', 'U0IRI00001', '+14155550108'],
  ];
  for (const [i, [name, role, slack, phone]] of people.entries()) {
    await db.run(`INSERT INTO users (name, email, password_hash, slack_user_id, whatsapp, role, is_admin, rotation_order)
      VALUES (?, ?, 'e2e', ?, ?, ?, ?, ?)`, [name, `${name.split(' ')[0].toLowerCase()}@example.com`, slack, phone, role, role === 'admin' ? 1 : 0, i + 1]);
  }
  const shifts = makeShifts(config);
  await db.run("INSERT INTO settings (key, value) VALUES ('rotation_start', ?)", [shifts.currentOrNext(new Date()).key]);
  await db.close();
}

async function incidents() {
  const post = (body) => fetch(`${ENV.PUBLIC_URL}/api/incidents`, {
    method: 'POST', headers: { Authorization: `Bearer ${ENV.API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  const history = ['Web menu blank for 2 stores', 'Square webhook signature errors', 'Push notifications delayed'];
  const resolved = [];
  for (const title of history) resolved.push(await post({ title, source: 'coralogix' }));
  const acked = await post({ title: 'API 5xx above 2% on /orders', source: 'coralogix' });
  await post({ title: 'Checkout failing for all stores', details: 'Checkout returns 502 for every store since 10:30 AM.', source: 'slack' });
  // Acknowledge and resolve the older ones straight in the database, as if people had.
  const { openDb } = await import(path.join(ROOT, 'src/db.js'));
  const db = await openDb(DB);
  const ana = await db.get("SELECT id FROM users WHERE name = 'Ana Gomez'");
  const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  await db.run("UPDATE incidents SET status = 'acknowledged', acked_by = ?, acked_at = ? WHERE id = ?", [ana.id, at(1), acked.id]);
  for (const [i, inc] of resolved.entries()) {
    await db.run("UPDATE incidents SET status = 'resolved', acked_by = ?, acked_at = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
      [ana.id, at(60 * (i + 2)), ana.id, at(60 * (i + 1)), inc.id]);
  }
  await db.close();
}

{
  await seed();
  const server = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], { env: { ...process.env, ...ENV }, stdio: 'inherit' });
  process.on('SIGINT', () => server.kill('SIGINT'));
  process.on('SIGTERM', () => server.kill('SIGTERM'));
  for (let i = 0; i < 50; i += 1) {
    if (await fetch(`${ENV.PUBLIC_URL}/healthz`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await incidents();
  console.log(`\nSign in as Ben (on call):  ${await link('ben')}\nSign in as Iris (admin):   ${await link('iris')}\n`);
}
