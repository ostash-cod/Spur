package de.ostash.spur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TimelineTest {
    private val min = 60_000L
    private val t0 = 1_800_000_000_000L
    private fun site(id: Long, name: String) = SiteRow(id, name, null, "#2E9E4F", 48.0, 11.0, 100.0, null)
    private fun seg(id: Long, siteId: Long, fromMin: Long, toMin: Long?, source: String = "auto") =
        SegmentRow(id, 1, "c$id", siteId, "work", t0 + fromMin * min, toMin?.let { t0 + it * min }, source)

    @Test
    fun luckenWerdenZurFahrtMitRichtigenNamen() {
        val sites = mapOf(1L to site(1, "Firma"), 2L to site(2, "Lilienstraße 77"), 3L to site(3, "Tutzing"))
        val segs = listOf(seg(1, 1, 0, 20), seg(2, 2, 55, 270), seg(3, 3, 330, 520))
        val blocks = buildTimeline(t0, t0 + 550 * min, t0 + 600 * min, segs, sites)
        assertEquals(
            listOf("Firma", "Fahrt", "Lilienstraße 77", "Fahrt", "Tutzing", "Heimfahrt"),
            blocks.map { it.label },
        )
        assertEquals(listOf(false, true, false, true, false, true), blocks.map { it.isTravel })
    }

    @Test
    fun ersteFahrtIstAnfahrtWennDieErsteBaustelleSpaeterBeginnt() {
        val sites = mapOf(2L to site(2, "Lilienstraße 77"))
        val blocks = buildTimeline(t0, t0 + 300 * min, t0 + 300 * min, listOf(seg(1, 2, 40, 280)), sites)
        assertEquals("Anfahrt", blocks.first().label)
        assertEquals(40 * min, blocks.first().end - blocks.first().start)
    }

    @Test
    fun kurzeLueckenUnterZweiMinutenSindKeineFahrt() {
        val sites = mapOf(2L to site(2, "A"), 3L to site(3, "B"))
        val blocks = buildTimeline(t0, t0 + 200 * min, t0 + 200 * min, listOf(seg(1, 2, 0, 100), seg(2, 3, 101, 200)), sites)
        assertEquals(listOf("A", "B"), blocks.map { it.label })
    }

    @Test
    fun laufenderTagEndetMitUnterwegsUndLaufenderAbschnittBisJetzt() {
        val sites = mapOf(2L to site(2, "A"))
        val running = buildTimeline(t0, null, t0 + 120 * min, listOf(seg(1, 2, 10, null, "manual")), sites)
        assertEquals(listOf("Anfahrt", "A"), running.map { it.label })
        assertEquals(t0 + 120 * min, running.last().end)
        val afterStop = buildTimeline(t0, null, t0 + 180 * min, listOf(seg(1, 2, 10, 100)), sites)
        assertEquals("Unterwegs", afterStop.last().label)
    }

    @Test
    fun tagOhneBaustelleIstUnterwegs() {
        val blocks = buildTimeline(t0, null, t0 + 30 * min, emptyList(), emptyMap())
        assertEquals(1, blocks.size)
        assertTrue(blocks[0].isTravel)
        assertEquals("Unterwegs", blocks[0].label)
    }

    @Test
    fun ueberlappungenVerschiebenDenNaechstenBlock() {
        val sites = mapOf(2L to site(2, "A"), 3L to site(3, "B"))
        val blocks = buildTimeline(t0, t0 + 200 * min, t0 + 200 * min, listOf(seg(1, 2, 0, 100), seg(2, 3, 90, 200)), sites)
        assertEquals(blocks[0].end, blocks[1].start)
    }
}
