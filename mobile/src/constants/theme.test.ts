import { Colors } from './theme';

// WCAG relative luminance and contrast ratio, for solid #RRGGBB colors.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(['light', 'dark'] as const)('%s theme', (scheme) => {
  const t = Colors[scheme];
  test.each(['label', 'label2', 'tintText', 'redText', 'greenText', 'orangeText'] as const)(
    '%s text meets 4.5:1 on the page and on cards',
    (fg) => {
      expect(contrast(t[fg], t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[fg], t.card)).toBeGreaterThanOrEqual(4.5);
    },
  );
  test('primary buttons are readable', () => {
    expect(contrast(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5);
  });
});
