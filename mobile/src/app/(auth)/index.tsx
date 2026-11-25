import { useRouter } from 'expo-router';
import { CalendarCheck, Hand, PhoneIncoming, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Button, Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';

const FEATURES: [LucideIcon, string, string][] = [
  [PhoneIncoming, 'Pages ring like a call', 'Even when the app is closed.'],
  [Hand, 'Acknowledge in a swipe', 'From the lock screen or the app. Paging stops for everyone.'],
  [CalendarCheck, 'Your weekends, handled', 'Swap, find cover or take a weekend from your phone.'],
];

export default function Welcome() {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const revoked = session.status === 'signedOut' && session.revoked;
  return (
    <Screen kicker="Welcome to" title="PagerDiem">
      {revoked ? (
        <AppText variant="sub" tone="orange">You were signed out. Scan a new code on the web Team page to sign in again.</AppText>
      ) : null}
      <View style={{ gap: Spacing.five }}>
        {FEATURES.map(([Icon, title, text]) => (
          <View key={title} style={{ flexDirection: 'row', gap: Spacing.four }}>
            <View style={{ width: 44, height: 44, borderRadius: Radius.md, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={22} color={c.tintText} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="headline">{title}</AppText>
              <AppText variant="sub" tone="secondary">{text}</AppText>
            </View>
          </View>
        ))}
      </View>
      <View style={{ gap: Spacing.two }}>
        <Button label="Scan code" onPress={() => router.push({ pathname: '/join', params: { mode: 'scan' } })} />
        <Button label="Enter address instead" variant="ghost" onPress={() => router.push({ pathname: '/join', params: { mode: 'address' } })} />
      </View>
    </Screen>
  );
}
