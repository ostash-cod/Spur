package de.ostash.spur

/**
 * Merkt, wenn man nach der Arbeit zu Hause ankommt. Zuhause liegt nur auf dem Handy.
 * Gefragt wird erst, wenn man vorher weit weg war (mehr als [awayM]) und dann mindestens [dwellMs] zu Hause bleibt.
 * Gibt den Zeitpunkt der Ankunft zurück (erster Punkt im Kreis), sonst null.
 */
class HomeWatcher(
    private val lat: Double,
    private val lng: Double,
    private val radiusM: Double = 150.0,
    private val awayM: Double = 400.0,
    private val dwellMs: Long = 3 * 60_000L,
    private val maxAccuracyM: Float = 100f,
) {
    private var wasAway = false
    private var insideSince: Long? = null

    fun onFix(f: Fix): Long? {
        if (f.accuracy > maxAccuracyM) return null
        val d = distanceMeters(f.lat, f.lng, lat, lng)
        if (d > awayM) {
            wasAway = true
            insideSince = null
            return null
        }
        if (d > radiusM) {
            insideSince = null
            return null
        }
        val since = insideSince ?: f.ts.also { insideSince = it }
        if (wasAway && f.ts - since >= dwellMs) {
            wasAway = false
            return since
        }
        return null
    }
}
