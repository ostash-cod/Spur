package de.ostash.spur

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

data class DayRow(
    val id: Long,
    val clientId: String,
    val startedAt: Long,
    val endedAt: Long?,
    val serverId: Long?,
    val dirty: Boolean,
)

data class PointRow(val id: Long, val ts: Long, val lat: Double, val lng: Double, val acc: Float)

data class SiteRow(
    val id: Long,
    val name: String,
    val customerName: String?,
    val color: String,
    val lat: Double?,
    val lng: Double?,
    val radius: Double,
    val system: String?,
    val kind: String = "baustelle",
    /** Weitere Punkte des Ortes als "lat,lng;lat,lng" (Parkplatz, andere Seite). */
    val extra: String = "",
) {
    fun extraPoints(): List<Pair<Double, Double>> =
        extra.split(";").mapNotNull { p ->
            val a = p.split(",")
            val la = a.getOrNull(0)?.toDoubleOrNull()
            val lo = a.getOrNull(1)?.toDoubleOrNull()
            if (la != null && lo != null) la to lo else null
        }

    /** Kleinster Abstand zu einem der bekannten Punkte des Ortes (Mitte und weitere Punkte). */
    fun distanceTo(lat: Double, lng: Double): Double? {
        val all = buildList { if (this@SiteRow.lat != null && this@SiteRow.lng != null) add(this@SiteRow.lat to this@SiteRow.lng); addAll(extraPoints()) }
        return all.minOfOrNull { distanceMeters(it.first, it.second, lat, lng) }
    }
}

/** Ein Halt an einem unbekannten Ort. Die App fragt, was das war (Pause, Händler, einfach weiter). */
data class StopRow(
    val id: Long,
    val dayId: Long,
    val lat: Double,
    val lng: Double,
    val startedAt: Long,
    val endedAt: Long?,
    val state: String, // 'pending' oder 'done'
    val segClientId: String?,
)

data class SegmentRow(
    val id: Long,
    val dayId: Long,
    val clientId: String,
    val siteId: Long?,
    val kind: String,
    val startedAt: Long,
    val endedAt: Long?,
    val source: String,
)

/**
 * Lokale Datenbank: Alles wird zuerst hier gespeichert und später mit dem Server abgeglichen,
 * damit auch ohne Internet nichts verloren geht.
 */
