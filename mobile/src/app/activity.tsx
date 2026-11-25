// Activity: every change to the rotation, the team and settings, and where it was made.
import { useRouter } from 'expo-router';
import {
  ArrowLeftRight, Check, CircleCheck, Megaphone, Phone, Settings, Shield, UserPlus, UserX, type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, EmptyState, Loading, Screen, Section, Segmented, Tile } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useActivity, useMe } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import type { ActivityItem } from '@/lib/api';
import { formatClock, formatDayLabel } from '@/lib/time';

type Kind = 'all' | 'rotation' | 'admin' | 'pages';
const KIND: Record<ActivityItem['icon'], Exclude<Kind, 'all'>> = {
  join: 'rotation', leave: 'rotation', swap: 'rotation', cover: 'rotation', team: 'admin', settings: 'admin', ack: 'pages', resolve: 'pages', test: 'pages',
};
const WHERE = { slack: 'in Slack', app: 'in the app', web: 'on the web', api: 'from the API' };

export default function Activity() {
  const c = useTheme();
  const router = useRouter();
  // Opened from a link there may be nothing behind this screen; then close to On call.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const me = useMe();
  const activity = useActivity();
  const [kind, setKind] = useState<Kind>('all');
  if (!me.data || !activity.data) return <Loading error={me.error ?? activity.error} onRetry={() => activity.refetch()} />;

  const tz = me.data.team.timezone;
  const look: Record<ActivityItem['icon'], [LucideIcon, string, string]> = {
    ack: [Check, c.greenSoft, c.greenText], resolve: [CircleCheck, c.greenSoft, c.greenText], test: [Phone, c.tintSoft, c.tintText],
    join: [UserPlus, c.tintSoft, c.tintText], leave: [UserX, c.redSoft, c.redText], swap: [ArrowLeftRight, c.tintSoft, c.tintText],
    cover: [Megaphone, c.orangeSoft, c.orangeText], team: [Shield, c.tintSoft, c.tintText], settings: [Settings, c.fill, c.label2],
  };
  const items = activity.data.items.filter((i) => kind === 'all' || KIND[i.icon] === kind);
  const days = [...new Set(items.map((i) => formatDayLabel(i.at, tz)))].map((label) => ({ label, items: items.filter((i) => formatDayLabel(i.at, tz) === label) }));

  return (
    <Screen kicker="Every change to the rotation, the team and settings." title="Activity" onBack={close}
      refreshing={activity.isRefetching} onRefresh={() => activity.refetch()}>
      <Segmented<Kind> value={kind} onChange={setKind}
        options={[{ value: 'all', label: 'All' }, { value: 'rotation', label: 'Rotation' }, { value: 'admin', label: 'Admin' }, { value: 'pages', label: 'Pages' }]} />
      {days.map((d) => (
        <Section key={d.label} title={d.label}>
          <Card>
            {d.items.map((item, n) => {
              const [Icon, bg, fg] = look[item.icon];
              return (
                <View key={`${item.at}-${n}`} style={[styles.row, n < d.items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
                  <Tile Icon={Icon} bg={bg} fg={fg} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="sub">{item.text}</AppText>
                    <AppText variant="foot" tone="secondary">{`${formatClock(item.at, tz)}${item.via ? ` · ${WHERE[item.via]}` : ''}`}</AppText>
                  </View>
                </View>
              );
            })}
          </Card>
        </Section>
      ))}
      {!items.length ? <EmptyState title="Nothing yet" text="Changes to the rotation, the team and settings show up here." /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
});
