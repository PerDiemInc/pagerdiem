// Storage. Uses Postgres when DATABASE_URL is set (production, e.g. Neon), otherwise a local
// SQLite file through Node's built-in driver. Both sit behind the same small async API:
//   db.get(sql, params)  -> first row or undefined
//   db.all(sql, params)  -> rows
//   db.run(sql, params)  -> { changes }
// SQL is written with `?` placeholders and in the subset both databases understand.
import fs from 'node:fs';
import path from 'node:path';

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,     -- always stored lowercase
  password_hash   TEXT NOT NULL,
  slack_user_id   TEXT,
  whatsapp        TEXT NOT NULL,            -- phone number, E.164 (column name kept for existing databases)
  is_admin        INTEGER NOT NULL DEFAULT 0,  -- legacy, kept in sync with role = 'admin' so a rollback still works
  role            TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('admin','engineer','non_technical')),
  active          INTEGER NOT NULL DEFAULT 1,
  rotation_order  INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Every person has their own Slack account and phone number.
CREATE UNIQUE INDEX IF NOT EXISTS users_slack_unique ON users(slack_user_id) WHERE slack_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_whatsapp_unique ON users(whatsapp);
CREATE TABLE IF NOT EXISTS shifts (
  weekend_key   TEXT PRIMARY KEY,
  base_user_id  INTEGER NOT NULL REFERENCES users(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  locked_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS overrides (
  weekend_key   TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  set_by        INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  details           TEXT,
  source            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  assigned_user_id  INTEGER REFERENCES users(id),
  backup_user_id    INTEGER REFERENCES users(id),
  escalation_level  INTEGER NOT NULL DEFAULT 0,
  ack_token         TEXT NOT NULL,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  last_paged_at     TEXT NOT NULL,
  acked_at          TEXT,
  acked_by          INTEGER REFERENCES users(id),
  resolved_at       TEXT,
  resolved_by       INTEGER REFERENCES users(id),
  quiet             INTEGER NOT NULL DEFAULT 0,  -- 1: posted in the channel without calling anyone; never escalates
  test              INTEGER NOT NULL DEFAULT 0   -- 1: a test page from /page test; calls once, never escalates or posts in the channel
);
CREATE INDEX IF NOT EXISTS incidents_open ON incidents(status) WHERE status != 'resolved';
CREATE TABLE IF NOT EXISTS incident_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id  INTEGER NOT NULL REFERENCES incidents(id),
  at           TEXT NOT NULL,
  message      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS incident_events_incident ON incident_events(incident_id);
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  channel      TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL,
  error        TEXT,
  incident_id  INTEGER REFERENCES incidents(id)
);
-- The people the rotation picked for a weekend, frozen when the weekend starts.
CREATE TABLE IF NOT EXISTS shift_people (
  weekend_key  TEXT NOT NULL,
  position     INTEGER NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (weekend_key, position)
);
-- People who added ('in') or removed ('out') themselves for a weekend: latest state.
CREATE TABLE IF NOT EXISTS weekend_members (
  weekend_key  TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL CHECK (status IN ('in','out')),
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (weekend_key, user_id)
);
-- Public history of every add/remove, visible to the whole team.
CREATE TABLE IF NOT EXISTS roster_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  weekend_key  TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL CHECK (action IN ('join','leave'))
);
-- "Take their spot" swaps from the calendar. Undoable by the swapper for 10 seconds;
-- announced (notified_at) only after that window passes without an undo.
CREATE TABLE IF NOT EXISTS swaps (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  at                    TEXT NOT NULL,
  weekend_key           TEXT NOT NULL,
  by_user_id            INTEGER NOT NULL REFERENCES users(id),
  replaced_user_id      INTEGER NOT NULL REFERENCES users(id),
  prev_by_status        TEXT,
  prev_replaced_status  TEXT,
  undone_at             TEXT,
  notified_at           TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_keys (
  key  TEXT PRIMARY KEY,
  at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Notes people add to an incident, shown with its timeline and posted in the on-call channel.
CREATE TABLE IF NOT EXISTS incident_notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id  INTEGER NOT NULL REFERENCES incidents(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  at           TEXT NOT NULL,
  text         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS incident_notes_incident ON incident_notes(incident_id);
-- Team, settings and app changes, for the phone app's Activity log.
CREATE TABLE IF NOT EXISTS admin_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  user_id  INTEGER REFERENCES users(id),
  via      TEXT,
  icon     TEXT NOT NULL,
  text     TEXT NOT NULL
);
-- Phones signed in to the PagerDiem app. Only a hash of each phone's sign-in token is stored.
CREATE TABLE IF NOT EXISTS devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  platform      TEXT NOT NULL CHECK (platform IN ('ios','android')),
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  push_token    TEXT,
  checks        TEXT NOT NULL DEFAULT '{}',   -- JSON: which wake-up checks the phone has passed
  tested_at     TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
`;

// Same tables for Postgres: identity ids and now() defaults; timestamps stay ISO text.
const PG_SCHEMA = SQLITE_SCHEMA
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
  .replace(/DEFAULT \(strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)\)/g,
    `DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`);

// Columns added after the first release. Older databases get them at startup.
const ADDED_COLUMNS = [
  ['incidents', 'quiet', 'INTEGER NOT NULL DEFAULT 0'],
  ['incidents', 'test', 'INTEGER NOT NULL DEFAULT 0'],
  ['swaps', 'trade_id', 'INTEGER'], // the other half of a two-way trade
  ['notifications', 'device_id', 'INTEGER'], // the phone a push went to
];

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function openSqlite(file) {
  // Imported lazily so Postgres deployments never load the experimental module.
  return import('node:sqlite').then(({ DatabaseSync }) => {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    raw.exec(SQLITE_SCHEMA);
    const columns = raw.prepare('PRAGMA table_info(users)').all();
    if (!columns.some((c) => c.name === 'role')) {
      raw.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('admin','engineer','non_technical'))`);
      raw.exec(`UPDATE users SET role = 'admin' WHERE is_admin = 1`);
    }
    for (const [table, column, ddl] of ADDED_COLUMNS) {
      if (!raw.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
    return {
      dialect: 'sqlite',
      async get(sql, params = []) { return raw.prepare(sql).get(...params); },
      async all(sql, params = []) { return raw.prepare(sql).all(...params); },
      async run(sql, params = []) { return { changes: Number(raw.prepare(sql).run(...params).changes) }; },
      async close() { raw.close(); },
    };
  });
}

