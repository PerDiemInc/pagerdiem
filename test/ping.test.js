import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { config, pingProblem } = await import('../src/config.js');
const { makePing, pingMode, loadSkill } = await import('../src/ping.js');
const { freshDb } = await import('./helpers.js');

const engineer = { id: 1, name: 'Ana', slack_user_id: 'UANA000000', active: 1, role: 'engineer' };
const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-ping-'));
const skillFile = path.join(skillDir, 'skill.md');
fs.writeFileSync(skillFile, 'Our runbook: the checkout service is called "cart".');

async function withPing(overrides, fn) {
  const saved = { ...config.ping };
  Object.assign(config.ping, { enabled: true, anthropicKey: 'sk-test-123', skillFile, checkUrls: [], routineUrl: '', routineToken: '', cooldownSeconds: 120, maxPerDay: 30 }, overrides);
  try { return await fn(); } finally { Object.assign(config.ping, saved); }
}

async function setup({ claudeText = '*Problem:* the cart service is down', fetchOverride } = {}) {
  const db = await freshDb();
  await db.run("INSERT INTO incidents (title, source, ack_token, created_at, last_paged_at) VALUES ('Cart 5xx', 'api', 't', '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z')");
  const posts = [];
  const calls = [];
  let clock = Date.parse('2026-11-22T12:00:00Z');
  const post = async (channel, text, blocks, threadTs) => { posts.push({ channel, text, threadTs }); return { ts: '111.1' }; };
  const fetchImpl = fetchOverride ?? (async (url, opts) => {
    calls.push({ url, opts });
    if (String(url).includes('/fire')) {
      return { ok: true, status: 200, json: async () => ({ claude_code_session_url: 'https://claude.ai/code/session_1' }), text: async () => '' };
    }
    if (String(url).includes('/v1/messages')) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: claudeText }] }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  });
  const rotation = { onCallNow: async () => ({ people: [{ name: 'Ben' }] }) };
  const ping = makePing({ db, rotation, post, fetchImpl, now: () => clock });
  return { ping, posts, calls, advance: (ms) => { clock += ms; } };
}

test('the AI check is off by default', async () => {
  assert.equal(config.ping.enabled, false);
  assert.equal(pingMode(), 'off');
  const { ping } = await setup();
  const verdict = ping.accept({ user: engineer });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /turned off/);
});

test('only active engineers and admins can run it', async () => {
  await withPing({}, async () => {
    const { ping } = await setup();
    assert.equal(ping.accept({ user: null }).ok, false, 'unknown Slack user');
    assert.equal(ping.accept({ user: { ...engineer, role: 'non_technical' } }).ok, false);
    assert.equal(ping.accept({ user: { ...engineer, active: 0 } }).ok, false, 'removed person');
    assert.equal(ping.accept({ user: { ...engineer, role: 'admin' } }).ok, true);
  });
});

test('a cooldown and a daily cap limit how often it runs', async () => {
  await withPing({ cooldownSeconds: 120, maxPerDay: 2 }, async () => {
    const { ping, advance } = await setup();
    assert.equal(ping.accept({ user: engineer }).ok, true);
    const soon = ping.accept({ user: engineer });
    assert.equal(soon.ok, false);
    assert.match(soon.message, /Try again in 120 s/);
    advance(121_000);
    assert.equal(ping.accept({ user: engineer }).ok, true);
    advance(121_000);
    const capped = ping.accept({ user: engineer });
    assert.equal(capped.ok, false);
    assert.match(capped.message, /daily limit of 2/);
  });
});

