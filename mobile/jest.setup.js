// Native-only pieces swapped out for Jest.
// Every test runs with the phone in Pakistan, so team-timezone formatting is really exercised.
process.env.TZ = "Asia/Karachi";
require('react-native-gesture-handler/jestSetup');
// The swipe gesture needs Reanimated's native runtime; tests render the row without it
// (the long-press menu offers the same actions and is tested; the swipe is checked on a device).
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// The keychain, in memory.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    getItemAsync: jest.fn(async (k) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
  };
});
jest.mock('expo-device', () => ({ deviceName: 'Test iPhone' }));
// No camera in tests: the scanner renders nothing and permission is not granted.
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: false, canAskAgain: true }, jest.fn()] }));

// The call libraries are native-only; screens never touch them directly, but the app's call wiring imports them.
jest.mock('react-native-callkeep', () => ({
  __esModule: true,
  default: { setup: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), reportEndCallWithUUID: jest.fn(), endCall: jest.fn() },
  CONSTANTS: { END_CALL_REASONS: { UNANSWERED: 3, ANSWERED_ELSEWHERE: 4 } },
}));
jest.mock('react-native-voip-push-notification', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(), removeEventListener: jest.fn(), registerVoipToken: jest.fn(), onVoipNotificationCompleted: jest.fn() },
}));
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  useLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
}));
