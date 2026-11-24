import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

import { ana, ben, freezeClock, incident, me, minutesBefore } from '@/test-fixtures';
import { fakeServer, pressAlertButton, renderScreen } from '@/test-utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const Incidents = require('../app/(tabs)/incidents').default;
const stats = { open: 1, acknowledged: 1, resolved: 1, last30Days: 3, medianAckMinutes: 4 };
const paging = incident(14, 'Checkout failing for all stores', { source: 'slack', createdAt: minutesBefore(6) });
const taken = incident(13, 'API 5xx above 2% on /orders', { status: 'acknowledged', ackedBy: ana, createdAt: minutesBefore(22) });
const done = incident(12, 'Loyalty points not posting', { status: 'resolved', ackedBy: ana, createdAt: minutesBefore(3000), ackedAt: minutesBefore(2989), resolvedAt: minutesBefore(2900) });

let fetchMock: jest.Mock;
async function show(incidents = [paging, taken, done], routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({ 'GET /api/app/me': me(), 'GET /api/app/incidents': { incidents, stats, recentTitles: [] }, ...routes });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderScreen(<Incidents />);
}
const posted = (path: string) => fetchMock.mock.calls.filter(([url, init]) => url.endsWith(path) && init?.method === 'POST');

let alertSpy: jest.SpyInstance;
beforeEach(() => { freezeClock(); jest.clearAllMocks(); alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); alertSpy.mockRestore(); });

test('active incidents first, with who has each one', async () => {
  await show();
  expect(await screen.findByText('1 open · 1 acknowledged')).toBeTruthy();
  expect(screen.getByText('Checkout failing for all stores')).toBeTruthy();
  expect(screen.getByText('Ana Gomez has it · Web')).toBeTruthy();
  expect(screen.queryByText('Loyalty points not posting')).toBeNull(); // resolved ones are under Resolved
  await fireEvent.press(screen.getByRole('tab', { name: 'Resolved' }));
  expect(screen.getByText('Ana Gomez acknowledged in 11 min')).toBeTruthy();
});

test('acknowledging from the row (swipe, or long press) calls the API and says so', async () => {
  await show([paging], { 'POST /api/app/incidents/14/ack': { changed: true, incident: { ...paging, status: 'acknowledged', ackedBy: ben } } });
  await fireEvent(await screen.findByLabelText('Checkout failing for all stores'), 'longPress');
  await pressAlertButton('Acknowledge');
  expect(await screen.findByText('Acknowledged. Paging stopped.')).toBeTruthy();
  expect(JSON.parse(posted('/api/app/incidents/14/ack')[0][1].body)).toEqual({ via: 'app' });
});

test('someone else got there first: not an error, just who has it', async () => {
  await show([paging], { 'POST /api/app/incidents/14/ack': { changed: false, incident: { ...paging, status: 'acknowledged', ackedBy: ana } } });
  await fireEvent(await screen.findByLabelText('Checkout failing for all stores'), 'longPress');
  await pressAlertButton('Acknowledge');
  expect(await screen.findByText('Already acknowledged by Ana Gomez')).toBeTruthy();
});

test('acknowledging something you had already acknowledged just says it’s done', async () => {
  await show([paging], { 'POST /api/app/incidents/14/ack': { changed: false, incident: { ...paging, status: 'acknowledged', ackedBy: ben } } });
  await fireEvent(await screen.findByLabelText('Checkout failing for all stores'), 'longPress');
  await pressAlertButton('Acknowledge');
  expect(await screen.findByText('Acknowledged. Paging stopped.')).toBeTruthy();
});

test('resolve asks first', async () => {
  await show([taken], { 'POST /api/app/incidents/13/resolve': { changed: true, incident: { ...taken, status: 'resolved' } } });
  await fireEvent(await screen.findByLabelText('API 5xx above 2% on /orders'), 'longPress');
  await pressAlertButton('Resolve');
  expect(alertSpy).toHaveBeenLastCalledWith('Resolve incident #13?', '“API 5xx above 2% on /orders” is marked fixed, paging stops and #on-call is told.', expect.anything());
  expect(posted('/api/app/incidents/13/resolve')).toHaveLength(0);
  await pressAlertButton('Resolve');
  expect(await screen.findByText('Resolved.')).toBeTruthy();
});

test('search, and the empty states', async () => {
  await show();
  await fireEvent.changeText(await screen.findByLabelText('Search incidents'), 'zzz');
  expect(screen.getByText('No results')).toBeTruthy();
  expect(screen.getByText('No incidents match “zzz”.')).toBeTruthy();
});

test('a team with no incidents yet', async () => {
  await show([]);
  expect(await screen.findByText('No incidents yet')).toBeTruthy();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Page on-call' })[1]); // the empty state's button
  expect(mockRouter.push).toHaveBeenCalledWith('/compose');
});
