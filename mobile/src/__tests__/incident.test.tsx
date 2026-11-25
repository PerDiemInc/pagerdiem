import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

import { ben, detail, freezeClock, me } from '@/test-fixtures';
import { fakeServer, pressAlertButton, renderScreen } from '@/test-utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: '14' }) }));

const Incident = require('../app/incident/[id]').default;

let fetchMock: jest.Mock;
async function show(routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({ 'GET /api/app/me': me(), 'GET /api/app/incidents/14': detail(), ...routes });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderScreen(<Incident />);
  await screen.findByText('Checkout failing for all stores');
}

let alertSpy: jest.SpyInstance;
beforeEach(() => { freezeClock(); jest.clearAllMocks(); alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); alertSpy.mockRestore(); });

test('the header says who paged, from where, and how long it has been paging', async () => {
  await show();
  expect(screen.getByText('Paging · 06:12')).toBeTruthy();
  expect(screen.getByText('#14 · Hana Ito paged from Slack at 10:53 AM · came in 6 more times')).toBeTruthy();
  expect(screen.getByText('Square’s status page shows a partial outage.')).toBeTruthy(); // a note, as a bubble
});

test('the escalation tab shows what happened, what is next and what comes later', async () => {
  await show();
  await fireEvent.press(screen.getByRole('tab', { name: 'Escalation' }));
  expect(screen.getByText('Call Ben Carter and Ana Gomez')).toBeTruthy();
  expect(screen.getByText('Call Eli Brooks, the backup')).toBeTruthy();
  expect(screen.getByLabelText('Call Eli Brooks, the backup: next')).toBeTruthy();
  expect(screen.getByLabelText('@channel in #on-call: later')).toBeTruthy();
  expect(screen.getByLabelText('Rings through Do Not Disturb: done')).toBeTruthy();
});

test('a note goes to the team', async () => {
  await show({ 'POST /api/app/incidents/14/notes': { at: new Date().toISOString(), kind: 'note', text: 'Rolling back', author: null } });
  await fireEvent.changeText(screen.getByLabelText('Note'), 'Rolling back');
  await fireEvent.press(screen.getByRole('button', { name: 'Post note' }));
  expect(await screen.findByText('Note posted. #on-call sees it too.')).toBeTruthy();
  const post = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/notes') && init?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ text: 'Rolling back' });
});

test('calling the backup a second time explains why not', async () => {
  await show({ 'POST /api/app/incidents/14/call-backup': new Response(JSON.stringify({ error: 'The backup has already been called' }), { status: 409 }) });
  await fireEvent.press(screen.getByRole('button', { name: 'More actions' }));
  await pressAlertButton('Call the backup now');
  expect(await screen.findByText('The backup has already been called')).toBeTruthy();
});

test('the responders strip does not ring whoever sent the page (D11)', async () => {
  await show({ 'GET /api/app/incidents/14': detail({ createdBy: ben }) });
  expect(screen.getByText('Not called')).toBeTruthy();
  expect(screen.getAllByText('Ringing')).toHaveLength(1); // Ana
});
