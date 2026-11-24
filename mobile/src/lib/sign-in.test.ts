import { challengeFor, pairPhone, parseConnectLink, readPendingIdentity, signUp } from './sign-in';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
  digestStringAsync: async (_alg: string, data: string) => require('node:crypto').createHash('sha256').update(data).digest('base64'),
  getRandomBytes: (n: number) => new Uint8Array(n).fill(7),
}));

test('reads pagerdiem://connect links, and nothing else', () => {
  expect(parseConnectLink('pagerdiem://connect?server=https%3A%2F%2Fpd.example.com&code=abc.def')).toEqual({ server: 'https://pd.example.com', code: 'abc.def' });
  expect(parseConnectLink('pagerdiem://connect?server=https%3A%2F%2Fpd.example.com&pending=p.q')).toEqual({ server: 'https://pd.example.com', pending: 'p.q' });
  expect(parseConnectLink('pagerdiem://connect?error=That%20account%20isn%27t%20allowed')).toEqual({ error: "That account isn't allowed" });
  expect(parseConnectLink('pagerdiem://elsewhere?code=x')).toBeNull();
  expect(parseConnectLink('https://evil.example/connect?code=x')).toBeNull();
});

test('the Google sign-in challenge is base64url(SHA-256(verifier)), as the server checks it', async () => {
  // The example from RFC 7636 appendix B.
  expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('pairing sends the code, this phone, and the verifier when there is one', async () => {
  const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ token: 'tok', me: { user: { name: 'Ben' } } }), { status: 200 }));
  const result = await pairPhone({ server: 'https://pd.example.com', code: 'abc', verifier: 'v'.repeat(43) }, fetchImpl);
  expect(result.token).toBe('tok');
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://pd.example.com/api/app/pair');
  expect(JSON.parse(init.body as string)).toEqual({ code: 'abc', platform: 'ios', deviceName: 'Test iPhone', verifier: 'v'.repeat(43) });
});

test('a Google sign-up shows the name from the signed pending sign-up, and sends the fields to the server', async () => {
  const pending = `${btoa(JSON.stringify({ email: 'new@example.com', name: 'Nia Lee', exp: 1 })).replace(/=+$/, '')}.sig`;
  expect(readPendingIdentity(pending)).toEqual({ email: 'new@example.com', name: 'Nia Lee' });
  expect(readPendingIdentity('garbage')).toBeNull();
  const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ error: 'Enter your number.', field: 'phone' }), { status: 400 }));
  await expect(signUp({ server: 'https://pd.example.com', pending, name: 'Nia', slack: '', phone: '', verifier: 'v' }, fetchImpl))
    .rejects.toMatchObject({ status: 400, field: 'phone' });
  expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ pending, name: 'Nia', platform: 'ios', verifier: 'v' });
});
