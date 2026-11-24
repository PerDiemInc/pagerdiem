import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, useFonts } from '@expo-google-fonts/geist';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { QueryClient, QueryClientProvider, focusManager, useQueryClient } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { noticePath, startIosCalls } from '@/calls/ios';
import { ToastHost } from '@/components/toast';
import { Colors } from '@/constants/theme';
import { applySavedLook, loadRing } from '@/hooks/use-phone-settings';
import { SessionProvider, useSession } from '@/hooks/use-session';
import type { Me } from '@/lib/api';

SplashScreen.preventAutoHideAsync();
applySavedLook();

// Refresh what's on screen whenever the app comes back to the foreground.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });

export default function RootLayout() {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, GeistMono_500Medium });
  if (!fontsLoaded) return null;

  const c = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: c.bg, card: c.card, text: c.label, border: c.border, primary: c.tint } };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ThemeProvider value={navTheme}>
            <Routes />
            <ToastHost />
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function Routes() {
  const session = useSession();
  useEffect(() => {
    if (session.status !== 'loading') SplashScreen.hideAsync();
  }, [session.status]);
  if (session.status === 'loading') return null;
  const signedIn = session.status === 'signedIn';
  return (
    <>
    <Calls />
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        <Stack.Screen name="incident/[id]" />
        <Stack.Screen name="page/[id]" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="swap/[key]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
        <Stack.Screen name="activity" />
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen name="connect" options={{ presentation: 'modal' }} />
    </Stack>
    </>
  );
}

/**
 * Pages ring on this phone. The call wiring lives for the whole app, signed in or not (a call that
 * comes in while signed out is ended), and never waits on the network: the team's timezone and
 * address were saved at sign-in.
 */
function Calls() {
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const current = useRef(session);
  const calls = useRef<ReturnType<typeof startIosCalls> | null>(null);
  const signedIn = session.status === 'signedIn';

  useEffect(() => {
    current.current = session;
    if (signedIn) calls.current?.refreshToken(); // the new server needs this phone's token
  }, [session, signedIn]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    loadRing().then((ring) => {
      if (cancelled) return;
      calls.current = startIosCalls({
        ringtone: ring.tone,
        navigate: (path) => router.navigate(path as Href),
        context: () => {
          const s = current.current;
          if (s.status !== 'signedIn') return null;
          const team = queryClient.getQueryData<Me>(['me'])?.team;
          return {
            post: s.api.post, get: s.api.get, server: s.session.server, publicUrl: s.session.publicUrl ?? team?.publicUrl,
            timezone: s.session.timezone ?? team?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
        },
      });
    });
    return () => { cancelled = true; calls.current?.stop(); calls.current = null; };
  }, [router, queryClient]);

  // A tapped notice (acknowledged, missed page) opens that incident's page, even from a cold start.
  const tapped = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const path = noticePath(tapped?.notification.request.content.data);
    if (!path || !signedIn) return;
    router.navigate(path as Href);
    Notifications.clearLastNotificationResponse(); // or it opens again after the next sign-in
  }, [tapped, signedIn, router]);
  return null;
}
