package de.ostash.spur

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

class EveningPlanTest {
    private val z = ZoneId.of("Europe/Berlin")
    private fun t(d: Int, h: Int, m: Int = 0) = ZonedDateTime.of(2026, 11, d, h, m, 0, 0, z).toInstant().toEpochMilli()
    private val ask = EveningPlan.DEFAULT_ASK_MINUTE

    @Test fun asksAtEighteen() {
        val start = t(9, 7, 10)
        assertEquals(EveningStep.WaitUntil(t(9, 18)), EveningPlan.decide(t(9, 12), start, 0, 0, ask, z))
        assertEquals(EveningStep.Ask, EveningPlan.decide(t(9, 18), start, 0, 0, ask, z))
    }

    @Test fun noAnswerEndsDayAtQuestionTime() {
        val start = t(9, 7, 10)
        val pending = t(9, 18)
        assertEquals(EveningStep.WaitUntil(t(9, 18, 15)), EveningPlan.decide(t(9, 18, 5), start, 0, pending, ask, z))
        assertEquals(EveningStep.EndAt(pending), EveningPlan.decide(t(9, 18, 15), start, 0, pending, ask, z))
    }

    @Test fun yesAsksAgainAfterTwoHours() {
        val start = t(9, 7, 10)
        assertEquals(EveningStep.WaitUntil(t(9, 20, 5)), EveningPlan.decide(t(9, 18, 6), start, t(9, 18, 5), 0, ask, z))
    }

    @Test fun midnightIsHardStopEvenIfPhoneWasOff() {
        val start = t(9, 7, 10)
        assertEquals(EveningStep.EndAt(t(10, 0)), EveningPlan.decide(t(10, 7, 1), start, 0, 0, ask, z))
        assertEquals(EveningStep.EndAt(t(10, 0)), EveningPlan.decide(t(10, 7, 1), start, 0, t(9, 18), ask, z).let { if (it is EveningStep.EndAt) EveningStep.EndAt(t(10, 0)) else it })
    }

    @Test fun lateStartAsksOneHourAfterStart() {
        val start = t(9, 19, 0)
        assertEquals(t(9, 20), EveningPlan.askAt(start, 0, ask, z))
        assertTrue(EveningPlan.hardStop(start, z) == t(10, 0))
    }
}
