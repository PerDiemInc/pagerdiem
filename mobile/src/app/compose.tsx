// Page on-call: say what's broken, choose how loud, send. Calling takes a one-second hold so a
// stray tap never wakes anyone; posting only (D10) is a plain tap.
import { useRouter } from 'expo-router';
import { Check, MessageSquare, Megaphone, Phone, PhoneOutgoing, Plus, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HoldButton } from '@/components/hold-button';
import { AppText, Button, Field, Loading, SheetHeader } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useAction, useHome, useIncident, useIncidents, useMe } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import type { IncidentSummary, Person } from '@/lib/api';
import { firstName, joinWords } from '@/lib/names';
import { formatTimer } from '@/lib/time';

type Mode = 'call' | 'post';
type Sent = { incident: IncidentSummary; paged: Person[]; mode: Mode; at: number };

export default function Compose() {
  const c = useTheme();
  const router = useRouter();
  // Opened from a link there may be nothing behind this screen; then close to On call.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const insets = useSafeAreaInsets();
  const me = useMe();
  const home = useHome();
  const recent = useIncidents();
  const { act, pending } = useAction();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  if (!me.data || !home.data) return <Loading error={me.error ?? home.error} onRetry={() => { me.refetch(); home.refetch(); }} />;

  const channel = `#${me.data.team.slackChannelName}`;
  const onCall = home.data.onCall?.people ?? [];
  const others = onCall.filter((p) => p.id !== me.data.user.id);
  const targets = others.length ? others : onCall; // whoever pages skips themselves, unless they're the only one (D11)
  const how: Mode = mode ?? (targets.length ? 'call' : 'post');
  const blocked = !title.trim() || pending;

  async function send() {
    const result = await act<{ incident: IncidentSummary; paged: Person[] }>('/api/app/incidents', { title: title.trim(), details: details.trim(), mode: how });
    if (result) setSent({ ...result, mode: how, at: Date.now() });
  }

  let who = 'Nobody’s phone rings. Anyone can acknowledge it from Slack or the app.';
  if (how === 'call' && targets.length) {
    who = `${joinWords(targets.map((p) => p.name))}’s ${targets.length > 1 ? 'phones ring' : 'phone rings'} now.`;
    if (others.length && others.length < onCall.length) who += ' You’re on call too, so we skip you.';
    if (home.data.onCall?.backup) who += ` ${home.data.onCall.backup.name} is the backup.`;
  } else if (how === 'call') {
    who = `Nobody’s on call, so this posts @here in ${channel}.`;
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SheetHeader title="Page on-call" cancel={sent ? 'Close' : 'Cancel'} onCancel={close} />
      {sent ? (
        <SentState sent={sent} channel={channel} onOpen={() => router.replace(`/incident/${sent.incident.id}`)} onDone={close} />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.five }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: Spacing.three }}>
              <Field label="What’s broken?" placeholder="Checkout failing for all stores" value={title} onChangeText={setTitle} multiline autoFocus />
              {recent.data?.recentTitles.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
                  {recent.data.recentTitles.map((t) => (
                    <Pressable key={t} accessibilityRole="button" onPress={() => setTitle(t)}
                      style={({ pressed }) => [styles.chip, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
                      <AppText variant="foot">{t}</AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {showDetails ? (
                <Field label="Details" placeholder="What you’ve seen and where" value={details} onChangeText={setDetails} multiline />
              ) : (
                <Button label="Add details" variant="ghost" icon={<Plus size={18} color={c.label} />} onPress={() => setShowDetails(true)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
              )}
            </View>
            <View style={{ gap: Spacing.two }}>
              <AppText variant="section" tone="secondary">How loud</AppText>
              <View accessibilityRole="radiogroup" style={{ gap: Spacing.two }}>
                <ModeOption Icon={Phone} title="Call their phones" sub="Rings until someone acknowledges" checked={how === 'call'} onPress={() => setMode('call')} />
                <ModeOption Icon={MessageSquare} title="Post only" sub={`In ${channel}. Nobody gets woken.`} checked={how === 'post'} onPress={() => setMode('post')} />
              </View>
              <AppText variant="foot" tone="secondary">{who}</AppText>
            </View>
          </ScrollView>
          <View style={{ padding: Spacing.four, paddingBottom: insets.bottom + Spacing.four, gap: Spacing.two }}>
            {how === 'call' ? (
              <HoldButton
                label={targets.length ? `Hold to call ${joinWords(targets.map(firstName))}` : `Hold to page ${channel}`}
                hint={targets.length ? `${joinWords(targets.map(firstName))} will be woken, even on Do Not Disturb.` : undefined}
                disabled={blocked} onFire={send} />
            ) : (
              <>
                <Button label={`Post in ${channel}`} icon={<MessageSquare size={18} color={c.onPrimary} />} disabled={blocked} loading={pending} onPress={send} />
                <AppText variant="foot" tone="secondary" style={{ textAlign: 'center' }}>Nobody gets woken up.</AppText>
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function ModeOption({ Icon, title, sub, checked, onPress }: { Icon: LucideIcon; title: string; sub: string; checked: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={`${title}. ${sub}`} accessibilityState={{ checked }} onPress={onPress}
      style={[styles.option, { backgroundColor: c.card, borderColor: checked ? c.label : c.border }]}>
      <View style={[styles.tile, { backgroundColor: checked ? c.tintSoft : c.fill }]}>
        <Icon size={18} color={checked ? c.tintText : c.label2} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{title}</AppText>
        <AppText variant="foot" tone="secondary">{sub}</AppText>
      </View>
      {checked ? <Check size={20} color={c.label} /> : null}
    </Pressable>
  );
}

function SentState({ sent, channel, onOpen, onDone }: { sent: Sent; channel: string; onOpen: () => void; onDone: () => void }) {
  const c = useTheme();
  const now = useNow(1000);
  // Refreshed every 5 s while it's open, so the moment someone picks it up shows here.
  const live = useIncident(sent.incident.id).data?.incident;
  const takenBy = live && live.status !== 'open' ? live.ackedBy : null;
  const calling = sent.paged.length > 0;
  const Icon = calling ? PhoneOutgoing : Megaphone;
  let text = 'We’ll tell you here and in Slack the moment someone acknowledges.';
  if (!calling) text = sent.mode === 'post' ? 'Nobody was called. You’ll see it here when someone picks it up.' : `Nobody’s on call, so we posted @here in ${channel}.`;
  if (takenBy) text = `${takenBy.name} acknowledged. Paging stopped.`;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.five, gap: Spacing.three }}>
      <View style={[styles.sentIcon, { backgroundColor: calling ? c.tintSoft : c.fill }]}>
        <Icon size={32} color={calling ? c.tintText : c.label2} />
      </View>
      <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
        {calling ? `Calling ${joinWords(sent.paged.map((p) => p.name))}` : `Posted in ${channel}`}
      </AppText>
      <AppText variant="sub" tone="secondary" style={{ textAlign: 'center' }}>{text}</AppText>
      {calling && !takenBy ? <AppText variant="mono" tone="tint">{`Ringing · ${formatTimer(now.getTime() - sent.at)}`}</AppText> : null}
      <View style={{ alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.four }}>
        <Button label={`Open incident #${sent.incident.id}`} onPress={onOpen} />
        <Button label="Done" variant="ghost" onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Radius.md, borderWidth: 1.5 },
  tile: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  sentIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
