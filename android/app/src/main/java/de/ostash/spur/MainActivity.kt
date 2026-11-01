package de.ostash.spur

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val Gelb = Color(0xFFF5C400)
private val Anthrazit = Color(0xFF2B2D31)
private val Hellgrau = Color(0xFFF2F3F4)
private val Gruen = Color(0xFF1F8A3B)
private val Rot = Color(0xFFC62828)

private val scheme = lightColorScheme(
    primary = Gelb,
    onPrimary = Color(0xFF1B1C1E),
    secondary = Anthrazit,
    background = Hellgrau,
    surface = Color.White,
    onBackground = Color(0xFF1F2124),
    onSurface = Color(0xFF1F2124),
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = scheme) { SpurApp() }
        }
    }

    override fun onResume() {
        super.onResume()
        if (Prefs.token(this) != null) SyncWorker.enqueue(this)
    }
}

private fun hasFineLocation(ctx: android.content.Context) =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

private fun hasBackgroundLocation(ctx: android.content.Context) =
    Build.VERSION.SDK_INT < 29 ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

@Composable
fun SpurApp() {
    val ctx = LocalContext.current
    var loggedIn by remember { mutableStateOf(Prefs.token(ctx) != null) }
    // Der Server kann die Anmeldung beenden (zum Beispiel nach „Neuer Code“): dann zurück zur Anmeldung.
    LaunchedEffect(Unit) {
        while (true) {
            loggedIn = Prefs.token(ctx) != null
            delay(2000)
        }
    }
    if (!loggedIn) LoginScreen(onDone = { loggedIn = true }) else MainScreen()
}

