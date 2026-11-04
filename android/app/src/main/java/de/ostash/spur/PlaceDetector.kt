package de.ostash.spur

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Ein bekannter Ort (Baustelle, Lager, Firma) mit Radius und Mindestdauer bis zur Erkennung. */
data class Place(
    val siteId: Long,
    val lat: Double,
    val lng: Double,
    val radiusM: Double,
    val dwellMs: Long,
    /** Wenn gesetzt, gilt für diesen Ort ein eigener Abstand/eine eigene Wartezeit beim Verlassen. */
    val leaveMarginM: Double? = null,
    val leaveDebounceMs: Long? = null,
)

data class Fix(val ts: Long, val lat: Double, val lng: Double, val accuracy: Float)

sealed class PlaceEvent {
    data class Arrive(val siteId: Long, val at: Long) : PlaceEvent()
    data class Leave(val siteId: Long, val at: Long) : PlaceEvent()
}

fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2) * sin(dLat / 2) +
        cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
}

/**
 * Erkennt Ankunft und Abfahrt an bekannten Orten aus GPS-Punkten.
 *
 * - Ankunft: Der Punkt liegt im Radius und bleibt dort mindestens [Place.dwellMs]. Die Zeit zählt ab dem ersten Punkt im Radius.
 * - Abfahrt: Der Standort ist länger als [leaveDebounceMs] außerhalb von Radius + [leaveMarginM]. Die Zeit zählt bis zum letzten Punkt im Radius.
 * - Kurze Ausreißer nach außen (bis [candidateGraceMs]) unterbrechen das Warten auf die Ankunft nicht.
 * - Ungenaue Punkte (schlechter als [maxAccuracyM]) werden ignoriert.
 */
class PlaceDetector(
    var places: List<Place>,
    private val leaveMarginM: Double = 40.0,
    private val leaveDebounceMs: Long = 90_000,
    private val maxAccuracyM: Float = 100f,
    private val candidateGraceMs: Long = 90_000,
) {
    private var current: Place? = null
    private var candidate: Place? = null
    private var candidateSince = 0L
    private var candidateLastIn = 0L
    private var outsideSince: Long? = null
    private var lastInsideTs = 0L

    val currentSiteId: Long? get() = current?.siteId

    fun onFix(f: Fix): List<PlaceEvent> {
        if (f.accuracy > maxAccuracyM) return emptyList()
        val events = mutableListOf<PlaceEvent>()

        val cur = current
        if (cur != null) {
            val d = distanceMeters(f.lat, f.lng, cur.lat, cur.lng)
            if (d <= cur.radiusM + (cur.leaveMarginM ?: leaveMarginM)) {
                outsideSince = null
                lastInsideTs = f.ts
                return events
            }
            val since = outsideSince ?: f.ts.also { outsideSince = it }
            if (f.ts - since < (cur.leaveDebounceMs ?: leaveDebounceMs)) return events
            events += PlaceEvent.Leave(cur.siteId, lastInsideTs)
            current = null
            outsideSince = null
            candidate = null
        }

        val inside = places
            .map { it to distanceMeters(f.lat, f.lng, it.lat, it.lng) }
            .filter { (p, d) -> d <= p.radiusM }
            .minByOrNull { it.second }
            ?.first
        if (inside == null) {
            // Ein einzelner Ausreißer (GPS springt im Haus oder hinter Metall) setzt das Warten nicht zurück.
            if (candidate != null && f.ts - candidateLastIn > candidateGraceMs) candidate = null
            return events
        }
        if (candidate?.siteId != inside.siteId) {
            candidate = inside
            candidateSince = f.ts
        }
        candidateLastIn = f.ts
        if (f.ts - candidateSince >= inside.dwellMs) {
            events += PlaceEvent.Arrive(inside.siteId, candidateSince)
            current = inside
            candidate = null
            outsideSince = null
            lastInsideTs = f.ts
        }
        return events
    }
}
