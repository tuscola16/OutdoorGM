import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { requestNotificationPermissions } from './notificationService';

/**
 * Player permission priming. We request *everything* a player needs up front while
 * they wait in the lobby — location ("Allow all the time"), notifications, and the
 * camera (for ration cards) — rather than prompting mid-game when each feature first
 * fires. That way nothing interrupts play and the GM isn't blind to a player who
 * hasn't yet hit the screen that would have asked.
 */

/** 'blocked' = denied and the OS won't prompt again (must be fixed in Settings). */
export type PermState = 'granted' | 'undetermined' | 'denied' | 'blocked';

export interface PlayerPermissions {
  /** Background location, i.e. Android "Allow all the time" / iOS "Always". */
  locationAlways: PermState;
  /** Foreground location ("While using") — prerequisite for the above. */
  locationWhenInUse: PermState;
  notifications: PermState;
  /** Only meaningful when the game uses rations; otherwise reported 'granted'. */
  camera: PermState;
}

type RawPerm = { status: string; granted?: boolean; canAskAgain?: boolean };

function norm(p: RawPerm): PermState {
  if (p.granted || p.status === 'granted') return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain === false ? 'blocked' : 'denied';
}

/** Read current statuses without prompting. */
export async function getPlayerPermissions(rationsEnabled: boolean): Promise<PlayerPermissions> {
  const [fg, bg, notif, cam] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Notifications.getPermissionsAsync(),
    ImagePicker.getCameraPermissionsAsync(),
  ]);
  return {
    locationWhenInUse: norm(fg),
    locationAlways: norm(bg),
    notifications: norm(notif),
    camera: rationsEnabled ? norm(cam) : 'granted',
  };
}

/**
 * Request every player permission, in the order the OS requires (foreground location
 * before background). Only prompts for ones still undetermined, so it won't re-nag a
 * player who already decided. Safe to call more than once. Returns the resulting state.
 */
export async function requestAllPlayerPermissions(rationsEnabled: boolean): Promise<PlayerPermissions> {
  // 1) Foreground location — the prerequisite for background.
  let fg = await Location.getForegroundPermissionsAsync();
  if (fg.status === 'undetermined') {
    fg = await Location.requestForegroundPermissionsAsync().catch(() => fg);
  }

  // 2) Background location ("Allow all the time") — only askable once foreground is granted.
  let bg = await Location.getBackgroundPermissionsAsync();
  if (fg.status === 'granted' && bg.status === 'undetermined') {
    bg = await Location.requestBackgroundPermissionsAsync().catch(() => bg);
  }

  // 3) Notifications (handles the iOS FCM authorization too, via notificationService).
  await requestNotificationPermissions().catch(() => {});
  const notif = await Notifications.getPermissionsAsync();

  // 4) Camera — only when the game actually uses ration photos.
  let cam = await ImagePicker.getCameraPermissionsAsync();
  if (rationsEnabled && cam.status === 'undetermined') {
    cam = await ImagePicker.requestCameraPermissionsAsync().catch(() => cam);
  }

  return {
    locationWhenInUse: norm(fg),
    locationAlways: norm(bg),
    notifications: norm(notif),
    camera: rationsEnabled ? norm(cam) : 'granted',
  };
}
