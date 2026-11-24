// Swap one of your weekends: pick someone on another weekend. They take yours and you take theirs.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, EmptyState, Loading, SheetHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useChange, useMe, useSchedule } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { formatRange } from '@/lib/time';

export default function Swap() {
  const c = useTheme();
  const router = useRouter();
  // Opened from a link there may be nothing behind this screen; then close to On call.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const { key } = useLocalSearchParams<{ key: string }>();
  const me = useMe();
  const schedule = useSchedule();
  const { change, pending } = useChange();
  if (!me.data || !schedule.data) return <Loading error={me.error ?? schedule.error} onRetry={() => schedule.refetch()} />;

  const tz = me.data.team.timezone;
  const mine = schedule.data.weekends.find((w) => w.key === key);
  const others = schedule.data.weekends.filter((w) => w.key !== key && !w.mine && new Date(w.start) > new Date());
  const choices = others.flatMap((w) => w.people.map((p) => ({ weekend: w, person: p, range: formatRange(w.start, w.end, tz) })));

  async function trade(theirKey: string, userId: number) {
    if (await change(`/api/app/weekends/${key}/trade`, { theirKey, userId })) close();
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SheetHeader title={mine ? `Swap ${formatRange(mine.start, mine.end, tz)}` : 'Swap'} cancel="Cancel" onCancel={close} />
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
        <AppText variant="sub" tone="secondary">They take your weekend and you take theirs. You both get a Slack DM.</AppText>
        {choices.length ? (
          <Card>
            {choices.map(({ weekend, person, range }, n) => (
              <Pressable key={`${weekend.key}-${person.id}`} accessibilityRole="button" accessibilityLabel={`${person.name}, on call ${range}`}
                disabled={pending} onPress={() => trade(weekend.key, person.id)}
                style={({ pressed }) => [styles.row, n < choices.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }, pressed && { backgroundColor: c.fill }]}>
                <Avatar initials={person.initials} />
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">{person.name}</AppText>
                  <AppText variant="foot" tone="secondary">{`On call ${range}`}</AppText>
                </View>
              </Pressable>
            ))}
          </Card>
        ) : (
          <EmptyState title="Nobody to swap with" text="No one else has a weekend coming up yet." />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
});
