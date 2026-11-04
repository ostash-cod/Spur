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

    private fun haendler(id: Long, name: String) = SiteRow(id, name, null, "#8D6E63", 48.0, 11.0, 100.0, null, "haendler")

    @Test
    fun fahrtZumHaendlerUndZurueckZurSelbenBaustelleIstMaterialfahrt() {
        val sites = mapOf(2L to site(2, "Lilienstraße 77"), 9L to haendler(9, "Brillux"))
        val segs = listOf(seg(1, 2, 0, 100), seg(2, 9, 125, 145), seg(3, 2, 170, 300))
        val blocks = buildTimeline(t0, t0 + 300 * min, t0 + 300 * min, segs, sites)
        assertEquals(listOf("Lilienstraße 77", "Fahrt", "Brillux", "Fahrt", "Lilienstraße 77"), blocks.map { it.label })
        assertEquals(listOf(null, "Lilienstraße 77", "Lilienstraße 77", "Lilienstraße 77", null), blocks.map { it.stripeFor })
        assertTrue(blocks[2].isHaendler)
    }

    @Test
    fun fahrtZuEinerAnderenBaustelleIstAnfahrtZurNeuenBaustelle() {
        val sites = mapOf(2L to site(2, "A"), 3L to site(3, "B"))
        val blocks = buildTimeline(t0, t0 + 300 * min, t0 + 300 * min, listOf(seg(1, 2, 0, 100), seg(2, 3, 150, 300)), sites)
        assertEquals(listOf(null, "B", null), blocks.map { it.stripeFor })
        assertEquals("Anfahrt zu B", blocks[1].stripeText)
    }

    @Test
    fun anfahrtAmMorgenUndHeimfahrtAmAbendHabenStreifenDerBaustelle() {
        val sites = mapOf(2L to site(2, "A"))
        val blocks = buildTimeline(t0, t0 + 400 * min, t0 + 400 * min, listOf(seg(1, 2, 60, 300)), sites)
        assertEquals(listOf("Anfahrt", "A", "Heimfahrt"), blocks.map { it.label })
        assertEquals(listOf("Anfahrt zu A", null, "Heimfahrt von A"), blocks.map { it.stripeText })
    }

    @Test
    fun pauseUnterwegsBleibtGrauAberDieFahrtDavorUndDanachHatStreifen() {
        val sites = mapOf(2L to site(2, "A"))
        val pause = SegmentRow(5, 1, "c5", null, "break", t0 + 130 * min, t0 + 150 * min, "manual")
        val segs = listOf(seg(1, 2, 0, 100), pause, seg(3, 2, 190, 300))
        val blocks = buildTimeline(t0, t0 + 300 * min, t0 + 300 * min, segs, sites)
        assertEquals(listOf("A", "Fahrt", "Pause", "Fahrt", "A"), blocks.map { it.label })
        assertEquals(listOf(null, "A", null, "A", null), blocks.map { it.stripeFor })
    }

    @Test
    fun lagerZwischenZweiFahrtenIstKeineMaterialfahrt() {
        val lager = SiteRow(7, "Lager", null, "#546E7A", 48.0, 11.0, 100.0, "lager")
        val sites = mapOf(2L to site(2, "A"), 7L to lager)
        val blocks = buildTimeline(t0, t0 + 300 * min, t0 + 300 * min, listOf(seg(1, 2, 0, 100), seg(2, 7, 130, 150), seg(3, 2, 180, 300)), sites)
        assertTrue(blocks.none { it.stripeText?.startsWith("Material") == true })
    }

    @Test
    fun weiterWieFahrtAbschnittWirdAlsFahrtGezaehlt() {
        val sites = mapOf(2L to site(2, "A"))
        val travel = SegmentRow(5, 1, "c5", null, "travel", t0 + 110 * min, t0 + 150 * min, "manual")
        val blocks = buildTimeline(t0, t0 + 300 * min, t0 + 300 * min, listOf(seg(1, 2, 0, 100), travel, seg(3, 2, 190, 300)), sites)
        assertEquals(listOf("A", "Fahrt", "A"), blocks.map { it.label })
        assertEquals(listOf(null, "A", null), blocks.map { it.stripeFor })
        assertEquals(90 * min, blocks[1].end - blocks[1].start)
    }
}
