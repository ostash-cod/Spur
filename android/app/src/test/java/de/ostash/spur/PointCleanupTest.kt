package de.ostash.spur

import org.junit.Assert.assertEquals
import org.junit.Test

class PointCleanupTest {
    /** Variante C: Aus den gesicherten Metern ergibt sich für jede Fahrt dieselbe Strecke wie aus den Punkten. */
    @Test fun gesicherteMeterErgebenDieselbenKilometer() {
        val pts = (0 until 200).map { i ->
            val acc = if (i % 17 == 0) 90f else 8f // ab und zu ein ungenauer Punkt
            val wobble = if (i % 5 == 0) 0.00005 else 0.0 // Wackeln von wenigen Metern
            PointRow(i.toLong(), 1_000L + i * 15_000L, 47.9 + (if (i in 60..120) 0.0 else i * 0.0007) + wobble, 11.3 + i * 0.0004, acc)
        }
        val cum = cumulativeMeters(pts)
        fun saved(from: Long, to: Long): Double {
            val r = cum.filter { it.first in from..to }
            return if (r.size < 2) 0.0 else (r.last().second - r.first().second) / 1000.0
        }
        for ((from, to) in listOf(1_000L to 3_000_000L, 1_000L to 900_000L, 900_000L to 1_800_000L, 1_830_000L to 3_000_000L, 500_000L to 520_000L)) {
            assertEquals("$from..$to", routeKm(pts, from, to), saved(from, to), 1e-9)
        }
    }
}
