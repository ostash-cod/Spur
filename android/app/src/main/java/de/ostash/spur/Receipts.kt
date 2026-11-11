package de.ostash.spur

import android.app.Activity
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Startet den Google-Dokumentenscanner. Das fertige PDF wird gemerkt und zum Hochladen vorgemerkt; danach geht [onScanned] mit der Beleg-Kennung. */
@Composable
fun rememberReceiptScanner(onScanned: (String) -> Unit): () -> Unit {
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode == Activity.RESULT_OK) {
            val pdf = GmsDocumentScanningResult.fromActivityResultIntent(res.data)?.pdf?.uri
            if (pdf != null) {
                try {
                    val dir = File(ctx.filesDir, "receipts").apply { mkdirs() }
                    val clientId = "receipt-" + UUID.randomUUID().toString()
                    val out = File(dir, "$clientId.pdf")
                    ctx.contentResolver.openInputStream(pdf)?.use { input -> out.outputStream().use { input.copyTo(it) } }
                    if (out.length() > 0) {
                        Db.get(ctx).addReceipt(clientId, out.absolutePath, System.currentTimeMillis())
                        SyncWorker.enqueue(ctx)
                        onScanned(clientId)
                    }
                } catch (e: Exception) {
                    Toast.makeText(ctx, "Der Beleg konnte nicht gespeichert werden.", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
    return {
        val activity = ctx as? Activity
        if (activity == null) {
            Toast.makeText(ctx, "Scanner nicht verfügbar.", Toast.LENGTH_LONG).show()
        } else {
            val options = GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(false)
                .setPageLimit(6)
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .build()
            GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
                .addOnSuccessListener { launcher.launch(IntentSenderRequest.Builder(it).build()) }
                .addOnFailureListener { Toast.makeText(ctx, "Der Scanner ist auf diesem Handy nicht verfügbar.", Toast.LENGTH_LONG).show() }
        }
    }
}

/** Wohin gehört der Beleg? Mehrere Ziele möglich, je Ziel ein kurzer Text („10 von 20 Stück“). */
@Composable
fun ReceiptAssignDialog(clientId: String, ordered: List<SiteRow>, runningSiteId: Long?, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val db = remember { Db.get(ctx) }
    val chosen = remember { mutableStateMapOf<Long, String>() }
    var query by remember { mutableStateOf("") }
    val candidates = remember(ordered) { ordered.filter { it.kind != "haendler" } }
    val q = query.trim().lowercase()
    val shown = (if (q.isEmpty()) candidates.take(8) else candidates.filter { it.name.lowercase().contains(q) || (it.customerName ?: "").lowercase().contains(q) }.take(12))
        .let { list -> (list + candidates.filter { it.id in chosen.keys && it !in list }) }
    // Gleich vorgewählt: die Baustelle, auf der man gerade ist.
    remember(clientId) { if (runningSiteId != null && candidates.any { it.id == runningSiteId }) chosen[runningSiteId] = "" ; 0 }
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Wofür ist der Beleg?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Du kannst mehrere wählen, zum Beispiel Baustelle und Lager.", fontSize = 13.sp, color = androidx.compose.ui.graphics.Color(0xFF6A6F75))
                OutlinedTextField(value = query, onValueChange = { query = it }, label = { Text("Suchen") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                for (s in shown) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = s.id in chosen.keys, onCheckedChange = { on -> if (on) chosen[s.id] = chosen[s.id] ?: "" else chosen.remove(s.id) })
                        Text(s.name + (if (s.system != null) " (Lager/Firma)" else ""), fontWeight = FontWeight.Bold)
                    }
                    if (s.id in chosen.keys) {
                        OutlinedTextField(
                            value = chosen[s.id] ?: "",
                            onValueChange = { chosen[s.id] = it },
                            label = { Text("Menge oder Notiz (freiwillig)") },
                            modifier = Modifier.fillMaxWidth().padding(start = 12.dp),
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(enabled = chosen.isNotEmpty(), onClick = {
                val arr = JSONArray()
                for ((id, t) in chosen) arr.put(JSONObject().put("site_id", id).put("text", t.trim()))
                db.setReceiptAllocs(clientId, arr.toString())
                SyncWorker.enqueue(ctx)
                onDone()
            }) { Text("Speichern") }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("Später zuordnen") } },
    )
}

/** Fragt, ob ein Foto der Baustelle oder ein Beleg aufgenommen werden soll. */
@Composable
fun CameraChoiceDialog(onPhoto: () -> Unit, onReceipt: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Was möchtest du aufnehmen?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { onDismiss(); onPhoto() }, modifier = Modifier.fillMaxWidth()) { Text("📷 Foto der Baustelle", fontWeight = FontWeight.Bold) }
                OutlinedButton(onClick = { onDismiss(); onReceipt() }, modifier = Modifier.fillMaxWidth()) { Text("🧾 Beleg scannen (Lieferschein, Rechnung)", fontWeight = FontWeight.Bold) }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}
