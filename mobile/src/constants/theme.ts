// Colors, type and spacing from the PagerDiem canvas kit (shadcn/ui-style tokens), light and dark.

export const Colors = {
  light: {
    bg: '#FAFAFA',
    card: '#FFFFFF',
    card2: '#F4F4F5',
    border: '#E4E4E7',
    label: '#09090B',
    label2: '#5F5F68',
    label3: '#A1A1AA',
    fill: '#F4F4F5',
    fill2: '#E4E4E7',
    sep: '#EDEDEF',
    primary: '#09090B',
    onPrimary: '#FFFFFF',
    tint: '#4F46E5',
    tintText: '#4338CA',
    tintSoft: 'rgba(79, 70, 229, 0.10)',
    red: '#DC2626',
    redText: '#B91C1C',
    redSoft: 'rgba(220, 38, 38, 0.09)',
    green: '#16A34A',
    greenText: '#116B33',
    greenSoft: 'rgba(22, 163, 74, 0.10)',
    orange: '#F59E0B',
    orangeText: '#A44B06',
    orangeSoft: 'rgba(245, 158, 11, 0.13)',
    segOn: '#FFFFFF',
    knob: '#FFFFFF',
    avatarBg: '#E4E4E7',
    avatarFg: '#27272A',
  },
  dark: {
    bg: '#09090B',
    card: '#111113',
    card2: '#18181B',
    border: 'rgba(255, 255, 255, 0.08)',
    label: '#FAFAFA',
    label2: '#A1A1AA',
    label3: '#71717A',
    fill: 'rgba(255, 255, 255, 0.06)',
    fill2: 'rgba(255, 255, 255, 0.12)',
    sep: 'rgba(255, 255, 255, 0.07)',
    primary: '#FAFAFA',
    onPrimary: '#09090B',
    tint: '#5753E0',
    tintText: '#A5B4FC',
    tintSoft: 'rgba(129, 140, 248, 0.14)',
    red: '#DC2626',
    redText: '#FCA5A5',
    redSoft: 'rgba(248, 113, 113, 0.12)',
    green: '#22C55E',
    greenText: '#86EFAC',
    greenSoft: 'rgba(74, 222, 128, 0.11)',
    orange: '#F59E0B',
    orangeText: '#FCD34D',
    orangeSoft: 'rgba(251, 191, 36, 0.12)',
    segOn: '#27272A',
    knob: '#FAFAFA',
    avatarBg: '#27272A',
    avatarFg: '#E4E4E7',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };

/** Geist for text, Geist Mono for numbers and timers (loaded in the root layout). */
export const Fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
} as const;

export const Spacing = { half: 2, one: 4, two: 8, three: 12, four: 16, five: 24, six: 32 } as const;

export const Radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
