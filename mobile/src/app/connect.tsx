// pagerdiem://connect links opened from outside the app (a message, a browser). The app asks
// before using one: a crafted link could otherwise sign this phone in to someone else's account.
// Links the app reads itself (its scanner, its Google sign-in sheet) never come through here, so a
// Google sign-up (which needs the app's verifier) is never finished from one.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { AppText, Button, Screen } from '@/components/ui';
import { useSession } from '@/hooks/use-session';
import { normalizeServer } from '@/lib/session';
import { pairPhone } from '@/lib/sign-in';

export default function Connect() {
  const params = useLocalSearchParams<{ server?: string; code?: string; error?: string }>();
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.error ?? '');
  const server = params.server ? normalizeServer(params.server) : null;
  const host = server?.replace(/^https?:\/\//, '');

  async function connect() {
    if (!server) return;
    setBusy(true);
    try {
      await session.signIn({ server, ...(await pairPhone({ server, code: params.code ?? '' })) });
      router.replace('/setup');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error || !server || !params.code) {
    return (
      <Screen title="Couldn't sign in">
        <AppText variant="body">{error || 'This sign-in link isn’t complete. Make a new one on the web app’s Team page.'}</AppText>
        <Button label="Try again" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  return (
    <Screen title={`Connect to ${host}?`}>
      <AppText variant="body" tone="secondary">
        This signs this phone in to PagerDiem at {host}. Only connect if you opened the link from your team&apos;s PagerDiem.
      </AppText>
      <Button label="Connect" onPress={connect} loading={busy} />
      <Button label="Cancel" variant="ghost" onPress={() => router.replace('/')} />
    </Screen>
  );
}
