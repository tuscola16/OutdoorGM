import ExpoModulesCore

/**
 * iOS half of the #82 native shims — deliberately inert.
 *
 * Neither capability is needed here. iOS has no user-acquirable CPU wake lock; the
 * `location` background mode already keeps the app scheduled. And step counting on iOS
 * goes through expo-sensors' `Pedometer.getStepCountAsync(start, end)`, which queries
 * CMPedometer's 7-day historic cache and therefore already returns counts accrued while
 * the app was suspended — the exact problem the Android shim exists to solve.
 *
 * This target exists so the module links cleanly on iOS builds. `getStepCount` resolves
 * `nil`, which every caller already treats as "unknown, don't judge".
 */
public class OutdoorNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OutdoorNative")

    AsyncFunction("getStepCount") { () -> Int? in
      return nil
    }

    // iOS has no equivalent of Android's provider split — CoreLocation gives you one
    // fused stream and no way to demand satellites only. Callers fall back to the
    // expo-location fix, which is what iOS would return here anyway.
    AsyncFunction("getGpsFix") { (_: Double) -> [String: Any]? in
      return nil
    }

    Function("acquireWakeLock") { (_: Double) -> Bool in
      return false
    }

    Function("releaseWakeLock") { () -> Bool in
      return true
    }

    Function("isWakeLockHeld") { () -> Bool in
      return false
    }
  }
}
