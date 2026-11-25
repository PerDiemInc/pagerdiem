import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

import { ana, ben, cal, dee, eli, fay, me, member } from '@/test-fixtures';
import { fakeServer, pressAlertButton, renderScreen } from '@/test-utils';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
const Team = require('../app/(tabs)/team').default;

const team = {
  members: [member(ana, 1, 'woken'), member(ben, 2, 'woken'), member(eli, 3, 'focus-risk'), member(fay, 4, 'none'), member(cal, 5, 'woken'), member(dee, 6, 'none')],
  inactive: [], signupUrl: 'https://pd.example.com/login',
};
let fetchMock: jest.Mock;
async function show(role: 'engineer' | 'admin', routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({ 'GET /api/app/me': me({}, role), 'GET /api/app/team': team, ...routes });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderScreen(<Team />);
  await screen.findByText('3 of 6 can be woken by a call');
}

let alertSpy: jest.SpyInstance;
beforeEach(() => { jest.clearAllMocks(); alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => alertSpy.mockRestore());

test('everyone sees who the app can wake', async () => {
  await show('engineer');
  expect(screen.getAllByText('Has the app · can be woken')).toHaveLength(3);
  expect(screen.getByText('Has the app · Focus may silence it')).toBeTruthy();
  expect(screen.getAllByText('Slack only · no app yet')).toHaveLength(2);
  expect(screen.getByText('Ben Carter (You)')).toBeTruthy();
});

test('an engineer gets no admin actions', async () => {
  await show('engineer');
  expect(screen.queryByLabelText('Manage Eli Brooks')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy sign-up link' })).toBeNull();
  expect(alertSpy).not.toHaveBeenCalled();
});

test('an admin manages a member', async () => {
  await show('admin', { 'POST /api/app/team/3/move': { ok: true, message: 'Moved Eli Brooks up.' } });
  await fireEvent.press(screen.getByLabelText('Manage Eli Brooks'));
  const [title, sub, buttons] = alertSpy.mock.calls[0];
  expect([title, sub]).toEqual(['Eli Brooks', 'In the rotation']);
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Move up', 'Move down', 'Make admin', 'Remove from rotation', 'Cancel']);
  await pressAlertButton('Move up');
  expect(await screen.findByText('Moved Eli Brooks up.')).toBeTruthy();
  const move = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/team/3/move') && init?.method === 'POST');
  expect(JSON.parse(move[1].body)).toEqual({ dir: -1 });
});
