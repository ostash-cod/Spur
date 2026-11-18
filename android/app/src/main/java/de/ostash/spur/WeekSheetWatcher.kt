package de.ostash.spur

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/** Schaut alle 30 Minuten nach, ob der Chef einen Wochenzettel geschickt hat, und meldet das einmal pro Zettel. */
class WeekSheetWatcher(private val ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val token = Prefs.token(ctx) ?: return@withContext Result.success()
        runCatching {
            val arr = Api.getArray(ctx, "/api/week-sheets", token)
            val seen = Prefs.notifiedWeekSheets(ctx).toMutableSet()
            for (i in 0 until arr.length()) {
                val w = arr.getJSONObject(i)
                if (w.optString("status") != "sent") continue
                val key = "${w.getInt("id")}:${w.getLong("sent_at")}"
                if (key in seen) continue
                notifyNew(ctx, w.getJSONObject("snapshot").optInt("kw"))
                seen.add(key)
            }
            Prefs.setNotifiedWeekSheets(ctx, seen.toList().takeLast(50).toSet())
        }
        Result.success()
    }

    companion object {
        private const val CHANNEL = "wochenzettel"
        private const val NOTIFICATION_ID = 4711

        fun schedule(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<WeekSheetWatcher>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("week-sheet-watch", ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun notifyNew(ctx: Context, kw: Int) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Wochenzettel", NotificationManager.IMPORTANCE_DEFAULT))
            }
            val open = PendingIntent.getActivity(ctx, 3, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_agenda)
                .setContentTitle("Spur: Wochenzettel zum Prüfen")
                .setContentText("Dein Chef hat die Woche (KW $kw) geschickt. Bitte prüfen und bestätigen (Berichte).")
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            runCatching { nm.notify(NOTIFICATION_ID, n) }
        }
    }
}
