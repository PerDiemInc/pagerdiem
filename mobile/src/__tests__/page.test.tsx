import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { ben, detail, freezeClock, me } from '@/test-fixtures';
import { fakeServer, renderScreen } from '@/test-utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: '14' }) }));

const Page = require('../app/page/[id]').default;
const activate = { nativeEvent: { actionName: 'activate' } };

beforeEach(() => { freezeClock(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

test('sliding acknowledges, and the timer stops at the acknowledgement', async () => {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  const open = detail();
  const ackedAt = new Date(new Date(open.incident.createdAt).getTime() + 300_000).toISOString(); // 5 min in
  const routes: Record<string, unknown> = {
    'GET /api/app/me': me(),
    'GET /api/app/incidents/14': open,
    'POST /api/app/incidents/14/ack': { changed: true, incident: { ...open.incident, status: 'acknowledged', ackedBy: ben, ackedAt } },
  };
  globalThis.fetch = fakeServer(routes) as unknown as typeof fetch;
  await renderScreen(<Page />);
  expect(await screen.findByLabelText('06:12 since the page went out')).toBeTruthy();
  expect(screen.getByText('Ringing now')).toBeTruthy();

  routes['GET /api/app/incidents/14'] = detail({ status: 'acknowledged', ackedBy: ben, ackedAt });
  await fireEvent(screen.getByLabelText('Slide to acknowledge'), 'accessibilityAction', activate);
  expect(await screen.findByText('Acknowledged. Paging stopped.')).toBeTruthy();
  expect(await screen.findByLabelText('05:00 to acknowledge')).toBeTruthy();
  expect(screen.getByText('You have it')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open incident and add a note' })).toBeTruthy();
});

test('someone else has it', async () => {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  const open = detail();
  const ackedAt = new Date(new Date(open.incident.createdAt).getTime() + 360_000).toISOString();
  globalThis.fetch = fakeServer({
    'GET /api/app/me': me(),
    'GET /api/app/incidents/14': detail({ status: 'acknowledged', ackedBy: open.onCall[1], ackedAt }),
  }) as unknown as typeof fetch;
  await renderScreen(<Page />);
  expect(await screen.findByText('Ana has it')).toBeTruthy();
  expect(screen.getByLabelText('06:00 to acknowledge')).toBeTruthy();
  expect(screen.queryByLabelText('Slide to acknowledge')).toBeNull();
});

test('whoever sent the page is not rung (D11), and a backup who was called is ringing', async () => {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  globalThis.fetch = fakeServer({ 'GET /api/app/me': me(), 'GET /api/app/incidents/14': detail({ createdBy: ben, escalationLevel: 1 }) }) as unknown as typeof fetch;
  await renderScreen(<Page />);
  expect(await screen.findByText('Ringing now')).toBeTruthy();
  expect(screen.getByText('Not called')).toBeTruthy(); // you
  expect(screen.getByText('Backup')).toBeTruthy(); // Eli
  expect(screen.getAllByText('Ringing')).toHaveLength(2); // Ana and Eli
});
