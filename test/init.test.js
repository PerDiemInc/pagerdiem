import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function runInit(args, input = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-init-'));
  const envFile = path.join(dir, 'env');
  const result = spawnSync('bash', ['init.sh', '--no-install', '--env-file', envFile, ...args], { cwd: root, input, encoding: 'utf8' });
  const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  return { ...result, env, envFile, dir };
}

const value = (env, key) => new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1];

test('init.sh --yes writes a working .env with generated secrets', () => {
  const r = runInit(['--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(value(r.env, 'SESSION_SECRET'), /^[0-9a-f]{64}$/);
  assert.match(value(r.env, 'API_TOKEN'), /^[0-9a-f]{48}$/);
  assert.equal(value(r.env, 'ON_CALL_DAYS'), 'FRI,SAT,SUN');
  assert.equal(value(r.env, 'ALLOWED_EMAIL_DOMAINS'), 'example.com');
  assert.equal(value(r.env, 'PUBLIC_URL'), 'http://localhost:3000');
  assert.equal((fs.statSync(r.envFile).mode & 0o777).toString(8), '600', 'only the owner can read it');
  const loaded = spawnSync('node', ['--env-file', r.envFile, '-e',
    "import('./src/config.js').then((m) => console.log(JSON.stringify(m.config.coverage)))"], { cwd: root, encoding: 'utf8' });
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.deepEqual(JSON.parse(loaded.stdout).days, [0, 5, 6], 'the app reads the file');
});

test('init.sh uses the answers it is given, quotes values, and keeps secrets off the screen', () => {
  const answers = ['Acme Tools', 'Acme Platform', 'Acme.com', 'Europe/London', '4000', 'mon, tue', '17:30', '08:00', '3',
    'y', 'xoxb-abc-123', 'sekret-signing', 'C0123456789', 'incidents', 'T0123456789', ''];
  const r = runInit([], answers.join('\n') + '\n');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(value(r.env, 'APP_NAME'), '"Acme Tools"');
  assert.equal(value(r.env, 'TEAM_NAME'), '"Acme Platform"');
  assert.equal(value(r.env, 'ALLOWED_EMAIL_DOMAINS'), 'acme.com');
  assert.equal(value(r.env, 'TEAM_TIMEZONE'), 'Europe/London');
  assert.equal(value(r.env, 'PORT'), '4000');
  assert.equal(value(r.env, 'PUBLIC_URL'), 'http://localhost:4000');
  assert.equal(value(r.env, 'ON_CALL_DAYS'), 'MON,TUE');
  assert.equal(value(r.env, 'ON_CALL_START'), '17:30');
  assert.equal(value(r.env, 'ON_CALL_END'), '08:00');
  assert.equal(value(r.env, 'PEOPLE_PER_WEEKEND'), '3');
  assert.equal(value(r.env, 'SLACK_BOT_TOKEN'), 'xoxb-abc-123');
  assert.equal(value(r.env, 'SLACK_SIGNING_SECRET'), 'sekret-signing');
  assert.equal(value(r.env, 'SLACK_ONCALL_CHANNEL'), 'C0123456789');
  assert.equal(value(r.env, 'SLACK_ONCALL_CHANNEL_NAME'), 'incidents');
  assert.equal(value(r.env, 'SLACK_TEAM_ID'), 'T0123456789');
  assert.ok(!r.stdout.includes('xoxb-abc-123') && !r.stdout.includes('sekret-signing'), 'secrets are not echoed');
  assert.equal(value(r.env, 'SLACK_ENGINEERS_GROUP_ID'), '', 'a skipped answer stays empty');
});

test('init.sh asks again when an answer is not valid', () => {
  const r = runInit([], 'PagerDiem\nTeam\nnot a domain\nexample.org\n');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Use a domain like example\.com/);
  assert.equal(value(r.env, 'ALLOWED_EMAIL_DOMAINS'), 'example.org');
});

test('init.sh never replaces an existing .env without --force', () => {
  const first = runInit(['--yes']);
  fs.writeFileSync(first.envFile, 'KEEP=me\n');
  const again = spawnSync('bash', ['init.sh', '--no-install', '--yes', '--env-file', first.envFile], { cwd: root, encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
  assert.equal(fs.readFileSync(first.envFile, 'utf8'), 'KEEP=me\n');
  const forced = spawnSync('bash', ['init.sh', '--no-install', '--yes', '--force', '--env-file', first.envFile], { cwd: root, encoding: 'utf8' });
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(fs.readFileSync(first.envFile, 'utf8'), /^SESSION_SECRET=[0-9a-f]{64}$/m);
});
