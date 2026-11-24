// Edit profile: the Slack account and phone number the team reaches you on.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { toast } from '@/components/toast';
import { AppText, Field, Loading, SheetHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useMe } from '@/hooks/use-api';
import { useApi } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import type { ApiError, Me } from '@/lib/api';

export default function Profile() {
  const me = useMe();
  if (!me.data) return <Loading error={me.error} onRetry={() => me.refetch()} />;
  return <ProfileForm me={me.data} />;
}

function ProfileForm({ me }: { me: Me }) {
  const c = useTheme();
  const router = useRouter();
  // Opened from a link there may be nothing behind this screen; then close to On call.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const api = useApi();
  const queryClient = useQueryClient();
  const [slack, setSlack] = useState(me.user.slack ?? '');
  const [phone, setPhone] = useState(me.user.phone);
  const [errors, setErrors] = useState<{ slack?: string; phone?: string; other?: string }>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      // Field errors belong under their field, so this calls the API directly instead of useAction's toast.
      queryClient.setQueryData(['me'], await api.post<Me>('/api/app/profile', { name: me.user.name, slack, phone }));
      toast.show({ text: 'Saved' });
      close();
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.field === 'slack' || e.field === 'phone' ? { [e.field]: e.message } : { other: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SheetHeader title="Edit profile" cancel="Cancel" onCancel={close} right={
        <Pressable accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled: saving }} disabled={saving} onPress={save} hitSlop={12}>
          <AppText variant="headline" tone="tint">Save</AppText>
        </Pressable>
      } />
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four }} keyboardShouldPersistTaps="handled">
        <Field label="Slack name" value={slack} onChangeText={setSlack} placeholder="Slack email or member ID" autoCapitalize="none" autoCorrect={false} error={errors.slack} />
        <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="+1 415 555 0123" keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" error={errors.phone} />
        {errors.other ? <AppText variant="foot" tone="red">{errors.other}</AppText> : null}
      </ScrollView>
    </View>
  );
}
