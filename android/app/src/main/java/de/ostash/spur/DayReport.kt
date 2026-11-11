package de.ostash.spur

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/** Pausenregel der Firma: ab 2,5 h 15 Min, ab 5 h 30 Min, ab 7,5 h 45 Min, ab 10 h 60 Min. */
fun pauseRuleMinutes(durationMs: Long): Int {
    val h = durationMs / 3_600_000.0
    return when {
        h >= 10.0 -> 60
        h >= 7.5 -> 45
        h >= 5.0 -> 30
        h >= 2.5 -> 15
        else -> 0
    }
}

/** Kilometer einer Fahrt aus den Standortpunkten. Wackelnde, ungenaue Punkte zählen nicht. */
fun routeKm(points: List<PointRow>, from: Long, to: Long): Double {
    val p = points.filter { it.ts in from..to && it.acc <= 60f }
    var m = 0.0
    for (i in 1 until p.size) {
        val d = distanceMeters(p[i - 1].lat, p[i - 1].lng, p[i].lat, p[i].lng)
        if (d >= 15.0) m += d
    }
    return m / 1000.0
}

/** Eine Zeile des Tageszettels. */
class SheetLine(val kind: String, val label: String, val siteId: Long?, from: Long, to: Long, val autoKm: Double?) {
    var from by mutableLongStateOf(from)
    var to by mutableLongStateOf(to)
    var vehicle by mutableStateOf("privat")
    var km by mutableStateOf("")
}

/** Gespeicherten (und eventuell geänderten) Zettel wieder laden. */
fun savedSheetLines(json: String, siteMap: Map<Long, SiteRow>): List<SheetLine> {
    val arr = JSONObject(json).getJSONArray("lines")
    return (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        val kind = o.getString("kind")
        val siteId = if (o.has("site_id")) o.getLong("site_id") else null
        val label = when (kind) {
            "travel" -> "Fahrt"
            "break" -> "Pause"
            "private" -> "Privat"
            else -> siteId?.let { siteMap[it]?.name } ?: "Arbeit"
        }
        SheetLine(kind, label, siteId, o.getLong("from"), o.getLong("to"), null).also { l ->
            if (kind == "travel") {
                l.vehicle = o.optString("vehicle", "privat")
                l.km = if (o.has("km")) String.format(java.util.Locale.GERMANY, "%.1f", o.getDouble("km")) else ""
            }
        }
    }
}

/** Neue Uhrzeit für einen Zeitpunkt (gleicher Tag), über die Uhrzeit-Auswahl des Handys. */
fun pickTime(ctx: android.content.Context, current: Long, onPicked: (Long) -> Unit) {
    val z = ZoneId.systemDefault()
    val t = Instant.ofEpochMilli(current).atZone(z)
    android.app.TimePickerDialog(ctx, { _, h, m ->
        onPicked(t.withHour(h).withMinute(m).withSecond(0).withNano(0).toInstant().toEpochMilli())
    }, t.hour, t.minute, true).show()
}

/** Zeit einer Zeile ändern; die Nachbarzeile passt sich an, damit keine Lücke entsteht. */
fun SnapshotStateList<SheetLine>.setBoundary(ctx: android.content.Context, i: Int, isEnd: Boolean, t: Long) {
    val l = this[i]
    if (isEnd) {
        if (t < l.from) { android.widget.Toast.makeText(ctx, "Das Ende liegt vor dem Beginn.", android.widget.Toast.LENGTH_SHORT).show(); return }
        l.to = t
        if (i + 1 < size) this[i + 1].from = t.coerceAtMost(this[i + 1].to).also { if (it < t) this[i + 1].to = t }
    } else {
        if (t > l.to) { android.widget.Toast.makeText(ctx, "Der Beginn liegt nach dem Ende.", android.widget.Toast.LENGTH_SHORT).show(); return }
        l.from = t
        if (i > 0) this[i - 1].to = t.coerceAtLeast(this[i - 1].from).also { if (it > t) this[i - 1].from = t }
    }
}

