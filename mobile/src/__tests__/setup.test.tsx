import { act, fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert, Linking, Platform } from 'react-native';

import type { Me } from '@/lib/api';
import { me } from '@/test-fixtures';
import { fakeServer, pressAlertButton, renderScreen } from '@/test-utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
let mockCanGoBack = false;
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, useCanGoBack: () => mockCanGoBack }));
const Setup = require('../app/setup').default;

const phone = (checks: Partial<Me['device']['checks']>, testedAt: string | null = null): Me => {
  const m = me();
  return { ...m, device: { ...m.device, testedAt, checks: { notifications: false, focus: false, ringer: false, fullScreen: false, dndAccess: false, ...checks } } };
};

let fetchMock: jest.Mock;
async function show(meReply: Me, routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({ 'GET /api/app/me': meReply, 'POST /api/app/device': meReply.device, ...routes });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderScreen(<Setup />);
  await screen.findByText('Make sure pages wake you');
}
const posted = (path: string) => fetchMock.mock.calls.filter(([url, init]) => url.endsWith(path) && init?.method === 'POST');

let alertSpy: jest.SpyInstance;
beforeEach(() => { jest.clearAllMocks(); mockParams = {}; mockCanGoBack = false; alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { alertSpy.mockRestore(); jest.restoreAllMocks(); });

test('iPhone steps, and how many are done', async () => {
  await show(phone({ notifications: true, ringer: true }));
  for (const title of ['Allow notifications', 'Let PagerDiem through Focus', 'Keep the ringer on', 'Answer a test call']) expect(screen.getByText(title)).toBeTruthy();
  expect(screen.queryByText('Allow full-screen calls')).toBeNull();
  expect(screen.getByText('2 of 4')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Finish the steps above' })).toBeDisabled();
});

test('Android steps', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
  await show({ ...phone({}), device: { ...phone({}).device, platform: 'android' } });
  // The first step's button repeats its title, as on the canvas.
  for (const title of ['Allow notifications', 'Allow full-screen calls', 'Allow Do Not Disturb access', 'Answer a test call']) expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  expect(screen.queryByText('Let PagerDiem through Focus')).toBeNull();
  expect(screen.getByText('0 of 4')).toBeTruthy();
});

test('Focus is done once you come back and confirm', async () => {
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await show(phone({ notifications: true }));
  await fireEvent.press(screen.getByRole('button', { name: 'Open Focus settings' }));
  expect(openSettings).toHaveBeenCalled();
  await fireEvent.press(await screen.findByRole('button', { name: 'I’ve added PagerDiem' }));
  expect(JSON.parse(posted('/api/app/device')[0][1].body)).toEqual({ checks: { focus: true } });
});

test('the test call rings, and is done when the answered call brings you back', async () => {
  await show(phone({ notifications: true, focus: true, ringer: true }), { 'POST /api/app/device/test-call': { callId: 'c1' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Ring me now' }));
  expect(await screen.findByText('Ringing your phone…')).toBeTruthy();
});

test('back from an answered test call, every step is done', async () => {
  mockParams = { tested: '1' };
  await show(phone({ notifications: true, focus: true, ringer: true }, '2026-12-12T16:00:00.000Z'));
  expect(screen.getByText('It rang and you answered. You’re set.')).toBeTruthy();
  expect(screen.getByText('4 of 4')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Go to On call' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

test('skipping asks first', async () => {
  await show(phone({}));
  await fireEvent.press(screen.getByRole('button', { name: 'Skip for now' }));
  expect(alertSpy).toHaveBeenLastCalledWith('Skip the Wake-up checks?', 'A page may not wake you at night. You can finish this later in You.', expect.anything());
  await pressAlertButton('Skip');
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

test('an unanswered test call can be tried again after a minute', async () => {
  await show(phone({ notifications: true, focus: true, ringer: true }), { 'POST /api/app/device/test-call': { callId: 'c1' } });
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  await fireEvent.press(screen.getByRole('button', { name: 'Ring me now' }));
  expect(await screen.findByText('Ringing your phone…')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(screen.getByText('No answer. Ring again when you’re ready.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Ring me now' })).toBeTruthy();
  jest.useRealTimers();
});

test('opened from You, Setup has a way back', async () => {
  mockCanGoBack = true;
  await show(phone({}));
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(mockRouter.back).toHaveBeenCalled();
});
