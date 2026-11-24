// Hold for a second to call people: a tap does nothing but explain, so nobody is woken by accident.
import * as Haptics from 'expo-haptics';
import { Phone } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function HoldButton({ label, hint: note, onFire, holdMs = 1000, disabled }: {
  label: string; hint?: string; onFire: () => void; holdMs?: number; disabled?: boolean;
}) {
  const c = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const fire = () => {
    timer.current = null;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onFire();
  };
  const start = () => {
    setHint(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(progress, { toValue: 1, duration: holdMs, easing: Easing.linear, useNativeDriver: false }).start();
    timer.current = setTimeout(fire, holdMs);
  };
  const stop = () => {
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setHint(true); // let go too early
    }
  };

  return (
    <View style={{ gap: Spacing.two }}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Hold for a second"
        accessibilityActions={[{ name: 'activate', label }]}
        onAccessibilityAction={(e) => !disabled && e.nativeEvent.actionName === 'activate' && fire()}
        disabled={disabled} onPressIn={start} onPressOut={stop}
        style={[styles.button, { backgroundColor: c.primary, opacity: disabled ? 0.45 : 1 }]}>
        <Animated.View style={[styles.fill, { backgroundColor: c.tint, width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        <Phone size={20} color={c.onPrimary} />
        <AppText variant="headline" style={{ color: c.onPrimary }}>{label}</AppText>
      </Pressable>
      {hint || note ? (
        <AppText variant="foot" tone={hint ? 'tint' : 'secondary'} style={{ textAlign: 'center' }}>
          {hint ? 'Hold the button for a second. It stops accidental pages.' : note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 56, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
