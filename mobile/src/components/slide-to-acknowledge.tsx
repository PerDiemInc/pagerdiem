// Slide the knob across to acknowledge. A tap or a short drag only nudges it, so a phone in a
// pocket can't acknowledge a page by accident. Screen readers get an "activate" action instead.
import * as Haptics from 'expo-haptics';
import { ArrowRight } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const KNOB = 56;
const PAD = 4;

/** Did a drag of `dx` across a track this wide go far enough to count? */
export function slideCompletes(dx: number, trackWidth: number, knob = KNOB) {
  return dx >= (trackWidth - knob - PAD * 2) * 0.85;
}

/** `onAcknowledge` says whether it worked; if not (no connection), the knob springs back for another try. */
export function SlideToAcknowledge({ label, onAcknowledge, disabled }: { label: string; onAcknowledge: () => Promise<boolean>; disabled?: boolean }) {
  const c = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0); // set on layout; the responder below is created once and reads it
  const busy = useRef(false);
  const done = useRef(false);
  // The responder is created once, so it reads the latest props from here.
  const props = useRef({ onAcknowledge, disabled });
  useEffect(() => { props.current = { onAcknowledge, disabled }; });
  const travel = () => Math.max(0, width.current - KNOB - PAD * 2);

  const settle = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 8 }).start();
  const fire = async () => {
    if (busy.current || done.current || props.current.disabled) return;
    busy.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    done.current = await props.current.onAcknowledge();
    busy.current = false;
    if (!done.current) settle();
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
    onPanResponderMove: (_, g) => x.setValue(Math.min(Math.max(0, g.dx), travel())),
    onPanResponderRelease: (_, g) => {
      if (slideCompletes(g.dx, width.current)) {
        Animated.timing(x, { toValue: travel(), duration: 120, useNativeDriver: true }).start(fire);
      } else {
        settle();
      }
    },
    onPanResponderTerminate: settle,
  })).current;
  return (
    <View
      accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && fire()}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
      style={[styles.track, { backgroundColor: c.fill, borderColor: c.border, opacity: disabled ? 0.5 : 1 }]}>
      <AppText variant="headline" tone="secondary" style={styles.label}>{label}</AppText>
      <Animated.View {...pan.panHandlers} style={[styles.knob, { backgroundColor: c.primary, transform: [{ translateX: x }] }]}>
        <ArrowRight size={24} color={c.onPrimary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: KNOB + PAD * 2, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', padding: PAD },
  label: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: 'center', justifyContent: 'center' },
});
