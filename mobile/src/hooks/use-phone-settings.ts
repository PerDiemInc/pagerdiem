// Settings that belong to this phone, not the server: how a page rings, and light or dark.
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Appearance, Platform } from 'react-native';

export type Tone = 'siren' | 'classic' | 'pulse';
export type Ring = { tone: Tone; loud: boolean; vibrate: boolean };
export type Look = 'system' | 'light' | 'dark';

export const TONES: { value: Tone; label: string; sub: string }[] = [
  { value: 'siren', label: 'Siren', sub: 'Loud and rising. Hard to sleep through.' },
  { value: 'classic', label: 'Classic phone', sub: 'Sounds like a normal call' },
  { value: 'pulse', label: 'Pulse', sub: 'Short beeps that get louder' },
];

const RING_KEY = 'pd.ring';
const LOOK_KEY = 'pd.appearance';
const DEFAULT_RING: Ring = { tone: 'siren', loud: true, vibrate: true };
// Readable by the call handlers while the phone is locked.
const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function loadRing(): Promise<Ring> {
  try {
    return { ...DEFAULT_RING, ...JSON.parse((await SecureStore.getItemAsync(RING_KEY, OPTIONS)) ?? '{}') };
  } catch {
    return DEFAULT_RING;
  }
}

/** Applies the saved light/dark choice; the root layout calls this once at start. */
export async function applySavedLook() {
  const look = (await SecureStore.getItemAsync(LOOK_KEY)) as Look | null;
  if (look === 'light' || look === 'dark') Appearance.setColorScheme(look);
}

export function usePhoneSettings() {
  const [ring, setRingState] = useState<Ring>(DEFAULT_RING);
  const [look, setLookState] = useState<Look>('system');
  useEffect(() => {
    loadRing().then(setRingState);
    SecureStore.getItemAsync(LOOK_KEY).then((v) => setLookState(v === 'light' || v === 'dark' ? v : 'system'));
  }, []);

  function setRing(patch: Partial<Ring>) {
    const next = { ...ring, ...patch };
    setRingState(next);
    SecureStore.setItemAsync(RING_KEY, JSON.stringify(next), OPTIONS);
    if (patch.tone && Platform.OS === 'ios') require('@/calls/ios').setRingtone(patch.tone);
  }
  function setLook(next: Look) {
    setLookState(next);
    SecureStore.setItemAsync(LOOK_KEY, next);
    Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  }
  return { ring, setRing, look, setLook };
}
