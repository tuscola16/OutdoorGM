# Android Local Dev Setup

## Prerequisites

- Android Studio installed
- Node.js 20+
- An Android device (USB debugging enabled) or emulator running

## Step 1 — Set environment variables (one-time per terminal session)

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"
```

## Step 2 — Install Android SDK platform 34

Expo SDK 51 / React Native 0.74 requires platform 34.

```powershell
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "platforms;android-34" "build-tools;34.0.0"
```

If `cmdline-tools` is not installed: open **Android Studio → Settings → SDK Manager → SDK Tools tab → check "Android SDK Command-line Tools"**, apply, then re-run the command above.

## Step 3 — Generate the native Android project

```powershell
npx expo prebuild --platform android --clean
```

## Step 4 — Run on device or emulator

```powershell
npx expo run:android
```

## Making environment variables permanent

To avoid repeating Step 1 every session, run this once in an **elevated** (Run as Administrator) PowerShell:

```powershell
[System.Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Android\Android Studio\jbr', 'User')
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
```

Then restart Android Studio.
