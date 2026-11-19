// Tests run on in-memory SQLite by default. Set TEST_DATABASE_URL to run them on Postgres
// (each call wipes that database's public schema, so never point it at real data).
import { openDb } from '../src/db.js';

export async function freshDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb(':memory:');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  return openDb(url);
}
