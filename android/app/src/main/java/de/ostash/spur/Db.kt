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

/**
 * Lokale Datenbank: Alles wird zuerst hier gespeichert und später mit dem Server abgeglichen,
 * damit auch ohne Internet nichts verloren geht.
 */
class Db private constructor(ctx: Context) : SQLiteOpenHelper(ctx, "spur.db", null, 1) {

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
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

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

    companion object {
        @Volatile private var instance: Db? = null

        fun get(ctx: Context): Db =
            instance ?: synchronized(this) { instance ?: Db(ctx.applicationContext).also { instance = it } }
    }
}