class Db private constructor(ctx: Context) : SQLiteOpenHelper(ctx, "spur.db", null, 10) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE days (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL UNIQUE,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                server_id INTEGER,
                dirty INTEGER NOT NULL DEFAULT 1)""",
        )
        db.execSQL(
            """CREATE TABLE points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day_id INTEGER NOT NULL,
                ts INTEGER NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                acc REAL NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0,
                UNIQUE(day_id, ts))""",
        )
        createSiteTables(db)
        createNoteTables(db)
        createSheetTables(db)
    }

    private fun createSheetTables(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS trip_marks (day_id INTEGER NOT NULL, start_ts INTEGER NOT NULL, vehicle TEXT NOT NULL, km REAL, PRIMARY KEY (day_id, start_ts))")
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL UNIQUE,
                path TEXT NOT NULL,
                taken_at INTEGER NOT NULL,
                uploaded INTEGER NOT NULL DEFAULT 0,
                allocs TEXT,
                allocs_dirty INTEGER NOT NULL DEFAULT 0)""",
        )
        db.execSQL("CREATE TABLE IF NOT EXISTS week_closed (week_start TEXT PRIMARY KEY)")
        db.execSQL("CREATE TABLE IF NOT EXISTS day_pause (day_id INTEGER PRIMARY KEY, minutes INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE IF NOT EXISTS sheet_outbox (date TEXT PRIMARY KEY, json TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0)")
    }

    private fun createNoteTables(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL UNIQUE,
                date TEXT NOT NULL,
                site_id INTEGER,
                text TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL DEFAULT 'arbeit')""",
        )
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL UNIQUE,
                path TEXT NOT NULL,
                site_id INTEGER,
                taken_at INTEGER NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0)""",
        )
    }

    private fun createSiteTables(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS sites (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                customer_name TEXT,
                color TEXT NOT NULL,
                lat REAL,
                lng REAL,
                radius REAL NOT NULL,
                system TEXT,
                kind TEXT NOT NULL DEFAULT 'baustelle',
                extra TEXT NOT NULL DEFAULT '')""",
        )
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS stops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day_id INTEGER NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                state TEXT NOT NULL DEFAULT 'pending',
                seg_client_id TEXT)""",
        )
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day_id INTEGER NOT NULL,
                client_id TEXT NOT NULL UNIQUE,
                site_id INTEGER,
                kind TEXT NOT NULL DEFAULT 'work',
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                source TEXT NOT NULL DEFAULT 'manual',
                dirty INTEGER NOT NULL DEFAULT 1)""",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        createNoteTables(db)
        createSheetTables(db)
        val noteHasKind = db.rawQuery("PRAGMA table_info(notes)", null).use { c ->
            var found = false
            while (c.moveToNext()) if (c.getString(1) == "kind") found = true
            found
        }
        if (!noteHasKind) db.execSQL("ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'arbeit'")
        if (oldVersion < 2) createSiteTables(db)
        if (oldVersion in 2..2) db.execSQL("ALTER TABLE sites ADD COLUMN system TEXT")
        if (oldVersion in 2..3) db.execSQL("ALTER TABLE sites ADD COLUMN kind TEXT NOT NULL DEFAULT 'baustelle'")
        if (oldVersion < 4) createSiteTables(db)
        val hasExtra = db.rawQuery("PRAGMA table_info(sites)", null).use { c ->
            var found = false
            while (c.moveToNext()) if (c.getString(1) == "extra") found = true
            found
        }
        if (!hasExtra) db.execSQL("ALTER TABLE sites ADD COLUMN extra TEXT NOT NULL DEFAULT ''")
    }

    fun dayById(id: Long): DayRow? =
        readableDatabase.rawQuery("SELECT $dayColumns FROM days WHERE id = ?", arrayOf(id.toString()))
            .use { c -> if (c.moveToFirst()) day(c) else null }

    private fun day(c: Cursor) = DayRow(
        id = c.getLong(0),
        clientId = c.getString(1),
        startedAt = c.getLong(2),
        endedAt = if (c.isNull(3)) null else c.getLong(3),
        serverId = if (c.isNull(4)) null else c.getLong(4),
        dirty = c.getInt(5) != 0,
    )

    private val dayColumns = "id, client_id, started_at, ended_at, server_id, dirty"

    /** Startet einen Tag, falls noch keiner läuft. Gibt den laufenden Tag zurück. */
    @Synchronized
    fun startDayIfNone(now: Long): DayRow {
        openDay()?.let { return it }
        val cv = ContentValues().apply {
            put("client_id", UUID.randomUUID().toString())
            put("started_at", now)
        }
        writableDatabase.insertOrThrow("days", null, cv)
        return openDay()!!
    }

    @Synchronized
    fun endOpenDay(now: Long) {
        val cv = ContentValues().apply {
            put("ended_at", now)
            put("dirty", 1)
        }
        writableDatabase.update("days", cv, "ended_at IS NULL", null)
        endAllOpenSegments(now)
    }

    fun openDay(): DayRow? =
        readableDatabase.rawQuery(
            "SELECT $dayColumns FROM days WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1",
            null,
        ).use { if (it.moveToFirst()) day(it) else null }

    fun addPoint(dayId: Long, ts: Long, lat: Double, lng: Double, acc: Float) {
        val cv = ContentValues().apply {
            put("day_id", dayId)
            put("ts", ts)
            put("lat", lat)
            put("lng", lng)
            put("acc", acc.toDouble())
        }
        writableDatabase.insertWithOnConflict("points", null, cv, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun countPoints(dayId: Long): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM points WHERE day_id = ?", arrayOf(dayId.toString()))
            .use { it.moveToFirst(); it.getInt(0) }

    fun unsyncedPointCount(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM points WHERE synced = 0", null)
            .use { it.moveToFirst(); it.getInt(0) }

    fun daysNeedingSync(): List<DayRow> =
        readableDatabase.rawQuery(
            """SELECT $dayColumns FROM days
               WHERE dirty = 1 OR id IN (SELECT day_id FROM points WHERE synced = 0)
                  OR id IN (SELECT day_id FROM segments WHERE dirty = 1)
               ORDER BY id""",
            null,
        ).use { c -> buildList { while (c.moveToNext()) add(day(c)) } }

    fun unsyncedPoints(dayId: Long, limit: Int): List<PointRow> =
        readableDatabase.rawQuery(
            "SELECT id, ts, lat, lng, acc FROM points WHERE day_id = ? AND synced = 0 ORDER BY ts LIMIT $limit",
            arrayOf(dayId.toString()),
        ).use { c ->
            buildList { while (c.moveToNext()) add(PointRow(c.getLong(0), c.getLong(1), c.getDouble(2), c.getDouble(3), c.getFloat(4))) }
        }

    fun markPointsSynced(ids: List<Long>) {
        if (ids.isEmpty()) return
        writableDatabase.execSQL("UPDATE points SET synced = 1 WHERE id IN (${ids.joinToString(",")})")
    }

    fun setServerId(dayId: Long, serverId: Long) {
        writableDatabase.execSQL("UPDATE days SET server_id = ? WHERE id = ?", arrayOf<Any>(serverId, dayId))
    }

    /** Nimmt die Markierung „noch abzugleichen“ nur weg, wenn sich der Tag inzwischen nicht geändert hat. */
    fun clearDirty(dayId: Long, endedAtSent: Long?) {
        if (endedAtSent == null) {
            writableDatabase.execSQL("UPDATE days SET dirty = 0 WHERE id = ? AND ended_at IS NULL", arrayOf<Any>(dayId))
        } else {
            writableDatabase.execSQL(
                "UPDATE days SET dirty = 0 WHERE id = ? AND ended_at = ?",
                arrayOf<Any>(dayId, endedAtSent),
            )
        }
    }


    // --- Baustellen (Kopie vom Server, auch ohne Internet nutzbar) ---
    @Synchronized
    fun replaceSites(list: List<SiteRow>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("sites", null, null)
            for (s in list) {
                val cv = ContentValues().apply {
                    put("id", s.id)
                    put("name", s.name)
                    put("customer_name", s.customerName)
                    put("color", s.color)
                    if (s.lat != null) put("lat", s.lat) else putNull("lat")
                    if (s.lng != null) put("lng", s.lng) else putNull("lng")
                    put("radius", s.radius)
                    put("system", s.system)
                    put("kind", s.kind)
                    put("extra", s.extra)
                }
                db.insert("sites", null, cv)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun sites(): List<SiteRow> =
        readableDatabase.rawQuery(
            "SELECT id, name, customer_name, color, lat, lng, radius, system, kind, extra FROM sites ORDER BY (system IS NOT NULL), name COLLATE NOCASE",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        SiteRow(
                            c.getLong(0), c.getString(1), if (c.isNull(2)) null else c.getString(2), c.getString(3),
                            if (c.isNull(4)) null else c.getDouble(4), if (c.isNull(5)) null else c.getDouble(5), c.getDouble(6),
                            if (c.isNull(7)) null else c.getString(7),
                            c.getString(8),
                            c.getString(9),
                        ),
                    )
                }
            }
        }

    // --- Zeitabschnitte (auf welcher Baustelle von wann bis wann) ---
    private fun segment(c: Cursor) = SegmentRow(
        id = c.getLong(0),
        dayId = c.getLong(1),
        clientId = c.getString(2),
        siteId = if (c.isNull(3)) null else c.getLong(3),
        kind = c.getString(4),
        startedAt = c.getLong(5),
        endedAt = if (c.isNull(6)) null else c.getLong(6),
        source = c.getString(7),
    )

    private val segmentColumns = "id, day_id, client_id, site_id, kind, started_at, ended_at, source"

    fun openSegment(dayId: Long): SegmentRow? =
        readableDatabase.rawQuery(
            "SELECT $segmentColumns FROM segments WHERE day_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            arrayOf(dayId.toString()),
        ).use { if (it.moveToFirst()) segment(it) else null }

    fun lastEndedSegment(dayId: Long): SegmentRow? =
        readableDatabase.rawQuery(
            "SELECT $segmentColumns FROM segments WHERE day_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1",
            arrayOf(dayId.toString()),
        ).use { if (it.moveToFirst()) segment(it) else null }

    @Synchronized
    fun reopenSegment(id: Long) {
        writableDatabase.execSQL("UPDATE segments SET ended_at = NULL, dirty = 1 WHERE id = ?", arrayOf<Any>(id))
    }

    /** Beendet den laufenden Abschnitt und startet einen neuen auf der gewählten Baustelle. */
    @Synchronized
    fun switchSite(dayId: Long, siteId: Long, now: Long, source: String = "manual") {
        endOpenSegment(dayId, now)
        val cv = ContentValues().apply {
            put("day_id", dayId)
            put("client_id", UUID.randomUUID().toString())
            put("site_id", siteId)
            put("kind", "work")
            put("started_at", now)
            put("source", source)
        }
        writableDatabase.insertOrThrow("segments", null, cv)
    }

    @Synchronized
    fun endOpenSegment(dayId: Long, now: Long) {
        val cv = ContentValues().apply {
            put("ended_at", now)
            put("dirty", 1)
        }
        writableDatabase.update("segments", cv, "day_id = ? AND ended_at IS NULL", arrayOf(dayId.toString()))
    }

    @Synchronized
    fun endAllOpenSegments(now: Long) {
        val cv = ContentValues().apply {
            put("ended_at", now)
            put("dirty", 1)
        }
        writableDatabase.update("segments", cv, "ended_at IS NULL", null)
    }

    fun dirtySegments(dayId: Long): List<SegmentRow> =
        readableDatabase.rawQuery(
            "SELECT $segmentColumns FROM segments WHERE day_id = ? AND dirty = 1 ORDER BY id",
            arrayOf(dayId.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(segment(c)) } }

    /** Nimmt die Markierung nur weg, wenn sich der Abschnitt seit dem Senden nicht geändert hat. */
    fun clearSegmentDirty(id: Long, endedAtSent: Long?) {
        if (endedAtSent == null) {
            writableDatabase.execSQL("UPDATE segments SET dirty = 0 WHERE id = ? AND ended_at IS NULL", arrayOf<Any>(id))
        } else {
            writableDatabase.execSQL("UPDATE segments SET dirty = 0 WHERE id = ? AND ended_at = ?", arrayOf<Any>(id, endedAtSent))
        }
    }

    fun latestDay(): DayRow? =
        readableDatabase.rawQuery("SELECT $dayColumns FROM days ORDER BY started_at DESC LIMIT 1", null)
            .use { if (it.moveToFirst()) day(it) else null }

    fun segmentsOfDay(dayId: Long): List<SegmentRow> =
        readableDatabase.rawQuery(
            "SELECT $segmentColumns FROM segments WHERE day_id = ? ORDER BY started_at",
            arrayOf(dayId.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(segment(c)) } }

    /** Alle Punkte des Tages ab [fromTs], älteste zuerst. */
    fun pointsSince(dayId: Long, fromTs: Long): List<PointRow> =
        readableDatabase.rawQuery("SELECT id, ts, lat, lng, acc FROM points WHERE day_id = ? AND ts >= ? ORDER BY ts", arrayOf(dayId.toString(), fromTs.toString()))
            .use { c -> buildList { while (c.moveToNext()) add(PointRow(c.getLong(0), c.getLong(1), c.getDouble(2), c.getDouble(3), c.getFloat(4))) } }

    fun lastPoint(): PointRow? =
        readableDatabase.rawQuery("SELECT id, ts, lat, lng, acc FROM points ORDER BY ts DESC LIMIT 1", null)
            .use { c -> if (c.moveToFirst()) PointRow(c.getLong(0), c.getLong(1), c.getDouble(2), c.getDouble(3), c.getFloat(4)) else null }

    // --- Halte an unbekannten Orten ---
    private fun stop(c: Cursor) = StopRow(
        id = c.getLong(0), dayId = c.getLong(1), lat = c.getDouble(2), lng = c.getDouble(3), startedAt = c.getLong(4),
        endedAt = if (c.isNull(5)) null else c.getLong(5), state = c.getString(6), segClientId = if (c.isNull(7)) null else c.getString(7),
    )
    private val stopColumns = "id, day_id, lat, lng, started_at, ended_at, state, seg_client_id"

    @Synchronized
    fun addStop(dayId: Long, lat: Double, lng: Double, startedAt: Long): Long {
        val cv = ContentValues().apply {
            put("day_id", dayId); put("lat", lat); put("lng", lng); put("started_at", startedAt)
        }
        return writableDatabase.insertOrThrow("stops", null, cv)
    }

    fun pendingStops(dayId: Long): List<StopRow> =
        readableDatabase.rawQuery("SELECT $stopColumns FROM stops WHERE day_id = ? AND state = 'pending' ORDER BY started_at", arrayOf(dayId.toString()))
            .use { c -> buildList { while (c.moveToNext()) add(stop(c)) } }

    fun latestStop(dayId: Long): StopRow? =
        readableDatabase.rawQuery("SELECT $stopColumns FROM stops WHERE day_id = ? ORDER BY started_at DESC LIMIT 1", arrayOf(dayId.toString()))
            .use { if (it.moveToFirst()) stop(it) else null }

    /** Zwei Halte nah beieinander sind ein Besuch: der frühere Halt läuft einfach weiter. */
    @Synchronized
    fun reopenStop(id: Long) {
        writableDatabase.execSQL("UPDATE stops SET ended_at = NULL WHERE id = ?", arrayOf<Any>(id))
    }

    @Synchronized
    fun endStop(id: Long, endedAt: Long) {
        writableDatabase.execSQL("UPDATE stops SET ended_at = ? WHERE id = ? AND ended_at IS NULL", arrayOf<Any>(endedAt, id))
    }

    @Synchronized
    fun finishStop(id: Long, segClientId: String?) {
        val cv = ContentValues().apply {
            put("state", "done")
            if (segClientId != null) put("seg_client_id", segClientId)
        }
        writableDatabase.update("stops", cv, "id = ?", arrayOf(id.toString()))
    }

    /** Legt einen Abschnitt an (zum Beispiel Pause oder Händler) und beendet davor einen laufenden, der früher begann. */
    @Synchronized
    fun insertSegment(dayId: Long, siteId: Long?, kind: String, startedAt: Long, endedAt: Long?, source: String = "manual"): String {
        val open = openSegment(dayId)
        if (open != null && open.startedAt <= startedAt) endOpenSegment(dayId, startedAt)
        val clientId = UUID.randomUUID().toString()
        val cv = ContentValues().apply {
            put("day_id", dayId)
            put("client_id", clientId)
            if (siteId != null) put("site_id", siteId) else putNull("site_id")
            put("kind", kind)
            put("started_at", startedAt)
            if (endedAt != null) put("ended_at", endedAt) else putNull("ended_at")
            put("source", source)
        }
        writableDatabase.insertOrThrow("segments", null, cv)
        return clientId
    }

    @Synchronized
    fun endSegmentByClientId(dayId: Long, clientId: String, endedAt: Long) {
        val cv = ContentValues().apply { put("ended_at", endedAt); put("dirty", 1) }
        writableDatabase.update("segments", cv, "day_id = ? AND client_id = ? AND ended_at IS NULL", arrayOf(dayId.toString(), clientId))
    }

    /** Neuer Ort (zum Beispiel Händler), sofort lokal bekannt, bevor der nächste Abgleich läuft. */
    @Synchronized
    fun upsertSite(s: SiteRow) {
        val cv = ContentValues().apply {
            put("id", s.id); put("name", s.name); put("customer_name", s.customerName); put("color", s.color)
            if (s.lat != null) put("lat", s.lat) else putNull("lat")
            if (s.lng != null) put("lng", s.lng) else putNull("lng")
            put("radius", s.radius); put("system", s.system); put("kind", s.kind); put("extra", s.extra)
        }
        writableDatabase.insertWithOnConflict("sites", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    // ---- Belege ----
    data class ReceiptRow(val id: Long, val clientId: String, val path: String, val takenAt: Long, val uploaded: Boolean, val allocs: String?, val allocsDirty: Boolean)

    fun addReceipt(clientId: String, path: String, takenAt: Long) {
        writableDatabase.execSQL("INSERT OR IGNORE INTO receipts (client_id, path, taken_at) VALUES (?, ?, ?)", arrayOf<Any>(clientId, path, takenAt))
    }

    fun setReceiptAllocs(clientId: String, json: String?) {
        writableDatabase.execSQL("UPDATE receipts SET allocs = ?, allocs_dirty = 1 WHERE client_id = ?", arrayOf<Any?>(json, clientId))
    }

    fun pendingReceipts(): List<ReceiptRow> =
        readableDatabase.rawQuery("SELECT id, client_id, path, taken_at, uploaded, allocs, allocs_dirty FROM receipts WHERE uploaded = 0 OR allocs_dirty = 1 ORDER BY id", null)
            .use { c -> buildList { while (c.moveToNext()) add(ReceiptRow(c.getLong(0), c.getString(1), c.getString(2), c.getLong(3), c.getInt(4) == 1, if (c.isNull(5)) null else c.getString(5), c.getInt(6) == 1)) } }

    fun markReceiptUploaded(id: Long) {
        writableDatabase.execSQL("UPDATE receipts SET uploaded = 1 WHERE id = ?", arrayOf<Any>(id))
    }

    fun markReceiptAllocsSent(id: Long) {
        writableDatabase.execSQL("UPDATE receipts SET allocs_dirty = 0 WHERE id = ?", arrayOf<Any>(id))
    }

    // ---- Tageszettel ----
    data class TripMark(val vehicle: String, val km: Double?)

    fun tripMark(dayId: Long, startTs: Long): TripMark? =
        readableDatabase.rawQuery("SELECT vehicle, km FROM trip_marks WHERE day_id = ? AND start_ts = ?", arrayOf(dayId.toString(), startTs.toString()))
            .use { c -> if (c.moveToFirst()) TripMark(c.getString(0), if (c.isNull(1)) null else c.getDouble(1)) else null }

    fun saveTripMark(dayId: Long, startTs: Long, vehicle: String, km: Double?) {
        writableDatabase.execSQL(
            "INSERT OR REPLACE INTO trip_marks (day_id, start_ts, vehicle, km) VALUES (?, ?, ?, ?)",
            arrayOf<Any?>(dayId, startTs, vehicle, km),
        )
    }

    /** Zuletzt gewähltes Fahrzeug, als Vorschlag für die nächste Fahrt. */
    fun lastVehicle(): String =
        readableDatabase.rawQuery("SELECT vehicle FROM trip_marks ORDER BY rowid DESC LIMIT 1", null)
            .use { c -> if (c.moveToFirst()) c.getString(0) else "privat" }

    fun dayPause(dayId: Long): Int? =
        readableDatabase.rawQuery("SELECT minutes FROM day_pause WHERE day_id = ?", arrayOf(dayId.toString()))
            .use { c -> if (c.moveToFirst()) c.getInt(0) else null }

    fun saveDayPause(dayId: Long, minutes: Int) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO day_pause (day_id, minutes) VALUES (?, ?)", arrayOf<Any>(dayId, minutes))
    }

    fun closeWeek(weekStart: String) {
        writableDatabase.execSQL("INSERT OR IGNORE INTO week_closed (week_start) VALUES (?)", arrayOf<Any>(weekStart))
    }

    fun isWeekClosed(weekStart: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM week_closed WHERE week_start = ?", arrayOf(weekStart)).use { it.moveToFirst() }

    /** Baustellen, auf denen an diesem Tag gearbeitet wurde (aus den Abschnitten aller Tage dieses Datums). */
    fun siteIdsWorkedOn(fromMs: Long, toMs: Long): List<Long> =
        readableDatabase.rawQuery(
            """SELECT DISTINCT s.site_id FROM segments s JOIN days d ON d.id = s.day_id
               WHERE d.started_at >= ? AND d.started_at < ? AND s.kind = 'work' AND s.site_id IS NOT NULL ORDER BY s.started_at""",
            arrayOf(fromMs.toString(), toMs.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(c.getLong(0)) } }

    fun queueSheet(date: String, json: String) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO sheet_outbox (date, json, sent) VALUES (?, ?, 0)", arrayOf<Any>(date, json))
    }

    fun unsentSheets(): List<Pair<String, String>> =
        readableDatabase.rawQuery("SELECT date, json FROM sheet_outbox WHERE sent = 0", null)
            .use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) } }

    fun sheetSent(date: String, json: String) {
        writableDatabase.execSQL("UPDATE sheet_outbox SET sent = 1 WHERE date = ? AND json = ?", arrayOf<Any>(date, json))
    }

    fun sheetState(date: String): Int? = // null = nie abgegeben, 0 = vorgemerkt, 1 = gesendet
        readableDatabase.rawQuery("SELECT sent FROM sheet_outbox WHERE date = ?", arrayOf(date))
            .use { c -> if (c.moveToFirst()) c.getInt(0) else null }

    // ---- Notizen und Fotos ----
    data class NoteRow(val id: Long, val clientId: String, val date: String, val siteId: Long?, val text: String, val kind: String = "arbeit")
    data class PhotoRow(val id: Long, val clientId: String, val path: String, val siteId: Long?, val takenAt: Long)

    private fun noteFrom(c: android.database.Cursor) =
        NoteRow(c.getLong(0), c.getString(1), c.getString(2), if (c.isNull(3)) null else c.getLong(3), c.getString(4), c.getString(5))

    fun notesForDate(date: String): List<NoteRow> =
        readableDatabase.rawQuery("SELECT id, client_id, date, site_id, text, kind FROM notes WHERE date = ? ORDER BY id", arrayOf(date))
            .use { c -> buildList { while (c.moveToNext()) add(noteFrom(c)) } }

    /** Speichert (oder ändert) die Notiz für Tag und Ort. Leerer Text löscht sie. */
    fun saveNote(date: String, siteId: Long?, text: String, kind: String = "arbeit") {
        val cid = (if (kind == "material") "mat-" else "note-") + "$date-${siteId ?: 0}"
        val t = text.trim()
        writableDatabase.execSQL(
            """INSERT INTO notes (client_id, date, site_id, text, updated_at, synced, kind) VALUES (?, ?, ?, ?, ?, 0, ?)
               ON CONFLICT(client_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at, synced = 0""",
            arrayOf<Any?>(cid, date, siteId, t, System.currentTimeMillis(), kind),
        )
    }

    fun unsyncedNotes(): List<NoteRow> =
        readableDatabase.rawQuery("SELECT id, client_id, date, site_id, text, kind FROM notes WHERE synced = 0 ORDER BY id", null)
            .use { c -> buildList { while (c.moveToNext()) add(noteFrom(c)) } }

    fun markNoteSynced(id: Long, text: String) {
        writableDatabase.execSQL("UPDATE notes SET synced = 1 WHERE id = ? AND text = ?", arrayOf<Any>(id, text))
    }

    fun deleteNoteRow(id: Long) {
        writableDatabase.execSQL("DELETE FROM notes WHERE id = ?", arrayOf<Any>(id))
    }

    fun addPhoto(clientId: String, path: String, siteId: Long?, takenAt: Long) {
        writableDatabase.execSQL(
            "INSERT OR IGNORE INTO photos (client_id, path, site_id, taken_at, synced) VALUES (?, ?, ?, ?, 0)",
            arrayOf<Any?>(clientId, path, siteId, takenAt),
        )
    }

    fun unsyncedPhotos(): List<PhotoRow> =
        readableDatabase.rawQuery("SELECT id, client_id, path, site_id, taken_at FROM photos WHERE synced = 0 ORDER BY id", null)
            .use { c -> buildList { while (c.moveToNext()) add(PhotoRow(c.getLong(0), c.getString(1), c.getString(2), if (c.isNull(3)) null else c.getLong(3), c.getLong(4))) } }

    fun markPhotoSynced(id: Long) {
        writableDatabase.execSQL("UPDATE photos SET synced = 1 WHERE id = ?", arrayOf<Any>(id))
    }

    fun photoCountForDate(from: Long, to: Long): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM photos WHERE taken_at >= ? AND taken_at < ?", arrayOf(from.toString(), to.toString()))
            .use { c -> if (c.moveToFirst()) c.getInt(0) else 0 }

    @Synchronized
    fun setSiteExtra(siteId: Long, extra: String) {
        writableDatabase.execSQL("UPDATE sites SET extra = ? WHERE id = ?", arrayOf<Any>(extra, siteId))
    }

    /** Wann und wie oft ein Ort benutzt wurde (für die Sortierung der Kacheln). */
    fun siteUsage(): Map<Long, Pair<Long, Int>> =
        readableDatabase.rawQuery("SELECT site_id, MAX(started_at), COUNT(*) FROM segments WHERE site_id IS NOT NULL GROUP BY site_id", null)
            .use { c -> buildMap { while (c.moveToNext()) put(c.getLong(0), c.getLong(1) to c.getInt(2)) } }

    // --- Halte ändern und Tage nach Datum ---
    fun daysOnDate(fromMs: Long, toMs: Long): List<DayRow> =
        readableDatabase.rawQuery("SELECT $dayColumns FROM days WHERE started_at >= ? AND started_at < ? ORDER BY started_at", arrayOf(fromMs.toString(), toMs.toString()))
            .use { c -> buildList { while (c.moveToNext()) add(day(c)) } }

    fun stopsOfDay(dayId: Long): List<StopRow> =
        readableDatabase.rawQuery("SELECT $stopColumns FROM stops WHERE day_id = ? ORDER BY started_at", arrayOf(dayId.toString()))
            .use { c -> buildList { while (c.moveToNext()) add(stop(c)) } }

    fun segmentByClientId(clientId: String): SegmentRow? =
        readableDatabase.rawQuery("SELECT $segmentColumns FROM segments WHERE client_id = ?", arrayOf(clientId))
            .use { if (it.moveToFirst()) segment(it) else null }

    @Synchronized
    fun updateSegment(clientId: String, kind: String, siteId: Long?) {
        val cv = ContentValues().apply {
            put("kind", kind)
            if (siteId != null) put("site_id", siteId) else putNull("site_id")
            put("dirty", 1)
        }
        writableDatabase.update("segments", cv, "client_id = ?", arrayOf(clientId))
    }

    /**
     * Antwort auf einen Halt eintragen oder ändern. [kind] ist 'break' (Pause), 'work' (Ort benannt, [siteId]) oder 'travel' (weiter wie Fahrt).
     * Gibt es zum Halt schon einen Abschnitt, wird er geändert, sonst entsteht ein neuer.
     */
    @Synchronized
    fun answerStop(stop: StopRow, kind: String, siteId: Long?) {
        val existing = stop.segClientId
        if (existing != null) {
            updateSegment(existing, kind, if (kind == "work") siteId else null)
            finishStop(stop.id, existing)
        } else if (kind == "travel") {
            finishStop(stop.id, null)
        } else {
            val cid = insertSegment(stop.dayId, if (kind == "work") siteId else null, kind, stop.startedAt, stop.endedAt)
            finishStop(stop.id, cid)
        }
    }

    companion object {
        @Volatile private var instance: Db? = null

        fun get(ctx: Context): Db =
            instance ?: synchronized(this) { instance ?: Db(ctx.applicationContext).also { instance = it } }
    }
}
