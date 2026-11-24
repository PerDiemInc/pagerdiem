// Wake-up checks: the few phone settings that decide whether a page at 3 AM actually wakes you.
// Shown after sign-in and from You. Each check is saved on the server (device.checks) so On call
// and the Team page can say who can be woken.
import * as Notifications from 'expo-notifications';
import { useCanGoBack, useLocalSearchParams, useRouter } from 'expo-router';
import { BellRing, Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Loading, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAction, useMe } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import type { DeviceChecks, Me } from '@/lib/api';

type Step = { id: keyof DeviceChecks | 'test'; title: string; text: string; cta: string; confirm?: string; run?: () => Promise<unknown> };

const openIntent = (action: string) => Linking.sendIntent(action).catch(() => Linking.openSettings());

function stepsFor(platform: Me['device']['platform']): Step[] {
  const notifications: Step = {
    id: 'notifications', title: 'Allow notifications', text: 'So you can see what each page is about.', cta: 'Allow notifications',
  };
  const test: Step = { id: 'test', title: 'Answer a test call', text: 'We’ll call you now. Answer it to finish.', cta: 'Ring me now' };
  if (platform === 'android') {
    return [
      notifications,
      // Android 14 made full-screen calls a permission; older versions allow it already.
      ...(Number(Platform.Version) >= 34 ? [{
        id: 'fullScreen' as const, title: 'Allow full-screen calls', text: 'Shows the incoming page over your lock screen.', cta: 'Allow',
        confirm: 'I’ve allowed it', run: () => openIntent('android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT'),
      }] : []),
      {
        id: 'dndAccess', title: 'Allow Do Not Disturb access', text: 'Lets a page ring at full volume, even on silent.', cta: 'Open settings',
        confirm: 'I’ve allowed it', run: () => openIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS'),
      },
      test,
    ];
  }
  return [
    notifications,
    {
      id: 'focus', title: 'Let PagerDiem through Focus', text: 'In Settings › Focus, add PagerDiem to Allowed Apps for Sleep and Do Not Disturb.',
      cta: 'Open Focus settings', confirm: 'I’ve added PagerDiem', run: () => Linking.openSettings(),
    },
    { id: 'ringer', title: 'Keep the ringer on', text: 'iPhone calls follow your ringer. Leave it on while you’re on call.', cta: 'Done' },
    test,
  ];
}

export default function Setup() {
  const me = useMe();
  if (!me.data) return <Loading error={me.error} onRetry={() => me.refetch()} />;
  return <Checks me={me.data} refetch={() => me.refetch()} />;
}

function Checks({ me, refetch }: { me: Me; refetch: () => void }) {
  const c = useTheme();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { tested } = useLocalSearchParams<{ tested?: string }>();
  const { act, pending } = useAction();
  const [opened, setOpened] = useState<string | null>(null); // a settings screen we sent you to
  const [ringing, setRinging] = useState(false);
  const [noAnswer, setNoAnswer] = useState(false);
  const checks = me.device.checks;
  const steps = stepsFor(me.device.platform);
  const isDone = (s: Step) => (s.id === 'test' ? Boolean(me.device.testedAt) : checks[s.id]);
  const doneCount = steps.filter(isDone).length;
  const current = steps.find((s) => !isDone(s));
  const save = (patch: Partial<DeviceChecks>) => act('/api/app/device', { checks: patch });

  // The call rings for 45 s; after a minute with no answer, offer it again.
  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(() => { setRinging(false); setNoAnswer(true); }, 60_000);
    return () => clearTimeout(timer);
  }, [ringing]);
  // Back from an answered test call: the server has marked it, so fetch it.
  useEffect(() => { if (tested === '1') refetch(); }, [tested, refetch]);
  // A permission granted elsewhere (or turned off in Settings) is still the truth.
  useEffect(() => {
    Notifications.getPermissionsAsync().then((p) => {
      if (p.granted !== checks.notifications) save({ notifications: p.granted });
    }).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  async function run(step: Step) {
    if (step.id === 'notifications') {
      const result = await Notifications.requestPermissionsAsync();
      if (result.granted) await save({ notifications: true });
      else Alert.alert('Notifications are off', 'Turn them on in Settings › PagerDiem › Notifications.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => { Linking.openSettings(); } }]);
    } else if (step.id === 'test') {
      setNoAnswer(false);
      if (await act('/api/app/device/test-call')) setRinging(true);
    } else if (step.run && opened !== step.id) {
      await step.run();
      setOpened(step.id);
    } else {
      setOpened(null);
      await save({ [step.id]: true });
    }
  }

  function skip() {
    Alert.alert('Skip the Wake-up checks?', 'A page may not wake you at night. You can finish this later in You.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Skip', onPress: () => router.replace('/') },
    ]);
  }

  const ready = doneCount === steps.length;
  return (
    <Screen title="Make sure pages wake you" onBack={canGoBack ? () => router.back() : undefined}>
      <AppText variant="body" tone="secondary">{`A page rings like a phone call. These ${steps.length} steps make sure it rings at 3 AM too.`}</AppText>
      <View style={{ gap: Spacing.two }}>
        <View style={[styles.track, { backgroundColor: c.fill }]}>
          <View style={[styles.fill, { width: `${(doneCount / steps.length) * 100}%`, backgroundColor: c.green }]} />
        </View>
        <AppText variant="foot" tone="secondary">{`${doneCount} of ${steps.length}`}</AppText>
      </View>
      <Card>
        {steps.map((step, n) => {
          const done = isDone(step);
          const here = step === current;
          return (
            <View key={step.id} style={[styles.step, n < steps.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
              <View style={[styles.badge, { backgroundColor: done ? c.green : here ? c.primary : c.fill }]}>
                {done ? <Check size={16} color="#FFFFFF" /> : <AppText variant="foot" style={{ fontFamily: Fonts.semibold, color: here ? c.onPrimary : c.label2 }}>{n + 1}</AppText>}
              </View>
              <View style={{ flex: 1, gap: Spacing.one }}>
                <AppText variant="headline" tone={done || here ? 'neutral' : 'secondary'}>{step.title}</AppText>
                <AppText variant="sub" tone="secondary">{done && step.id === 'test' ? 'It rang and you answered. You’re set.' : step.text}</AppText>
                {here && step.id === 'test' && ringing ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <BellRing size={16} color={c.tintText} />
                    <AppText variant="sub" tone="tint">Ringing your phone…</AppText>
                  </View>
                ) : here ? (
                  <>
                    {step.id === 'test' && noAnswer ? <AppText variant="sub" tone="orange">No answer. Ring again when you’re ready.</AppText> : null}
                    <Button label={opened === step.id && step.confirm ? step.confirm : step.cta} variant="secondary" loading={pending}
                    onPress={() => run(step)} style={{ alignSelf: 'flex-start', marginTop: Spacing.one }} />
                  </>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>
      <View style={{ gap: Spacing.two }}>
        <Button label={ready ? 'Go to On call' : 'Finish the steps above'} disabled={!ready} onPress={() => router.replace('/')} />
        {ready ? null : <Button label="Skip for now" variant="ghost" onPress={skip} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.pill },
  step: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.four },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
