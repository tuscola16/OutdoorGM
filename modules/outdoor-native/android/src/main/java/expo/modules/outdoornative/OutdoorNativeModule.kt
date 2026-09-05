package expo.modules.outdoornative

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native shims for ROADMAP #82. Two capabilities, both of which exist because the
 * managed-workflow APIs measurably failed in the field on 2026-09-05.
 *
 *  1. `getStepCount()` — reads Android's cumulative TYPE_STEP_COUNTER directly.
 *     expo-sensors' Pedometer only delivers via a `watchStepCount` listener, and that
 *     listener does not fire while the app is backgrounded: the field trail shows a
 *     locked phone stuck at 2 steps for 16 minutes, while a phone that was periodically
 *     unlocked flushed backlogs of 367/211/319/147 steps on each wake. The *hardware*
 *     counted correctly the whole time — nothing was reading it. Polling the cumulative
 *     value on each background location wake is what makes it readable while locked.
 *
 *  2. `acquireWakeLock()` / `releaseWakeLock()` — a PARTIAL_WAKE_LOCK held for the
 *     duration of location tracking. A foreground service keeps the *process* alive but
 *     does NOT keep the CPU awake, and expo-location holds no wake lock of its own
 *     (verified: zero PowerManager references in its Android source). The field trail
 *     shows the consequence — a 3s requested cadence delivered at a 14–18s median with
 *     ~90s gaps, and a locked phone's median accuracy degrading to 38m against 13m for
 *     one kept awake.
 */
class OutdoorNativeModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OutdoorNative")

    /**
     * Cumulative steps since device boot, or `null` when the sensor is absent or doesn't
     * report in time. Null means "unknown" and callers must treat it as such — never as
     * zero steps taken.
     */
    AsyncFunction("getStepCount") { promise: Promise ->
      readStepCounter(promise)
    }

    /**
     * A single fix from `LocationManager.GPS_PROVIDER` — satellites only, bypassing the
     * fused provider entirely. Resolves `null` on timeout or when GPS is off.
     *
     * This exists because of the 2026-09-05 field trail. `expo-location` uses
     * `FusedLocationProviderClient` with `PRIORITY_HIGH_ACCURACY`, which is the right
     * priority — but fused is a *policy layer*, free to answer with a Wi-Fi/cell
     * trilateration when it judges that adequate, and that judgement changes once the app
     * is backgrounded. Measured consequence: a player walked past a 20 m checkpoint and
     * her backgrounded fixes never came closer than **65 m**, while claiming 27–36 m
     * accuracy; three minutes later, foregrounded on the same phone in the same woods,
     * she was at 4–10 m. Canopy doesn't change in three minutes and a wake lock didn't
     * help, so the provider's own policy is the remaining explanation.
     *
     * GPS_PROVIDER has no such policy: it either has satellites or it doesn't. The costs
     * are real — more battery, and a cold fix can take 30 s+ under canopy — which is why
     * the caller only asks for one when a player is near a checkpoint.
     */
    AsyncFunction("getGpsFix") { timeoutMs: Double, promise: Promise ->
      requestGpsFix(timeoutMs.toLong(), promise)
    }

    /**
     * Hold a partial wake lock so the CPU keeps servicing location callbacks with the
     * screen off. Idempotent. `timeoutMs` is a safety valve: the OS releases the lock
     * even if we somehow never do, so a bug here can't strand a player's battery.
     */
    Function("acquireWakeLock") { timeoutMs: Double ->
      if (wakeLock?.isHeld == true) return@Function true
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        ?: return@Function false
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OutdoorGM::LocationTracking")
      lock.setReferenceCounted(false)
      lock.acquire(timeoutMs.toLong())
      wakeLock = lock
      true
    }

    Function("releaseWakeLock") {
      releaseInternal()
      true
    }

    Function("isWakeLockHeld") {
      wakeLock?.isHeld == true
    }

    OnDestroy {
      releaseInternal()
    }
  }

  /**
   * One-shot GPS_PROVIDER fix. Registers for updates, takes the first, unregisters.
   *
   * The timeout is doing real work: under canopy a cold GPS fix can take longer than a
   * background task's execution window, and a hung promise inside the location upload
   * path would stall the fix that the caller already has in hand. On timeout we resolve
   * `null` and the caller falls back to the fused fix rather than losing the upload.
   */
  @Suppress("MissingPermission") // ACCESS_FINE_LOCATION is declared and granted before tracking starts.
  private fun requestGpsFix(timeoutMs: Long, promise: Promise) {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (lm == null || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
      promise.resolve(null)
      return
    }

    val settled = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())
    var listener: LocationListener? = null

    val finish = { loc: Location? ->
      if (settled.compareAndSet(false, true)) {
        listener?.let { runCatching { lm.removeUpdates(it) } }
        if (loc == null) {
          promise.resolve(null)
        } else {
          promise.resolve(
            mapOf(
              "latitude" to loc.latitude,
              "longitude" to loc.longitude,
              "accuracy" to if (loc.hasAccuracy()) loc.accuracy.toDouble() else null,
              "speed" to if (loc.hasSpeed()) loc.speed.toDouble() else null,
              "heading" to if (loc.hasBearing()) loc.bearing.toDouble() else null,
              "timestamp" to loc.time.toDouble(),
              "provider" to (loc.provider ?: "gps"),
              // Legacy extra that GPS_PROVIDER fixes usually carry; absent on some OEMs.
              // A low count is the direct signal that canopy is starving the receiver.
              "satellites" to loc.extras?.getInt("satellites")
            )
          )
        }
      }
    }

    listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        handler.post { finish(location) }
      }

      // Required on older API levels; no-ops on modern ones.
      override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
      override fun onProviderEnabled(provider: String) = Unit
      override fun onProviderDisabled(provider: String) {
        handler.post { finish(null) }
      }
    }

    try {
      lm.requestLocationUpdates(
        LocationManager.GPS_PROVIDER,
        0L,
        0f,
        listener,
        Looper.getMainLooper()
      )
    } catch (e: Throwable) {
      finish(null)
      return
    }

    handler.postDelayed({ finish(null) }, timeoutMs)
  }

  private fun releaseInternal() {
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
    } catch (_: Throwable) {
      // Releasing an already-released lock throws; never let teardown crash the app.
    }
    wakeLock = null
  }

  /**
   * TYPE_STEP_COUNTER is an on-change sensor, so there is no synchronous getter — we
   * register, take the first event (which carries the current cumulative total), and
   * unregister. The timeout matters: on a device without the sensor, or one that simply
   * doesn't report promptly, we must resolve `null` rather than leave the caller's
   * promise hanging inside a background task with a limited execution window.
   */
  private fun readStepCounter(promise: Promise) {
    val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    val sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (sensorManager == null || sensor == null) {
      promise.resolve(null)
      return
    }

    val settled = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())
    var listener: SensorEventListener? = null

    val finish = { value: Int? ->
      if (settled.compareAndSet(false, true)) {
        listener?.let { runCatching { sensorManager.unregisterListener(it) } }
        promise.resolve(value)
      }
    }

    listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        val steps = event.values.firstOrNull()?.toInt()
        handler.post { finish(steps) }
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    val registered = sensorManager.registerListener(
      listener,
      sensor,
      SensorManager.SENSOR_DELAY_FASTEST
    )
    if (!registered) {
      finish(null)
      return
    }

    // Give it a moment to deliver. 3s is generous for an on-change sensor that reports
    // its current value on registration, and short enough not to stall a location upload.
    handler.postDelayed({ finish(null) }, 3000)
  }
}
