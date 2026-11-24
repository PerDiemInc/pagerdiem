import type { ExpoConfig } from 'expo/config';

// PerDiem publishes the store builds. A team that runs its own pagerdiem builds the app under its
// own Apple team and Firebase project by setting these (spec D7a).
const bundleId = process.env.APP_BUNDLE_ID ?? 'com.tryperdiem.pagerdiem';

const config: ExpoConfig = {
  name: process.env.APP_NAME ?? 'PagerDiem',
  slug: 'pagerdiem',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'pagerdiem',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: bundleId,
    appleTeamId: process.env.APPLE_TEAM_ID ?? 'NDXNQ5M4K4', // Per Diem Subscriptions, Inc.
    icon: './assets/images/icon.png',
    // Each TestFlight or App Store upload needs a higher build number than the last.
    buildNumber: process.env.BUILD_NUMBER ?? '1',
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // voip: a page wakes the app to show the call screen; remote-notification: background pushes.
      UIBackgroundModes: ['voip', 'remote-notification'],
    },
  },
  android: {
    package: bundleId,
    // Firebase Cloud Messaging for Android calls. Not in git: download it from your own Firebase project.
    googleServicesFile: process.env.GOOGLE_SERVICES_FILE ?? './google-services.json',
    allowBackup: false, // the sign-in token never leaves the phone in a backup
    adaptiveIcon: {
      backgroundColor: '#09090B',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#09090B', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-secure-store',
    ['expo-camera', { cameraPermission: 'Scan the sign-in code from the PagerDiem Team page.', barcodeScannerEnabled: true }],
    // The ringtones go into the app bundle, where CallKit and Android notifications can play them.
    ['expo-notifications', { sounds: ['./assets/ringtones/rising.caf', './assets/ringtones/classic.caf', './assets/ringtones/beeps.caf'] }],
    './plugins/with-voip-callkit',
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
