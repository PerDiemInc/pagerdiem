// Schedule: the next 12 weekends. Your weekends can be swapped, left or offered for cover; anyone
// else's can be taken, or joined when it needs cover.
import { useRouter } from 'expo-router';
import { CalendarPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText, Avatar, Card, ListRow, Loading, Pill, RoundButton, Screen, Section, Segmented } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useChange, useMe, useSchedule } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import type { Weekend } from '@/lib/api';
import { addToCalendar } from '@/lib/links';
import { firstName, joinWords, namesWithYou } from '@/lib/names';
import { dateTile, formatMonth, formatRange, formatShiftHours } from '@/lib/time';

export default function Schedule() {
  const c = useTheme();
  const router = useRouter();
  const me = useMe();
  const schedule = useSchedule();
  const { change } = useChange();
  const now = useNow(60_000);
  const [onlyMine, setOnlyMine] = useState(false);
  if (!me.data || !schedule.data) return <Loading error={me.error ?? schedule.error} onRetry={() => { me.refetch(); schedule.refetch(); }} />;

  const { coverage, weekends } = schedule.data;
  const meId = me.data.user.id;
  const tz = me.data.team.timezone;
  const channel = `#${me.data.team.slackChannelName}`;
  const range = (w: Weekend) => formatRange(w.start, w.end, tz);
  const running = (w: Weekend) => new Date(w.start) <= now && now < new Date(w.end);
  const shown = weekends.filter((w) => !onlyMine || w.mine);
  const months = [...new Set(shown.map((w) => formatMonth(w.start, tz)))].map((title) => ({ title, weekends: shown.filter((w) => formatMonth(w.start, tz) === title) }));
  const post = (w: Weekend, action: string, body?: unknown) => change(`/api/app/weekends/${w.key}/${action}`, body);

  function leave(w: Weekend) {
    const others = w.people.filter((p) => p.id !== meId);
    const after = others.length
      ? `${joinWords(others.map((p) => p.name))} will be on their own and the weekend shows as needing cover.`
      : 'Nobody will be on call and the weekend shows as needing cover.';
    Alert.alert(`Leave ${range(w)}?`, `${after} ${channel} is told.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => { post(w, 'leave'); } },
    ]);
  }

  function open(w: Weekend) {
    const findCover = { text: 'Find cover', onPress: () => { post(w, 'ask-cover'); } };
    if (w.mine) {
      // A weekend that has started can only be handed on, not swapped or left.
      const buttons = running(w) ? [findCover] : [
        { text: 'Swap…', onPress: () => router.push(`/swap/${w.key}`) },
        findCover,
        { text: 'Leave weekend', style: 'destructive' as const, onPress: () => leave(w) },
      ];
      Alert.alert(range(w), namesWithYou(w.people, meId), [...buttons, { text: 'Cancel', style: 'cancel' }]);
      return;
    }
    const buttons = w.people.length < w.count
      ? [{ text: 'Take this weekend', onPress: () => { post(w, 'join'); } }]
      : w.people.map((p) => ({ text: `Take ${firstName(p)}’s spot`, onPress: () => { post(w, 'swap', { userId: p.id }); } }));
    Alert.alert(range(w), w.people.length ? joinWords(w.people.map((p) => p.name)) : 'Nobody yet', [...buttons, { text: 'Cancel', style: 'cancel' }]);
  }

  return (
    <Screen
      kicker={`${formatShiftHours(coverage)} · ${coverage.weekendCount} ${coverage.weekendCount === 1 ? 'person' : 'people'}`} title="Schedule"
      right={<RoundButton label="Add to your calendar" Icon={CalendarPlus} onPress={() => addToCalendar(me.data!.calendarFeedUrl)} />}
      refreshing={schedule.isRefetching} onRefresh={() => schedule.refetch()}>
      <Segmented<'all' | 'mine'> value={onlyMine ? 'mine' : 'all'} onChange={(v) => setOnlyMine(v === 'mine')}
        options={[{ value: 'all', label: 'All weekends' }, { value: 'mine', label: 'Only mine' }]} />
      {months.map((m) => (
        <Section key={m.title} title={m.title}>
          <Card>
            {m.weekends.map((w, n) => {
              const tile = dateTile(w.start, tz);
              const short = w.people.length < w.count;
              const live = running(w);
              const pill = live ? 'Now' : short ? 'Needs cover' : w.mine ? 'You' : null;
              return (
                <ListRow
                    key={w.key} last={n === m.weekends.length - 1} onPress={() => open(w)}
                    label={`${range(w)}, ${w.people.length ? namesWithYou(w.people, meId) : 'Nobody yet'}`}
                    title={w.people.length ? namesWithYou(w.people, meId) : 'Nobody yet'}
                    subtitle={`${range(w)}${live ? ' · now' : ''}${short ? ` · needs ${w.count - w.people.length} more` : ''}`}
                    left={
                      <View style={{ width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: w.mine ? c.tintSoft : c.fill }}>
                        <AppText variant="foot" tone={w.mine ? 'tint' : 'secondary'} style={{ fontSize: 11, lineHeight: 13 }}>{tile.dow}</AppText>
                        <AppText variant="headline" tone={w.mine ? 'tint' : 'neutral'}>{tile.day}</AppText>
                      </View>
                    }
                    right={pill ? <Pill label={pill} tone={live ? 'green' : short ? 'orange' : 'tint'} /> : <View style={{ flexDirection: 'row' }}>{w.people.map((p) => <Avatar key={p.id} initials={p.initials} size={28} />)}</View>}
                  />
              );
            })}
          </Card>
        </Section>
      ))}
      <AppText variant="foot" tone="secondary" style={{ paddingHorizontal: Spacing.one }}>Tap one of your weekends to swap it, leave it or find cover.</AppText>
    </Screen>
  );
}
