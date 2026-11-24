import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert, Text } from 'react-native';

import { useSession } from '@/hooks/use-session';
import { freezeClock, me } from '@/test-fixtures';
import { fakeServer, pressAlertButton, renderScreen } from '@/test-utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));
const You = require('../app/(tabs)/you').default;
const Profile = require('../app/profile').default;
const Activity = require('../app/activity').default;

// The app's sign-in gate: You while signed in, Welcome once signed out.
function Gate() {
  return useSession().status === 'signedIn' ? <You /> : <Text>Welcome</Text>;
}

let fetchMock: jest.Mock;
async function serve(role: 'engineer' | 'admin', routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({ 'GET /api/app/me': me({}, role), ...routes });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

let alertSpy: jest.SpyInstance;
beforeEach(() => { freezeClock(); jest.clearAllMocks(); alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); alertSpy.mockRestore(); });

test('an engineer gets no admin settings', async () => {
  await serve('engineer');
  await renderScreen(<Gate />);
  expect(await screen.findByText('Ben Carter')).toBeTruthy();
  expect(screen.queryByText('Coverage')).toBeNull();
  expect(screen.queryByText('Resend weekend message')).toBeNull();
  expect(screen.getByText(/^Connected to pd\.example\.com/)).toBeTruthy();
});

test('coverage needs at least one day', async () => {
  await serve('admin');
  await renderScreen(<Gate />);
  for (const day of ['Friday', 'Saturday', 'Sunday']) await fireEvent.press(await screen.findByRole('checkbox', { name: day }));
  expect(screen.getByText('Pick at least one day that needs someone on call.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save coverage' })).toBeDisabled();
});

test('Ring me now sends a test call', async () => {
  await serve('engineer', { 'POST /api/app/device/test-call': { callId: 'c1' } });
  await renderScreen(<Gate />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Ring me now' }));
  expect(await screen.findByText('Calling you now. Answer to finish.')).toBeTruthy();
});

test('signing out asks, tells the server, forgets the session and shows Welcome', async () => {
  await serve('engineer', { 'POST /api/app/signout': { ok: true } });
  await renderScreen(<Gate />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
  expect(alertSpy).toHaveBeenLastCalledWith('Sign out?', 'This phone stops ringing for pages until you sign in again. Slack DMs still reach you.', expect.anything());
  await pressAlertButton('Sign out');
  expect(await screen.findByText('Welcome')).toBeTruthy();
  expect(await SecureStore.getItemAsync('pd.session')).toBeNull();
  expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/api/app/signout') && init?.method === 'POST')).toBe(true);
});

test('editing your profile shows the server’s error under the field', async () => {
  await serve('engineer', {
    'POST /api/app/profile': new Response(JSON.stringify({ error: 'That phone number already belongs to Ana Gomez. Use your own number.', field: 'phone' }), { status: 400 }),
  });
  await renderScreen(<Profile />);
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), '+14155550102');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('That phone number already belongs to Ana Gomez. Use your own number.')).toBeTruthy();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('the activity log says where each change was made', async () => {
  await serve('engineer', {
    'GET /api/app/activity': {
      items: [
        { at: '2026-12-12T15:23:00.000Z', text: 'Ana Gomez acknowledged #13 API 5xx above 2% on /orders', via: 'slack', icon: 'ack' },
        { at: '2026-12-11T21:40:00.000Z', text: 'Cal Reyes and Dee Patel swapped Dec 25 and Jan 1', via: 'web', icon: 'swap' },
        { at: '2026-12-10T13:02:00.000Z', text: 'Ben Carter answered a test call', via: 'app', icon: 'test' },
      ],
    },
  });
  await renderScreen(<Activity />);
  expect(await screen.findByText('Today')).toBeTruthy();
  expect(screen.getByText('10:23 AM · in Slack')).toBeTruthy();
  expect(screen.getByText('Yesterday')).toBeTruthy();
  expect(screen.getByText('4:40 PM · on the web')).toBeTruthy();
  expect(screen.getByText('Thu, Dec 10')).toBeTruthy();
  expect(screen.getByText('8:02 AM · in the app')).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Rotation' }));
  expect(screen.queryByText('Ben Carter answered a test call')).toBeNull();
});

test('iPhone calls follow the ringer, so there are no Vibrate or full-volume switches', async () => {
  await serve('engineer');
  await renderScreen(<Gate />);
  expect(await screen.findByText('Ringtone')).toBeTruthy();
  expect(screen.queryByText('Vibrate')).toBeNull();
  expect(screen.queryByText('Ring at full volume')).toBeNull();
});
