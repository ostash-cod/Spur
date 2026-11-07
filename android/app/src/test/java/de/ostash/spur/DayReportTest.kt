package de.ostash.spur

import org.junit.Assert.assertEquals
import org.junit.Test

class DayReportTest {
    private val h = 3_600_000L

    @Test fun pauseNachRegel() {
        assertEquals(0, pauseRuleMinutes(2 * h))
        assertEquals(15, pauseRuleMinutes(2 * h + h / 2))
        assertEquals(30, pauseRuleMinutes(5 * h))
        assertEquals(45, pauseRuleMinutes(8 * h))
        assertEquals(60, pauseRuleMinutes(11 * h))
    }

    @Test fun kilometerIgnorierenWackelnUndUngenaues() {
        // ca. 1,1 km nach Norden (0,01 Grad), ein ungenauer Ausreißer und ein Wackler von wenigen Metern
        val pts = listOf(
            PointRow(1, 1000, 48.00, 11.0, 10f),
            PointRow(2, 2000, 48.005, 11.0, 10f),
            PointRow(3, 2500, 49.0, 12.0, 500f), // ungenau, zählt nicht
            PointRow(4, 3000, 48.01, 11.0, 10f),
            PointRow(5, 4000, 48.01001, 11.0, 10f), // Wackler, zählt nicht
        )
        assertEquals(1.11, routeKm(pts, 0, 10_000), 0.03)
    }
}