/**
 * Fester Weg Zuhause–Firma: Beginnt der Tag mit einer Fahrt, die bei Firma oder Lager endet, oder endet er mit einer Fahrt von dort,
 * zählt die feste Kilometerzahl statt der Strecke aus den Standortpunkten.
 */
/** Fester Weg Zuhause–Firma für Mitarbeiter mit Privatauto, sonst 0. */
fun commuteKm(ctx: android.content.Context): Double = if (Prefs.usesPrivateCar(ctx)) Prefs.homeKm(ctx) else 0.0

fun isCommuteBlock(blocks: List<TimelineBlock>, i: Int, siteMap: Map<Long, SiteRow>): Boolean {
    val b = blocks[i]
    if (!b.isTravel) return false
    fun isBase(x: TimelineBlock?) = x != null && !x.isTravel && x.siteId != null && siteMap[x.siteId]?.system != null
    val first = i == 0
    val last = i == blocks.lastIndex
    return (first && isBase(blocks.getOrNull(i + 1))) || (last && isBase(blocks.getOrNull(i - 1)))
}

fun sheetLines(db: Db, day: DayRow, now: Long, siteMap: Map<Long, SiteRow>, fixedKm: Double = 0.0): List<SheetLine> {
    val blocks = buildTimeline(day.startedAt, day.endedAt, now, db.segmentsOfDay(day.id), siteMap)
    val points = db.pointsSince(day.id, day.startedAt)
    val fallback = db.lastVehicle()
    return blocks.mapIndexed { idx, b ->
        val travel = b.isTravel
        val kind = if (travel) "travel" else b.kind
        val auto = if (travel) routeKm(points, b.start, b.end) else null
        SheetLine(kind, b.label + (b.stripeText?.let { " ($it)" } ?: ""), b.siteId, b.start, b.end, auto).also { l ->
            if (travel) {
                val mark = db.tripMark(day.id, b.start)
                l.vehicle = mark?.vehicle ?: fallback
                val commute = fixedKm > 0.0 && isCommuteBlock(blocks, idx, siteMap)
                val km = mark?.km ?: if (commute) fixedKm else auto
                l.km = if (km == null || km == 0.0) "" else String.format(java.util.Locale.GERMANY, "%.1f", km)
            }
        }
    }
}

private fun kmValue(s: String): Double? = s.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it >= 0 }

private val hm = java.time.format.DateTimeFormatter.ofPattern("HH:mm")
private fun hmOf(ms: Long) = hm.format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))

/** Montag der Woche, in der das Datum liegt, als Text. */
fun weekStartOf(date: java.time.LocalDate): String = date.minusDays((date.dayOfWeek.value - 1).toLong()).toString()

/** Ein Tag ist gesperrt, wenn er älter als 7 Tage ist oder seine Woche abgegeben wurde. */
fun isDayLocked(db: Db, date: java.time.LocalDate): Boolean =
    date.isBefore(java.time.LocalDate.now().minusDays(7)) || db.isWeekClosed(weekStartOf(date))

/** Zettel aus dem gespeicherten Stand (Fahrzeug, Kilometer, Pause) zusammenstellen und zum Senden vormerken. */
fun queueSheetFor(db: Db, day: DayRow, now: Long, siteMap: Map<Long, SiteRow>, fixedKm: Double = 0.0) {
    val date = Instant.ofEpochMilli(day.startedAt).atZone(ZoneId.systemDefault()).toLocalDate().toString()
    if (db.sheetState(date) != null) return // schon abgegeben oder vorgemerkt, mit den Änderungen des Mitarbeiters
    val end = day.endedAt ?: now
    val lines = sheetLines(db, day, now, siteMap, fixedKm)
    val brk = db.segmentsOfDay(day.id).filter { it.kind == "break" && it.endedAt != null }.sumOf { it.endedAt!! - it.startedAt }
    val pauseMin = db.dayPause(day.id) ?: maxOf(pauseRuleMinutes(end - day.startedAt), (brk / 60_000L).toInt())
    queueSheetJson(db, day, day.startedAt, end, pauseMin, lines)
}

