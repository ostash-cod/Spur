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
class Db private constructor(ctx: Context) : SQLiteOpenHelper(ctx, "spur.db", null, 2) {

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
                radius REAL NOT NULL)""",
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
        if (oldVersion < 2) createSiteTables(db)
    }

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
            "SELECT id, name, customer_name, color, lat, lng, radius FROM sites ORDER BY name COLLATE NOCASE",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        SiteRow(
                            c.getLong(0), c.getString(1), if (c.isNull(2)) null else c.getString(2), c.getString(3),
                            if (c.isNull(4)) null else c.getDouble(4), if (c.isNull(5)) null else c.getDouble(5), c.getDouble(6),
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

    fun lastPoint(): PointRow? =
        readableDatabase.rawQuery("SELECT id, ts, lat, lng, acc FROM points ORDER BY ts DESC LIMIT 1", null)
            .use { c -> if (c.moveToFirst()) PointRow(c.getLong(0), c.getLong(1), c.getDouble(2), c.getDouble(3), c.getFloat(4)) else null }

    companion object {
        @Volatile private var instance: Db? = null

        fun get(ctx: Context): Db =
            instance ?: synchronized(this) { instance ?: Db(ctx.applicationContext).also { instance = it } }
    }
}
