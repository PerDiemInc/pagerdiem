// You: your profile, how this phone wakes you, appearance, and (for admins) the team's coverage.
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import {
  CalendarPlus, ChevronRight, History, Minus, Music, PhoneIncoming, Plus, Send, ShieldCheck, Vibrate, Volume2, type LucideIcon,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { toast } from '@/components/toast';
import { AppText, Avatar, Button, Card, Loading, Pill, Screen, Section, Segmented, Tile } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAction, useChange, useMe } from '@/hooks/use-api';
import { TONES, usePhoneSettings, type Look } from '@/hooks/use-phone-settings';
import { useApi, useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import type { Coverage, Me } from '@/lib/api';
import { addToCalendar } from '@/lib/links';
import { clock12, formatDate } from '@/lib/time';

export default function You() {
  const router = useRouter();
  const me = useMe();
  if (!me.data) return <Loading error={me.error} onRetry={() => me.refetch()} />;
  const m = me.data;
  return (
    <Screen title="You" refreshing={me.isRefetching} onRefresh={() => me.refetch()}>
      <ProfileCard me={m} onPress={() => router.push('/profile')} />
      <WakingYouUp me={m} />
      <Appearance />
      <Section title="More">
        <Card>
          <Row Icon={CalendarPlus} title="Add weekends to calendar" onPress={() => addToCalendar(m.calendarFeedUrl)} />
          <Row Icon={History} title="Activity log" onPress={() => router.push('/activity')} last />
        </Card>
      </Section>
      {m.user.role === 'admin' ? <CoverageEditor coverage={m.coverage} /> : null}
      <SignOut />
      <AppText variant="foot" tone="tertiary" style={{ textAlign: 'center' }}>
        {`Connected to ${m.team.publicUrl.replace(/^https?:\/\//, '')}${Constants.expoConfig?.version ? ` · Version ${Constants.expoConfig.version}` : ''}`}
      </AppText>
    </Screen>
  );
}

function ProfileCard({ me, onPress }: { me: Me; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={onPress}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <Avatar initials={me.user.initials} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="headline">{me.user.name}</AppText>
          <AppText variant="foot" tone="secondary">{me.user.email}</AppText>
          <AppText variant="foot" tone="secondary">{`${me.user.slack ?? 'No Slack yet'} · ${me.user.phone}`}</AppText>
        </View>
        <ChevronRight size={18} color={c.label3} />
      </Card>
    </Pressable>
  );
}

function WakingYouUp({ me }: { me: Me }) {
  const router = useRouter();
  const { act } = useAction();
  const { ring, setRing } = usePhoneSettings();
  const checks = me.device.checks;
  const allGood = checks.notifications && checks.focus && checks.ringer && (me.device.platform === 'ios' || (checks.fullScreen && checks.dndAccess));
  const tone = TONES.find((t) => t.value === ring.tone) ?? TONES[0];

  async function ringMe() {
    if (await act('/api/app/device/test-call')) toast.show({ text: 'Calling you now. Answer to finish.' });
  }
  function pickTone() {
    Alert.alert('Ringtone', undefined, [
      ...TONES.map((t) => ({ text: t.value === ring.tone ? `${t.label} (current)` : t.label, onPress: () => setRing({ tone: t.value }) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  return (
    <Section title="Waking you up">
      <Card>
        <Row Icon={ShieldCheck} title="Wake-up checks" right={<Pill label={allGood ? 'All good' : 'Needs a look'} tone={allGood ? 'green' : 'orange'} />} onPress={() => router.push('/setup')} />
        <Row Icon={PhoneIncoming} title="Ring me now" sub={me.device.testedAt ? `Last answered ${formatDate(me.device.testedAt, me.team.timezone)}` : 'Not tested yet'} onPress={ringMe} />
        <Row Icon={Music} title="Ringtone" sub={tone.label} onPress={pickTone} />
        {Platform.OS === 'android' ? (
          <Row Icon={Volume2} title="Ring at full volume" right={<Toggle label="Ring at full volume" value={ring.loud} onChange={(loud) => setRing({ loud })} />} />
        ) : null}
        <Row Icon={Vibrate} title="Vibrate" right={<Toggle label="Vibrate" value={ring.vibrate} onChange={(vibrate) => setRing({ vibrate })} />} last />
      </Card>
      <AppText variant="foot" tone="secondary" style={{ paddingHorizontal: Spacing.one }}>
        Full volume works on Android, even on silent. iPhone calls follow your ringer, so leave it on while you’re on call.
      </AppText>
    </Section>
  );
}

function Appearance() {
  const { look, setLook } = usePhoneSettings();
  return (
    <Section title="Appearance">
      <Segmented<Look> value={look} onChange={setLook} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
    </Section>
  );
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shift = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function CoverageEditor({ coverage }: { coverage: Coverage }) {
  const c = useTheme();
  const { change, pending } = useChange();
  const [draft, setDraft] = useState(coverage);
  const set = (patch: Partial<Coverage>) => setDraft({ ...draft, ...patch });
  const toggle = (day: number) => set({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort() });
  const noDays = draft.days.length === 0;

  return (
    <Section title="Coverage" action={<Pill label="Admin" tone="tint" />}>
      <Card style={{ padding: Spacing.four, gap: Spacing.four }}>
        <View style={{ gap: Spacing.two }}>
          <AppText variant="foot" tone="secondary">Days that need someone on call</AppText>
          <View style={{ flexDirection: 'row', gap: Spacing.one }}>
            {DAYS.map((name, day) => {
              const on = draft.days.includes(day);
              return (
                <Pressable key={name} accessibilityRole="checkbox" accessibilityLabel={name} accessibilityState={{ checked: on }} onPress={() => toggle(day)}
                  style={[styles.day, { backgroundColor: on ? c.primary : c.fill }]}>
                  <AppText variant="foot" style={{ fontFamily: Fonts.semibold, color: on ? c.onPrimary : c.label2 }}>{name[0]}</AppText>
                </Pressable>
              );
            })}
          </View>
          {noDays ? <AppText variant="foot" tone="red" accessibilityLiveRegion="polite">Pick at least one day that needs someone on call.</AppText> : null}
        </View>
        <Stepper label="Starts" value={clock12(draft.start)} less="Earlier start" more="Later start" onLess={() => set({ start: shift(draft.start, -30) })} onMore={() => set({ start: shift(draft.start, 30) })} />
        <Stepper label="Ends" value={clock12(draft.end)} less="Earlier end" more="Later end" onLess={() => set({ end: shift(draft.end, -30) })} onMore={() => set({ end: shift(draft.end, 30) })} />
        <Stepper label="Weekend days" value={`${draft.weekendCount} on call`} less="Fewer on weekend days" more="More on weekend days"
          onLess={draft.weekendCount > 1 ? () => set({ weekendCount: draft.weekendCount - 1 }) : undefined} onMore={() => set({ weekendCount: draft.weekendCount + 1 })} />
        <Stepper label="Weekdays" value={`${draft.weekdayCount} on call`} less="Fewer on weekdays" more="More on weekdays"
          onLess={draft.weekdayCount > 1 ? () => set({ weekdayCount: draft.weekdayCount - 1 }) : undefined} onMore={() => set({ weekdayCount: draft.weekdayCount + 1 })} />
        <Button label="Save coverage" disabled={noDays} loading={pending} onPress={() => change('/api/app/coverage', draft)} />
      </Card>
      <Card>
        <Row Icon={Send} title="Resend weekend message" sub="Sends “you’re on call now” to whoever is on call" onPress={() => change('/api/app/resend-weekend-start')} last />
      </Card>
    </Section>
  );
}

function Stepper({ label, value, less, more, onLess, onMore }: { label: string; value: string; less: string; more: string; onLess?: () => void; onMore?: () => void }) {
  const c = useTheme();
  const button = (name: string, Icon: LucideIcon, onPress?: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={onPress}
      hitSlop={6} style={[styles.step, { backgroundColor: c.fill, opacity: onPress ? 1 : 0.4 }]}>
      <Icon size={18} color={c.label} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
      <View style={{ flex: 1 }}>
        <AppText variant="sub">{label}</AppText>
        <AppText variant="foot" tone="secondary">{value}</AppText>
      </View>
      {button(less, Minus, onLess)}
      {button(more, Plus, onMore)}
    </View>
  );
}

function SignOut() {
  const session = useSession();
  const api = useApi();
  function confirm() {
    Alert.alert('Sign out?', 'This phone stops ringing for pages until you sign in again. Slack DMs still reach you.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive',
        onPress: async () => {
          // Tell the server to forget this phone; sign out here even if it can't be reached.
          await api.post('/api/app/signout').catch(() => null);
          await session.signOut();
        },
      },
    ]);
  }
  return <Button label="Sign out" variant="secondary" onPress={confirm} />;
}

function Row({ Icon, title, sub, right, onPress, last }: { Icon: LucideIcon; title: string; sub?: string; right?: ReactNode; onPress?: () => void; last?: boolean }) {
  const c = useTheme();
  const body = (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
      <Tile Icon={Icon} bg={c.fill} fg={c.label} />
      <View style={{ flex: 1 }}>
        <AppText variant="body">{title}</AppText>
        {sub ? <AppText variant="foot" tone="secondary">{sub}</AppText> : null}
      </View>
      {right ? <View>{right}</View> : onPress ? <ChevronRight size={18} color={c.label3} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: c.fill }}>
      {body}
    </Pressable>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = useTheme();
  return <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: c.green, false: c.fill }} thumbColor="#FFFFFF" />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, minHeight: 56 },
  day: { flex: 1, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  step: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
