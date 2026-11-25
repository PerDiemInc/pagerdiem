// Renders a screen the way the app does: with the server-data cache and the sign-in session.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import type { ReactElement, ReactNode } from 'react';

import { toast, ToastHost } from '@/components/toast';
import { SessionProvider, useSession } from '@/hooks/use-session';

export function renderScreen(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Ready>{ui}</Ready>
        <ToastHost />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

// A toast left showing at the end of a test would keep its timer, and Jest, running.
afterEach(() => toast.hide());

/** Like the app's splash: nothing renders until the saved session has loaded. */
function Ready({ children }: { children: ReactNode }) {
  return useSession().status === 'loading' ? null : children;
}

/** A fetch that answers each request from `routes` ("POST /api/app/pair" → JSON or a Response). */
export function fakeServer(routes: Record<string, unknown>) {
  return jest.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    if (!(key in routes)) return new Response(JSON.stringify({ error: `No route ${key}` }), { status: 404 });
    const reply = routes[key];
    return reply instanceof Response ? reply : new Response(JSON.stringify(reply), { status: 200 });
  });
}

/** Presses a button of the last native Alert the screen showed (Alert.alert must be spied on). */
export async function pressAlertButton(label: string) {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
  const button = buttons.find((b) => b.text === label);
  if (!button) throw new Error(`No "${label}" in the last alert: ${buttons.map((b) => b.text).join(', ')}`);
  await act(async () => { await button.onPress?.(); });
}
