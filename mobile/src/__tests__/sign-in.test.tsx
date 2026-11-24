import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { fakeServer, renderScreen } from '@/test-utils';

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));

const Connect = require('../app/connect').default;
const Join = require('../app/(auth)/join').default;
const AboutYou = require('../app/(auth)/about-you').default;
const SignIn = require('../app/(auth)/sign-in').default;

const me = { user: { id: 1, name: 'Ben Carter', initials: 'BC', role: 'engineer' } };

beforeEach(() => jest.clearAllMocks());

test('a sign-in link asks before connecting, then signs the phone in', async () => {
  mockParams = { server: 'http://localhost:3000', code: 'abc' };
  globalThis.fetch = fakeServer({ 'POST /api/app/pair': { token: 'tok', me } }) as unknown as typeof fetch;
  await renderScreen(<Connect />);
  expect(await screen.findByText('Connect to localhost:3000?')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/setup'));
  // Who signed in is kept with the token, so a call can be handled before the app reaches the server.
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('pd.session', JSON.stringify({ server: 'http://localhost:3000', token: 'tok', userId: 1 }), expect.anything());
});

test('a sign-up link from outside the app is refused: sign-ups finish in the app’s own Google sheet', async () => {
  mockParams = { server: 'https://pd.example.com', pending: 'p.q' };
  await renderScreen(<Connect />);
  expect(await screen.findByText('This sign-in link isn’t complete. Make a new one on the web app’s Team page.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
});

test('About you opened from a link (not from Sign in) asks to sign in again and sends nothing', async () => {
  mockParams = { server: 'https://evil.example', pending: 'eyJlbWFpbCI6ImJlbkBjb21wYW55LmNvbSJ9.x' };
  globalThis.fetch = jest.fn() as unknown as typeof fetch;
  await renderScreen(<AboutYou />);
  expect(await screen.findByText('Sign in with Google again to finish signing up.')).toBeTruthy();
  expect(screen.queryByText(/ben@company.com/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('Sign in refuses a server address that isn’t one', async () => {
  mockParams = { server: 'javascript:alert(1)' };
  await renderScreen(<SignIn />);
  expect(await screen.findByText('That isn’t a PagerDiem address.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
});

test('connecting while signed in signs this phone out of the old server first', async () => {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://old.example.com', token: 'old' }));
  mockParams = { server: 'http://localhost:3000', code: 'abc' };
  const fetchMock = jest.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/pair') ? { token: 'tok', me } : { ok: true }), { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderScreen(<Connect />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/setup'));
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://localhost:3000/api/app/pair', 'https://old.example.com/api/app/signout']);
});

test('a sign-in that failed says why', async () => {
  mockParams = { error: "That account isn't allowed" };
  await renderScreen(<Connect />);
  expect(await screen.findByText("That account isn't allowed")).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
});

test("an address that can't be reached says where to check", async () => {
  mockParams = { mode: 'address' };
  globalThis.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
  await renderScreen(<Join />);
  await fireEvent.changeText(await screen.findByLabelText('Server address'), 'pd.nowhere.test');
  await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
  expect(await screen.findByText("We couldn't reach pd.nowhere.test. Check the address on the web app's Team page.")).toBeTruthy();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('a reachable address moves on to Google sign-in', async () => {
  mockParams = { mode: 'address' };
  globalThis.fetch = fakeServer({ 'GET /healthz': { ok: true } }) as unknown as typeof fetch;
  await renderScreen(<Join />);
  await fireEvent.changeText(await screen.findByLabelText('Server address'), 'pd.example.com');
  await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { server: 'https://pd.example.com' } }));
});

test('Join has a way back to Welcome', async () => {
  mockParams = { mode: 'address' };
  await renderScreen(<Join />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
  expect(mockRouter.back).toHaveBeenCalled();
});
