import { parsePagePayload, type RingingPayload } from './payload';
import { watchRinging } from './ringing';

const payload = parsePagePayload({
  type: 'page', callId: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', incidentId: '14', title: 'Checkout failing', reason: '', pagedBy: '',
  attempt: 1, nextCallAt: '2026-12-12T16:02:00.000Z', server: 'https://pd.example.com', sentAt: '2026-12-12T16:00:00.000Z',
}) as RingingPayload;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a late push for an incident someone already acknowledged stops ringing within 3 s', async () => {
  const fetchIncident = jest.fn().mockResolvedValueOnce({ status: 'open' }).mockResolvedValue({ status: 'acknowledged' });
  const endCall = jest.fn();
  const notifyMissed = jest.fn();
  watchRinging({ payload, fetchIncident, endCall, notifyMissed, timezone: 'America/New_York' });
  await jest.advanceTimersByTimeAsync(3000);
  expect(endCall).toHaveBeenCalledWith(payload.callId, 'answeredElsewhere');
  expect(notifyMissed).not.toHaveBeenCalled();
});

test('unanswered for 45 s: the call ends and says when we call again, in the team’s time', async () => {
  const fetchIncident = jest.fn().mockResolvedValue({ status: 'open' });
  const endCall = jest.fn();
  const notifyMissed = jest.fn();
  watchRinging({ payload, fetchIncident, endCall, notifyMissed, timezone: 'America/New_York' });
  await jest.advanceTimersByTimeAsync(44_000);
  expect(endCall).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1_000);
  expect(endCall).toHaveBeenCalledWith(payload.callId, 'unanswered');
  expect(notifyMissed).toHaveBeenCalledWith('Missed page · Checkout failing. We’ll call you again at 11:02 AM.');
});

test('stop() ends the watch', async () => {
  const fetchIncident = jest.fn().mockResolvedValue({ status: 'open' });
  const endCall = jest.fn();
  const stop = watchRinging({ payload, fetchIncident, endCall, notifyMissed: jest.fn(), timezone: 'America/New_York' });
  stop();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(endCall).not.toHaveBeenCalled();
});
