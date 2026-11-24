import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { fakeServer, renderScreen } from '@/test-utils';

import { ana, detail, eli, home, incident, me } from '@/test-fixtures';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const Compose = require('../app/compose').default;
const activate = { nativeEvent: { actionName: 'activate' } };

let fetchMock: jest.Mock;
async function show(routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({
    'GET /api/app/home': home({ onCall: { people: [ana], start: '2026-12-11T23:00:00.000Z', until: '2026-12-14T14:00:00.000Z', backup: eli } }),
    'GET /api/app/me': me(),
    'GET /api/app/incidents': { incidents: [], recentTitles: ['Checkout failing', 'Orders not printing', 'App won’t open'], stats: { open: 0, acknowledged: 0, resolved: 0, last30Days: 0, medianAckMinutes: null } },
    'POST /api/app/incidents': { incident: incident(15, 'Checkout failing'), paged: [ana] },
    ...routes,
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderScreen(<Compose />);
  await screen.findByRole('button', { name: 'Hold to call Ana' });
}
const posted = () => fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/api/app/incidents') && init?.method === 'POST');

beforeEach(() => jest.clearAllMocks());

test("nothing sends until you say what's broken", async () => {
  await show();
  expect(screen.getByRole('button', { name: 'Hold to call Ana' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: /Post only/ }));
  expect(screen.getByRole('button', { name: 'Post in #on-call' })).toBeDisabled();
});

test('calling their phones takes a hold, and says who is ringing', async () => {
  await show();
  await fireEvent.press(await screen.findByRole('button', { name: 'Checkout failing' })); // a recent title
  const call = screen.getByRole('button', { name: 'Hold to call Ana' });
  expect(call).toBeEnabled();
  await fireEvent.press(call);
  expect(posted()).toHaveLength(0);
  await fireEvent(call, 'accessibilityAction', activate);
  expect(await screen.findByText('Calling Ana Gomez')).toBeTruthy();
  expect(JSON.parse(posted()[0][1].body)).toEqual({ title: 'Checkout failing', details: '', mode: 'call' });
  await fireEvent.press(screen.getByRole('button', { name: 'Open incident #15' }));
  expect(mockRouter.replace).toHaveBeenCalled();
});

test('posting only sends on a tap and wakes nobody', async () => {
  await show({ 'POST /api/app/incidents': { incident: incident(16, 'Menu photos missing', { quiet: true }), paged: [] } });
  await fireEvent.changeText(screen.getByLabelText('What’s broken?'), 'Menu photos missing');
  await fireEvent.press(screen.getByRole('radio', { name: /Post only/ }));
  expect(screen.getByText('Nobody’s phone rings. Anyone can acknowledge it from Slack or the app.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Post in #on-call' }));
  expect(await screen.findByText('Posted in #on-call')).toBeTruthy();
  expect(JSON.parse(posted()[0][1].body)).toEqual({ title: 'Menu photos missing', details: '', mode: 'post' });
});

test('opened from a link with nothing behind it, Cancel goes to On call', async () => {
  mockRouter.canGoBack.mockReturnValue(false);
  await show();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  mockRouter.canGoBack.mockReturnValue(true);
});

test('after paging, the sent screen says who picked it up', async () => {
  await show({ 'GET /api/app/incidents/15': detail({ status: 'acknowledged', ackedBy: ana, ackedAt: new Date().toISOString() }) });
  await fireEvent.press(await screen.findByRole('button', { name: 'Checkout failing' }));
  await fireEvent(screen.getByRole('button', { name: 'Hold to call Ana' }), 'accessibilityAction', activate);
  expect(await screen.findByText('Calling Ana Gomez')).toBeTruthy();
  expect(await screen.findByText('Ana Gomez acknowledged. Paging stopped.')).toBeTruthy();
});
