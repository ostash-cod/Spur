package de.ostash.spur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaceDetectorTest {
    private val baseLat = 48.0
    private val baseLng = 11.0
    private val mPerDegLat = 111_195.0

    // Punkt, der "metersNorth" Meter nördlich vom Ort liegt
    private fun north(metersNorth: Double) = baseLat + metersNorth / mPerDegLat

    private val site = Place(1, baseLat, baseLng, 100.0, 120_000)
    private val lager = Place(2, baseLat + 0.05, baseLng, 100.0, 60_000)
    private fun fix(sec: Int, metersNorth: Number, acc: Float = 8f) = Fix(sec * 1000L, north(metersNorth.toDouble()), baseLng, acc)

    private fun run(detector: PlaceDetector, fixes: List<Fix>) = fixes.flatMap { detector.onFix(it) }

    @Test
    fun ankunftZaehltAbErstemPunktImRadius() {
        val d = PlaceDetector(listOf(site))
        val fixes = listOf(fix(0, 800), fix(15, 400), fix(30, 90), fix(45, 20), fix(100, 10), fix(160, 15), fix(170, 12))
        val events = run(d, fixes)
        assertEquals(listOf<PlaceEvent>(PlaceEvent.Arrive(1, 30_000)), events)
        assertEquals(1L, d.currentSiteId)
    }

    @Test
    fun durchfahrtOhneHaltWirdNichtErkannt() {
        val d = PlaceDetector(listOf(site))
        // 100 m Radius bei 50 km/h: nur wenige Sekunden im Radius
        val events = run(d, listOf(fix(0, 300), fix(10, 150), fix(15, 60), fix(20, -40), fix(25, -150), fix(40, -400)))
        assertTrue(events.isEmpty())
    }

    @Test
    fun abfahrtZaehltBisZumLetztenPunktImRadius() {
        val d = PlaceDetector(listOf(site))
        run(d, listOf(fix(0, 20), fix(130, 25)))
        assertEquals(1L, d.currentSiteId)
        val events = run(d, listOf(fix(600, 30), fix(615, 300), fix(630, 600), fix(710, 900)))
        assertEquals(listOf<PlaceEvent>(PlaceEvent.Leave(1, 600_000)), events)
        assertEquals(null, d.currentSiteId)
    }

    @Test
    fun kurzerGpsAusreisserBeendetDenAbschnittNicht() {
        val d = PlaceDetector(listOf(site))
        run(d, listOf(fix(0, 20), fix(130, 25)))
        val events = run(d, listOf(fix(200, 400), fix(215, 30), fix(300, 20)))
        assertTrue(events.isEmpty())
        assertEquals(1L, d.currentSiteId)
    }

    @Test
    fun randZoneVerhindertHinUndHer() {
        val d = PlaceDetector(listOf(site))
        run(d, listOf(fix(0, 20), fix(130, 25)))
        // 120 m: außerhalb des Radius (100 m), aber noch innerhalb der Randzone (140 m)
        val events = run(d, (0..20).map { fix(200 + it * 15, 120.0) })
        assertTrue(events.isEmpty())
    }

    @Test
    fun lagerWirdSchnellerErkanntAlsBaustelle() {
        val d = PlaceDetector(listOf(site, lager))
        val atLager = { sec: Int -> Fix(sec * 1000L, lager.lat, lager.lng, 8f) }
        val events = run(d, listOf(atLager(0), atLager(30), atLager(70)))
        assertEquals(listOf<PlaceEvent>(PlaceEvent.Arrive(2, 0)), events)
    }

    @Test
    fun direkterWechselVonBaustelleZuLager() {
        val d = PlaceDetector(listOf(site, lager))
        val events = mutableListOf<PlaceEvent>()
        events += run(d, listOf(fix(0, 10), fix(130, 15)))
        events += run(d, listOf(fix(600, 20), fix(700, 5000), fix(800, 5200)))
        val atLager = { sec: Int -> Fix(sec * 1000L, lager.lat, lager.lng, 8f) }
        events += run(d, listOf(atLager(900), atLager(960)))
        assertEquals(
            listOf(PlaceEvent.Arrive(1, 0), PlaceEvent.Leave(1, 600_000), PlaceEvent.Arrive(2, 900_000)),
            events,
        )
    }

    @Test
    fun ungenauePunkteWerdenIgnoriert() {
        val d = PlaceDetector(listOf(site))
        val events = run(d, listOf(fix(0, 10, acc = 300f), fix(130, 10, acc = 250f), fix(300, 10, acc = 150f)))
        assertTrue(events.isEmpty())
        assertEquals(null, d.currentSiteId)
    }

    @Test
    fun stillstandMitRepetiertemPunktWirdErkannt() {
        // Die App wiederholt den letzten Punkt alle 20 Sekunden, wenn das Handy still liegt.
        val d = PlaceDetector(listOf(site))
        val events = run(d, (0..8).map { fix(it * 20, 30) })
        assertEquals(listOf<PlaceEvent>(PlaceEvent.Arrive(1, 0)), events)
    }

    @Test
    fun entfernungStimmt() {
        val d = distanceMeters(48.0, 11.0, 48.001, 11.0)
        assertEquals(111.2, d, 0.5)
    }

    @Test
    fun kurzerAusreisserSetztDasWartenNichtZurueck() {
        val d = PlaceDetector(listOf(site))
        // 30 s im Radius, ein Ausreißer (GPS springt), danach weiter im Radius -> Ankunft ab erstem Punkt
        val events = run(d, listOf(fix(0, 50), fix(30, 60), fix(45, 400), fix(60, 55), fix(125, 40), fix(130, 40)))
        assertEquals(listOf<PlaceEvent>(PlaceEvent.Arrive(1, 0)), events)
    }

    @Test
    fun langeZeitAusserhalbSetztDasWartenZurueck() {
        val d = PlaceDetector(listOf(site))
        val events = run(d, listOf(fix(0, 50), fix(30, 400), fix(150, 400), fix(160, 50), fix(200, 50)))
        assertTrue(events.isEmpty())
    }

    @Test
    fun baustelleMitEigenemAbstandBleibtBeimUmsHausFahrenAktiv() {
        val strikt = Place(1, baseLat, baseLng, 100.0, 120_000, leaveMarginM = 120.0, leaveDebounceMs = 240_000)
        val d = PlaceDetector(listOf(strikt))
        val events = run(d, listOf(fix(0, 20), fix(60, 20), fix(130, 20), fix(150, 200), fix(200, 215), fix(260, 215), fix(300, 30)))
        assertEquals(listOf<PlaceEvent>(PlaceEvent.Arrive(1, 0)), events)
        assertEquals(1L, d.currentSiteId)
    }

    @Test
    fun ortMitZweitemPunktWirdVonDortErkanntUndNichtVerlassen() {
        val a = Place(1, baseLat, baseLng, 100.0, 60_000)
        val b = Place(1, baseLat + 400 / mPerDegLat, baseLng, 100.0, 60_000) // Parkplatz 400 m nördlich
        val d = PlaceDetector(listOf(a, b))
        val events = run(d, listOf(fix(0, 700), fix(30, 410), fix(60, 405), fix(100, 400), fix(160, 395), fix(200, 405)))
        assertEquals(1L, d.currentSiteId)
        assertEquals(1, events.count { it is PlaceEvent.Arrive })
        // Zu Fuß zum ersten Punkt und zurück: keine Abfahrt
        val more = run(d, listOf(fix(300, 200), fix(400, 20), fix(500, 10), fix(600, 390)))
        assertTrue(more.none { it is PlaceEvent.Leave })
    }

    @Test
    fun nachbarortWirdTrotzGrossemAbstandsrandErkannt() {
        // Großer Ort (IKEA) und ein Baumarkt 220 m weiter nördlich: Der Baumarkt liegt noch im Abstandsrand von IKEA.
        val ikea = Place(10, baseLat, baseLng, 150.0, 60_000, leaveMarginM = 100.0, leaveDebounceMs = 180_000)
        val baumarkt = Place(11, north(220.0), baseLng, 150.0, 60_000)
        val d = PlaceDetector(listOf(ikea, baumarkt))
        val events = run(d, listOf(fix(0, 10), fix(40, 20), fix(70, 15), fix(100, 15), fix(130, 200), fix(160, 215), fix(190, 220), fix(220, 222), fix(250, 220)))
        assertTrue("Ankunft bei IKEA", events.first() is PlaceEvent.Arrive && (events.first() as PlaceEvent.Arrive).siteId == 10L)
        assertTrue("Abfahrt von IKEA", events.any { it is PlaceEvent.Leave && it.siteId == 10L })
        assertTrue("Ankunft am Baumarkt", events.any { it is PlaceEvent.Arrive && it.siteId == 11L })
        assertEquals(11L, d.currentSiteId)
    }

    @Test
    fun amGrossenOrtBleibtMan_wennKeinNachbarortDa_ist() {
        val ikea = Place(10, baseLat, baseLng, 150.0, 60_000, leaveMarginM = 100.0, leaveDebounceMs = 180_000)
        val d = PlaceDetector(listOf(ikea))
        val events = run(d, listOf(fix(0, 10), fix(40, 20), fix(70, 15), fix(100, 200), fix(160, 240), fix(220, 240), fix(280, 240)))
        assertEquals(1, events.size) // nur die Ankunft, kein Wechsel
        assertEquals(10L, d.currentSiteId)
    }

    @Test
    fun langsamesDurchkriechenImStauIstKeineAnkunft() {
        val big = Place(1, baseLat, baseLng, 200.0, 120_000)
        val d = PlaceDetector(listOf(big))
        // 6 Minuten lang im Kreis, aber immer weiter nach Süden: alle 30 s etwa 50 m
        val fixes = (0..12).map { fix(it * 30, 190 - it * 30) }
        assertTrue(run(d, fixes).isEmpty())
    }

    @Test
    fun einparkenUndStehenBleibenIstEineAnkunft() {
        val big = Place(1, baseLat, baseLng, 200.0, 120_000)
        val d = PlaceDetector(listOf(big))
        // fährt hinein (150 m in 30 s), steht dann still
        val fixes = listOf(fix(0, 190), fix(15, 120), fix(30, 40)) + (2..12).map { fix(it * 30, 35) }
        val events = run(d, fixes)
        assertEquals(1, events.size)
        assertEquals(PlaceEvent.Arrive(1, 0), events[0])
    }

    @Test
    fun ungenauePunkteZaehlenNichtFuerEineAnkunft() {
        val d = PlaceDetector(listOf(site))
        val events = run(d, (0..10).map { fix(it * 30, 150, acc = 80f) })
        assertTrue(events.isEmpty())
    }
}
