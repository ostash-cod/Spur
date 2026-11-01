package de.ostash.spur

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Läuft als Vordergrunddienst, solange der Tag läuft, und schreibt GPS-Punkte in die lokale Datenbank.
 * Ohne „Tag starten“ wird nichts aufgezeichnet.
 */
class TrackingService : Service() {

    private var dayId: Long = -1
    private var sinceSync = 0
    private var running = false

    // Automatische Erkennung von Baustellen, Lager und Firma
    private var detector: PlaceDetector? = null
    private var lastFix: Fix? = null
    private var tickCount = 0
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            tickCount++
            val d = detector
            val f = lastFix
            if (d != null) {
                if (tickCount % 6 == 0) d.places = loadPlaces()
                // Liegt das Handy still, kommen keine neuen Punkte. Dann zählt der letzte Standort weiter.
                val now = System.currentTimeMillis()
                if (f != null && now - f.ts < STALE_FIX_MS) handle(d.onFix(f.copy(ts = now)))
            }
            handler.postDelayed(this, TICK_MS)
        }
    }

    private fun loadPlaces(): List<Place> =
        Db.get(this).sites().mapNotNull { s ->
            val lat = s.lat
            val lng = s.lng
            if (lat == null || lng == null) null
            else Place(s.id, lat, lng, s.radius, if (s.system != null) DWELL_SYSTEM_MS else DWELL_SITE_MS)
        }

    private fun handle(events: List<PlaceEvent>) {
        if (events.isEmpty() || dayId < 0) return
        val db = Db.get(this)
        for (e in events) {
            val open = db.openSegment(dayId)
            when (e) {
                is PlaceEvent.Arrive -> {
                    if (open?.siteId == e.siteId) continue // läuft schon (zum Beispiel von Hand gestartet)
                    db.switchSite(dayId, e.siteId, maxOf(e.at, open?.startedAt ?: e.at), "auto")
                }
                is PlaceEvent.Leave -> if (open?.siteId == e.siteId) db.endOpenSegment(dayId, maxOf(e.at, open.startedAt))
            }
        }
        SyncWorker.enqueue(this)
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val db = Db.get(this@TrackingService)
            for (loc in result.locations) {
                db.addPoint(dayId, loc.time, loc.latitude, loc.longitude, loc.accuracy)
                sinceSync++
                val fix = Fix(loc.time, loc.latitude, loc.longitude, loc.accuracy)
                lastFix = fix
                detector?.let { handle(it.onFix(fix)) }
            }
            if (sinceSync >= SYNC_EVERY_POINTS) {
                sinceSync = 0
                SyncWorker.enqueue(this@TrackingService)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val db = Db.get(this)
        when (intent?.action) {
            ACTION_STOP -> {
                stopTracking()
                db.endOpenDay(System.currentTimeMillis())
                SyncWorker.enqueue(this)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                dayId = db.startDayIfNone(System.currentTimeMillis()).id
                SyncWorker.enqueue(this)
            }
            else -> {
                // Neustart durch das System: nur weitermachen, wenn ein Tag noch läuft.
                val open = db.openDay()
                if (open == null) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                dayId = open.id
            }
        }
        startTracking()
        return START_STICKY
    }

    private fun startTracking() {
        if (running) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        startInForeground()
        if (!granted) return
        detector = PlaceDetector(loadPlaces())
        lastFix = null
        handler.removeCallbacks(tick)
        handler.postDelayed(tick, TICK_MS)
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(INTERVAL_MS / 2)
            .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
            .build()
        @Suppress("MissingPermission")
        LocationServices.getFusedLocationProviderClient(this)
            .requestLocationUpdates(request, callback, Looper.getMainLooper())
        running = true
    }

    private fun stopTracking() {
        handler.removeCallbacks(tick)
        detector = null
        if (running) {
            LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
            running = false
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    private fun startInForeground() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Spur läuft", NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Spur: Tag läuft")
            .setContentText("Der Standort wird aufgezeichnet.")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        if (running) {
            LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
            running = false
        }
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "de.ostash.spur.START"
        const val ACTION_STOP = "de.ostash.spur.STOP"
        private const val CHANNEL = "tracking"
        private const val NOTIFICATION_ID = 1
        private const val INTERVAL_MS = 15_000L
        private const val MIN_DISTANCE_M = 15f
        private const val SYNC_EVERY_POINTS = 40
        private const val TICK_MS = 20_000L
        private const val STALE_FIX_MS = 15 * 60_000L
        private const val DWELL_SITE_MS = 120_000L
        private const val DWELL_SYSTEM_MS = 60_000L

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, TrackingService::class.java).setAction(ACTION_START))
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, TrackingService::class.java).setAction(ACTION_STOP))
        }
    }
}
