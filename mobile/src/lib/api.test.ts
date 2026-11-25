import { ApiError, createClient } from './api';

const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

test('sends the bearer token and reads JSON', async () => {
  const fetchImpl = jest.fn(() => ok({ hello: 'world' }));
  const api = createClient({ server: 'https://pd.example.com', token: 'tok', fetchImpl, onUnauthorized: jest.fn() });
  expect(await api.get('/api/app/me')).toEqual({ hello: 'world' });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://pd.example.com/api/app/me');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
});

test('errors carry the status, message and field', async () => {
  const api = createClient({ server: 'https://pd.example.com', token: 't', fetchImpl: () => ok({ error: 'Enter your number.', field: 'phone' }, 400), onUnauthorized: jest.fn() });
  await expect(api.post('/api/app/profile', {})).rejects.toEqual(new ApiError(400, 'Enter your number.', 'phone'));
});

test('a 401 signs the phone out once and throws', async () => {
  const onUnauthorized = jest.fn();
  const api = createClient({ server: 'https://pd.example.com', token: 't', fetchImpl: () => ok({ error: 'Sign in again' }, 401), onUnauthorized });
  await expect(api.get('/api/app/me')).rejects.toMatchObject({ status: 401 });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

test("a server that doesn't answer in time, or can't be reached, is status 0 with the host", async () => {
  const slow = createClient({ server: 'https://pd.example.com', token: 't', timeoutMs: 50, onUnauthorized: jest.fn(),
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) });
  await expect(slow.get('/api/app/home')).rejects.toEqual(new ApiError(0, "Can't reach pd.example.com"));
  const down = createClient({ server: 'https://pd.example.com', token: 't', onUnauthorized: jest.fn(), fetchImpl: () => Promise.reject(new TypeError('Network request failed')) });
  await expect(down.get('/api/app/home')).rejects.toEqual(new ApiError(0, "Can't reach pd.example.com"));
});
