package de.ostash.spur

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Ein Block im Zeitbalken: eine Baustelle (in ihrer Farbe) oder eine Fahrt (gelb mit Transporter). */
data class TimelineBlock(
    val isTravel: Boolean,
    val label: String,
    val colorHex: String?,
    val customer: String?,
    val start: Long,
    val end: Long,
    val auto: Boolean,
)

private const val MIN_TRAVEL_MS = 2 * 60_000L

/** Macht aus den Abschnitten die Blöcke des Tages. Die Zeit dazwischen ist Fahrt. */
fun buildTimeline(
    dayStart: Long,
    dayEnd: Long?,
    now: Long,
    segments: List<SegmentRow>,
    sites: Map<Long, SiteRow>,
): List<TimelineBlock> {
    val end = dayEnd ?: now
    val segs = segments.sortedBy { it.startedAt }
    val out = mutableListOf<TimelineBlock>()
    var cursor = dayStart
    for (s in segs) {
        val sEnd = s.endedAt ?: end
        if (s.startedAt - cursor >= MIN_TRAVEL_MS) {
            out += TimelineBlock(true, if (out.isEmpty()) "Anfahrt" else "Fahrt", null, null, cursor, s.startedAt, false)
        }
        val start = maxOf(s.startedAt, cursor)
        val site = s.siteId?.let { sites[it] }
        out += TimelineBlock(false, site?.name ?: "Ohne Baustelle", site?.color, site?.customerName, start, maxOf(start, sEnd), s.source == "auto")
        cursor = maxOf(cursor, sEnd)
    }
    if (end - cursor >= MIN_TRAVEL_MS) {
        val label = when {
            segs.isEmpty() -> "Unterwegs"
            dayEnd != null -> "Heimfahrt"
            else -> "Unterwegs"
        }
        out += TimelineBlock(true, label, null, null, cursor, end, false)
    }
    return out
}

private val clock = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())
private fun hm(ms: Long) = clock.format(Instant.ofEpochMilli(ms))
private fun dur(ms: Long): String {
    val m = (ms / 60_000).coerceAtLeast(0)
    return "%d:%02d h".format(m / 60, m % 60)
}

private val Gelb = Color(0xFFF5C400)
private val Dunkel = Color(0xFF1B1C1E)

@Composable
fun VanIcon(modifier: Modifier = Modifier) {
    Canvas(modifier.size(width = 34.dp, height = 20.dp)) {
        val s = size.width / 34f
        val body = Color(0xFF4B5159)
        drawRoundRect(body, Offset(1 * s, 2 * s), Size(19 * s, 12 * s), CornerRadius(2 * s))
        val cab = Path().apply {
            moveTo(20 * s, 5 * s); lineTo(26.2f * s, 5 * s); lineTo(31.5f * s, 9.2f * s); lineTo(31.5f * s, 14 * s); lineTo(20 * s, 14 * s); close()
        }
        drawPath(cab, body)
        val win = Path().apply {
            moveTo(22 * s, 6.8f * s); lineTo(25.6f * s, 6.8f * s); lineTo(28.6f * s, 9.2f * s); lineTo(22 * s, 9.2f * s); close()
        }
        drawPath(win, Gelb)
        for (cx in listOf(8f, 26f)) {
            drawCircle(Gelb, 4.4f * s, Offset(cx * s, 15.5f * s))
            drawCircle(body, 3f * s, Offset(cx * s, 15.5f * s))
        }
    }
}

/** Senkrechter Zeitbalken wie am Desktop: eine Stunde ist 66 dp hoch. */
@Composable
fun DayTimeline(blocks: List<TimelineBlock>) {
    if (blocks.isEmpty()) return
    val dpPerMin = 1.1f
    val t0 = blocks.first().start / 3_600_000 * 3_600_000
    val tEnd = blocks.maxOf { it.end }
    val totalMin = ((tEnd - t0) / 60_000f).coerceAtLeast(60f)
    var prevBottom = -1000f
    val placed = blocks.map { b ->
        val top = maxOf((b.start - t0) / 60_000f * dpPerMin, prevBottom + 2f)
        val h = maxOf(28f, (b.end - b.start) / 60_000f * dpPerMin - 2f)
        prevBottom = top + h
        Triple(b, top, h)
    }
    val total = maxOf(totalMin * dpPerMin, prevBottom + 6f)
    Box(Modifier.fillMaxWidth().height(total.dp)) {
        var m = 0f
        while (m <= totalMin) {
            val y = (m * dpPerMin).dp
            Text(hm(t0 + (m * 60_000).toLong()), fontSize = 11.sp, color = Color(0xFF6A6F75), modifier = Modifier.offset(y = y - 8.dp).width(40.dp))
            Box(Modifier.offset(x = 44.dp, y = y).fillMaxWidth().height(1.dp).background(Color(0xFFDCDFE2)))
            m += 60f
        }
        for ((b, top, h) in placed) {
            val bg = if (b.isTravel) Gelb else Color(android.graphics.Color.parseColor(b.colorHex ?: "#B8BCC2"))
            val fg = if (b.isTravel || bg.luminance() > 0.5f) Dunkel else Color.White
            Row(
                Modifier
                    .padding(start = 48.dp)
                    .offset(y = top.dp)
                    .fillMaxWidth()
                    .height(h.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(bg)
                    .padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (b.isTravel) {
                    VanIcon()
                    Box(Modifier.width(8.dp))
                }
                Column {
                    Text("${b.label} · ${dur(b.end - b.start)}", color = fg, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    if (h >= 44f) {
                        Text(
                            "${hm(b.start)} bis ${hm(b.end)}" + (b.customer?.let { " · $it" } ?: "") + if (b.auto) " · automatisch" else "",
                            color = fg,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
        }
    }
}
