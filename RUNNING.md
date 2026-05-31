# RUNNING.md — Local Dev Guide for Outdoor GM (Android, Windows)

This guide covers running the app locally on Windows against a physical Android
device or the Pixel6_API34 emulator. The app uses native modules and **cannot
run in Expo Go** — a custom dev client is required.

---

## Prerequisites

| Tool | Where to get it |
|------|-----------------|
| Android Studio (includes JBR + emulator) | developer.android.com/studio |
| Node.js 20+ | nodejs.org |
| Emulator: `Pixel6_API34` AVD | Android Studio → Device Manager |
| Firebase project + `google-services.json` in `android/app/` | Firebase Console |

---

## 1 — Environment variables (set once per session, or persist permanently)

```powershell
$env:JAVA_HOME    = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH         = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"

# Critical on Windows: fixes SQLite JDBC tmpdir for Room annotation processing
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$env:TEMP"
$env:NODE_ENV = "development"
```

To make them permanent (run once in an elevated PowerShell):
```powershell
[System.Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Android\Android Studio\jbr', 'User')
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
```

---

## 2 — One-time Windows build fixes

These need to be done once per machine (or after clearing the Gradle cache).

### 2a — Pre-place the SQLite JDBC native DLL

The Room annotation processor (`expo-updates:kaptDebugKotlin`) cannot extract its
SQLite native library due to a Windows tmpdir issue. Pre-place it directly:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$jar  = "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\org.xerial\sqlite-jdbc\3.41.2.2\ddeb8d3a3004f412ed19b4c98b3aec11d9452ab5\sqlite-jdbc-3.41.2.2.jar"
$jdk  = "$env:USERPROFILE\.gradle\jdks\eclipse_adoptium-17-amd64-windows\jdk-17.0.19+10\bin"
$zip  = [System.IO.Compression.ZipFile]::OpenRead($jar)
$entry = $zip.Entries | Where-Object { $_.FullName -eq "org/sqlite/native/Windows/x86_64/sqlitejdbc.dll" }
[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, "$jdk\sqlitejdbc.dll", $true)
$zip.Dispose()
```

> **Note:** If the Gradle toolchain JDK path changes (different JDK version downloaded),
> repeat this step for the new path. Check `$env:USERPROFILE\.gradle\jdks\` to find it.

### 2b — Pre-populate Prefab CMake output (if `.cxx` directory is missing)

On a clean environment, the Android Gradle Plugin fails to copy the Prefab CLI
output for `expo-modules-core`. After running `expo prebuild` and the first
`assembleDebug` (which may fail), run this to fix it:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$env:TEMP"

$prefabJar   = "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\com.google.prefab\cli\2.0.0\f2702b5ca13df54e3ca92f29d6b403fb6285d8df\cli-2.0.0-all.jar"
$reactPrefab = "$env:USERPROFILE\.gradle\caches\transforms-3\587f6682c05a965a7b7aa9a82f307c5b\transformed\jetified-react-android-0.74.5-debug\prefab"
$fbjniPrefab = "$env:USERPROFILE\.gradle\caches\transforms-3\5ebd2d5f6fbc082145b51aaba6965530\transformed\jetified-fbjni-0.6.0\prefab"

# Find the .cxx hash dir (changes if Gradle config changes)
$cxxBase = (Get-ChildItem "node_modules\expo-modules-core\android\.cxx\Debug" | Select-Object -First 1).FullName + "\prefab"

foreach ($abi in @("armeabi-v7a","arm64-v8a","x86","x86_64")) {
    $out = "$cxxBase\$abi\prefab"
    $stage = "$env:TEMP\pfb-$abi"
    New-Item -ItemType Directory -Force $out,$stage | Out-Null
    & "$env:JAVA_HOME\bin\java" --class-path $prefabJar com.google.prefab.cli.AppKt `
        --build-system cmake --platform android --abi $abi --os-version 23 `
        --stl "c++_shared" --ndk-version 26 --output $stage $reactPrefab $fbjniPrefab 2>&1 | Out-Null
    Copy-Item -Recurse -Force "$stage\*" $out
    Write-Host "Prefab OK: $abi"
}
```

