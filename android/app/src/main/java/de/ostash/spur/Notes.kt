package de.ostash.spur

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import android.media.ExifInterface
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID

private val dayFmt = DateTimeFormatter.ofPattern("dd.MM.")

/** Foto aufnehmen: Kamera-App öffnen, Bild verkleinern, merken und zum Abgleich vormerken. */
@Composable
fun rememberPhotoTaker(siteId: Long?, onTaken: () -> Unit): () -> Unit {
    val ctx = LocalContext.current
    var pending by remember { mutableStateOf<Triple<File, String, Long>?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val p = pending
        pending = null
        if (p != null) {
            val (raw, clientId, takenAt) = p
            if (ok && raw.exists() && raw.length() > 0) {
                val out = File(raw.parentFile, "$clientId.jpg")
                if (shrinkJpeg(raw, out)) {
                    Db.get(ctx).addPhoto(clientId, out.absolutePath, siteId, takenAt)
                    SyncWorker.enqueue(ctx)
                    onTaken()
                }
            }
            raw.delete()
        }
    }
    return {
        val dir = File(ctx.filesDir, "photos").apply { mkdirs() }
        val clientId = "photo-" + UUID.randomUUID().toString()
        val raw = File(dir, "raw-$clientId.jpg")
        pending = Triple(raw, clientId, System.currentTimeMillis())
        val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", raw)
        launcher.launch(uri)
    }
}

/** Verkleinert auf höchstens 1600 Punkte Kantenlänge, dreht nach den Kameradaten, speichert als JPEG. */
fun shrinkJpeg(src: File, dst: File): Boolean = try {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(src.absolutePath, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    var bmp = BitmapFactory.decodeFile(src.absolutePath, opts)!!
    val longest = maxOf(bmp.width, bmp.height)
    if (longest > 1600) {
        val f = 1600f / longest
        bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * f).toInt(), (bmp.height * f).toInt(), true)
    }
    val rot = when (ExifInterface(src.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    if (rot != 0f) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rot) }, true)
    dst.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
    true
} catch (e: Exception) {
    false
}

/** Notiz schreiben oder ändern. Tag (heute bis 5 Tage zurück) und Ort sind wählbar. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun NoteDialog(startDate: LocalDate, startSiteId: Long?, sites: List<SiteRow>, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val db = remember { Db.get(ctx) }
    var date by remember { mutableStateOf(startDate) }
    var siteId by remember { mutableStateOf(startSiteId) }
    var reload by remember { mutableIntStateOf(0) }
    val saved = remember(date, siteId, reload) { db.notesForDate(date.toString()).firstOrNull { it.siteId == siteId }?.text ?: "" }
    var text by remember(date, siteId) { mutableStateOf(saved) }
    val today = LocalDate.now()
    val choices = sites.filter { it.system == null && it.kind != "haendler" }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Notiz zur Arbeit") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Tag", fontWeight = FontWeight.Bold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0..5) {
                        val d = today.minusDays(i.toLong())
                        FilterChip(selected = d == date, onClick = { date = d }, label = { Text(if (i == 0) "Heute" else if (i == 1) "Gestern" else d.format(dayFmt)) })
                    }
                }
                Text("Baustelle", fontWeight = FontWeight.Bold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(selected = siteId == null, onClick = { siteId = null }, label = { Text("Ohne Baustelle") })
                    for (s in choices) FilterChip(selected = siteId == s.id, onClick = { siteId = s.id }, label = { Text(s.name) })
                }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text("Was wurde gemacht?") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
            }
        },
        confirmButton = {
            Button(onClick = {
                db.saveNote(date.toString(), siteId, text)
                SyncWorker.enqueue(ctx)
                reload++
                onDismiss()
            }) { Text("Speichern") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/** Die zwei Knöpfe Foto und Notiz nebeneinander. */
@Composable
fun PhotoNoteButtons(onPhoto: (() -> Unit)?, onNote: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (onPhoto != null) {
            OutlinedButton(onClick = onPhoto, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text("📷 Foto", fontSize = 17.sp, fontWeight = FontWeight.Bold) }
        }
        OutlinedButton(onClick = onNote, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text("📝 Notiz", fontSize = 17.sp, fontWeight = FontWeight.Bold) }
    }
}

/** Liste der Notizen eines Tages; Tippen öffnet sie zum Ändern. */
@Composable
fun NotesList(date: LocalDate, sites: Map<Long, SiteRow>, version: Int, onEdit: (Db.NoteRow) -> Unit) {
    val ctx = LocalContext.current
    val notes = remember(date, version) { Db.get(ctx).notesForDate(date.toString()).filter { it.text.isNotBlank() } }
    for (n in notes) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White).clickable { onEdit(n) }.padding(12.dp),
        ) {
            Text(n.siteId?.let { sites[it]?.name } ?: "Ohne Baustelle", fontWeight = FontWeight.Bold)
            Text(n.text, color = Color(0xFF3A3F45))
            Text("Tippen zum Ändern", color = Color(0xFF6A6F75), fontSize = 12.sp)
        }
    }
}