async function openPostgres(url) {
  const { default: pg } = await import('pg');
  // COUNT(*) and other int8 values come back as JS numbers instead of strings.
  pg.types.setTypeParser(20, (v) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => console.error('postgres pool error:', err.message));
  await pool.query(PG_SCHEMA);
  const hasRole = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'role'`);
  if (!hasRole.rowCount) {
    await pool.query(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('admin','engineer','non_technical'))`);
    await pool.query(`UPDATE users SET role = 'admin' WHERE is_admin = 1`);
  }
  for (const [table, column, ddl] of ADDED_COLUMNS) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`);
  }
  return {
    dialect: 'pg',
    async get(sql, params = []) { return (await pool.query(toPgPlaceholders(sql), params)).rows[0]; },
    async all(sql, params = []) { return (await pool.query(toPgPlaceholders(sql), params)).rows; },
    async run(sql, params = []) { return { changes: (await pool.query(toPgPlaceholders(sql), params)).rowCount }; },
    async close() { await pool.end(); },
  };
}

/** `target` is a postgres:// URL or a SQLite file path (':memory:' for tests). */
export function openDb(target) {
  return /^postgres(ql)?:\/\//.test(target) ? openPostgres(target) : openSqlite(target);
}

/** Claim a one-time key. Resolves true the first time, false after. */
export async function claimOnce(db, key) {
  const r = await db.run('INSERT INTO sent_keys (key) VALUES (?) ON CONFLICT (key) DO NOTHING', [key]);
  return r.changes === 1;
}
