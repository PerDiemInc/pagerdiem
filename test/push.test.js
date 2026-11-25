// Push senders for the phone app: APNs VoIP (iPhone calls) and FCM (Android), with no SDKs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import crypto from 'node:crypto';

const { makeApns } = await import('../src/notify/apns.js');
const { makeFcm } = await import('../src/notify/fcm.js');
const { pushWarnings, readPushConfig } = await import('../src/config.js');

function verifyJwt(jwt, publicKey, alg) {
  const [header, payload, signature] = jwt.split('.');
  const key = alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey;
  return crypto.verify('sha256', Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'));
}
const jwtPart = (jwt, i) => JSON.parse(Buffer.from(jwt.split('.')[i], 'base64url').toString('utf8'));

/** A local plain-text HTTP/2 server standing in for api.push.apple.com. */
async function fakeApns(reply = () => [200, null]) {
  const seen = [];
  let connections = 0;
  const server = http2.createServer();
  server.on('session', () => { connections += 1; });
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.on('data', (c) => { body += c; });
    stream.on('end', () => {
      seen.push({ headers, body: JSON.parse(body || '{}') });
      const [status, json] = reply(seen.length);
      stream.respond({ ':status': status, 'content-type': 'application/json' });
      stream.end(json ? JSON.stringify(json) : '');
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { seen, connections: () => connections, host: `http://localhost:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/** Each connection answers its first `answered` requests, then goes silent, like a NAT that forgot an idle flow. */
async function silentAfter(answered) {
  let connections = 0;
  const server = http2.createServer();
  server.on('session', (session) => {
    connections += 1;
    let requests = 0;
    session.on('stream', (stream) => {
      requests += 1;
      stream.resume();
      if (requests > answered) return; // never answered
      stream.on('end', () => { stream.respond({ ':status': 200 }); stream.end(); });
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { connections: () => connections, host: `http://localhost:${server.address().port}`, close: () => { server.close(); } };
}

const ecKeys = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

test('APNs: VoIP push with the right headers and a verifiable token', async () => {
  const { privateKey, publicKey } = ecKeys();
  const fake = await fakeApns();
  const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    bundleId: 'com.tryperdiem.pagerdiem', host: fake.host });
  try {
    assert.deepEqual(await apns.sendVoip('tok123', { type: 'page', incidentId: '14' }), { ok: true });
    const { headers, body } = fake.seen[0];
    assert.equal(headers[':method'], 'POST');
    assert.equal(headers[':path'], '/3/device/tok123');
    assert.equal(headers['apns-topic'], 'com.tryperdiem.pagerdiem.voip');
    assert.equal(headers['apns-push-type'], 'voip');
    assert.equal(headers['apns-priority'], '10');
    const expires = Number(headers['apns-expiration']);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(expires > now && expires <= now + 61, 'a ring older than a minute is dropped');
    const jwt = headers.authorization.replace(/^bearer /, '');
    assert.ok(verifyJwt(jwt, publicKey, 'ES256'));
    assert.deepEqual(jwtPart(jwt, 0), { alg: 'ES256', kid: 'K1' });
    assert.equal(jwtPart(jwt, 1).iss, 'T1');
    assert.deepEqual(body, { type: 'page', incidentId: '14' });
  } finally {
    apns.close();
    await fake.close();
  }
});

test('APNs: only 410 / Unregistered is gone; a wrong environment or bundle id is a config error, not a dead phone', async () => {
  const { privateKey } = ecKeys();
  const replies = [[410, { reason: 'Unregistered' }], [400, { reason: 'BadDeviceToken' }], [400, { reason: 'DeviceTokenNotForTopic' }],
    [500, { reason: 'InternalServerError' }], [400, { reason: 'BadExpirationDate' }]];
  const fake = await fakeApns((n) => replies[n - 1]);
  const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    bundleId: 'com.tryperdiem.pagerdiem', host: fake.host });
  try {
    assert.deepEqual(await apns.sendVoip('a', {}), { ok: false, gone: true, reason: 'Unregistered' });
    const wrongEnv = await apns.sendVoip('b', {});
    assert.equal(wrongEnv.gone, false, 'every phone answers BadDeviceToken when APNS_ENV is wrong: keep their tokens');
    assert.match(wrongEnv.reason, /^BadDeviceToken: check APNS_ENV/);
    const wrongBundle = await apns.sendVoip('c', {});
    assert.equal(wrongBundle.gone, false);
    assert.match(wrongBundle.reason, /^DeviceTokenNotForTopic: check APNS_BUNDLE_ID/);
    assert.deepEqual(await apns.sendVoip('d', {}), { ok: false, gone: false, reason: 'InternalServerError' });
    assert.deepEqual(await apns.sendVoip('e', {}), { ok: false, gone: false, reason: 'BadExpirationDate' });
  } finally {
    apns.close();
    await fake.close();
  }
});

