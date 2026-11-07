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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
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
class SheetLine(val kind: String, val label: String, val siteId: Long?, val from: Long, val to: Long, val autoKm: Double?) {
    var vehicle: String = "privat"
    var km: String = ""
}

fun sheetLines(db: Db, day: DayRow, now: Long, siteMap: Map<Long, SiteRow>): List<SheetLine> {
    val blocks = buildTimeline(day.startedAt, day.endedAt, now, db.segmentsOfDay(day.id), siteMap)
    val points = db.pointsSince(day.id, day.startedAt)
    val fallback = db.lastVehicle()
    return blocks.map { b ->
        val travel = b.isTravel
        val kind = if (travel) "travel" else b.kind
        val auto = if (travel) routeKm(points, b.start, b.end) else null
        SheetLine(kind, b.label + (b.stripeText?.let { " ($it)" } ?: ""), b.siteId, b.start, b.end, auto).also { l ->
            if (travel) {
                val mark = db.tripMark(day.id, b.start)
                l.vehicle = mark?.vehicle ?: fallback
                val km = mark?.km ?: auto
                l.km = if (km == null || km == 0.0) "" else String.format(java.util.Locale.GERMANY, "%.1f", km)
            }
        }
    }
}

private fun kmValue(s: String): Double? = s.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it >= 0 }

private val hm = java.time.format.DateTimeFormatter.ofPattern("HH:mm")
private fun hmOf(ms: Long) = hm.format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))

/** Der Zettel zum Tagesende: Abschnitte, Fahrzeug und Kilometer prüfen, Pause einstellen, abgeben. */
@Composable
fun SheetDialog(day: DayRow, now: Long, siteMap: Map<Long, SiteRow>, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val db = remember { Db.get(ctx) }
    val end = day.endedAt ?: now
    val lines = remember(day.id) { mutableStateListOf<SheetLine>().also { it.addAll(sheetLines(db, day, now, siteMap)) } }
    val tick = remember { mutableStateOf(0) }
    val brk = db.segmentsOfDay(day.id).filter { it.kind == "break" && it.endedAt != null }.sumOf { it.endedAt!! - it.startedAt }
    val ruleMin = maxOf(pauseRuleMinutes(end - day.startedAt), (brk / 60_000L).toInt())
    var pause by remember(day.id) { mutableStateOf((db.dayPause(day.id) ?: ruleMin).toString()) }
    val pauseMin = pause.trim().toIntOrNull()?.coerceIn(0, 600) ?: 0
    val paidMs = maxOf(0L, end - day.startedAt - pauseMin * 60_000L)
    val privKm = lines.filter { it.kind == "travel" && it.vehicle == "privat" }.sumOf { kmValue(it.km) ?: 0.0 }
    val date = Instant.ofEpochMilli(day.startedAt).atZone(ZoneId.systemDefault()).toLocalDate().toString()
    val state = db.sheetState(date)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Zettel für den Tag") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${hmOf(day.startedAt)} bis ${hmOf(end)} Uhr", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                for (l in lines) {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFFF1F3F5)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("${hmOf(l.from)} bis ${hmOf(l.to)} · ${l.label}", fontWeight = FontWeight.Bold)
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
                val json = JSONObject().put("date", date).put("start", day.startedAt).put("end", end).put("pause_min", pauseMin).put("lines", arr).toString()
                db.queueSheet(date, json)
                SyncWorker.enqueue(ctx)
                onDismiss()
            }) { Text("Abgeben") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Später") } },
    )
}

/** Knopf „Zettel“ für einen Tag: öffnet den Zettel zum Prüfen und Abgeben. */
@Composable
fun SheetButton(day: DayRow, now: Long, siteMap: Map<Long, SiteRow>) {
    var open by remember { mutableStateOf(false) }
    androidx.compose.material3.OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text("📋 Zettel für diesen Tag prüfen und abgeben", fontWeight = FontWeight.Bold)
    }
    if (open) SheetDialog(day, now, siteMap, onDismiss = { open = false })
}
