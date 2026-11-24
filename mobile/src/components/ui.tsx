// The small building blocks every screen uses, styled with the canvas tokens.
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TYPE = {
  largeTitle: { fontFamily: Fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: Fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  headline: { fontFamily: Fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 22 },
  sub: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 20 },
  foot: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  section: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' },
  mono: { fontFamily: Fonts.mono, fontSize: 15, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

type Tone = 'neutral' | 'tint' | 'red' | 'green' | 'orange';

export function AppText({ variant = 'body', tone, style, ...props }: TextProps & { variant?: keyof typeof TYPE; tone?: 'secondary' | 'tertiary' | Tone }) {
  const c = useTheme();
  const color = { secondary: c.label2, tertiary: c.label3, neutral: c.label, tint: c.tintText, red: c.redText, green: c.greenText, orange: c.orangeText }[tone ?? 'neutral'];
  return <Text {...props} style={[TYPE[variant], { color }, style]} />;
}

export function Button({ label, onPress, variant = 'primary', icon, disabled, loading, style }: {
  label: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  icon?: ReactNode; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const look = {
    primary: { bg: c.primary, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.card, fg: c.label, border: c.border },
    destructive: { bg: c.red, fg: '#FFFFFF', border: c.red },
    ghost: { bg: 'transparent', fg: c.label, border: 'transparent' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: look.bg, borderColor: look.border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      {loading ? <ActivityIndicator color={look.fg} /> : icon}
      <Text style={[TYPE.headline, { color: look.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}

export function ListRow({ title, subtitle, left, right, onPress, chevron = Boolean(onPress), last, label }: {
  title: string; subtitle?: string; left?: ReactNode; right?: ReactNode; onPress?: () => void; chevron?: boolean; last?: boolean; label?: string;
}) {
  const c = useTheme();
  const body = (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="headline" numberOfLines={2}>{title}</AppText>
        {subtitle ? <AppText variant="foot" tone="secondary" numberOfLines={2}>{subtitle}</AppText> : null}
      </View>
      {/* A wrapper, so a Pill (which hugs the top of a column) stays centred in the row. */}
      {right ? <View>{right}</View> : null}
      {chevron ? <ChevronRight size={18} color={c.label3} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: c.fill }}>
      {body}
    </Pressable>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = useTheme();
  const look = {
    neutral: { bg: c.fill, fg: c.label2 }, tint: { bg: c.tintSoft, fg: c.tintText }, red: { bg: c.redSoft, fg: c.redText },
    green: { bg: c.greenSoft, fg: c.greenText }, orange: { bg: c.orangeSoft, fg: c.orangeText },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: look.bg }]}>
      <Text style={[TYPE.foot, { fontFamily: Fonts.medium, color: look.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ initials, size = 36 }: { initials: string; size?: number }) {
  const c = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: Fonts.semibold, fontSize: size * 0.38, color: c.avatarFg }}>{initials}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const c = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: c.fill }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: c.segOn, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}>
            <Text style={[TYPE.foot, { fontFamily: on ? Fonts.semibold : Fonts.medium, color: on ? c.label : c.label2 }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small rounded square with an icon, at the start of a row. */
export function Tile({ Icon, bg, fg }: { Icon: LucideIcon; bg: string; fg: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: bg }]}>
      <Icon size={18} color={fg} />
    </View>
  );
}

/** The round button at the top right of a screen, like Page on-call. */
export function RoundButton({ label, Icon, onPress }: { label: string; Icon: LucideIcon; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}
      style={({ pressed }) => [styles.round, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}>
      <Icon size={22} color={c.onPrimary} />
    </Pressable>
  );
}

/**
 * The top bar of a sheet: Cancel on the left, the title, an optional action on the right. The native
 * safe-area view pads only as far as the status bar overlaps it, so it's right both as a sheet and
 * when a sheet opens full screen (from a link).
 */
export function SheetHeader({ title, cancel, onCancel, right }: { title: string; cancel: string; onCancel: () => void; right?: ReactNode }) {
  const c = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }}>
      <View style={[styles.sheetHeader, { borderBottomColor: c.sep }]}>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12} style={{ minWidth: 64 }}>
          <AppText variant="body" tone="tint">{cancel}</AppText>
        </Pressable>
        <AppText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</AppText>
        <View style={{ minWidth: 64, alignItems: 'flex-end' }}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

/** A labelled text field with its error under it. */
export function Field({ label, error, style, ...props }: TextInputProps & { label: string; error?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="foot" tone="secondary">{label}</AppText>
      <TextInput
        accessibilityLabel={label} placeholderTextColor={c.label3} {...props}
        style={[TYPE.body, styles.input, { color: c.label, backgroundColor: c.card, borderColor: error ? c.red : c.border }, style]}
      />
      {error ? <AppText variant="foot" tone="red" accessibilityLiveRegion="polite">{error}</AppText> : null}
    </View>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six, paddingHorizontal: Spacing.five }}>
      <AppText variant="headline" style={{ textAlign: 'center' }}>{title}</AppText>
      <AppText variant="sub" tone="secondary" style={{ textAlign: 'center' }}>{text}</AppText>
      {action}
    </View>
  );
}

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: Spacing.two }}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.one }}>
          <AppText variant="section" tone="secondary">{title}</AppText>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** What a screen shows until its server data arrives: a spinner, or the error with Try again. */
export function Loading({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.five }}>
      {error ? (
        <EmptyState title="Couldn’t load this" text={error.message} action={onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : undefined} />
      ) : (
        <ActivityIndicator color={c.label2} accessibilityLabel="Loading" />
      )}
    </View>
  );
}

/** A scrolling screen with a large title, pull to refresh, and room for the tab bar. `onBack` adds a Back link for screens without a header. */
export function Screen({ title, kicker, right, children, refreshing, onRefresh, onBack }: {
  title?: string; kicker?: string; right?: ReactNode; children: ReactNode; refreshing?: boolean; onRefresh?: () => void; onBack?: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  // iOS works out the status bar, home indicator and tab bar from where the screen really sits (a
  // screen inside the tabs isn't always laid out full-screen); Android pads by hand.
  const ios = Platform.OS === 'ios';
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingTop: (ios ? 0 : insets.top) + Spacing.four, paddingBottom: ios ? Spacing.six : insets.bottom + 96,
        paddingHorizontal: Spacing.four, gap: Spacing.five,
      }}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.label2} /> : undefined}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={12} style={styles.back}>
          <ChevronLeft size={22} color={c.tintText} />
          <AppText variant="body" tone="tint">Back</AppText>
        </Pressable>
      ) : null}
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.three }}>
          <View style={{ flex: 1, gap: Spacing.one }}>
            {kicker ? <AppText variant="foot" tone="secondary">{kicker}</AppText> : null}
            <AppText variant="largeTitle" accessibilityRole="header">{title}</AppText>
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four },
  card: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  pill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  segmented: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, gap: 3 },
  input: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.four },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  tile: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -6, marginBottom: -Spacing.three },
  segment: { flex: 1, minHeight: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
