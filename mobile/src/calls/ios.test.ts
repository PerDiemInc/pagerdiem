const mockVoip: Record<string, (arg: unknown) => void> = {};
const mockKeep: Record<string, (arg: unknown) => void> = {};
jest.mock('react-native-voip-push-notification', () => ({
  __esModule: true,
  default: {
    addEventListener: (type: string, handler: (arg: unknown) => void) => { mockVoip[type] = handler; },
    removeEventListener: jest.fn(),
    registerVoipToken: jest.fn(),
    onVoipNotificationCompleted: jest.fn(),
    RNVoipPushRemoteNotificationsRegisteredEvent: 'RNVoipPushRemoteNotificationsRegisteredEvent',
  },
}));
jest.mock('react-native-callkeep', () => ({
  __esModule: true,
  default: {
    setup: jest.fn(), clearInitialEvents: jest.fn(), reportEndCallWithUUID: jest.fn(), endCall: jest.fn(), removeEventListener: jest.fn(),
    addEventListener: (type: string, handler: (arg: unknown) => void) => { mockKeep[type] = handler; },
  },
  CONSTANTS: { END_CALL_REASONS: { FAILED: 1, UNANSWERED: 3, ANSWERED_ELSEWHERE: 4 } },
}));

import RNCallKeep from 'react-native-callkeep';
import VoipPushNotification from 'react-native-voip-push-notification';

import { noticePath, startIosCalls, type CallContext } from './ios';

const callId = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const page = { type: 'page', callId, incidentId: '14', title: 'Checkout failing', nextCallAt: '2026-12-12T16:02:00.000Z', server: 'https://pd.example.com' };
const shown = (payload: object, uuid = callId) => ({ name: 'RNCallKeepDidDisplayIncomingCall', data: { callUUID: uuid, payload } });
const answered = (uuid = callId) => ({ name: 'RNCallKeepPerformAnswerCallAction', data: { callUUID: uuid.toUpperCase() } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let ctx: CallContext | null;
let post: jest.Mock;
function start() {
  post = jest.fn().mockResolvedValue({ changed: true, incident: { ackedBy: { id: 1, name: 'Ben Carter' } } });
  ctx = { post, get: jest.fn().mockResolvedValue({ incident: { status: 'open' } }), server: 'https://pd.example.com', publicUrl: 'https://pd.example.com', timezone: 'America/New_York' };
  return startIosCalls({ context: () => ctx, navigate: jest.fn(), ringtone: 'siren' });
}

beforeEach(() => jest.clearAllMocks());

test('the PushKit token is sent on every start and whenever it changes, once each', async () => {
  const calls = start();
  expect(VoipPushNotification.registerVoipToken).toHaveBeenCalled();
  mockVoip.didLoadWithEvents([{ name: 'RNVoipPushRemoteNotificationsRegisteredEvent', data: 'tok-1' }]);
  mockVoip.register('tok-1');
  await flush();
  expect(post.mock.calls).toEqual([['/api/app/device', { pushToken: 'tok-1' }]]);
  mockVoip.register('tok-2');
  await flush();
  expect(post).toHaveBeenLastCalledWith('/api/app/device', { pushToken: 'tok-2' });
  calls.stop();
});

test('signed out, the token waits; after signing in it is sent', async () => {
  const calls = start();
  const signedIn = ctx;
  ctx = null;
  mockVoip.register('tok-1');
  await flush();
  expect(post).not.toHaveBeenCalled();
  ctx = signedIn;
  calls.refreshToken();
  expect(VoipPushNotification.registerVoipToken).toHaveBeenCalledTimes(2);
  mockVoip.register('tok-1');
  await flush();
  expect(post).toHaveBeenCalledWith('/api/app/device', { pushToken: 'tok-1' });
  calls.stop();
});

test('answering a call made before the app had loaded acknowledges it, and the buffer is cleared', async () => {
  const calls = start();
  mockKeep.didLoadWithEvents([shown(page), answered()]);
  await flush();
  expect(post).toHaveBeenCalledWith('/api/app/incidents/14/ack', { via: 'call' });
  expect(RNCallKeep.clearInitialEvents).toHaveBeenCalled();
  expect(VoipPushNotification.onVoipNotificationCompleted).toHaveBeenCalledWith(callId);
  calls.stop();
});

test('a call delivered twice is handled once', async () => {
  const calls = start();
  mockKeep.didLoadWithEvents([shown(page), answered()]);
  mockKeep.didLoadWithEvents([shown(page), answered()]); // the library re-sends its buffer
  await flush();
  expect(post.mock.calls.filter(([path]) => path.endsWith('/ack'))).toHaveLength(1);
  calls.stop();
});

test('signed out, a call is ended at once and nothing is sent', async () => {
  const calls = start();
  ctx = null;
  mockKeep.didDisplayIncomingCall(shown(page).data);
  expect(RNCallKeep.reportEndCallWithUUID).toHaveBeenCalledWith(callId, 1);
  calls.stop();
});

test('a call that isn’t a valid page, or comes from another server, is ended and ignored', async () => {
  const calls = start();
  mockKeep.didDisplayIncomingCall(shown({ ...page, title: '' }).data);
  mockKeep.didDisplayIncomingCall(shown({ ...page, server: 'https://staging.example.com' }, '7f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f').data);
  expect(RNCallKeep.reportEndCallWithUUID).toHaveBeenCalledTimes(2);
  mockKeep.answerCall({ callUUID: '7f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f' });
  await flush();
  expect(post).not.toHaveBeenCalled();
  calls.stop();
});

test('a phone signed in before the server address was saved still rings', async () => {
  const calls = start();
  ctx = { ...ctx!, server: 'http://192.168.1.20:3000', publicUrl: undefined }; // typed a LAN address; public URL unknown yet
  mockKeep.didDisplayIncomingCall(shown({ ...page, server: 'http://localhost:3000' }).data);
  expect(RNCallKeep.reportEndCallWithUUID).not.toHaveBeenCalled();
  calls.stop();
});

test('signing out while it rings ends the call', async () => {
  jest.useFakeTimers();
  const calls = start();
  mockKeep.didDisplayIncomingCall(shown(page).data);
  await jest.advanceTimersByTimeAsync(0);
  ctx = null;
  await jest.advanceTimersByTimeAsync(3_000);
  expect(RNCallKeep.reportEndCallWithUUID).toHaveBeenCalledWith(callId, 4);
  calls.stop();
  jest.useRealTimers();
});

test('a tapped notice opens only an incident page', () => {
  expect(noticePath({ path: '/page/14' })).toBe('/page/14');
  expect(noticePath({ path: '/page/14/../../you' })).toBeNull();
  expect(noticePath({ path: 'https://evil.example' })).toBeNull();
  expect(noticePath(undefined)).toBeNull();
});