test('APNs: one token is reused across sends', async () => {
  const { privateKey } = ecKeys();
  const fake = await fakeApns();
  const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    bundleId: 'com.tryperdiem.pagerdiem', host: fake.host });
  try {
    await apns.sendVoip('a', {});
    await apns.sendVoip('b', {});
    assert.equal(fake.seen[0].headers.authorization, fake.seen[1].headers.authorization);
  } finally {
    apns.close();
    await fake.close();
  }
});

function fakeGoogle(sendReplies = []) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: `at-${calls.length}`, expires_in: 3600 }), { status: 200 });
    }
    const [status, json] = sendReplies.shift() ?? [200, { name: 'projects/p/messages/1' }];
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, fetchImpl };
}

const rsaServiceAccount = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicKey, account: { project_id: 'pagerdiem-test', client_email: 'push@pagerdiem-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) } };
};

test('FCM: high priority data message with a cached OAuth token', async () => {
  const { publicKey, account } = rsaServiceAccount();
  const google = fakeGoogle();
  const fcm = makeFcm({ serviceAccount: account, fetchImpl: google.fetchImpl });
  assert.deepEqual(await fcm.send('device-1', { type: 'page', incidentId: '14' }), { ok: true });
  assert.deepEqual(await fcm.send('device-2', { type: 'cancel', incidentId: '14' }), { ok: true });

  const tokenCalls = google.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token');
  assert.equal(tokenCalls.length, 1, 'one OAuth token for both sends');
  const form = new URLSearchParams(tokenCalls[0].init.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const assertion = form.get('assertion');
  assert.ok(verifyJwt(assertion, publicKey, 'RS256'));
  assert.equal(jwtPart(assertion, 1).scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(jwtPart(assertion, 1).iss, account.client_email);

  const sends = google.calls.filter((c) => c.url !== 'https://oauth2.googleapis.com/token');
  assert.equal(sends[0].url, 'https://fcm.googleapis.com/v1/projects/pagerdiem-test/messages:send');
  assert.equal(sends[0].init.headers.Authorization, 'Bearer at-1');
  assert.deepEqual(JSON.parse(sends[0].init.body), {
    message: { token: 'device-1', data: { type: 'page', incidentId: '14' }, android: { priority: 'HIGH', ttl: '60s' } },
  });
});

test('FCM: UNREGISTERED is gone, other failures are not', async () => {
  const { account } = rsaServiceAccount();
  const google = fakeGoogle([
    [404, { error: { status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }],
    [400, { error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] } }],
    [503, { error: { status: 'UNAVAILABLE' } }],
  ]);
  const fcm = makeFcm({ serviceAccount: account, fetchImpl: google.fetchImpl });
  assert.deepEqual(await fcm.send('a', {}), { ok: false, gone: true, reason: 'UNREGISTERED' });
  assert.deepEqual(await fcm.send('b', {}), { ok: false, gone: true, reason: 'UNREGISTERED' });
  assert.deepEqual(await fcm.send('c', {}), { ok: false, gone: false, reason: 'UNAVAILABLE' });
});

test('push config: optional, and a half-set key is a startup warning, never an error', () => {
  assert.deepEqual(pushWarnings({}), [], 'no keys: calls are dry-run, nothing to warn about');
  assert.deepEqual(pushWarnings({ APNS_KEY_ID: 'K1' }), ['Phone calls on iPhone are off: set APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY.']);
  assert.deepEqual(pushWarnings({ FCM_SERVICE_ACCOUNT: '{not json' }),
    ['Phone calls on Android are off: FCM_SERVICE_ACCOUNT must be the service account JSON from Firebase.']);
  const { account } = rsaServiceAccount();
  assert.deepEqual(pushWarnings({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: pem(), FCM_SERVICE_ACCOUNT: JSON.stringify(account) }), []);

  const push = readPushConfig({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' });
  assert.equal(push.apns.privateKey, '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'pasted \\n become real newlines');
  assert.equal(push.apns.bundleId, 'com.tryperdiem.pagerdiem');
  assert.equal(push.apns.host, 'https://api.push.apple.com');
  assert.equal(readPushConfig({ APNS_ENV: 'development' }).apns.host, 'https://api.sandbox.push.apple.com');
  assert.equal(push.fcm.serviceAccount, null);
});

const pem = () => ecKeys().privateKey.export({ type: 'pkcs8', format: 'pem' });

test('APNs: a connection that went silent is dropped and the page is sent again on a fresh one', async () => {
  const fake = await silentAfter(1);
  const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey: pem(), bundleId: 'b', host: fake.host, timeoutMs: 300 });
  try {
    assert.deepEqual(await apns.sendVoip('a', {}), { ok: true });
    assert.deepEqual(await apns.sendVoip('b', {}), { ok: true }, 'the silent connection is replaced and the page still goes out');
    assert.deepEqual(await apns.sendVoip('c', {}), { ok: true });
    assert.equal(fake.connections(), 3);
  } finally {
    apns.close();
    fake.close();
  }
});

test('APNs: a page that times out on a brand-new connection fails instead of hanging', async () => {
  const fake = await silentAfter(0);
  const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey: pem(), bundleId: 'b', host: fake.host, timeoutMs: 200 });
  try {
    assert.deepEqual(await apns.sendVoip('a', {}), { ok: false, gone: false, reason: 'Timed out' });
    assert.equal(fake.connections(), 1, 'no retry when the connection was already fresh');
  } finally {
    apns.close();
    fake.close();
  }
});

