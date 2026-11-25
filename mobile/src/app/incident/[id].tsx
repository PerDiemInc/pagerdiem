// One incident: who it reached, what happened, what escalation does next, and notes for the team.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronLeft, Clock, Ellipsis, Hand, Hash, Minus, SendHorizontal, Smartphone, MessageSquare } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { AppText, Avatar, Button, Card, EmptyState, Loading, Pill, Segmented, Tile } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAction, useIncident, useIncidentActions, useMe } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import type { EscalationStep, IncidentDetail, Reach } from '@/lib/api';
import { copyLink, openSlack } from '@/lib/links';
import { fromSource } from '@/lib/names';
import { formatAge, formatClock, formatTimer } from '@/lib/time';

type Tab = 'activity' | 'people' | 'plan';

/** The status pill: "Paging · 06:12", "You have it", "Ana Gomez has it", "Resolved in 22 min". */
function statusPill({ incident: i }: IncidentDetail, meId: number, now: Date): { label: string; tone: 'red' | 'orange' | 'green' } {
  const since = (iso: string) => new Date(iso).getTime() - new Date(i.createdAt).getTime();
  if (i.status === 'open') return { label: `Paging · ${formatTimer(now.getTime() - new Date(i.createdAt).getTime())}`, tone: 'red' };
  if (i.status === 'acknowledged') return { label: i.ackedBy?.id === meId ? 'You have it' : `${i.ackedBy?.name ?? 'Someone'} has it`, tone: 'orange' };
  const took = i.resolvedAt ? since(i.resolvedAt) : 0;
  return { label: `Resolved in ${took < 60_000 ? 'under a minute' : formatAge(i.createdAt, new Date(i.resolvedAt ?? i.createdAt))}`, tone: 'green' };
}

