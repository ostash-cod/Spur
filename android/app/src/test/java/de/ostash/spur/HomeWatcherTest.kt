package de.ostash.spur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HomeWatcherTest {
    private val lat = 47.96
    private val lng = 11.30
    private fun fix(min: Int, dLat: Double = 0.0, acc: Float = 10f) = Fix(min * 60_000L, lat + dLat, lng, acc)

    @Test fun noQuestionIfNeverLeftHome() {
        val w = HomeWatcher(lat, lng)
        for (m in 0..30) assertNull(w.onFix(fix(m)))
    }

    @Test fun asksAfterReturningHome() {
        val w = HomeWatcher(lat, lng)
        assertNull(w.onFix(fix(0)))
        assertNull(w.onFix(fix(30, 0.05))) // ca. 5,5 km weg
        assertNull(w.onFix(fix(60)))
        assertNull(w.onFix(fix(62)))
        assertEquals(60 * 60_000L, w.onFix(fix(63)))
        assertNull(w.onFix(fix(70))) // nur einmal
    }

    @Test fun drivingPastHomeDoesNotCount() {
        val w = HomeWatcher(lat, lng)
        w.onFix(fix(0, 0.05))
        assertNull(w.onFix(fix(10)))
        assertNull(w.onFix(fix(11, 0.05)))
    }

    @Test fun badAccuracyIgnored() {
        val w = HomeWatcher(lat, lng)
        w.onFix(fix(0, 0.05))
        assertNull(w.onFix(fix(10, 0.0, 500f)))
        assertNull(w.onFix(fix(14, 0.0, 500f)))
    }
}
