// Incidents: what needs you now, then what happened before. Swipe a row (or long-press it) to
// acknowledge or resolve.
import { useRouter } from 'expo-router';
import { Check, Plus, Search, TriangleAlert, UserCheck } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { SwipeRow, type RowAction } from '@/components/swipe-row';
import { AppText, Button, Card, EmptyState, Loading, RoundButton, Screen, Section, Segmented, Tile } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useIncidentActions, useIncidents, useMe } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import type { IncidentSummary } from '@/lib/api';
import { sourceName } from '@/lib/names';
import { formatAckIn, formatClock, formatDate } from '@/lib/time';

type Tab = 'active' | 'resolved' | 'all';
const PAGE = 20;

export default function Incidents() {
  const c = useTheme();
  const router = useRouter();
  const me = useMe();
  const list = useIncidents();
  const { acknowledge, resolve } = useIncidentActions();
  const now = useNow(60_000);
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  if (!me.data || !list.data) return <Loading error={me.error ?? list.error} onRetry={() => { me.refetch(); list.refetch(); }} />;

  const meId = me.data.user.id;
  const tz = me.data.team.timezone;
  const responder = me.data.user.role !== 'non_technical';
  const all = list.data.incidents;
  const count = (status: IncidentSummary['status']) => all.filter((i) => i.status === status).length;
  const needle = query.trim().toLowerCase();
  const inTab = all.filter((i) => tab === 'all' || (tab === 'active') === (i.status !== 'resolved'));
  const matches = needle ? inTab.filter((i) => i.title.toLowerCase().includes(needle)) : inTab;
  const shown = showAll || needle ? matches : matches.slice(0, PAGE);
  const active = shown.filter((i) => i.status !== 'resolved');
  const earlier = shown.filter((i) => i.status === 'resolved');

  function line(i: IncidentSummary) {
    const who = i.ackedBy?.id === meId ? 'You' : i.ackedBy?.name;
    if (i.status === 'open') return i.quiet ? `Posted · ${sourceName(i.source)}` : `Paging · ${sourceName(i.source)}${i.createdBy ? ` · ${i.createdBy.name}` : ''}`;
    if (i.status === 'acknowledged') return `${who} ${who === 'You' ? 'have' : 'has'} it · ${sourceName(i.source)}`;
    if (who && i.ackedAt) return `${who} ${formatAckIn(new Date(i.ackedAt).getTime() - new Date(i.createdAt).getTime()).replace('Acknowledged', 'acknowledged')}`;
    return 'Resolved';
  }

  function row(i: IncidentSummary, n: number, rows: IncidentSummary[]) {
    const actions: RowAction[] = [];
    if (responder && i.status === 'open') actions.push({ label: 'Acknowledge', tone: 'orange', onPress: () => acknowledge(i.id) });
    if (responder && i.status !== 'resolved') actions.push({ label: 'Resolve', tone: 'green', onPress: () => resolve(i) });
    const look = { open: [TriangleAlert, c.redSoft, c.redText], acknowledged: [UserCheck, c.orangeSoft, c.orangeText], resolved: [Check, c.greenSoft, c.greenText] }[i.status] as [typeof Check, string, string];
    const today = formatDate(i.createdAt, tz) === formatDate(now.toISOString(), tz);
    return (
      <View key={i.id} style={n < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }}>
        <SwipeRow title={i.title} actions={actions} onPress={() => router.push(`/incident/${i.id}`)}>
          <View style={styles.row}>
            <Tile Icon={look[0]} bg={look[1]} fg={look[2]} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="headline" numberOfLines={2}>{i.title}</AppText>
              <AppText variant="foot" tone="secondary" numberOfLines={1}>{line(i)}</AppText>
            </View>
            <View style={{ alignItems: 'flex-end', gap: Spacing.one }}>
              <AppText variant="foot" tone="secondary">{today ? formatClock(i.createdAt, tz) : formatDate(i.createdAt, tz)}</AppText>
              {i.status === 'open' ? <View style={[styles.live, { backgroundColor: c.red }]} /> : null}
            </View>
          </View>
        </SwipeRow>
      </View>
    );
  }

  return (
    <Screen
      kicker={all.length ? `${count('open')} open · ${count('acknowledged')} acknowledged` : 'Nothing yet'} title="Incidents"
      right={<RoundButton label="Page on-call" Icon={Plus} onPress={() => router.push('/compose')} />}
      refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      {all.length ? (
        <>
          <View style={[styles.search, { backgroundColor: c.fill }]}>
            <Search size={18} color={c.label2} />
            <TextInput accessibilityLabel="Search incidents" placeholder="Search" placeholderTextColor={c.label3} value={query} onChangeText={setQuery}
              returnKeyType="search" clearButtonMode="while-editing" style={[styles.searchInput, { color: c.label }]} />
          </View>
          <Segmented<Tab> value={tab} onChange={(t) => { setTab(t); setShowAll(false); }}
            options={[{ value: 'active', label: 'Active' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }]} />
          {active.length ? (
            <Section title="Needs you">
              <Card>{active.map((i, n) => row(i, n, active))}</Card>
              {responder ? <AppText variant="foot" tone="secondary" style={{ paddingHorizontal: Spacing.one }}>Swipe left on an incident to acknowledge or resolve it.</AppText> : null}
            </Section>
          ) : null}
          {earlier.length ? (
            <Section title={tab === 'resolved' ? 'Resolved' : 'Earlier'}>
              <Card>{earlier.map((i, n) => row(i, n, earlier))}</Card>
            </Section>
          ) : null}
          {!shown.length ? (
            <EmptyState title={needle ? 'No results' : 'All clear'} text={needle ? `No incidents match “${query.trim()}”.` : 'Nothing needs you right now.'} />
          ) : null}
          {matches.length > shown.length ? <Button label={`Show ${matches.length - shown.length} more`} variant="ghost" onPress={() => setShowAll(true)} /> : null}
        </>
      ) : (
        <EmptyState
          title="No incidents yet"
          text="When someone pages on-call from here, Slack or an alert, it shows up with who it reached and how fast they picked it up."
          action={<Button label="Page on-call" variant="secondary" onPress={() => router.push('/compose')} style={{ marginTop: Spacing.three }} />} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  live: { width: 8, height: 8, borderRadius: 4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.md, paddingHorizontal: Spacing.three, minHeight: 44 },
  searchInput: { flex: 1, fontFamily: Fonts.regular, fontSize: 16, paddingVertical: Spacing.two },
});
