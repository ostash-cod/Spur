package de.ostash.spur

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

class EveningPlanTest {
    private val z = ZoneId.of("Europe/Berlin")
    private fun t(d: Int, h: Int, m: Int = 0) = ZonedDateTime.of(2026, 11, d, h, m, 0, 0, z).toInstant().toEpochMilli()
    private val ask = EveningPlan.DEFAULT_ASK_MINUTE
    private val start = t(9, 7, 10)

    private fun d(now: Long, lastYes: Long = 0, first: Long = 0, asks: Int = 0, lastAsk: Long = 0, onSite: Boolean = false, moving: Boolean = false) =
        EveningPlan.decide(now, start, lastYes, first, asks, lastAsk, onSite, moving, ask, z)

    @Test fun asksAtEighteen() {
        assertEquals(EveningStep.WaitUntil(t(9, 18)), d(t(9, 12)))
        assertEquals(EveningStep.Ask, d(t(9, 18)))
    }

    @Test fun threeAsksThenEndAtFirstAsk() {
        val first = t(9, 18)
        assertEquals(EveningStep.WaitUntil(t(9, 18, 15)), d(t(9, 18, 5), first = first, asks = 1, lastAsk = first))
        assertEquals(EveningStep.Ask, d(t(9, 18, 15), first = first, asks = 1, lastAsk = first))
        assertEquals(EveningStep.Ask, d(t(9, 18, 30), first = first, asks = 2, lastAsk = t(9, 18, 15)))
        assertEquals(EveningStep.WaitUntil(t(9, 18, 45)), d(t(9, 18, 35), first = first, asks = 3, lastAsk = t(9, 18, 30)))
        assertEquals(EveningStep.EndAt(first), d(t(9, 18, 45), first = first, asks = 3, lastAsk = t(9, 18, 30)))
    }

    @Test fun yesAsksAgainAfterTwoHours() {
        assertEquals(EveningStep.WaitUntil(t(9, 20, 5)), d(t(9, 18, 6), lastYes = t(9, 18, 5)))
    }

    @Test fun onSiteAsksHourlyAndNeverEnds() {
        assertEquals(EveningStep.Ask, d(t(9, 18), onSite = true))
        assertEquals(EveningStep.WaitUntil(t(9, 19)), d(t(9, 18, 20), onSite = true, lastAsk = t(9, 18)))
        assertEquals(EveningStep.Ask, d(t(9, 19), onSite = true, lastAsk = t(9, 18)))
    }

    @Test fun drivingPostponesQuestion() {
        assertEquals(EveningStep.WaitUntil(t(9, 18, 5)), d(t(9, 18), moving = true))
    }

    @Test fun midnightIsHardStop() {
        assertEquals(EveningStep.EndAt(t(10, 0)), d(t(10, 0, 1), onSite = true))
    }
}
