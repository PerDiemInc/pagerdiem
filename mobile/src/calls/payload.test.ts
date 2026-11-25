import { parsePagePayload } from './payload';

const callId = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const page = {
  type: 'page', callId, incidentId: '14', title: 'Checkout failing for all stores', reason: 'You are on call', pagedBy: 'Hana Ito',
  attempt: 1, nextCallAt: '2026-12-12T16:02:00.000Z', server: 'https://pd.example.com', sentAt: '2026-12-12T16:00:00.000Z',
};

test('a page reads the same from APNs (numbers) and FCM (strings)', () => {
  const fromApns = parsePagePayload(page);
  expect(fromApns).toEqual({ ...page, incidentId: 14, attempt: 1 });
  expect(parsePagePayload({ ...page, attempt: '1' })).toEqual(fromApns);
  expect(parsePagePayload({ ...page, type: 'test', incidentId: '0' })).toMatchObject({ type: 'test', incidentId: 0 });
});

test('a cancel needs only the incident', () => {
  expect(parsePagePayload({ type: 'cancel', incidentId: '14' })).toEqual({ type: 'cancel', incidentId: 14 });
});

test('anything else is ignored', () => {
  expect(parsePagePayload(null)).toBeNull();
  expect(parsePagePayload('page')).toBeNull();
  expect(parsePagePayload({ ...page, type: 'other' })).toBeNull();
  expect(parsePagePayload({ ...page, incidentId: '14; DROP' })).toBeNull();
  expect(parsePagePayload({ ...page, callId: 'not-a-uuid' })).toBeNull();
  expect(parsePagePayload({ ...page, title: '  ' })).toBeNull();
  expect(parsePagePayload({ type: 'cancel' })).toBeNull();
});
