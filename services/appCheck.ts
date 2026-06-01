import appCheck from '@react-native-firebase/app-check';

// App Check attests that requests come from a genuine build of this app, not a
// script wielding the (publicly shipped) Firebase config. Tokens start flowing
// as soon as this runs; *enforcement* is a separate step you turn on in the
// Firebase console (App Check → APIs → Firestore/Functions) once you've
// confirmed real builds get tokens. Until then this is non-fatal: if a provider
// can't attest, requests still succeed (because enforcement is off), so wiring
// it up early can't lock anyone out.
//
// Dev builds use the `debug` provider, which prints a debug token to the native
// log on first launch — register that token in the console (App Check → Manage
// debug tokens) so the emulator/dev client can attest.
let initialized = false;

export async function initAppCheck(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const provider = appCheck().newReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: {
        provider: __DEV__ ? 'debug' : 'playIntegrity',
      },
      apple: {
        provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
      },
    });
    await appCheck().initializeAppCheck({
      provider,
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // Never let App Check setup crash app startup. Worst case (until enforcement
    // is enabled) requests proceed without an attestation token.
    console.warn('[AppCheck] initialization failed', err);
  }
}
