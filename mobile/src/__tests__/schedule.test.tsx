import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

import { ana, cal, dec18, dec25, freezeClock, jan8, me, thisWeekend, ben } from '@/test-fixtures';
import { fakeServer, pressAlertButton, renderScreen } from '@/test-utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));

const Schedule = require('../app/(tabs)/schedule').default;
const Swap = require('../app/swap/[key]').default;
const coverage = { days: [0, 5, 6], start: '18:00', end: '09:00', weekendCount: 2, weekdayCount: 1 };

let fetchMock: jest.Mock;
async function serve(routes: Record<string, unknown> = {}) {
  await SecureStore.setItemAsync('pd.session', JSON.stringify({ server: 'https://pd.example.com', token: 'tok' }));
  fetchMock = fakeServer({
    'GET /api/app/me': me(),
    'GET /api/app/schedule': { coverage, weekends: [thisWeekend([ben, ana]), dec18, dec25, jan8] },
    ...routes,
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}
const posted = (path: string) => fetchMock.mock.calls.filter(([url, init]) => url.endsWith(path) && init?.method === 'POST');

let alertSpy: jest.SpyInstance;
beforeEach(() => { freezeClock(); jest.clearAllMocks(); alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); alertSpy.mockRestore(); });

test('weekends by month, with the shift hours on top', async () => {
  await serve();
  await renderScreen(<Schedule />);
  expect(await screen.findByText('Fri 6:00 PM to Mon 9:00 AM · 2 people')).toBeTruthy();
  expect(screen.getByText('December')).toBeTruthy();
  expect(screen.getByText('January')).toBeTruthy();
  expect(screen.getByText('Dec 11 to 14 · now')).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Only mine' }));
  expect(screen.queryByText('Eli and Fay')).toBeNull();
});

test('your weekend offers swap, cover and leave; leaving asks first', async () => {
  await serve({ 'POST /api/app/weekends/2027-01-08/leave': { ok: true, message: 'You’re off Jan 8 to 11. That weekend now needs cover.' } });
  await renderScreen(<Schedule />);
  await fireEvent.press(await screen.findByLabelText('Jan 8 to 11, You and Ana'));
  await pressAlertButton('Leave weekend');
  expect(alertSpy).toHaveBeenLastCalledWith('Leave Jan 8 to 11?', 'Ana Gomez will be on their own and the weekend shows as needing cover. #on-call is told.', expect.anything());
  await pressAlertButton('Leave');
  expect(await screen.findByText('You’re off Jan 8 to 11. That weekend now needs cover.')).toBeTruthy();
});

test('swapping trades weekends, and Undo puts both back', async () => {
  mockParams = { key: '2027-01-08' };
  await serve({
    'POST /api/app/weekends/2027-01-08/trade': { ok: true, message: 'Swapped. You take Dec 25 to 28.', undo: { ids: [7, 8], until: new Date(Date.now() + 10_000).toISOString() } },
    'POST /api/app/swaps/undo': { ok: true, message: 'Swap undone. Nothing changed and nobody was notified.' },
  });
  await renderScreen(<Swap />);
  expect(await screen.findByText('Swap Jan 8 to 11')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Cal Reyes, on call Dec 25 to 28' }));
  expect(await screen.findByText('Swapped. You take Dec 25 to 28.')).toBeTruthy();
  expect(JSON.parse(posted('/trade')[0][1].body)).toEqual({ theirKey: '2026-12-25', userId: cal.id });
  await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
  expect(JSON.parse(posted('/api/app/swaps/undo')[0][1].body)).toEqual({ ids: [7, 8] });
  expect(await screen.findByText('Swap undone. Nothing changed and nobody was notified.')).toBeTruthy();
});
