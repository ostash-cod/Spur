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

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val db = Db.get(this@TrackingService)
            for (loc in result.locations) {
                db.addPoint(dayId, loc.time, loc.latitude, loc.longitude, loc.accuracy)
                sinceSync++
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

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, TrackingService::class.java).setAction(ACTION_START))
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, TrackingService::class.java).setAction(ACTION_STOP))
        }
    }
}
