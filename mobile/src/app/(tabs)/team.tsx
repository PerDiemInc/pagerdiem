// Team: who's in the rotation, in what order, and whether a call can wake each of them. Admins
// manage people from here.
import { Link as LinkIcon, ChevronRight, Smartphone } from 'lucide-react-native';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, EmptyState, Loading, Pill, RoundButton, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useChange, useMe, useTeam } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import type { TeamMember } from '@/lib/api';
import { copyLink } from '@/lib/links';
import { formatDate } from '@/lib/time';

export default function Team() {
  const c = useTheme();
  const me = useMe();
  const team = useTeam();
  const { change } = useChange();
  if (me.data?.user.role === 'non_technical') {
    return <Screen title="Team"><EmptyState title="For engineers and admins" text="The team list has everyone's phone number, so only people who get paged can see it." /></Screen>;
  }
  if (!me.data || !team.data) return <Loading error={me.error ?? team.error} onRetry={() => { me.refetch(); team.refetch(); }} />;

  const admin = me.data.user.role === 'admin';
  const tz = me.data.team.timezone;
  const { members, inactive, signupUrl } = team.data;
  const size = Math.max(1, me.data.coverage.weekendCount);
  const groups = Array.from({ length: Math.ceil(members.length / size) }, (_, i) => members.slice(i * size, i * size + size));
  const wakeable = members.filter((m) => m.app === 'woken').length;
  const reach = {
    woken: { text: 'Has the app · can be woken', dot: c.green },
    'focus-risk': { text: 'Has the app · Focus may silence it', dot: c.orange },
    none: { text: 'Slack only · no app yet', dot: c.label3 },
  };

  function manage(m: TeamMember, inRotation: boolean) {
    const idx = members.findIndex((x) => x.id === m.id);
    const isAdmin = m.role === 'admin';
    const remove = () => Alert.alert(`Remove ${m.name}?`, 'They won’t be on call any more and their future weekends will need cover. They can still sign in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { change(`/api/app/team/${m.id}/active`, { active: false }); } },
    ]);
    Alert.alert(m.name, inRotation ? 'In the rotation' : 'Not in the rotation', [
      ...(inRotation && idx > 0 ? [{ text: 'Move up', onPress: () => { change(`/api/app/team/${m.id}/move`, { dir: -1 }); } }] : []),
      ...(inRotation && idx < members.length - 1 ? [{ text: 'Move down', onPress: () => { change(`/api/app/team/${m.id}/move`, { dir: 1 }); } }] : []),
      { text: isAdmin ? 'Remove admin' : 'Make admin', onPress: () => { change(`/api/app/team/${m.id}/role`, { role: isAdmin ? 'engineer' : 'admin' }); } },
      inRotation
        ? { text: 'Remove from rotation', style: 'destructive' as const, onPress: remove }
        : { text: 'Add to rotation', onPress: () => { change(`/api/app/team/${m.id}/active`, { active: true }); } },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function row(m: TeamMember, n: number, list: TeamMember[], inRotation: boolean) {
    const r = reach[m.app];
    const body = (
      <View style={[styles.row, n < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
        <Avatar initials={m.initials} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <AppText variant="headline">{m.id === me.data!.user.id ? `${m.name} (You)` : m.name}</AppText>
            {m.role === 'admin' ? <Pill label="Admin" tone="tint" /> : null}
          </View>
          {inRotation ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <View style={[styles.dot, { backgroundColor: r.dot }]} />
              <AppText variant="foot" tone="secondary">{r.text}</AppText>
            </View>
          ) : <AppText variant="foot" tone="secondary">Out of the rotation</AppText>}
        </View>
        {admin ? <ChevronRight size={18} color={c.label3} /> : null}
      </View>
    );
    if (!admin) return <View key={m.id}>{body}</View>;
    return (
      <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Manage ${m.name}`} onPress={() => manage(m, inRotation)}
        style={({ pressed }) => pressed && { backgroundColor: c.fill }}>
        {body}
      </Pressable>
    );
  }

  return (
    <Screen
      kicker={`${members.length} in the rotation · ${groups.length} ${size === 2 ? 'pairs' : 'groups'}`} title="Team"
      right={admin ? <RoundButton label="Copy sign-up link" Icon={LinkIcon} onPress={() => copyLink(signupUrl, 'Sign-up link copied')} /> : undefined}
      refreshing={team.isRefetching} onRefresh={() => team.refetch()}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <View style={[styles.wake, { backgroundColor: wakeable === members.length ? c.greenSoft : c.orangeSoft }]}>
          <Smartphone size={20} color={wakeable === members.length ? c.greenText : c.orangeText} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="headline">{`${wakeable} of ${members.length} can be woken by a call`}</AppText>
          <AppText variant="foot" tone="secondary">The rest only get Slack, which won’t wake them at night.</AppText>
        </View>
      </Card>
      {groups.map((group, i) => (
        <Section key={i} title={`${size === 2 ? 'Pair' : 'Group'} ${i + 1}`}
          action={group[0]?.nextWeekend ? <AppText variant="foot" tone="secondary">{`Next on ${formatDate(group[0].nextWeekend, tz)}`}</AppText> : undefined}>
          <Card>{group.map((m, n) => row(m, n, group, true))}</Card>
        </Section>
      ))}
      {admin && inactive.length ? (
        <Section title="Not in rotation">
          <Card>{inactive.map((m, n) => row(m, n, inactive, false))}</Card>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  dot: { width: 8, height: 8, borderRadius: 4 },
  wake: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
