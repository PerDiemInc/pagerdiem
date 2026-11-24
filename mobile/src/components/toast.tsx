// One short message at the bottom of the screen ("Acknowledged. Paging stopped."), optionally with
// an action such as Undo that stays until its deadline.
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Toast = { text: string; action?: { label: string; onPress: () => void } };

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const set = (next: Toast | null) => {
  current = next;
  listeners.forEach((l) => l());
};

export const toast = {
  /** Shows for `durationMs`, or until `until` (epoch ms) when there's an action like Undo. */
  show({ text, action, durationMs = 4000, until }: Toast & { durationMs?: number; until?: number }) {
    if (timer) clearTimeout(timer);
    set({ text, action });
    timer = setTimeout(() => set(null), until ? Math.max(0, until - Date.now()) : durationMs);
  },
  hide() {
    if (timer) clearTimeout(timer);
    set(null);
  },
};

export function ToastHost() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const t = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
  if (!t) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 96 }]}>
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.toast, { backgroundColor: c.primary }]}>
        <AppText variant="sub" style={{ color: c.onPrimary, flex: 1 }}>{t.text}</AppText>
        {t.action ? (
          <Pressable accessibilityRole="button" hitSlop={12} onPress={() => { toast.hide(); t.action?.onPress(); }}>
            <AppText variant="headline" style={{ color: c.onPrimary, textDecorationLine: 'underline' }}>{t.action.label}</AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.four, right: Spacing.four },
  toast: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: Radius.md, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
});