test('Claude API mode: sends the skill and the snapshot, and replies in a thread with Slack-safe text', async () => {
  await withPing({ checkUrls: ['https://svc.example.com/health?token=SECRET'] }, async () => {
    const { ping, posts, calls } = await setup({ claudeText: '*Problem:* cart is down <!channel> <https://evil.example|click>' });
    await ping.run({ text: 'checkout is failing', channel: 'C123', user: engineer });

    const claude = calls.find((c) => String(c.url).includes('/v1/messages'));
    assert.equal(claude.opts.headers['x-api-key'], 'sk-test-123');
    const body = JSON.parse(claude.opts.body);
    assert.equal(body.model, config.ping.model);
    assert.match(body.system, /DATA written by people and systems/);
    assert.match(body.system, /checkout service is called "cart"/, 'your skill file is used');
    const prompt = body.messages[0].content;
    assert.match(prompt, /<request untrusted="true">checkout is failing<\/request>/);
    assert.match(prompt, /Cart 5xx/, 'open incidents are in the snapshot');
    assert.match(prompt, /https:\/\/svc\.example\.com\/health"/, 'health probes are in the snapshot');
    assert.ok(!prompt.includes('SECRET'), 'query strings are left out of the snapshot');
    assert.ok(!JSON.stringify(posts).includes('sk-test-123'));

    assert.equal(posts.length, 2);
    assert.match(posts[0].text, /asked for a check: \*checkout is failing\*/);
    assert.equal(posts[1].threadTs, '111.1');
    assert.match(posts[1].text, /&lt;!channel&gt;/);
    assert.ok(!posts[1].text.includes('<!channel>') && !posts[1].text.includes('<https://evil'), 'no mention or link injection');
  });
});

test('an API failure is reported without leaking the key', async () => {
  await withPing({}, async () => {
    const { ping, posts } = await setup({ fetchOverride: async () => ({ ok: false, status: 401, text: async () => 'invalid key sk-test-123' }) });
    await ping.run({ text: '', channel: 'C123', user: engineer });
    const last = posts.at(-1).text;
    assert.match(last, /could not finish/);
    assert.match(last, /401/);
    assert.ok(!last.includes('sk-test-123'));
    assert.match(posts[0].text, /a general health sweep/);
  });
});

test('when the bot cannot post in the channel, the reply goes to the command response URL', async () => {
  await withPing({}, async () => {
    const hits = [];
    const { ping } = await setup({
      fetchOverride: async (url, opts) => {
        hits.push({ url, opts });
        if (String(url).includes('anthropic')) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'all quiet' }] }), text: async () => '' };
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      },
    });
    const db = await freshDb();
    const noChannel = makePing({
      db, rotation: { onCallNow: async () => null },
      post: async () => { throw new Error('not_in_channel'); },
      fetchImpl: async (url, opts) => { hits.push({ url, opts }); return String(url).includes('anthropic')
        ? { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'all quiet' }] }), text: async () => '' }
        : { ok: true, status: 200, json: async () => ({}), text: async () => '' }; },
    });
    await noChannel.run({ text: 'x', channel: 'CNOPE', user: engineer, responseUrl: 'https://hooks.slack.com/commands/abc' });
    const fallback = hits.find((h) => h.url === 'https://hooks.slack.com/commands/abc');
    assert.ok(fallback, 'answered through the response URL');
    assert.match(JSON.parse(fallback.opts.body).text, /all quiet/);
    assert.ok(ping);
  });
});

test('routine mode hands the request to the routine and links its session', async () => {
  await withPing({ routineUrl: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire', routineToken: 'sk-ant-oat01-secret' }, async () => {
    assert.equal(pingMode(), 'routine');
    const { ping, posts, calls } = await setup();
    await ping.run({ text: 'payments failing', channel: 'C123', user: engineer });
    assert.equal(calls.filter((c) => String(c.url).includes('/v1/messages')).length, 0, 'the Messages API is not called');
    const fire = calls.find((c) => String(c.url).includes('/fire'));
    assert.equal(fire.opts.headers.authorization, 'Bearer sk-ant-oat01-secret');
    assert.equal(fire.opts.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
    const payload = JSON.parse(JSON.parse(fire.opts.body).text);
    assert.equal(payload.request, 'payments failing');
    assert.equal(payload.slackChannel, 'C123');
    assert.equal(payload.slackThreadTs, '111.1');
    assert.equal(payload.askedBy, 'Ana');
    assert.match(posts.at(-1).text, /<https:\/\/claude\.ai\/code\/session_1\|session>/);
    assert.ok(!JSON.stringify(posts).includes('sk-ant-oat01-secret'));
  });
});

test('enabling it without a key or routine is a startup error, and the skill falls back if missing', () => {
  assert.equal(pingProblem({}), null, 'off needs nothing');
  assert.match(pingProblem({ PING_ENABLED: 'true' }), /ANTHROPIC_API_KEY/);
  assert.equal(pingProblem({ PING_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' }), null);
  assert.equal(pingProblem({ PING_ENABLED: 'true', PING_ROUTINE_URL: 'u', PING_ROUTINE_TOKEN: 't' }), null);
  assert.match(loadSkill(skillFile), /cart/);
  assert.match(loadSkill(path.join(skillDir, 'missing.md')), /what you think is wrong/);
  assert.match(loadSkill('skills/ping.md'), /on-call triage/, 'the shipped default skill loads');
});
