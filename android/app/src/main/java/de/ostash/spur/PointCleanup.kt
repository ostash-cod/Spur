package de.ostash.spur

import android.content.Context

/**
 * Variante C: Die rohen GPS-Punkte eines Tages bleiben nur kurz auf dem Handy.
 * Nach [Prefs.pointsHours] Stunden ab Tagesende werden sie gelöscht, die gefahrenen Kilometer bleiben.
 */
object PointCleanup {
    fun run(ctx: Context, now: Long = System.currentTimeMillis()): Int = runCatching {
        val cutoff = now - Prefs.pointsHours(ctx) * 3_600_000L
        // Im Testmodus warten, bis die Punkte beim Server sind (höchstens 14 Tage).
        val waitForServer = Prefs.uploadPoints(ctx)
        var n = Db.get(ctx).purgePoints(cutoff, onlySynced = waitForServer)
        if (waitForServer) n += Db.get(ctx).purgePoints(now - 14 * 86_400_000L, onlySynced = false)
        n
    }.getOrDefault(0)
}