fun queueSheetJson(db: Db, day: DayRow, start: Long, end: Long, pauseMin: Int, lines: List<SheetLine>) {
    val date = Instant.ofEpochMilli(day.startedAt).atZone(ZoneId.systemDefault()).toLocalDate().toString()
    val arr = JSONArray()
    for (l in lines) {
        val o = JSONObject().put("kind", l.kind).put("from", l.from).put("to", l.to)
        if (l.siteId != null) o.put("site_id", l.siteId)
        if (l.kind == "travel") {
            o.put("vehicle", l.vehicle)
            kmValue(l.km)?.let { o.put("km", it) }
        }
        arr.put(o)
    }
    val json = JSONObject().put("date", date).put("start", start).put("end", end).put("pause_min", pauseMin).put("lines", arr).toString()
    db.queueSheet(date, json)
}

/** Der Zettel zum Tagesende: Abschnitte, Fahrzeug und Kilometer prüfen, Pause einstellen, abgeben. */
@Composable
fun SheetDialog(day: DayRow, now: Long, siteMap: Map<Long, SiteRow>, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val db = remember { Db.get(ctx) }
    val date = Instant.ofEpochMilli(day.startedAt).atZone(ZoneId.systemDefault()).toLocalDate().toString()
    val savedJson = remember(day.id) { db.unsentOrSentSheetJson(date) }
    val lines = remember(day.id) {
        mutableStateListOf<SheetLine>().also {
            it.addAll(if (savedJson != null) savedSheetLines(savedJson, siteMap) else sheetLines(db, day, now, siteMap, commuteKm(ctx)))
        }
    }
    val tick = remember { mutableStateOf(0) }
    val start = lines.firstOrNull()?.from ?: day.startedAt
    val end = lines.lastOrNull()?.to ?: (day.endedAt ?: now)
    val brk = db.segmentsOfDay(day.id).filter { it.kind == "break" && it.endedAt != null }.sumOf { it.endedAt!! - it.startedAt }
    val ruleMin = maxOf(pauseRuleMinutes(end - start), (brk / 60_000L).toInt())
    var pause by remember(day.id) { mutableStateOf((db.dayPause(day.id) ?: ruleMin).toString()) }
    val pauseMin = pause.trim().toIntOrNull()?.coerceIn(0, 600) ?: 0
    val paidMs = maxOf(0L, end - start - pauseMin * 60_000L)
    val privKm = lines.filter { it.kind == "travel" && it.vehicle == "privat" }.sumOf { kmValue(it.km) ?: 0.0 }
    val state = db.sheetState(date)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Zettel für den Tag") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${hmOf(start)} bis ${hmOf(end)} Uhr", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                lines.forEachIndexed { i, l ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFFF1F3F5)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(l.label, fontWeight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            androidx.compose.material3.OutlinedButton(onClick = { pickTime(ctx, l.from) { t -> lines.setBoundary(ctx, i, false, t); tick.value++ } }) { Text("von ${hmOf(l.from)}") }
                            androidx.compose.material3.OutlinedButton(onClick = { pickTime(ctx, l.to) { t -> lines.setBoundary(ctx, i, true, t); tick.value++ } }) { Text("bis ${hmOf(l.to)}") }
                        }
                        if (l.kind == "travel") {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                FilterChip(selected = l.vehicle == "privat", onClick = { l.vehicle = "privat"; tick.value++ }, label = { Text("Privatauto") })
                                FilterChip(selected = l.vehicle == "firma", onClick = { l.vehicle = "firma"; tick.value++ }, label = { Text("Firmenauto") })
                            }
                            OutlinedTextField(
                                value = l.km,
                                onValueChange = { l.km = it; tick.value++ },
                                label = { Text("Kilometer") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.width(160.dp),
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = pause,
                    onValueChange = { pause = it.filter { ch -> ch.isDigit() }.take(3) },
                    label = { Text("Pause in Minuten") },
                    supportingText = { Text("Vorschlag nach Regel: $ruleMin Min. Du kannst es ändern.") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.width(220.dp),
                )
                key(tick.value) {
                    Text("Bezahlt: ${formatDuration(paidMs)} h · Privatauto: ${String.format(java.util.Locale.GERMANY, "%.1f", privKm)} km", fontWeight = FontWeight.Bold)
                }
                if (state == 0) Text("Zettel ist vorgemerkt und geht ab, sobald Internet da ist.", color = Color(0xFF6A6F75), fontSize = 13.sp)
                if (state == 1) Text("Zettel wurde abgegeben. Du kannst ihn ändern und noch einmal abgeben.", color = Color(0xFF6A6F75), fontSize = 13.sp)
            }
        },
        confirmButton = {
            Button(onClick = {
                for (l in lines) if (l.kind == "travel") db.saveTripMark(day.id, l.from, l.vehicle, kmValue(l.km))
                db.saveDayPause(day.id, pauseMin)
                queueSheetJson(db, day, start, end, pauseMin, lines)
                SyncWorker.enqueue(ctx)
                onDismiss()
            }) { Text("Abgeben") }
        },
        dismissButton = {
            Row {
                if (savedJson != null) TextButton(onClick = {
                    lines.clear(); lines.addAll(sheetLines(db, day, now, siteMap, commuteKm(ctx))); tick.value++
                }) { Text("Neu aus dem Tag") }
                TextButton(onClick = onDismiss) { Text("Später") }
            }
        },
    )
}

