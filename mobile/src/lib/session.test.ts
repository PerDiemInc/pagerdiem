import * as SecureStore from 'expo-secure-store';

import { clearSession, loadSession, normalizeServer, saveSession } from './session';

test('server addresses are normalised to https, and plain http only for local development hosts', () => {
  expect(normalizeServer('pd.example.com/team')).toBe('https://pd.example.com');
  expect(normalizeServer(' https://PD.example.com/ ')).toBe('https://pd.example.com');
  expect(normalizeServer('http://evil.com')).toBe('https://evil.com');
  expect(normalizeServer('http://localhost:3000')).toBe('http://localhost:3000');
  expect(normalizeServer('http://10.0.2.2:3000')).toBe('http://10.0.2.2:3000');
  expect(normalizeServer('http://192.168.1.20:3000/x')).toBe('http://192.168.1.20:3000');
  expect(normalizeServer('')).toBeNull();
  expect(normalizeServer('not a url !!')).toBeNull();
});

test('the session is kept in this phone’s keychain, readable after first unlock (so a locked phone can acknowledge), never in backups', async () => {
  expect(await loadSession()).toBeNull();
  await saveSession({ server: 'https://pd.example.com', token: 'tok' });
  expect(await loadSession()).toEqual({ server: 'https://pd.example.com', token: 'tok' });
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('pd.session', expect.any(String), { keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' });
  await clearSession();
  expect(await loadSession()).toBeNull();
});
