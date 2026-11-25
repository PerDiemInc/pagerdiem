// Connect to your team: scan the code from the web Team page, or type the server's address.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, Field, Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { createClient } from '@/lib/api';
import { normalizeServer } from '@/lib/session';
import { pairPhone, parseConnectLink } from '@/lib/sign-in';

export default function Join() {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const params = useLocalSearchParams<{ mode?: 'scan' | 'address' }>();
  const [mode, setMode] = useState(params.mode ?? 'scan');
  const [permission, requestPermission] = useCameraPermissions();
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scanned = useRef(false);

  async function onScanned(data: string) {
    if (scanned.current) return;
    const link = parseConnectLink(data);
    const server = link?.server ? normalizeServer(link.server) : null;
    if (!server || !link?.code) {
      setError("That isn't a PagerDiem sign-in code. On the web app, go to Team and tap Show sign-in code.");
      return;
    }
    scanned.current = true;
    setBusy(true);
    try {
      await session.signIn({ server, ...(await pairPhone({ server, code: link.code })) });
      router.replace('/setup');
    } catch (err) {
      scanned.current = false;
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const server = normalizeServer(address);
    if (!server) {
      setError('Enter the address of your PagerDiem, like pagerdiem.example.com.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createClient({ server }).get('/healthz');
      router.push({ pathname: '/sign-in', params: { server } });
    } catch {
      setError(`We couldn't reach ${server.replace(/^https?:\/\//, '')}. Check the address on the web app's Team page.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Connect to your team" onBack={() => router.back()}>
      <AppText variant="body" tone="secondary">Open PagerDiem on the web, go to Team, and tap Show sign-in code.</AppText>
      {mode === 'scan' ? (
        <View style={{ gap: Spacing.three }}>
          <View style={{ aspectRatio: 1, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: c.card2, alignItems: 'center', justifyContent: 'center' }}>
            {permission?.granted ? (
              <CameraView style={{ position: 'absolute', inset: 0 } as never} barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => onScanned(data)} />
            ) : (
              <View style={{ padding: Spacing.five, gap: Spacing.three, alignItems: 'center' }}>
                <AppText variant="sub" tone="secondary" style={{ textAlign: 'center' }}>PagerDiem needs the camera to scan the code.</AppText>
                <Button label="Allow camera" variant="secondary" onPress={requestPermission} />
              </View>
            )}
          </View>
          {error ? <AppText variant="foot" tone="red">{error}</AppText> : null}
          {busy ? <AppText variant="foot" tone="secondary">Signing in…</AppText> : null}
          <Button label="Enter address instead" variant="ghost" onPress={() => { setError(''); setMode('address'); }} />
        </View>
      ) : (
        <View style={{ gap: Spacing.four }}>
          <Field label="Server address" placeholder="pagerdiem.example.com" value={address} onChangeText={setAddress}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" returnKeyType="go" onSubmitEditing={connect} error={error} />
          <Button label="Connect" onPress={connect} loading={busy} />
          <Button label="Scan code instead" variant="ghost" onPress={() => { setError(''); setMode('scan'); }} />
        </View>
      )}
    </Screen>
  );
}
