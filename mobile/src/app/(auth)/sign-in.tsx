// Sign in with Google: for a server whose address was typed instead of scanned.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Server } from 'lucide-react-native';
import { useState } from 'react';

import { AppText, Button, Card, ListRow, Screen } from '@/components/ui';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { normalizeServer } from '@/lib/session';
import { googleSignIn, pairPhone, pendingSignUp } from '@/lib/sign-in';

export default function SignIn() {
  const router = useRouter();
  // The address comes from a route, which a link can set: check it like a typed one.
  const server = normalizeServer(useLocalSearchParams<{ server?: string }>().server ?? '');
  if (!server) {
    return (
      <Screen title="Sign in" onBack={() => router.replace('/')}>
        <AppText variant="body">That isn’t a PagerDiem address.</AppText>
      </Screen>
    );
  }
  return <SignInTo server={server} />;
}

function SignInTo({ server }: { server: string }) {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const host = server.replace(/^https?:\/\//, '');

  async function signIn() {
    setError('');
    const result = await googleSignIn(server);
    if (!result) return; // closed the sheet
    const { link, verifier } = result;
    if (link?.error) {
      setError(link.error);
    } else if (link?.pending) {
      Object.assign(pendingSignUp, { server, pending: link.pending, verifier });
      router.replace('/about-you');
    } else if (link?.code) {
      setBusy(true);
      try {
        await session.signIn({ server, ...(await pairPhone({ server, code: link.code, verifier })) });
        router.replace('/setup');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <Screen title="Sign in" onBack={() => router.back()}>
      <Card><ListRow title={host} subtitle="Your team's PagerDiem" left={<Server size={20} color={c.label2} />} last /></Card>
      <AppText variant="body" tone="secondary">Use the Google account you use for PagerDiem on the web.</AppText>
      {error ? (
        <Card style={{ padding: 16, gap: 4, backgroundColor: c.redSoft }}>
          <AppText variant="headline" tone="red">That account isn&apos;t allowed</AppText>
          <AppText variant="foot" tone="red">{error}</AppText>
        </Card>
      ) : null}
      <Button label="Sign in with Google" onPress={signIn} loading={busy} />
    </Screen>
  );
}