@Composable
fun LoginScreen(onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var server by remember { mutableStateOf(Prefs.serverUrl(ctx)) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(Anthrazit), contentAlignment = Alignment.Center) {
        Column(
            Modifier.fillMaxWidth().padding(24.dp).background(Color.White, MaterialTheme.shapes.large).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Spur", fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.background(Gelb).padding(horizontal = 12.dp))
            Text("von Wladi", color = Color(0xFF6A6F75))
            OutlinedTextField(
                value = code,
                onValueChange = { code = it },
                label = { Text("Zugangscode") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Text,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { Text("Server") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            if (error.isNotEmpty()) Text(error, color = Rot)
            Button(
                enabled = !busy && code.isNotBlank() && server.isNotBlank(),
                onClick = {
                    busy = true
                    error = ""
                    Prefs.setServerUrl(ctx, server)
                    scope.launch {
                        try {
                            val res = withContext(Dispatchers.IO) { Api.login(ctx, code.trim()) }
                            val user = res.getJSONObject("user")
                            Prefs.saveLogin(ctx, res.getString("token"), user.getString("name"), user.getBoolean("uses_private_car"))
                            onDone()
                        } catch (e: Api.ApiException) {
                            error = e.message ?: "Fehler"
                        } catch (e: Exception) {
                            error = "Keine Verbindung zum Server"
                        }
                        busy = false
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Gelb, contentColor = Color(0xFF1B1C1E)),
                modifier = Modifier.fillMaxWidth().height(56.dp),
            ) { Text("Anmelden", fontSize = 18.sp, fontWeight = FontWeight.Bold) }
        }
    }
}

private fun formatDuration(ms: Long): String {
    val minutes = (ms / 60_000).coerceAtLeast(0)
    return "%d:%02d".format(minutes / 60, minutes % 60)
}

private val timeFmt = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

@Composable
fun MainScreen() {
    val ctx = LocalContext.current
    val db = remember { Db.get(ctx) }
    var tab by remember { mutableIntStateOf(0) }
    var confirmStop by remember { mutableStateOf(false) }
    var permissionHint by remember { mutableStateOf(false) }

    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(1000)
            value = System.currentTimeMillis()
        }
    }
    val day = remember(now) { db.openDay() }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (hasFineLocation(ctx)) {
            permissionHint = false
            TrackingService.start(ctx)
        } else {
            permissionHint = true
        }
    }

    fun startDay() {
        if (hasFineLocation(ctx)) {
            TrackingService.start(ctx)
        } else {
            val wanted = buildList {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
                add(Manifest.permission.ACCESS_COARSE_LOCATION)
                if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            }
            permissionLauncher.launch(wanted.toTypedArray())
        }
    }

    val status = if (day == null) "Tag nicht gestartet" else "Tag läuft seit ${timeFmt.format(Instant.ofEpochMilli(day.startedAt))}"
    val detail = if (day == null) "Morgens „Tag starten“ drücken" else "Dauer ${formatDuration(now - day.startedAt)} h · GPS-Punkte ${db.countPoints(day.id)}"

    Scaffold(
        containerColor = Hellgrau,
        topBar = {
            Row(
                Modifier.fillMaxWidth().background(Anthrazit).statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(status, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text(detail, color = Color(0xFFB9BDC2), fontSize = 13.sp)
                }
                Button(
                    onClick = { if (day == null) startDay() else confirmStop = true },
                    colors = ButtonDefaults.buttonColors(containerColor = if (day == null) Gruen else Rot, contentColor = Color.White),
                ) { Text(if (day == null) "Tag starten" else "Tag beenden") }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White) {
                listOf("Heute", "Berichte", "Einstellungen").forEachIndexed { i, label ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i },
                        icon = { Spacer(Modifier.height(0.dp)) },
                        label = { Text(label, fontSize = 15.sp, fontWeight = if (tab == i) FontWeight.Bold else FontWeight.Normal) },
                        alwaysShowLabel = true,
                        colors = NavigationBarItemDefaults.colors(indicatorColor = Gelb),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                0 -> TodayScreen(
                    running = day != null,
                    onToggle = { if (day == null) startDay() else confirmStop = true },
                    permissionHint = permissionHint,
                    pending = db.unsyncedPointCount(),
                    now = now,
                )
                1 -> PlaceholderScreen("Berichte", "Wochen- und Monatsnachweis kommen im nächsten Schritt.")
                else -> SettingsScreen()
            }
        }
    }

    if (confirmStop) {
        AlertDialog(
            onDismissRequest = { confirmStop = false },
            title = { Text("Tag beenden?") },
            text = { Text("Danach wird kein Standort mehr aufgezeichnet.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmStop = false
                    TrackingService.stop(ctx)
                }) { Text("Ja, beenden", color = Rot, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
fun TodayScreen(running: Boolean, onToggle: () -> Unit, permissionHint: Boolean, pending: Int, now: Long) {
    val ctx = LocalContext.current
    val lastSync = Prefs.lastSync(ctx)
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Button(
            onClick = onToggle,
            colors = ButtonDefaults.buttonColors(containerColor = if (running) Rot else Gruen, contentColor = Color.White),
            modifier = Modifier.fillMaxWidth().height(180.dp),
        ) { Text(if (running) "Tag beenden" else "Tag starten", fontSize = 34.sp, fontWeight = FontWeight.ExtraBold) }

        if (permissionHint) {
            Text(
                "Ohne Standortfreigabe kann Spur den Weg nicht aufzeichnen. Bitte unter Einstellungen den Standort erlauben.",
                color = Rot,
            )
        }
        Text(
            when {
                pending == 0 && lastSync > 0 -> "Alles abgeglichen (${timeFmt.format(Instant.ofEpochMilli(lastSync))} Uhr)"
                pending == 0 -> "Noch nichts aufgezeichnet"
                else -> "$pending Punkte warten auf den Abgleich (Internet nötig)"
            },
            color = Color(0xFF6A6F75),
        )
        if (!running) {
            Text("Der Zeitbalken mit Baustellen kommt im nächsten Schritt.", color = Color(0xFF6A6F75))
        }
    }
}

@Composable
fun PlaceholderScreen(title: String, text: String) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text(text, color = Color(0xFF6A6F75))
    }
}

@Composable
fun SettingsScreen() {
    val ctx = LocalContext.current
    val name = Prefs.userName(ctx)
    val server = Prefs.serverUrl(ctx)
    val powerManager = ctx.getSystemService(PowerManager::class.java)
    val ignoring = powerManager.isIgnoringBatteryOptimizations(ctx.packageName)

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Einstellungen", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text("Angemeldet als $name")
        Text("Server: $server", color = Color(0xFF6A6F75), fontSize = 13.sp)

        Text("Standort", fontWeight = FontWeight.Bold)
        Text(
            if (hasFineLocation(ctx)) "Standort erlaubt" + if (hasBackgroundLocation(ctx)) ", auch im Hintergrund" else ", aber nicht „immer“"
            else "Standort nicht erlaubt",
        )
        OutlinedButton(
            onClick = {
                ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
            },
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) { Text("Standort „immer erlauben“ (Handy-Einstellungen)") }

        Text("Akku", fontWeight = FontWeight.Bold)
        Text(if (ignoring) "Energiesparen ist für Spur ausgeschaltet." else "Energiesparen kann die Aufzeichnung stoppen.")
        if (!ignoring) {
            OutlinedButton(
                onClick = {
                    ctx.startActivity(
                        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")),
                    )
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Energiesparen für Spur ausschalten") }
        }

        Text("Abgleich", fontWeight = FontWeight.Bold)
        OutlinedButton(onClick = { SyncWorker.enqueue(ctx) }, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text("Jetzt mit dem Server abgleichen")
        }

        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = { Prefs.logout(ctx) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) { Text("Abmelden", color = Rot) }
    }
}
