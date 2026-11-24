// On call: who's on call now, what needs you, and the weekends coming up.
import { useRouter } from 'expo-router';
import {
  Bell, CalendarPlus, ChevronRight, CircleCheck, Hand, MessageSquare, Moon, Plus, ShieldCheck, TriangleAlert, UserCheck, Users, type LucideIcon,
} from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { toast } from '@/components/toast';
import { AppText, Avatar, Button, Card, ListRow, Loading, RoundButton, Screen, Section, Tile } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useAction, useHome, useIncidentActions, useMe } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import type { Home, IncidentSummary, Me } from '@/lib/api';
import { namesWithYou } from '@/lib/names';
import { dateTile, formatAge, formatDate, formatDay, formatDayClock, formatLeft, formatRange } from '@/lib/time';

type Hero = { kicker: string; tone: 'green' | 'orange' | 'secondary'; big: string; sub: string; ring: string; done: number; Icon: LucideIcon };

export default function OnCall() {
  const router = useRouter();
  const me = useMe();
  const home = useHome();
  const now = useNow(60_000);
  if (!me.data || !home.data) {
    return <Loading error={me.error ?? home.error} onRetry={() => { me.refetch(); home.refetch(); }} />;
  }
  return (
    <Screen
      kicker={formatDay(now.toISOString(), me.data.team.timezone)} title="On call"
      right={<RoundButton label="Page on-call" Icon={Plus} onPress={() => router.push('/compose')} />}
      refreshing={home.isRefetching} onRefresh={() => { home.refetch(); me.refetch(); }}>
      <HeroCard me={me.data} home={home.data} now={now} />
      <NeedsYou me={me.data} home={home.data} now={now} />
      <ComingUp me={me.data} home={home.data} />
    </Screen>
  );
}

function heroFor(me: Me, { onCall, next, comingUp }: Home, now: Date, c: ReturnType<typeof useTheme>): Hero {
  const tz = me.team.timezone;
  if (onCall) {
    const elapsed = (now.getTime() - new Date(onCall.start).getTime()) / (new Date(onCall.until).getTime() - new Date(onCall.start).getTime());
    const done = Math.min(1, Math.max(0, elapsed));
    const until = formatDayClock(onCall.until, tz);
    if (onCall.people.some((p) => p.id === me.user.id)) {
      const others = onCall.people.filter((p) => p.id !== me.user.id);
      const withWhom = others.length === 1 ? others[0].name : namesWithYou(others, me.user.id);
      return { kicker: 'You’re on call', tone: 'green', big: formatLeft(onCall.until, now), sub: others.length ? `With ${withWhom} until ${until}` : `Until ${until}`, ring: c.tint, done, Icon: Bell };
    }
    const mine = comingUp.find((w) => w.mine);
    return {
      kicker: 'On call now', tone: 'green', big: namesWithYou(onCall.people, me.user.id),
      sub: `Until ${until}.${mine ? ` You’re next on ${formatDate(mine.start, tz)}.` : ''}`, ring: c.label3, done, Icon: Users,
    };
  }
  if (next && new Date(next.start) <= now && now < new Date(next.end)) {
    return { kicker: 'Needs cover', tone: 'orange', big: 'Nobody’s on call', sub: `This weekend needs ${next.count} ${next.count === 1 ? 'person' : 'people'}.`, ring: c.orange, done: 0, Icon: TriangleAlert };
  }
  return {
    kicker: 'Weekday', tone: 'secondary', big: 'Pages go to Slack',
    sub: `@here in #${me.team.slackChannelName}.${next ? ` The weekend starts ${formatDayClock(next.start, tz)}.` : ''}`, ring: c.label3, done: 0, Icon: MessageSquare,
  };
}

