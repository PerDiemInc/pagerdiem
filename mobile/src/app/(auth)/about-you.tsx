// The last step of a Google sign-up: how the team reaches you.
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AppText, Button, Field, Screen } from '@/components/ui';
import { useSession } from '@/hooks/use-session';
import { ApiError } from '@/lib/api';
import { pendingSignUp, readPendingIdentity, signUp } from '@/lib/sign-in';

export default function AboutYou() {
  const router = useRouter();
  // Opened from a link there may be nothing behind this screen; then close to On call.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const session = useSession();
  const { server, pending, verifier } = pendingSignUp;
  const identity = pending ? readPendingIdentity(pending) : null;
  const [name, setName] = useState(identity?.name ?? '');
  const [slack, setSlack] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<{ name?: string; slack?: string; phone?: string; other?: string }>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const signedUp = await signUp({ server: server!, pending: pending!, name, slack, phone, verifier });
      Object.assign(pendingSignUp, { server: undefined, pending: undefined, verifier: undefined });
      await session.signIn({ server: server!, ...signedUp });
      router.replace('/setup');
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.field === 'name' || e.field === 'slack' || e.field === 'phone' ? { [e.field]: e.message } : { other: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!server || !pending) {
    return (
      <Screen title="How do we reach you?" onBack={close}>
        <AppText variant="body" tone="secondary">Sign in with Google again to finish signing up.</AppText>
        <Button label="Back to Welcome" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen title="How do we reach you?" onBack={close}>
      <AppText variant="body" tone="secondary">Your Slack name links your DMs. Your number is shown to the team so they can reach you directly.</AppText>
      {identity ? <AppText variant="foot" tone="secondary">Signing up as {identity.email}</AppText> : null}
      <Field label="Name" value={name} onChangeText={setName} textContentType="name" autoComplete="name" error={errors.name} />
      <Field label="Slack" value={slack} onChangeText={setSlack} placeholder="Slack email or member ID" autoCapitalize="none" autoCorrect={false} error={errors.slack} />
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+1 415 555 0123" keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" error={errors.phone} />
      {errors.other ? <AppText variant="foot" tone="red">{errors.other}</AppText> : null}
      <Button label="Continue" onPress={save} loading={busy} />
    </Screen>
  );
}
