// A row you can swipe left for its actions. A long press offers the same actions, for anyone who
// can't or won't swipe.
import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type RowAction = { label: string; tone: 'orange' | 'green' | 'red'; onPress: () => void };

export function SwipeRow({ title, actions, onPress, children }: { title: string; actions: RowAction[]; onPress?: () => void; children: ReactNode }) {
  const c = useTheme();
  const tone = { orange: '#A84C00', green: '#1C7432', red: c.red };
  const menu = () => Alert.alert(title, undefined, [...actions.map((a) => ({ text: a.label, onPress: a.onPress })), { text: 'Cancel', style: 'cancel' as const }]);
  return (
    <ReanimatedSwipeable
      friction={2} rightThreshold={40} overshootRight={false}
      renderRightActions={(_progress, _drag, swipeable) => (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label}
              onPress={() => { swipeable.close(); a.onPress(); }} style={[styles.action, { backgroundColor: tone[a.tone] }]}>
              <Text style={styles.actionText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint="Long press for actions"
        onPress={onPress} onLongPress={menu} style={({ pressed }) => [{ backgroundColor: c.card }, pressed && { backgroundColor: c.fill }]}>
        {children}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row' },
  action: { width: 104, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#FFFFFF', fontFamily: Fonts.semibold, fontSize: 15 },
});
