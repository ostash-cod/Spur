package de.ostash.spur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class ReminderPlanTest {
    private val zone = ZoneId.of("Europe/Berlin")
    private val cfg = ReminderConfig() // Mo–Fr, 06:55 und 07:00
    private fun at(date: String, time: String) = ZonedDateTime.of(LocalDate.parse(date), LocalTime.parse(time), zone)

    // 2026-11-06 ist ein Freitag, 2026-11-09 ein Montag.
    @Test
    fun ersteErinnerungAmMorgen() {
        assertEquals(at("2026-11-06", "06:55"), ReminderPlan.next(at("2026-11-06", "05:00"), cfg, null))
    }

    @Test
    fun danachDieZweiteUndDannAlleFuenfMinuten() {
        assertEquals(at("2026-11-06", "07:00"), ReminderPlan.next(at("2026-11-06", "06:55"), cfg, null))
        assertEquals(at("2026-11-06", "07:05"), ReminderPlan.next(at("2026-11-06", "07:00"), cfg, null))
        assertEquals(at("2026-11-06", "07:10"), ReminderPlan.next(at("2026-11-06", "07:07"), cfg, null))
    }

    @Test
    fun nachDemWiederholungsendeGehtEsAmNaechstenArbeitstagWeiter() {
        // Freitag nach 10:00 -> Samstag und Sonntag sind aus, also Montag 06:55
        assertEquals(at("2026-11-09", "06:55"), ReminderPlan.next(at("2026-11-06", "12:00"), cfg, null))
    }

    @Test
    fun wiederholungHoerNachDreiStundenAuf() {
        val last = ReminderPlan.slots(LocalDate.parse("2026-11-06"), cfg, zone).last()
        assertEquals(at("2026-11-06", "10:00"), last)
    }

    @Test
    fun heuteFreiUeberspringtDenTag() {
        val free = LocalDate.parse("2026-11-06")
        assertEquals(at("2026-11-09", "06:55"), ReminderPlan.next(at("2026-11-06", "05:00"), cfg, free))
    }

    @Test
    fun wochentageSindEinzelnWaehlbarAuchSonntag() {
        val so = cfg.copy(days = setOf(DayOfWeek.SUNDAY))
        assertEquals(at("2026-11-08", "06:55"), ReminderPlan.next(at("2026-11-06", "05:00"), so, null))
    }

    @Test
    fun ausgeschaltetOderKeinTagGibtNichts() {
        assertNull(ReminderPlan.next(at("2026-11-06", "05:00"), cfg.copy(enabled = false), null))
        assertNull(ReminderPlan.next(at("2026-11-06", "05:00"), cfg.copy(days = emptySet()), null))
    }

    @Test
    fun vertauschteZeitenWerdenSortiert() {
        val c = cfg.copy(first = LocalTime.of(7, 0), second = LocalTime.of(6, 50))
        assertEquals(at("2026-11-06", "06:50"), ReminderPlan.next(at("2026-11-06", "05:00"), c, null))
        assertEquals(at("2026-11-06", "07:00"), ReminderPlan.next(at("2026-11-06", "06:50"), c, null))
    }

    @Test
    fun gleicheZeitenGebenKeineDoppelteErinnerung() {
        val c = cfg.copy(first = LocalTime.of(7, 0), second = LocalTime.of(7, 0))
        val s = ReminderPlan.slots(LocalDate.parse("2026-11-06"), c, zone)
        assertEquals(s.distinct(), s)
        assertTrue(s.first() == at("2026-11-06", "07:00"))
    }

    @Test
    fun sommerzeitwechselBleibtBeiDerOrtszeit() {
        // Umstellung auf Winterzeit am 2026-10-25; Sonntag eingeschaltet
        val so = cfg.copy(days = setOf(DayOfWeek.SUNDAY))
        val n = ReminderPlan.next(at("2026-10-24", "12:00"), so, null)!!
        assertEquals(LocalTime.of(6, 55), n.toLocalTime())
        assertEquals(LocalDate.parse("2026-10-25"), n.toLocalDate())
    }
}
