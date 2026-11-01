package de.ostash.spur

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Gleicht Tage und GPS-Punkte mit dem Server ab, sobald Internet da ist. */
class SyncWorker(private val ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val token = Prefs.token(ctx) ?: return@withContext Result.success()
        val db = Db.get(ctx)
        try {
            for (day in db.daysNeedingSync()) {
                var serverId = day.serverId
                if (serverId == null || day.dirty) {
                    val body = JSONObject()
                        .put("client_id", day.clientId)
                        .put("started_at", day.startedAt)
                        .put("ended_at", day.endedAt ?: JSONObject.NULL)
                    serverId = Api.post(ctx, "/api/days", body, token).getLong("id")
                    db.setServerId(day.id, serverId)
                    db.clearDirty(day.id, day.endedAt)
                }
                while (true) {
                    val points = db.unsyncedPoints(day.id, 200)
                    if (points.isEmpty()) break
                    val arr = JSONArray()
                    for (p in points) {
                        arr.put(JSONObject().put("ts", p.ts).put("lat", p.lat).put("lng", p.lng).put("acc", p.acc.toDouble()))
                    }
                    Api.post(ctx, "/api/days/$serverId/points", JSONObject().put("points", arr), token)
                    db.markPointsSynced(points.map { it.id })
                }
            }
            Prefs.setLastSync(ctx, System.currentTimeMillis())
            Result.success()
        } catch (e: Api.ApiException) {
            when {
                e.code == 401 -> { Prefs.logout(ctx); Result.failure() }
                e.code >= 500 || e.code == 0 -> Result.retry()
                else -> Result.failure()
            }
        } catch (e: IOException) {
            Result.retry()
        }
    }

    companion object {
        fun enqueue(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("sync", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}
