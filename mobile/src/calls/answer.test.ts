import { ApiError } from '@/lib/api';

import { onAnswer } from './answer';
import { parsePagePayload, type RingingPayload } from './payload';

const callId = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const base = { callId, incidentId: '14', title: 'Checkout failing', reason: '', pagedBy: '', attempt: 1, nextCallAt: '2026-12-12T16:02:00.000Z', server: 'https://pd.example.com', sentAt: '' };
const page = parsePagePayload({ type: 'page', ...base }) as RingingPayload;
const testCall = parsePagePayload({ type: 'test', ...base, incidentId: '0' }) as RingingPayload;

afterEach(() => jest.useRealTimers());

test('answering a page acknowledges it as a call, hangs up, opens the page and says so', async () => {
  // iOS never brings an app forward from a call, so a notice confirms it and opens the page on tap.
  const post = jest.fn().mockResolvedValue({ changed: true, incident: { ackedBy: { name: 'Ben Carter' } } });
  const endCall = jest.fn();
  const navigate = jest.fn();
  const notify = jest.fn();
  await onAnswer(page, { post, endCall, navigate, notify });
  expect(post).toHaveBeenCalledWith('/api/app/incidents/14/ack', { via: 'call' });
  expect(endCall).toHaveBeenCalledWith(callId);
  // The call stays up until the acknowledgement settles: iOS keeps a live call's app running.
  expect(post.mock.invocationCallOrder[0]).toBeLessThan(endCall.mock.invocationCallOrder[0]);
  expect(navigate).toHaveBeenCalledWith('/page/14');
  expect(notify).toHaveBeenCalledWith({ title: 'Acknowledged · Checkout failing', body: 'Paging stopped. Tap to open.', path: '/page/14' });
});

test('someone else acknowledged first: the notice says who has it', async () => {
  const post = jest.fn().mockResolvedValue({ changed: false, incident: { ackedBy: { name: 'Ana Gomez' } } });
  const notify = jest.fn();
  await onAnswer(page, { post, endCall: jest.fn(), navigate: jest.fn(), notify });
  expect(notify).toHaveBeenCalledWith({ title: 'Already acknowledged · Checkout failing', body: 'Ana Gomez has it. Tap to open.', path: '/page/14' });
});

test('a failing acknowledgement is retried after 1, 4 and 15 s, then says to open the incident', async () => {
  jest.useFakeTimers();
  const post = jest.fn().mockRejectedValue(new ApiError(0, 'Can’t reach pd.example.com'));
  const notify = jest.fn();
  const done = onAnswer(page, { post, endCall: jest.fn(), navigate: jest.fn(), notify });
  await jest.advanceTimersByTimeAsync(0);
  expect(post).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(post).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(4_000);
  expect(post).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(15_000);
  await done;
  expect(post).toHaveBeenCalledTimes(4);
  expect(notify).toHaveBeenCalledWith({ title: 'Couldn’t acknowledge · Checkout failing', body: 'Open the incident to try again.', path: '/page/14' });
});

test('an incident resolved before you answered is not retried, and says so', async () => {
  const post = jest.fn().mockRejectedValue(new ApiError(409, 'This incident is resolved'));
  const notify = jest.fn();
  await onAnswer(page, { post, endCall: jest.fn(), navigate: jest.fn(), notify });
  expect(post).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith({ title: 'Already resolved · Checkout failing', body: 'Nothing to do. Tap to open.', path: '/page/14' });
});

test('any other refusal after answering says so', async () => {
  const post = jest.fn().mockRejectedValue(new ApiError(404, 'Incident not found'));
  const notify = jest.fn();
  await onAnswer(page, { post, endCall: jest.fn(), navigate: jest.fn(), notify });
  expect(post).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith({ title: 'Couldn’t acknowledge · Checkout failing', body: 'Incident not found', path: '/page/14' });
});

test('answering a test call finishes the wake-up check', async () => {
  const post = jest.fn().mockResolvedValue({ ok: true });
  const navigate = jest.fn();
  await onAnswer(testCall, { post, endCall: jest.fn(), navigate, notify: jest.fn() });
  expect(post).toHaveBeenCalledWith('/api/app/device/test-call/answered', { callId });
  expect(navigate).toHaveBeenCalledWith('/setup?tested=1');
});
