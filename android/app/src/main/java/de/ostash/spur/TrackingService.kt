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
    private var stopDetector: StopDetector? = null
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
                if (f != null && now - f.ts < STALE_FIX_MS) {
                    val fix = f.copy(ts = now)
                    handle(d.onFix(fix))
                    checkAway(fix, d)
                    stopDetector?.onFix(fix, d.currentSiteId != null)?.let { handleStop(it) }
                }
            }
            askLongStop()
            handler.postDelayed(this, TICK_MS)
        }
    }

    private var askedStopId = -1L

    private fun askLongStop() {
        if (dayId < 0) return
        val st = Db.get(this).latestStop(dayId) ?: return
        if (st.state == "pending" && st.endedAt == null && st.id != askedStopId && System.currentTimeMillis() - st.startedAt >= ASK_AFTER_MS) {
            askedStopId = st.id
            notifyStop(st.startedAt)
        }
    }

    // Von Hand gestartete (oder nach einem Neustart nicht erkannte) Baustelle: Entfernt man sich weit und lange, endet sie von selbst.
    private var awaySince: Long? = null
    private var awaySiteId: Long? = null

    private fun checkAway(f: Fix, d: PlaceDetector) {
        if (dayId < 0 || f.accuracy > 100f) return
        val db = Db.get(this)
        val open = db.openSegment(dayId)
        val mine = if (open?.kind == "work" && open.siteId != null && d.currentSiteId != open.siteId) d.places.filter { it.siteId == open.siteId } else emptyList()
        val place = mine.minByOrNull { distanceMeters(f.lat, f.lng, it.lat, it.lng) - it.radiusM }
        if (open == null || place == null) { awaySince = null; awaySiteId = null; return }
        if (mine.any { distanceMeters(f.lat, f.lng, it.lat, it.lng) <= it.radiusM + AWAY_EXTRA_M }) { awaySince = null; awaySiteId = null; return }
        if (awaySiteId != open.siteId) { awaySiteId = open.siteId; awaySince = f.ts }
        val since = awaySince ?: f.ts.also { awaySince = it }
        if (f.ts - since >= AWAY_MS) {
            // Ende = letzter Punkt, an dem man noch bei der Baustelle war
            val lastInside = db.pointsSince(dayId, open.startedAt)
                .lastOrNull { p -> p.acc <= 100f && mine.any { distanceMeters(p.lat, p.lng, it.lat, it.lng) <= it.radiusM + AWAY_EXTRA_M } }?.ts
            db.endOpenSegment(dayId, maxOf(lastInside ?: since, open.startedAt))
            awaySince = null; awaySiteId = null
            SyncWorker.enqueue(this)
        }
    }

    private fun loadPlaces(): List<Place> =
        Db.get(this).sites().flatMap { s ->
            val main = placeFor(s, s.lat, s.lng)
            listOfNotNull(main) + s.extraPoints().mapNotNull { placeFor(s, it.first, it.second) }
        }

    private fun placeFor(s: SiteRow, lat: Double?, lng: Double?): Place? =
        run {
            if (lat == null || lng == null) null
            else {
                val baustelle = s.system == null && s.kind != "haendler"
                Place(
                    s.id, lat, lng,
                    if (s.system != null) s.radius else maxOf(s.radius, if (s.kind == "haendler") HAENDLER_MIN_RADIUS_M else BAUSTELLE_MIN_RADIUS_M),
                    if (s.system != null || s.kind == "haendler") DWELL_SYSTEM_MS else DWELL_SITE_MS,
                    // Eine Baustelle verlässt man nicht, nur weil man ums Haus fährt: weiter weg und länger draußen.
                    leaveMarginM = if (baustelle) 120.0 else null,
                    leaveDebounceMs = if (baustelle) 4 * 60_000L else null,
                )
            }
        }

    private fun handle(events: List<PlaceEvent>) {
        if (events.isEmpty() || dayId < 0) return
        val db = Db.get(this)
        for (e in events) {
            val open = db.openSegment(dayId)
            when (e) {
                is PlaceEvent.Arrive -> {
                    if (open?.siteId == e.siteId) continue // läuft schon (zum Beispiel von Hand gestartet)
                    // Kommt man nach kurzer Zeit zur selben Baustelle zurück (Parkplatz suchen), läuft der alte Abschnitt einfach weiter.
                    val prev = if (open == null) db.lastEndedSegment(dayId) else null
                    if (prev != null && prev.kind == "work" && prev.siteId == e.siteId && prev.endedAt != null && e.at - prev.endedAt < RETURN_GAP_MS) {
                        db.reopenSegment(prev.id)
                    } else {
                        db.switchSite(dayId, e.siteId, maxOf(e.at, open?.startedAt ?: e.at), "auto")
                    }
                }
                is PlaceEvent.Leave -> if (open?.siteId == e.siteId) db.endOpenSegment(dayId, maxOf(e.at, open.startedAt))
            }
        }
        SyncWorker.enqueue(this)
    }

    // Halt an einem unbekannten Ort: Die App merkt ihn sich und fragt (Pause, Ort benennen oder einfach weiter).
    private fun handleStop(e: StopEvent) {
        if (dayId < 0) return
        val db = Db.get(this)
        when (e) {
            is StopEvent.Stop -> {
                // Hat der Mitarbeiter von Hand eine Baustelle gewählt, steht er dort. Dann wird nicht gefragt.
                if (db.openSegment(dayId)?.kind == "work") return
                // Zwei Halte kurz nacheinander und nah beieinander (zum Beispiel Parkplatz und Markt) sind ein Besuch.
                val last = db.latestStop(dayId)
                if (last != null && last.state == "pending" && last.endedAt != null && e.since - last.endedAt < MERGE_GAP_MS &&
                    distanceMeters(last.lat, last.lng, e.lat, e.lng) < MERGE_DIST_M
                ) {
                    db.reopenStop(last.id)
                    return
                }
                db.addStop(dayId, e.lat, e.lng, e.since)
                // Kurze Halte (3 bis 10 Minuten) stehen still in der Liste. Gefragt wird erst nach 10 Minuten (siehe tick).
            }
            is StopEvent.Resume -> {
                val stop = db.latestStop(dayId) ?: return
                if (stop.endedAt != null) return
                db.endStop(stop.id, e.at)
                // Eine Pause oder ein Händler-Abschnitt, der von diesem Halt kam, endet mit dem Halt.
                stop.segClientId?.let { db.endSegmentByClientId(dayId, it, maxOf(e.at, stop.startedAt)) }
                SyncWorker.enqueue(this)
            }
        }
    }

    private fun notifyStop(since: Long) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(ASK_CHANNEL, "Nachfragen", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            this, 1, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val time = java.text.SimpleDateFormat("HH:mm", java.util.Locale.GERMANY).format(java.util.Date(since))
        val n = NotificationCompat.Builder(this, ASK_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Spur: Wo bist du?")
            .setContentText("Du stehst seit $time Uhr an einem unbekannten Ort. Zum Antworten tippen.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(ASK_NOTIFICATION_ID, n) }
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val db = Db.get(this@TrackingService)
            for (loc in result.locations) {
                db.addPoint(dayId, loc.time, loc.latitude, loc.longitude, loc.accuracy)
                sinceSync++
                val fix = Fix(loc.time, loc.latitude, loc.longitude, loc.accuracy)
                lastFix = fix
                detector?.let { d ->
                    handle(d.onFix(fix))
                    checkAway(fix, d)
                    stopDetector?.onFix(fix, d.currentSiteId != null)?.let { handleStop(it) }
                }
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
        stopDetector = StopDetector()
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
        stopDetector = null
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
        private const val ASK_CHANNEL = "ask"
        private const val ASK_NOTIFICATION_ID = 2
        private const val ASK_AFTER_MS = 10 * 60_000L
        private const val RETURN_GAP_MS = 20 * 60_000L
        private const val AWAY_MS = 3 * 60_000L
        private const val AWAY_EXTRA_M = 150.0
        private const val MERGE_GAP_MS = 5 * 60_000L
        private const val MERGE_DIST_M = 300.0
        private const val HAENDLER_MIN_RADIUS_M = 150.0
        private const val BAUSTELLE_MIN_RADIUS_M = 200.0
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