test('APNs: a connection idle for longer than idleMs is not reused', async () => {
  const fake = await fakeApns();
  const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey: pem(), bundleId: 'b', host: fake.host, idleMs: 50 });
  try {
    await apns.sendVoip('a', {});
    await apns.sendVoip('b', {});
    assert.equal(fake.connections(), 1, 'back-to-back pushes share one connection');
    await new Promise((r) => setTimeout(r, 120));
    await apns.sendVoip('c', {});
    assert.equal(fake.connections(), 2);
  } finally {
    apns.close();
    await fake.close();
  }
});

test('push config: an APNS_PRIVATE_KEY that is not a valid .p8 key turns iPhone calls off with a warning', () => {
  const bad = { APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: 'not a key' };
  assert.deepEqual(pushWarnings(bad), ['Phone calls on iPhone are off: APNS_PRIVATE_KEY is not a valid .p8 key.']);
  assert.equal(readPushConfig(bad).apns.enabled, false);
  assert.equal(readPushConfig({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: pem() }).apns.enabled, true);
});

test('FCM: a cancel can go at normal priority', async () => {
  const { account } = rsaServiceAccount();
  const google = fakeGoogle();
  const fcm = makeFcm({ serviceAccount: account, fetchImpl: google.fetchImpl });
  await fcm.send('device-1', { type: 'cancel', incidentId: '14' }, { priority: 'NORMAL' });
  const send = google.calls.find((c) => c.url.endsWith(':send'));
  assert.equal(JSON.parse(send.init.body).message.android.priority, 'NORMAL');
});

test('FCM: sends at the same moment share one sign-in', async () => {
  const { account } = rsaServiceAccount();
  const google = fakeGoogle();
  const fcm = makeFcm({ serviceAccount: account, fetchImpl: google.fetchImpl });
  await Promise.all([fcm.send('a', {}), fcm.send('b', {}), fcm.send('c', {})]);
  assert.equal(google.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').length, 1);
});

test('push senders fail cleanly when the network is down', async () => {
  const apns = makeApns({ keyId: 'K1', teamId: 'T1', privateKey: pem(), bundleId: 'b', host: 'https://apns.invalid',
    connect: () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.deepEqual(await apns.sendVoip('a', {}), { ok: false, gone: false, reason: 'getaddrinfo ENOTFOUND' });
  const { account } = rsaServiceAccount();
  const fcm = makeFcm({ serviceAccount: account, fetchImpl: async () => { throw new Error('fetch failed'); } });
  assert.deepEqual(await fcm.send('a', {}), { ok: false, gone: false, reason: 'fetch failed' });
});