> **Note:** The transform hashes in the paths above may differ if you have a different
> version of React Native or NDK. Find the correct paths inside
> `$env:USERPROFILE\.gradle\caches\transforms-3\`.

---

## 3 — Generate the Android native project

Only needed after cloning fresh or if you deleted the `android/` directory:

```powershell
cd "C:\Users\tusco\OneDrive\Documents\Code_repositories\OutdoorGM"
npx expo prebuild --platform android --clean
```

---

## 4 — Build and install the debug APK

```powershell
# Set env vars first (Section 1)
cd android

# Build for emulator (x86_64 only — faster build)
.\gradlew assembleDebug -PreactNativeArchitectures=x86_64

# Install on running emulator
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb install -r "app\build\outputs\apk\debug\app-debug.apk"
```

If the build fails on the **first run** with a Prefab/CMake error, run Section 2b
then retry. It will succeed on the second attempt.

To build for a physical device (all ABIs):
```powershell
.\gradlew assembleDebug
```

---

## 5 — Start the Metro bundler

In a **separate terminal**, from the project root:

```powershell
cd "C:\Users\tusco\OneDrive\Documents\Code_repositories\OutdoorGM"
npx expo start --dev-client
```

Metro will start on port 8081. Leave this terminal running.

---

## 6 — Launch the app and connect to Metro

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"

# Forward Metro port to emulator
& $adb -s emulator-5554 reverse tcp:8081 tcp:8081

# Launch the app
& $adb -s emulator-5554 shell am start -n "com.bagelrun.outdoorgm/.MainActivity"
```

The **Expo Dev Client** launcher screen will appear, showing
`http://10.0.2.2:8081` with a green dot. Tap it (use the coordinate below if
tap detection seems off):

```powershell
& $adb -s emulator-5554 shell input swipe 540 408 540 408 80
```

The app will bundle and load to the **Login** screen.

---

## 7 — Navigating the app via ADB (for screenshots)

Use `input swipe x y x y 80` (not `input tap`) for reliable touch delivery.
All coordinates are for the 1080×2400 Pixel6_API34 emulator.

| Screen | ADB command |
|--------|-------------|
| My Games → GM game | `input swipe 540 294 540 294 80` |
| GM Map → Alerts tab | `input swipe 782 431 782 431 80` |
| My Games → Join a Game | `input swipe 540 2044 540 2044 80` |
| My Games → Create a Game | `input swipe 540 2209 540 2209 80` |
| Back | `input keyevent KEYCODE_BACK` |
| Open dev menu (for debugging) | `input keyevent 82` |

> **Known limitation:** The Profile screen header icon (x≈878, y≈92) overlaps
> with the Expo dev client's dev-menu trigger zone and cannot be reached via ADB
> tap. Open the dev menu with `keyevent 82`, tap **Continue**, then quickly tap
> the profile icon via the emulator's graphical window instead.

### Taking and pulling a screenshot

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb -s emulator-5554 shell screencap -p /sdcard/screen.png
& $adb -s emulator-5554 pull /sdcard/screen.png .\screenshots\screen.png
```

To resize for use in documentation (requires no extra tools — uses .NET):

```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile(".\screenshots\screen.png")
$w = [int]($img.Width * 0.38); $h = [int]($img.Height * 0.38)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, $w, $h); $g.Dispose(); $img.Dispose()
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$p = New-Object System.Drawing.Imaging.EncoderParameters(1)
$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 78L)
$bmp.Save(".\screenshots\screen.jpg", $enc, $p); $bmp.Dispose()
```

---

## 8 — Firebase emulators (optional, for local dev)

```powershell
firebase emulators:start --config firebase.emulator.json
```

Then start Metro with the emulator flag:
```powershell
$env:EXPO_PUBLIC_USE_EMULATOR = "true"
npx expo start --dev-client
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `expo-updates:kaptDebugKotlin FAILED` with SQLite error | Run Section 2a (pre-place DLL) |
| `expo-modules-core:configureCMakeDebug FAILED` — No compatible library | Run Section 2b (Prefab fix) |
| App crashes on launch: "Crashlytics build ID is missing" | You're using the old `outdoor-gm.apk` pre-built release. Build fresh via Section 4 instead. |
| Metro shows "port 8081 in use" | A Metro server is already running — connect to it directly. |
| `autoFocus` crash on Create Game navigation | Transient RN view-hierarchy error — press Reload in the error screen and navigate again. |
| Profile icon tap opens dev menu | See known limitation in Section 7. |
