package de.ostash.spur

sealed class StopEvent {
    /** Das Handy steht seit [since] an einem Ort, den die App nicht kennt (Position [lat], [lng]). */
    data class Stop(val lat: Double, val lng: Double, val since: Long) : StopEvent()

    /** Der Halt ist vorbei. [at] ist der letzte Punkt am Haltort. */
    data class Resume(val at: Long) : StopEvent()
}

/**
 * Erkennt, dass man länger an einem Ort steht, der kein Baustelle, Lager, Firma oder Händler ist (zum Beispiel ein Baumarkt).
 *
 * - Ein Halt beginnt, wenn die Punkte [minMs] lang im Umkreis von [radiusM] bleiben. Die Zeit zählt ab dem ersten Punkt.
 * - Ein einzelner Ausreißer nach außen beendet den Halt nicht. Erst wenn man [leaveMs] lang draußen ist, gilt der Halt als vorbei.
 * - An einem bekannten Ort wird nichts gemeldet.
 */
class StopDetector(
    private val minMs: Long = 3 * 60_000L,
    private val radiusM: Double = 70.0,
    private val maxAccuracyM: Float = 100f,
    private val leaveMs: Long = 60_000L,
) {
    private var anchor: Fix? = null
    private var sumLat = 0.0
    private var sumLng = 0.0
    private var n = 0
    private var emitted = false
    private var lastInside = 0L
    private var outsideSince: Long? = null

    fun onFix(f: Fix, atKnownPlace: Boolean): StopEvent? {
        if (f.accuracy > maxAccuracyM) return null
        if (atKnownPlace) return reset()
        val a = anchor
        if (a == null) {
            begin(f)
            return null
        }
        if (distanceMeters(a.lat, a.lng, f.lat, f.lng) > radiusM) {
            val since = outsideSince ?: f.ts.also { outsideSince = it }
            if (f.ts - since < leaveMs) return null
            val ev = reset()
            begin(f)
            return ev
        }
        outsideSince = null
        lastInside = f.ts
        sumLat += f.lat
        sumLng += f.lng
        n++
        if (!emitted && f.ts - a.ts >= minMs) {
            emitted = true
            return StopEvent.Stop(sumLat / n, sumLng / n, a.ts)
        }
        return null
    }

    private fun begin(f: Fix) {
        anchor = f
        sumLat = f.lat
        sumLng = f.lng
        n = 1
        lastInside = f.ts
        outsideSince = null
        emitted = false
    }

    private fun reset(): StopEvent? {
        val ev = if (emitted) StopEvent.Resume(lastInside) else null
        anchor = null
        emitted = false
        n = 0
        outsideSince = null
        return ev
    }
}
