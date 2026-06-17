import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';

/**
 * Android battery-optimization (Doze) exemption.
 *
 * Field finding: on a phone left in the default "Optimized" battery state, Android stops
 * delivering background location to our foreground service the moment the screen locks —
 * so a player silently drops off the GM's map within a couple of minutes even with
 * "Allow all the time" granted, the location service running, and its notification showing
 * (reproduced on a stock Pixel 8, so this is Doze, not an OEM battery-killer). Exempting the
 * app from battery optimization ("Unrestricted" / "ignore battery optimizations") is what
 * keeps background GPS flowing while locked. iOS has no equivalent, so it's reported exempt.
 */

const ANDROID_PACKAGE =
  (Constants.expoConfig?.android?.package as string | undefined) ?? 'com.bagelrun.outdoorgm';

/**
 * True only when the OS is still throttling us (Android, optimization on). Best-effort: any
 * read error → false, so we never nag on a device where we genuinely can't tell. iOS → false.
 */
export async function isBatteryOptimized(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false;
  }
}

/**
 * Fire the system "Allow Outdoor GM to run in the background?" dialog (Android only).
 * Resolves when the user returns to the app; callers re-read `isBatteryOptimized()` to
 * refresh state. The direct dialog needs the `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
 * manifest permission (declared in app.json); if an OEM build doesn't honor it, we fall
 * back to the battery-optimization list so the player can flip us off "Optimized" by hand.
 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      { data: `package:${ANDROID_PACKAGE}` }
    );
  } catch {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
    ).catch(() => {});
  }
}
