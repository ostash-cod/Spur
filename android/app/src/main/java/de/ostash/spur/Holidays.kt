package de.ostash.spur

import java.time.LocalDate

/** Gesetzliche Feiertage in Bayern (überwiegend katholisch, also mit Mariä Himmelfahrt). */
object Holidays {
    /** Ostersonntag nach der Gaußschen Formel. */
    fun easter(year: Int): LocalDate {
        val a = year % 19
        val b = year / 100
        val c = year % 100
        val d = b / 4
        val e = b % 4
        val f = (b + 8) / 25
        val g = (b - f + 1) / 3
        val h = (19 * a + b - d - g + 15) % 30
        val i = c / 4
        val k = c % 4
        val l = (32 + 2 * e + 2 * i - h - k) % 7
        val m = (a + 11 * h + 22 * l) / 451
        val month = (h + l - 7 * m + 114) / 31
        val day = (h + l - 7 * m + 114) % 31 + 1
        return LocalDate.of(year, month, day)
    }

    fun forYear(y: Int): Set<LocalDate> {
        val e = easter(y)
        return setOf(
            LocalDate.of(y, 1, 1), LocalDate.of(y, 1, 6),
            e.minusDays(2), e.plusDays(1), LocalDate.of(y, 5, 1),
            e.plusDays(39), e.plusDays(50), e.plusDays(60),
            LocalDate.of(y, 8, 15), LocalDate.of(y, 10, 3), LocalDate.of(y, 11, 1),
            LocalDate.of(y, 12, 25), LocalDate.of(y, 12, 26),
        )
    }

    fun isHoliday(d: LocalDate): Boolean = d in forYear(d.year)
}