export default function IncidentScreen() {
  const c = useTheme();
  const router = useRouter();
  // Opened from a link there may be nothing behind this screen; then close to On call.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const incident = useIncident(Number(id));
  const actions = useIncidentActions();
  const { act, pending: posting } = useAction();
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>('activity');
  const [note, setNote] = useState('');
  if (!me.data || !incident.data) return <Loading error={me.error ?? incident.error} onRetry={() => { me.refetch(); incident.refetch(); }} />;

  const data = incident.data;
  const inc = data.incident;
  const meId = me.data.user.id;
  const tz = me.data.team.timezone;
  const channel = `#${me.data.team.slackChannelName}`;
  const responder = me.data.user.role !== 'non_technical';
  const pill = statusPill(data, meId, now);
  const meta = `#${inc.id} · ${inc.createdBy ? `${inc.createdBy.name} paged` : 'Paged'} ${fromSource(inc.source)} at ${formatClock(inc.createdAt, tz)}${inc.repeats ? ` · came in ${inc.repeats} more ${inc.repeats === 1 ? 'time' : 'times'}` : ''}`;

  function more() {
    const team = me.data!.team;
    Alert.alert(`Incident #${inc.id}`, inc.title, [
      ...(responder && inc.status === 'open' && !inc.quiet ? [
        { text: 'Call everyone again', onPress: () => actions.run(`/api/app/incidents/${inc.id}/call-again`) },
        { text: 'Call the backup now', onPress: () => actions.run(`/api/app/incidents/${inc.id}/call-backup`) },
      ] : []),
      { text: 'Copy link', onPress: () => copyLink(`${team.publicUrl}/incidents/${inc.id}`) },
      { text: 'Open in Slack', onPress: () => openSlack(team.slackChannelName) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function postNote() {
    if (await act(`/api/app/incidents/${inc.id}/notes`, { text: note.trim() })) {
      setNote('');
      toast.show({ text: `Note posted. ${channel} sees it too.` });
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={close} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={c.tintText} />
          <AppText variant="body" tone="tint">Incidents</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="More actions" onPress={more} hitSlop={12}>
          <Ellipsis size={24} color={c.tintText} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: Spacing.two }}>
          <Pill label={pill.label} tone={pill.tone} />
          <AppText variant="largeTitle" accessibilityRole="header">{inc.title}</AppText>
          <AppText variant="foot" tone="secondary">{meta}</AppText>
          {inc.details ? <AppText variant="body">{inc.details}</AppText> : null}
        </View>
        <Responders data={data} meId={meId} channel={channel} onPress={() => setTab('people')} />
        {responder && inc.status !== 'resolved' ? (
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            {inc.status === 'open' ? (
              <Button label="Acknowledge" icon={<Hand size={18} color={c.onPrimary} />} onPress={() => actions.acknowledge(inc.id)} loading={actions.pending} style={{ flex: 1 }} />
            ) : null}
            <Button label="Resolve" variant={inc.status === 'open' ? 'secondary' : 'primary'} icon={<Check size={18} color={inc.status === 'open' ? c.label : c.onPrimary} />}
              onPress={() => actions.resolve(inc)} style={{ flex: 1 }} />
          </View>
        ) : null}
        <Segmented<Tab> value={tab} onChange={setTab}
          options={[{ value: 'activity', label: 'Activity' }, { value: 'people', label: 'Who it reached' }, { value: 'plan', label: 'Escalation' }]} />
        {tab === 'activity' ? <Activity data={data} meId={meId} tz={tz} /> : null}
        {tab === 'people' ? <WhoItReached reached={data.reached} tz={tz} /> : null}
        {tab === 'plan' ? <EscalationSteps steps={data.escalation} tz={tz} /> : null}
      </ScrollView>
      {tab === 'activity' ? (
        <View style={[styles.noteBar, { borderTopColor: c.sep, backgroundColor: c.bg, paddingBottom: insets.bottom + Spacing.two }]}>
          <TextInput accessibilityLabel="Note" placeholder="Add a note for the team" placeholderTextColor={c.label3} value={note} onChangeText={setNote}
            onSubmitEditing={() => note.trim() && postNote()} returnKeyType="send"
            style={[styles.noteInput, { color: c.label, backgroundColor: c.card, borderColor: c.border }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="Post note" accessibilityState={{ disabled: !note.trim() || posting }}
            disabled={!note.trim() || posting} onPress={postNote}
            style={[styles.send, { backgroundColor: c.primary, opacity: note.trim() ? 1 : 0.4 }]}>
            <SendHorizontal size={18} color={c.onPrimary} />
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Responders({ data, meId, channel, onPress }: { data: IncidentDetail; meId: number; channel: string; onPress: () => void }) {
  const c = useTheme();
  const inc = data.incident;
  const status = (id: number) => {
    if (inc.ackedBy?.id === id) return 'Has it';
    // Whoever sent the page isn't rung while someone else is on call (D11).
    if (inc.quiet || (id === inc.createdBy?.id && data.onCall.length > 1)) return 'Not called';
    return inc.status === 'open' ? 'Ringing' : 'Stopped';
  };
  const people = data.onCall.map((p) => ({ key: `p${p.id}`, initials: p.initials, name: p.id === meId ? 'You' : p.name, status: status(p.id) }));
  if (inc.backup && !data.onCall.some((p) => p.id === inc.backup!.id)) {
    const called = inc.escalationLevel >= 1;
    people.push({ key: 'backup', initials: inc.backup.initials, name: inc.backup.name, status: inc.ackedBy?.id === inc.backup.id ? 'Has it' : called ? 'Called' : inc.status === 'open' ? 'Backup' : 'Not needed' });
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
      {people.map((p) => (
        <Pressable key={p.key} accessibilityRole="button" onPress={onPress} style={[styles.chip, { backgroundColor: c.card, borderColor: c.border }]}>
          <Avatar initials={p.initials} size={28} />
          <View>
            <AppText variant="foot" style={{ fontFamily: Fonts.semibold }}>{p.name}</AppText>
            <AppText variant="foot" tone={p.status === 'Has it' ? 'green' : p.status === 'Ringing' ? 'orange' : 'secondary'}>{p.status}</AppText>
          </View>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, { backgroundColor: c.card, borderColor: c.border }]}>
        <Tile Icon={Hash} bg={c.fill} fg={c.label2} />
        <View>
          <AppText variant="foot" style={{ fontFamily: Fonts.semibold }}>{channel}</AppText>
          <AppText variant="foot" tone="green">Posted</AppText>
        </View>
      </Pressable>
    </ScrollView>
  );
}

function Activity({ data, meId, tz }: { data: IncidentDetail; meId: number; tz: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.three }}>
      {data.feed.map((item, n) => {
        if (item.kind === 'event') {
          return (
            <AppText key={n} variant="sub" tone="secondary">
              <AppText variant="sub" style={{ fontFamily: Fonts.mono }} tone="tertiary">{formatClock(item.at, tz)}</AppText>
              {` · ${item.text}`}
            </AppText>
          );
        }
        const mine = item.author?.id === meId;
        return (
          <View key={n} style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: Spacing.one }}>
            <AppText variant="foot" tone="secondary">{`${mine ? 'You' : item.author?.name ?? 'Someone'} · ${formatClock(item.at, tz)}`}</AppText>
            <View style={[styles.bubble, { backgroundColor: mine ? c.tintSoft : c.card, borderColor: mine ? 'transparent' : c.border }]}>
              <AppText variant="body">{item.text}</AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function WhoItReached({ reached, tz }: { reached: Reach[]; tz: string }) {
  const c = useTheme();
  if (!reached.length) return <EmptyState title="Nobody reached yet" text="Calls, Slack DMs and the channel post show up here as they go out." />;
  const byRecipient = new Map<string, Reach[]>();
  for (const r of reached) byRecipient.set(r.recipient, [...(byRecipient.get(r.recipient) ?? []), r]);
  const statusText = { sent: 'Sent', failed: 'Failed', 'dry-run': 'Not sent (no keys set up)' };
  return (
    <Card>
      {[...byRecipient].map(([recipient, items], n, rows) => (
        <View key={recipient} style={[styles.reach, n < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
          <AppText variant="headline">{recipient}</AppText>
          {items.map((r, k) => {
            const Icon = r.channel === 'push' ? Smartphone : MessageSquare;
            const kind = r.channel === 'push' ? 'Phone call' : recipient.startsWith('#') ? 'Channel post' : 'Slack DM';
            return (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <Icon size={16} color={c.label2} />
                <AppText variant="foot" tone={r.status === 'failed' ? 'red' : 'secondary'} style={{ flex: 1 }}>{`${kind} · ${statusText[r.status]}`}</AppText>
                <AppText variant="foot" tone="tertiary">{formatClock(r.at, tz)}</AppText>
              </View>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

function EscalationSteps({ steps, tz }: { steps: EscalationStep[]; tz: string }) {
  const c = useTheme();
  const look = {
    done: { Icon: Check, bg: c.tintSoft, fg: c.tintText, note: '' },
    next: { Icon: Clock, bg: c.orangeSoft, fg: c.orangeText, note: 'Next' },
    later: { Icon: Clock, bg: c.fill, fg: c.label2, note: '' },
    skipped: { Icon: Minus, bg: c.fill, fg: c.label3, note: 'Skipped' },
  };
  return (
    <Card>
      {steps.map((s, n) => {
        const l = look[s.state];
        return (
          <View key={n} accessible accessibilityLabel={`${s.label}: ${s.state}`}
            style={[styles.step, n < steps.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
            <Tile Icon={l.Icon} bg={l.bg} fg={l.fg} />
            <View style={{ flex: 1 }}>
              <AppText variant="body" tone={s.state === 'skipped' ? 'tertiary' : 'neutral'}>{s.label}</AppText>
              {l.note ? <AppText variant="foot" tone={s.state === 'next' ? 'orange' : 'tertiary'}>{l.note}</AppText> : null}
            </View>
            <AppText variant="foot" tone={s.state === 'next' ? 'orange' : 'secondary'}>{formatClock(s.at, tz)}</AppText>
          </View>
        );
      })}
    </Card>
  );
}


const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  back: { flexDirection: 'row', alignItems: 'center', marginLeft: -4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  bubble: { maxWidth: '85%', borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  reach: { padding: Spacing.four, gap: Spacing.two },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  noteBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  noteInput: { flex: 1, minHeight: 44, borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: Spacing.four, fontFamily: Fonts.regular, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