/** Knopf „Zettel“ für einen Tag: öffnet den Zettel zum Prüfen und Abgeben. */
@Composable
fun SheetButton(day: DayRow, now: Long, siteMap: Map<Long, SiteRow>) {
    var open by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    val date = Instant.ofEpochMilli(day.startedAt).atZone(ZoneId.systemDefault()).toLocalDate()
    if (isDayLocked(Db.get(ctx), date)) {
        Text("Dieser Tag ist abgeschlossen. Änderungen macht nur der Chef.", color = Color(0xFF6A6F75), fontSize = 13.sp)
        return
    }
    androidx.compose.material3.OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text("📋 Zettel für diesen Tag prüfen und abgeben", fontWeight = FontWeight.Bold)
    }
    if (open) SheetDialog(day, now, siteMap, onDismiss = { open = false })
}

/** Knopf „Woche abgeben“: schickt die Zettel von Montag bis heute ab und sperrt die Woche für Änderungen. */
@Composable
fun WeekSubmitButton(now: Long, siteMap: Map<Long, SiteRow>) {
    val ctx = LocalContext.current
    val db = remember { Db.get(ctx) }
    var confirm by remember { mutableStateOf(false) }
    var doneMsg by remember { mutableStateOf<String?>(null) }
    val today = java.time.LocalDate.now()
    val weekStart = weekStartOf(today)
    if (db.isWeekClosed(weekStart) && doneMsg == null) {
        Text("Diese Woche ist abgegeben.", color = Color(0xFF6A6F75), fontSize = 13.sp)
        return
    }
    androidx.compose.material3.OutlinedButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text("✅ Woche abgeben", fontWeight = FontWeight.Bold)
    }
    doneMsg?.let { Text(it, color = Color(0xFF2E7D32), fontSize = 14.sp) }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Woche abgeben?") },
            text = { Text("Alle Zettel von Montag bis heute gehen an den Chef. Danach kannst du diese Tage nicht mehr ändern.") },
            confirmButton = {
                Button(onClick = {
                    confirm = false
                    val zone = ZoneId.systemDefault()
                    val monday = java.time.LocalDate.parse(weekStart)
                    var n = 0
                    var d = monday
                    while (!d.isAfter(today)) {
                        val from = d.atStartOfDay(zone).toInstant().toEpochMilli()
                        val to = d.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                        for (day in db.daysOnDate(from, to)) { queueSheetFor(db, day, now, siteMap, commuteKm(ctx)); n++ }
                        d = d.plusDays(1)
                    }
                    db.closeWeek(weekStart)
                    SyncWorker.enqueue(ctx)
                    doneMsg = "Woche abgegeben ($n Tage)."
                }) { Text("Ja, abgeben") }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Abbrechen") } },
        )
    }
}
