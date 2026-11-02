package de.ostash.spur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StopDetectorTest {
    private val baseLat = 48.0
    private val baseLng = 11.0
    private val mPerDegLat = 111_195.0
    private fun fix(sec: Int, metersNorth: Double = 0.0, acc: Float = 8f) = Fix(sec * 1000L, baseLat + metersNorth / mPerDegLat, baseLng, acc)

    @Test
    fun haltNachZehnMinutenZaehltAbErstemPunkt() {
        val d = StopDetector()
        val events = (0..700 step 20).mapNotNull { d.onFix(fix(it, (it % 40) * 0.5), false) }
        assertEquals(1, events.size)
        val stop = events[0] as StopEvent.Stop
        assertEquals(0L, stop.since)
        assertTrue(Math.abs(stop.lat - baseLat) < 0.0003)
    }

    @Test
    fun fahrenErzeugtKeinenHalt() {
        val d = StopDetector()
        val events = (0..1200 step 20).mapNotNull { d.onFix(fix(it, it * 15.0), false) }
        assertTrue(events.isEmpty())
    }

    @Test
    fun bekannterOrtMeldetNichts() {
        val d = StopDetector()
        val events = (0..1200 step 20).mapNotNull { d.onFix(fix(it), true) }
        assertTrue(events.isEmpty())
    }

    @Test
    fun ausreisserBeendetDenHaltNicht() {
        val d = StopDetector()
        val events = mutableListOf<StopEvent>()
        for (s in 0..700 step 20) d.onFix(fix(s), false)?.let(events::add)
        d.onFix(fix(720, 300.0), false)?.let(events::add) // einzelner Ausreißer
        d.onFix(fix(740), false)?.let(events::add)
        assertEquals(1, events.size)
        assertTrue(events[0] is StopEvent.Stop)
    }

    @Test
    fun wegfahrenBeendetDenHaltMitLetztemPunktImKreis() {
        val d = StopDetector()
        val events = mutableListOf<StopEvent>()
        for (s in 0..700 step 20) d.onFix(fix(s), false)?.let(events::add)
        for (s in 720..820 step 20) d.onFix(fix(s, (s - 700) * 5.0), false)?.let(events::add)
        assertEquals(2, events.size)
        assertEquals(StopEvent.Resume(700_000L), events[1])
    }

    @Test
    fun ungenauePunkteWerdenIgnoriert() {
        val d = StopDetector()
        val events = (0..900 step 20).mapNotNull { d.onFix(fix(it, acc = 250f), false) }
        assertNull(events.firstOrNull())
    }
}
