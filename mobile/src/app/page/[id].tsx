// The page: what a call opens to. A big timer, who's ringing, what escalation does next, and the
// one thing to do: slide to acknowledge. Answering the call already acknowledged it (D1).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Ellipsis, MessageSquare, Repeat, X } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SlideToAcknowledge } from '@/components/slide-to-acknowledge';
import { AppText, Avatar, Button, Card, Loading, Pill, Section } from '@/components/ui';
import { Fonts, Spacing } from '@/constants/theme';
import { useIncident, useIncidentActions, useMe } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { copyLink, openSlack } from '@/lib/links';
import { firstName, fromSource } from '@/lib/names';
import { formatClock, formatTimer } from '@/lib/time';

export default function PageScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const incident = useIncident(Number(id));
  const actions = useIncidentActions();
  const now = useNow(1000);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  if (!me.data || !incident.data) return <Loading error={me.error ?? incident.error} onRetry={() => { me.refetch(); incident.refetch(); }} />;

  const { incident: inc, escalation, onCall } = incident.data;
  const team = me.data.team;
  const meId = me.data.user.id;
  const tz = team.timezone;
  const responder = me.data.user.role !== 'non_technical';
  const open = inc.status === 'open';
  const at = (iso: string | null) => new Date(iso ?? Date.now()).getTime() - new Date(inc.createdAt).getTime();
  // The timer runs while paging and stops at the acknowledgement (or the fix).
  const elapsed = open ? now.getTime() - new Date(inc.createdAt).getTime() : at(inc.status === 'resolved' ? inc.resolvedAt : inc.ackedAt);
  const look = open ? { label: 'Paging', tone: 'red' as const, timer: 'since the page went out' }
    : inc.status === 'resolved' ? { label: 'Resolved', tone: 'green' as const, timer: 'to fix' }
      : { label: inc.ackedBy?.id === meId ? 'You have it' : `${inc.ackedBy ? firstName(inc.ackedBy) : 'Someone'} has it`, tone: 'orange' as const, timer: 'to acknowledge' };
  const next = escalation.find((s) => s.state === 'next');
  const backup = inc.backup && inc.escalationLevel < 1 && !inc.quiet ? inc.backup : null;

  // Whoever sent the page isn't rung while someone else is on call (D11).
  const notCalled = (id: number) => inc.quiet || (id === inc.createdBy?.id && onCall.length > 1);
  const calledBackup = inc.backup && inc.escalationLevel >= 1 && !onCall.some((p) => p.id === inc.backup!.id) ? [{ ...inc.backup, role: 'Backup' }] : [];
  const people = [...onCall.map((p) => ({ ...p, role: 'On call' })), ...calledBackup].map((p) => ({
    ...p, label: p.id === meId ? 'You' : p.name,
    status: inc.ackedBy?.id === p.id ? 'Has it' : notCalled(p.id) ? 'Not called' : open ? 'Ringing' : 'Stopped',
  }));
  const facts: [string, string][] = open ? [] : [
    ['Paged', formatClock(inc.createdAt, tz)],
    ...(inc.ackedBy && inc.ackedBy.id !== meId ? [['Acknowledged by', inc.ackedBy.name] as [string, string]] : []),
    ...(inc.ackedAt ? [['Acknowledged in', formatTimer(at(inc.ackedAt))] as [string, string]] : []),
    ...(inc.resolvedAt ? [['Fixed in', formatTimer(at(inc.resolvedAt))] as [string, string]] : []),
  ];

  function passToBackup() {
    if (!backup) return;
    Alert.alert(`Call ${backup.name} now?`, `${firstName(backup)} is the backup. We’ll call them right away and keep calling the others.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Call ${firstName(backup)}`, onPress: () => actions.run(`/api/app/incidents/${inc.id}/call-backup`) },
    ]);
  }

  function more() {
    Alert.alert(`Incident #${inc.id}`, inc.title, [
      ...(responder && open && !inc.quiet ? [{ text: 'Call everyone again', onPress: () => actions.run(`/api/app/incidents/${inc.id}/call-again`) }] : []),
      { text: 'Copy link', onPress: () => copyLink(`${team.publicUrl}/incidents/${inc.id}`) },
      { text: 'Open in Slack', onPress: () => openSlack(team.slackChannelName) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={12}><X size={24} color={c.label} /></Pressable>
        <AppText variant="headline">{`Incident #${inc.id}`}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="More actions" onPress={more} hitSlop={12}><Ellipsis size={24} color={c.label} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.five }}>
        <Card style={[styles.hero, open && { borderColor: c.red, borderWidth: 1.5 }]}>
          <Pill label={look.label} tone={look.tone} />
          <AppText variant="foot" tone="secondary">{`${inc.createdBy?.name ?? 'An alert'} · ${fromSource(inc.source)} · ${formatClock(inc.createdAt, tz)}`}</AppText>
          <AppText style={[styles.timer, { color: c.label }]} accessibilityLabel={`${formatTimer(elapsed)} ${look.timer}`}>{formatTimer(elapsed)}</AppText>
          <AppText variant="foot" tone="secondary">{look.timer}</AppText>
          <AppText variant="title" style={{ textAlign: 'center' }}>{inc.title}</AppText>
          {inc.details ? <AppText variant="sub" tone="secondary" style={{ textAlign: 'center' }}>{inc.details}</AppText> : null}
        </Card>

        {open && !inc.quiet && escalation.length ? (
          <Section title="Escalation" action={next ? <AppText variant="foot" tone="orange">{`Next at ${formatClock(next.at, tz)}`}</AppText> : undefined}>
            <Card style={{ padding: Spacing.three, gap: Spacing.two }}>
              {escalation.filter((s) => s.state !== 'skipped').map((s, n) => (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
                  <View style={[styles.dot, { backgroundColor: s.state === 'done' ? c.tint : 'transparent', borderColor: s.state === 'next' ? c.orange : s.state === 'done' ? c.tint : c.label3 }]}>
                    {s.state === 'done' ? <Check size={10} color={c.onPrimary} /> : null}
                  </View>
                  <AppText variant="foot" tone={s.state === 'next' ? 'orange' : 'secondary'} style={{ width: 64, fontFamily: Fonts.mono }}>{formatClock(s.at, tz)}</AppText>
                  <AppText variant="sub" tone={s.state === 'later' ? 'secondary' : 'neutral'} style={{ flex: 1 }}>{s.label}</AppText>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={open ? 'Ringing now' : 'People'}>
          <Card>
            {people.map((p, n) => (
              <View key={p.id} style={[styles.person, n < people.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
                <Avatar initials={p.initials} />
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">{p.label}</AppText>
                  <AppText variant="foot" tone="secondary">{p.role}</AppText>
                </View>
                <Pill label={p.status} tone={p.status === 'Has it' ? 'green' : p.status === 'Ringing' ? 'orange' : 'neutral'} />
              </View>
            ))}
          </Card>
        </Section>

        {facts.length ? (
          <Section title="Summary">
            <Card>
              {facts.map(([label, value], n) => (
                <View key={label} style={[styles.fact, n < facts.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
                  <AppText variant="sub" tone="secondary">{label}</AppText>
                  <AppText variant="sub" style={{ fontFamily: Fonts.medium }}>{value}</AppText>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}
      </ScrollView>

      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.three, borderTopColor: c.sep }]}>
        {open && responder ? (
          <>
            <SlideToAcknowledge label="Slide to acknowledge" onAcknowledge={() => actions.acknowledge(inc.id)} disabled={actions.pending} />
            <View style={{ flexDirection: 'row', gap: Spacing.two }}>
              {backup ? <Button label="Pass to backup" variant="secondary" icon={<Repeat size={18} color={c.label} />} onPress={passToBackup} style={{ flex: 1 }} /> : null}
              <Button label="Open Slack" variant="secondary" icon={<MessageSquare size={18} color={c.label} />} onPress={() => openSlack(team.slackChannelName)} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            {responder && inc.status === 'acknowledged' && inc.ackedBy?.id === meId ? (
              <Button label="Resolve" icon={<Check size={18} color={c.onPrimary} />} onPress={() => actions.resolve(inc)} />
            ) : null}
            <Button label="Open incident and add a note" variant={inc.status === 'acknowledged' && inc.ackedBy?.id === meId ? 'secondary' : 'primary'}
              onPress={() => router.replace(`/incident/${inc.id}`)} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  hero: { alignItems: 'center', gap: Spacing.two, padding: Spacing.five },
  timer: { fontFamily: Fonts.mono, fontSize: 56, lineHeight: 64, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  fact: { flexDirection: 'row', justifyContent: 'space-between', padding: Spacing.three },
  controls: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
