import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { fakeServer, renderScreen } from '@/test-utils';

import { ana, ben, dec18, eli, fay, freezeClock, home, incident, jan8, me, minutesBefore, NOW, thisWeekend } from '@/test-fixtures';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

const Home = require('../app/(tabs)/index').default;

let fetchMock: jest.Mock;
async function show(homeReply: object, meReply = me(), routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({ 'GET /api/app/home': homeReply, 'GET /api/app/me': meReply, ...routes });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderScreen(<Home />);
  await screen.findByText('Saturday, December 12');
}

beforeEach(() => freezeClock());
afterEach(() => jest.useRealTimers());

test('you are on call: time left and who is with you', async () => {
  await show(home());
  expect(screen.getByText('You’re on call')).toBeTruthy();
  expect(screen.getByText('1 day 22 hr left')).toBeTruthy();
  expect(screen.getByText('With Ana Gomez until Mon 9:00 AM')).toBeTruthy();
});

test('someone else is on call: who, until when, and your next weekend', async () => {
  await show(home({ onCall: { people: [eli, fay], start: thisWeekend([]).start, until: thisWeekend([]).end, backup: null }, comingUp: [jan8] }));
  expect(screen.getByText('On call now')).toBeTruthy();
  expect(screen.getByText('Eli and Fay')).toBeTruthy();
  expect(screen.getByText('Until Mon 9:00 AM. You’re next on Jan 8.')).toBeTruthy();
});

test('nobody is on call this weekend: say so, and take it in one tap', async () => {
  const open = thisWeekend([]);
  await show(home({ onCall: null, next: open, comingUp: [open, dec18] }), me(), { 'POST /api/app/weekends/2026-12-11/join': { ok: true, message: 'Joined.' } });
  expect(screen.getByText('Needs cover')).toBeTruthy();
  expect(screen.getByText('Nobody’s on call')).toBeTruthy();
  expect(screen.getByText('This weekend needs 2 people.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Take this weekend' }));
  expect(await screen.findByText('You’re on call this weekend.')).toBeTruthy();
});

test('on a weekday, pages go to Slack until the weekend starts', async () => {
  await show(home({ onCall: null, next: dec18, comingUp: [dec18, jan8] }));
  expect(screen.getByText('Weekday')).toBeTruthy();
  expect(screen.getByText('Pages go to Slack')).toBeTruthy();
  expect(screen.getByText('@here in #on-call. The weekend starts Fri 6:00 PM.')).toBeTruthy();
});

test('says when Focus may silence calls, and when calls can wake you', async () => {
  await show(home(), me({ focus: false }));
  expect(screen.getByText('Focus may silence calls')).toBeTruthy();
  expect(screen.queryByText('We can wake you')).toBeNull();
});

test('a phone that passed its checks can wake you', async () => {
  await show(home());
  expect(screen.getByText('We can wake you')).toBeTruthy();
});

test('needs you: acknowledge a page from home', async () => {
  const paging = incident(7, 'Checkout failing for all stores', { createdAt: minutesBefore(6) });
  const taken = incident(4, 'API 5xx above 2% on /orders', { status: 'acknowledged', ackedBy: ana, createdAt: minutesBefore(19) });
  await show(home({ needsYou: [paging, taken] }), me(), { 'POST /api/app/incidents/7/ack': { changed: true, incident: { ...paging, status: 'acknowledged', ackedBy: ben } } });
  expect(screen.getByText('Paging you · 6 min')).toBeTruthy();
  expect(screen.getByText('Ana Gomez has it · 19 min')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Acknowledge' }));
  expect(await screen.findByText('Acknowledged. Paging stopped.')).toBeTruthy();
  const ack = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/api/app/incidents/7/ack') && init.method === 'POST');
  expect(JSON.parse(ack[1].body)).toEqual({ via: 'app' });
});

test('a page you sent while on call with someone else rings them, not you', async () => {
  await show(home({ needsYou: [incident(8, 'Push notifications delayed', { createdBy: ben, createdAt: NOW })] }));
  expect(screen.getByText('Paging · just now')).toBeTruthy();
});

test('all quiet when nothing is open', async () => {
  await show(home({ needsYou: [] }));
  expect(screen.getByText('All quiet')).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Coming up')).toBeTruthy());
});
