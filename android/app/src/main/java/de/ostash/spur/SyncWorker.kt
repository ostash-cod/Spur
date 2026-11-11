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
            // Wer bin ich? (Der Chef-Status steht auf dem Server und kann sich seit der Anmeldung geändert haben.)
            runCatching {
                val me = Api.get(ctx, "/api/me", token)
                Prefs.setAdmin(ctx, me.optString("role") == "admin")
                Prefs.setCanReceipts(ctx, me.optBoolean("can_receipts", false))
                Prefs.setHomeKm(ctx, if (me.isNull("home_km")) 0.0 else me.optDouble("home_km", 0.0))
            }
            // Aktuelle Baustellen vom Server holen (für die Kacheln).
            val sites = Api.getArray(ctx, "/api/sites", token)
            db.replaceSites(
                buildList {
                    for (i in 0 until sites.length()) {
                        val o = sites.getJSONObject(i)
                        add(
                            SiteRow(
                                id = o.getLong("id"),
                                name = o.getString("name"),
                                customerName = if (o.isNull("customer_name")) null else o.getString("customer_name"),
                                color = o.getString("color"),
                                lat = if (o.isNull("lat")) null else o.getDouble("lat"),
                                lng = if (o.isNull("lng")) null else o.getDouble("lng"),
                                radius = o.optDouble("radius_m", 100.0),
                                system = if (o.isNull("system")) null else o.getString("system"),
                                kind = o.optString("kind", "baustelle"),
                                extra = extraString(o),
                            ),
                        )
                    }
                },
            )
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
                val segments = db.dirtySegments(day.id)
                if (segments.isNotEmpty()) {
                    val arr = JSONArray()
                    for (s in segments) {
                        arr.put(
                            JSONObject()
                                .put("client_id", s.clientId)
                                .put("site_id", s.siteId ?: JSONObject.NULL)
                                .put("kind", s.kind)
                                .put("started_at", s.startedAt)
                                .put("ended_at", s.endedAt ?: JSONObject.NULL)
                                .put("source", s.source)
                                .put("activity", s.activity ?: JSONObject.NULL),
                        )
                    }
                    try {
                        Api.post(ctx, "/api/days/$serverId/segments", JSONObject().put("segments", arr), token)
                    } catch (e: Api.ApiException) {
                        // Eine Baustelle, die es nicht mehr gibt, darf den Abgleich nicht für immer blockieren.
                        if (e.code != 400) throw e
                    }
                    for (s in segments) db.clearSegmentDirty(s.id, s.endedAt)
                }
            }
            for ((date, json) in db.unsentSheets()) {
                try {
                    Api.post(ctx, "/api/sheets", JSONObject(json), token)
                    db.sheetSent(date, json)
                } catch (e: Api.ApiException) {
                    if (e.code != 400) throw e
                    db.sheetSent(date, json)
                }
            }
            for (r in db.pendingReceipts()) {
                var uploaded = r.uploaded
                if (!uploaded) {
                    val f = java.io.File(r.path)
                    if (!f.exists()) { db.markReceiptUploaded(r.id); uploaded = true }
                    else try {
                        val type = if (r.path.endsWith(".pdf")) "application/pdf" else "image/jpeg"
                        Api.postBytes(ctx, "/api/receipts", f.readBytes(), type, mapOf("x-client-id" to r.clientId, "x-taken-at" to r.takenAt.toString()), token)
                        db.markReceiptUploaded(r.id)
                        f.delete() // auf dem Handy wird kein Beleg behalten
                        uploaded = true
                    } catch (e: Api.ApiException) {
                        if (e.code == 403 || e.code == 415 || e.code == 400) { db.markReceiptUploaded(r.id); f.delete(); uploaded = true } else throw e
                    }
                }
                if (uploaded && r.allocsDirty) {
                    val arr = r.allocs?.let { JSONArray(it) } ?: JSONArray()
                    try {
                        Api.post(ctx, "/api/receipts/allocs", JSONObject().put("client_id", r.clientId).put("allocs", arr), token)
                    } catch (e: Api.ApiException) {
                        if (e.code != 400 && e.code != 404) throw e
                    }
                    db.markReceiptAllocsSent(r.id)
                }
            }
            for (n in db.unsyncedNotes()) {
                try {
                    Api.post(
                        ctx, "/api/notes",
                        JSONObject().put("client_id", n.clientId).put("date", n.date)
                            .put("site_id", n.siteId ?: JSONObject.NULL).put("text", n.text).put("kind", n.kind)
                            .put("updated_at", System.currentTimeMillis()),
                        token,
                    )
                    if (n.text.isEmpty()) db.deleteNoteRow(n.id) else db.markNoteSynced(n.id, n.text)
                } catch (e: Api.ApiException) {
                    if (e.code != 400) throw e
                    db.markNoteSynced(n.id, n.text)
                }
            }
            for (p in db.unsyncedPhotos()) {
                val f = java.io.File(p.path)
                if (!f.exists()) { db.markPhotoSynced(p.id); continue }
                try {
                    val headers = mutableMapOf("x-client-id" to p.clientId, "x-taken-at" to p.takenAt.toString())
                    if (p.siteId != null) headers["x-site-id"] = p.siteId.toString()
                    Api.postBytes(ctx, "/api/photos", f.readBytes(), "image/jpeg", headers, token)
                    db.markPhotoSynced(p.id)
                } catch (e: Api.ApiException) {
                    if (e.code != 400) throw e
                    db.markPhotoSynced(p.id)
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

/** Weitere Punkte eines Ortes aus der Antwort des Servers als "lat,lng;lat,lng". */
fun extraString(o: JSONObject): String {
    val arr = o.optJSONArray("extra_points") ?: return ""
    return (0 until arr.length()).joinToString(";") { i -> arr.getJSONObject(i).let { "${it.getDouble("lat")},${it.getDouble("lng")}" } }
}