function HeroCard({ me, home, now }: { me: Me; home: Home; now: Date }) {
  const c = useTheme();
  const router = useRouter();
  const { act, pending } = useAction();
  const hero = heroFor(me, home, now, c);
  const nobody = hero.kicker === 'Needs cover';
  const ios = me.device.platform === 'ios';
  const silence = ios ? 'Focus' : 'Do Not Disturb';
  const r = 32;
  const length = 2 * Math.PI * r;

  async function take() {
    if (home.next && (await act(`/api/app/weekends/${home.next.key}/join`))) toast.show({ text: 'You’re on call this weekend.' });
  }

  return (
    <Card style={{ padding: Spacing.four, gap: Spacing.four }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.four }}>
        <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={76} height={76} style={StyleSheet.absoluteFill}>
            <Circle cx={38} cy={38} r={r} stroke={c.fill} strokeWidth={6} fill="none" />
            {hero.done > 0 ? (
              <Circle cx={38} cy={38} r={r} stroke={hero.ring} strokeWidth={6} fill="none" strokeLinecap="round"
                strokeDasharray={`${length * hero.done} ${length}`} transform="rotate(-90 38 38)" />
            ) : null}
          </Svg>
          <hero.Icon size={26} color={nobody ? c.orangeText : c.label} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="foot" tone={hero.tone}>{hero.kicker}</AppText>
          <AppText variant="title">{hero.big}</AppText>
          <AppText variant="sub" tone="secondary">{hero.sub}</AppText>
        </View>
      </View>
      {nobody ? (
        <>
          <View style={{ gap: Spacing.two }}>
            <AppText variant="section" tone="secondary">If something breaks</AppText>
            <PlanStep when="Now" text={`@here in #${me.team.slackChannelName}`} />
            <PlanStep when="Then" text={`Reminders in #${me.team.slackChannelName} until someone picks it up`} />
          </View>
          <Button label="Take this weekend" variant="secondary" icon={<CalendarPlus size={18} color={c.label} />} onPress={take} loading={pending} />
        </>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => router.push(me.device.checks.focus ? '/you' : '/setup')}
          style={({ pressed }) => [styles.reach, { borderTopColor: c.sep, opacity: pressed ? 0.7 : 1 }]}>
          {me.device.checks.focus ? (
            <>
              <Tile Icon={ShieldCheck} bg={c.greenSoft} fg={c.greenText} />
              <View style={{ flex: 1 }}>
                <AppText variant="headline">We can wake you</AppText>
                <AppText variant="foot" tone="secondary">
                  {`Calls on · rings through ${silence} · ${me.device.testedAt ? `tested ${formatDate(me.device.testedAt, me.team.timezone)}` : 'not tested yet'}`}
                </AppText>
              </View>
              <CircleCheck size={20} color={c.greenText} />
            </>
          ) : (
            <>
              <Tile Icon={Moon} bg={c.orangeSoft} fg={c.orangeText} />
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{`${silence} may silence calls`}</AppText>
                <AppText variant="foot" tone="secondary">{ios ? 'Sleep Focus doesn’t allow PagerDiem yet' : 'Do Not Disturb doesn’t allow PagerDiem yet'}</AppText>
              </View>
              <ChevronRight size={18} color={c.label3} />
            </>
          )}
        </Pressable>
      )}
    </Card>
  );
}

function NeedsYou({ me, home, now }: { me: Me; home: Home; now: Date }) {
  const c = useTheme();
  const router = useRouter();
  const open = home.needsYou.filter((i) => i.status === 'open');
  const taken = home.needsYou.filter((i) => i.status === 'acknowledged');
  return (
    <Section title="Needs you" action={<LinkText label="See all" onPress={() => router.push('/incidents')} />}>
      {open.map((i) => <PagingCard key={i.id} incident={i} me={me} home={home} now={now} />)}
      {taken.length ? (
        <Card>
          {taken.map((i, n) => (
            <ListRow key={i.id} last={n === taken.length - 1} title={i.title} onPress={() => router.push(`/incident/${i.id}`)}
              subtitle={i.ackedBy?.id === me.user.id ? 'You have it · paging stopped' : `${i.ackedBy?.name ?? 'Someone'} has it · ${formatAge(i.createdAt, now)}`}
              left={<Tile Icon={UserCheck} bg={c.orangeSoft} fg={c.orangeText} />} />
          ))}
        </Card>
      ) : null}
      {!open.length && !taken.length ? (
        <Card>
          <ListRow title="All quiet" subtitle="No open incidents." left={<Tile Icon={CircleCheck} bg={c.greenSoft} fg={c.greenText} />} last />
        </Card>
      ) : null}
    </Section>
  );
}

