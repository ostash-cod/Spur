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

class CommuteTest {
    private fun block(travel: Boolean, siteId: Long?, start: Long) =
        TimelineBlock(isTravel = travel, label = "x", colorHex = null, customer = null, start = start, end = start + 1000, auto = true, siteId = siteId)
    private fun site(id: Long, system: String?) =
        SiteRow(id, "s$id", null, "#000000", null, null, 100.0, system)

    @org.junit.Test fun firstAndLastTripToFirmaAreCommute() {
        val sites = mapOf(1L to site(1, "firma"), 2L to site(2, null))
        val blocks = listOf(block(true, null, 0), block(false, 1, 1), block(true, null, 2), block(false, 2, 3), block(true, null, 4), block(false, 1, 5), block(true, null, 6))
        org.junit.Assert.assertTrue(isCommuteBlock(blocks, 0, sites))
        org.junit.Assert.assertFalse(isCommuteBlock(blocks, 2, sites))
        org.junit.Assert.assertFalse(isCommuteBlock(blocks, 4, sites))
        org.junit.Assert.assertTrue(isCommuteBlock(blocks, 6, sites))
    }

    @org.junit.Test fun tripToBaustelleIsNotCommute() {
        val sites = mapOf(2L to site(2, null))
        val blocks = listOf(block(true, null, 0), block(false, 2, 1), block(true, null, 2))
        org.junit.Assert.assertFalse(isCommuteBlock(blocks, 0, sites))
        org.junit.Assert.assertFalse(isCommuteBlock(blocks, 2, sites))
    }
}