function PagingCard({ incident, me, home, now }: { incident: IncidentSummary; me: Me; home: Home; now: Date }) {
  const c = useTheme();
  const router = useRouter();
  const { acknowledge, pending } = useIncidentActions();
  const onCall = home.onCall?.people ?? [];
  // Whoever pages skips themselves when someone else is on call too (D11).
  const ringsMe = onCall.some((p) => p.id === me.user.id) && !(incident.createdBy?.id === me.user.id && onCall.length > 1);
  const kicker = incident.quiet ? 'Posted' : ringsMe ? 'Paging you' : 'Paging';

  return (
    <Card style={{ padding: Spacing.four, gap: Spacing.three, borderColor: c.red }}>
      <Pressable accessibilityRole="button" accessibilityLabel={incident.title} onPress={() => router.push(`/page/${incident.id}`)}
        style={{ flexDirection: 'row', gap: Spacing.three, alignItems: 'center' }}>
        <Tile Icon={Bell} bg={c.redSoft} fg={c.redText} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="foot" tone="red">{`${kicker} · ${formatAge(incident.createdAt, now)}`}</AppText>
          <AppText variant="headline">{incident.title}</AppText>
          <AppText variant="foot" tone="secondary">
            {incident.quiet ? `Posted in #${me.team.slackChannelName}. Nobody was called.` : 'Rings until someone acknowledges.'}
          </AppText>
        </View>
        <ChevronRight size={18} color={c.label3} />
      </Pressable>
      {me.user.role !== 'non_technical' ? (
        <Button label="Acknowledge" variant="destructive" icon={<Hand size={18} color="#FFFFFF" />} onPress={() => acknowledge(incident.id)} loading={pending} />
      ) : null}
    </Card>
  );
}

function ComingUp({ me, home }: { me: Me; home: Home }) {
  const router = useRouter();
  const c = useTheme();
  const tz = me.team.timezone;
  if (!home.comingUp.length) return null;
  return (
    <Section title="Coming up" action={<LinkText label="Schedule" onPress={() => router.push('/schedule')} />}>
      <Card>
        {home.comingUp.map((w, n) => {
          const tile = dateTile(w.start, tz);
          return (
            <ListRow
              key={w.key} last={n === home.comingUp.length - 1} onPress={() => router.push('/schedule')} chevron={false}
              title={w.people.length ? namesWithYou(w.people, me.user.id) : 'Nobody yet'}
              subtitle={`${formatRange(w.start, w.end, tz)}${w.needsCover ? ' · needs cover' : ''}`}
              left={
                <View style={[styles.dateTile, { backgroundColor: w.mine ? c.tintSoft : c.fill }]}>
                  <AppText variant="foot" tone={w.mine ? 'tint' : 'secondary'} style={{ fontSize: 11, lineHeight: 13 }}>{tile.dow}</AppText>
                  <AppText variant="headline" tone={w.mine ? 'tint' : 'neutral'}>{tile.day}</AppText>
                </View>
              }
              right={<View style={{ flexDirection: 'row' }}>{w.people.map((p) => <Avatar key={p.id} initials={p.initials} size={28} />)}</View>}
            />
          );
        })}
      </Card>
    </Section>
  );
}

function PlanStep({ when, text }: { when: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.three }}>
      <AppText variant="mono" tone="secondary" style={{ width: 44 }}>{when}</AppText>
      <AppText variant="sub" style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}

function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={12}>
      <AppText variant="sub" tone="tint">{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reach: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.four, borderTopWidth: StyleSheet.hairlineWidth },
  dateTile: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
