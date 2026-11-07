package de.ostash.spur

import android.content.Context
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Switch
import java.time.DayOfWeek
import java.time.LocalTime
import java.time.format.TextStyle as DayStyle
import androidx.compose.material3.IconButton
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
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
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

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
                            Prefs.saveLogin(ctx, res.getString("token"), user.getString("name"), user.getBoolean("uses_private_car"), user.optString("role") == "admin")
                            Reminder.schedule(ctx)
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

fun formatDuration(ms: Long): String {
    val minutes = (ms / 60_000).coerceAtLeast(0)
    return "%d:%02d".format(minutes / 60, minutes % 60)
}

private val timeFmt = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

/** Wie viele frühere Tage man durch Wischen erreicht. */
private const val DAYS_BACK = 60

@Composable
fun MainScreen() {
    val ctx = LocalContext.current
    val db = remember { Db.get(ctx) }
    var tab by remember { mutableIntStateOf(0) }
    var confirmStop by remember { mutableStateOf(false) }
    var sheetDayId by remember { mutableStateOf<Long?>(null) }
    var permissionHint by remember { mutableStateOf(false) }
    var pendingSite by remember { mutableStateOf<Long?>(null) }
    var confirmEndSite by remember { mutableStateOf<SiteRow?>(null) }
    var showNewSite by remember { mutableStateOf(false) }
    var confirmStart by remember { mutableStateOf<SiteRow?>(null) }
    var positionSite by remember { mutableStateOf<SiteRow?>(null) }
    var showSaveHaendler by remember { mutableStateOf(false) }
    var nameStop by remember { mutableStateOf<StopRow?>(null) }
    var confirmPause by remember { mutableStateOf<StopRow?>(null) }
    var changeStop by remember { mutableStateOf<StopRow?>(null) }
    var menuSite by remember { mutableStateOf<SiteRow?>(null) }
    var update by remember { mutableStateOf<UpdateInfo?>(null) }
    val scope = rememberCoroutineScope()
    val pagerState = rememberPagerState(initialPage = DAYS_BACK, pageCount = { DAYS_BACK + 1 })
    val page = pagerState.currentPage
    val selectedDate = LocalDate.now().minusDays((DAYS_BACK - page).toLong())

    // Läuft ein Tag, aber der Aufzeichnungsdienst wurde beendet (Update, Neustart, Energiesparen), startet er wieder, sobald die App geöffnet wird.
    LaunchedEffect(Unit) {
        if (db.openDay() != null && hasFineLocation(ctx)) TrackingService.start(ctx)
        Reminder.schedule(ctx) // Erinnerung zum Tagesbeginn
    }
    // Chef-Status beim Start vom Server holen (wer sich früher angemeldet hat, hat ihn vielleicht nicht gespeichert).
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching { Prefs.setAdmin(ctx, Api.get(ctx, "/api/me", Prefs.token(ctx) ?: "").optString("role") == "admin") }
        }
    }
    // Beim Start nachsehen, ob es eine neuere App gibt (ohne Meldung, wenn kein Internet da ist).
    LaunchedEffect(Unit) {
        update = withContext(Dispatchers.IO) { runCatching { Updater.check(ctx) }.getOrNull() }
    }

    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(1000)
            value = System.currentTimeMillis()
        }
    }
    val day = remember(now) { db.openDay() }
    val segment = remember(now) { day?.let { db.openSegment(it.id) } }
    val sites = remember(now / 3000) { db.sites() }
    val currentSite = sites.find { it.id == segment?.siteId }
    val usage = remember(now / 5000) { db.siteUsage() }
    val latestDay = remember(now / 5000) { db.latestDay() }
    val siteMap = remember(sites) { sites.associateBy { it.id } }
    val todayDay = latestDay?.takeIf { Instant.ofEpochMilli(it.startedAt).atZone(ZoneId.systemDefault()).toLocalDate() == LocalDate.now() }
    val allStops = remember(now / 2000, todayDay?.id) { todayDay?.let { db.stopsOfDay(it.id) } ?: emptyList() }
    val stops = allStops.filter { it.state == "pending" }
    val doneStops = remember(allStops, siteMap) {
        allStops.filter { it.state == "done" }.map { st ->
            val seg = st.segClientId?.let { db.segmentByClientId(it) }
            val text = when (seg?.kind) {
                "break" -> "Pause"
                "work" -> seg.siteId?.let { siteMap[it]?.name } ?: "Ort"
                else -> "Weiter wie Fahrt"
            }
            st to text
        }
    }
    val pastDays = remember(page, now / 5000) {
        if (page == DAYS_BACK) emptyList() else {
            val zone = ZoneId.systemDefault()
            db.daysOnDate(selectedDate.atStartOfDay(zone).toInstant().toEpochMilli(), selectedDate.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli())
        }
    }
    val timeline = remember(now / 5000, sites) {
        val d = latestDay
        val isToday = d != null && Instant.ofEpochMilli(d.startedAt).atZone(ZoneId.systemDefault()).toLocalDate() == LocalDate.now()
        if (d != null && isToday) buildTimeline(d.startedAt, d.endedAt, now, db.segmentsOfDay(d.id), siteMap) else emptyList()
    }

    // Tag beginnen (falls noch keiner läuft) und, wenn gewünscht, gleich auf einer Baustelle starten.
    fun beginDay(siteId: Long?) {
        val d = db.startDayIfNone(System.currentTimeMillis())
        if (siteId != null) db.switchSite(d.id, siteId, System.currentTimeMillis())
        TrackingService.start(ctx)
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (hasFineLocation(ctx)) {
            permissionHint = false
            beginDay(pendingSite)
        } else {
            permissionHint = true
        }
        pendingSite = null
    }

    fun startDay(siteId: Long? = null) {
        if (hasFineLocation(ctx)) {
            beginDay(siteId)
        } else {
            pendingSite = siteId
            val wanted = buildList {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
                add(Manifest.permission.ACCESS_COARSE_LOCATION)
                if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            }
            permissionLauncher.launch(wanted.toTypedArray())
        }
    }

    fun answerAtSite(st: StopRow, site: SiteRow) {
        val open = day?.let { db.openSegment(it.id) }
        if (day != null && (open == null || open.startedAt <= st.startedAt)) db.endOpenSegment(day.id, st.startedAt)
        db.answerStop(st, "work", site.id)
        learnPoint(ctx, site, st.lat, st.lng)
        changeStop = null
        SyncWorker.enqueue(ctx)
    }

    fun onSiteTap(site: SiteRow) {
        when {
            segment?.siteId == site.id -> confirmEndSite = site
            else -> confirmStart = site // immer nachfragen, damit nichts versehentlich in der Tasche passiert
        }
    }

    val dateText = selectedDate.format(DateTimeFormatter.ofPattern("EEEE, d. MMMM", Locale.GERMANY))
    val subtitle = when {
        tab != 0 || page == DAYS_BACK ->
            if (day == null) "Tag nicht gestartet"
            else "seit ${timeFmt.format(Instant.ofEpochMilli(day.startedAt))} · ${
                when {
                    segment == null -> "keine Baustelle gewählt"
                    segment.kind == "break" -> "Pause " + formatDuration(now - segment.startedAt) + " h"
                    segment.kind == "work" -> (currentSite?.name ?: "Ort") + " " + formatDuration(now - segment.startedAt) + " h"
                    else -> "unterwegs"
                }
            }"
        pastDays.isEmpty() -> "Nichts aufgezeichnet"
        else -> pastDays.joinToString(" · ") { d ->
            "${timeFmt.format(Instant.ofEpochMilli(d.startedAt))} bis ${d.endedAt?.let { timeFmt.format(Instant.ofEpochMilli(it)) } ?: "offen"} · ${formatDuration((d.endedAt ?: now) - d.startedAt)} h"
        }
    }

    Scaffold(
        containerColor = Hellgrau,
        topBar = {
            Row(
                Modifier.fillMaxWidth().background(Anthrazit).statusBarsPadding().padding(horizontal = 6.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (tab == 0) {
                    TextButton(onClick = { scope.launch { pagerState.animateScrollToPage((page - 1).coerceAtLeast(0)) } }, enabled = page > 0) {
                        Text("‹", color = if (page > 0) Color.White else Color(0xFF55585D), fontSize = 30.sp)
                    }
                } else Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(dateText, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    Text(subtitle, color = Color(0xFFB9BDC2), fontSize = 13.sp)
                }
                if (tab == 0) {
                    if (page != DAYS_BACK) {
                        TextButton(onClick = { scope.launch { pagerState.animateScrollToPage(DAYS_BACK) } }) { Text("Heute", color = Gelb, fontWeight = FontWeight.Bold) }
                    }
                    TextButton(onClick = { scope.launch { pagerState.animateScrollToPage((page + 1).coerceAtMost(DAYS_BACK)) } }, enabled = page < DAYS_BACK) {
                        Text("›", color = if (page < DAYS_BACK) Color.White else Color(0xFF55585D), fontSize = 30.sp)
                    }
                }
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
                0 -> HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { p ->
                  if (p != DAYS_BACK) {
                    PastDayScreen(LocalDate.now().minusDays((DAYS_BACK - p).toLong()), now, db, siteMap)
                  } else TodayScreen(
                    running = day != null,
                    onToggle = { if (day == null) startDay() else confirmStop = true },
                    permissionHint = permissionHint,
                    pending = db.unsyncedPointCount(),
                    now = now,
                    dayInfo = day?.let { "Tag ${formatDuration(now - it.startedAt)} h · GPS-Punkte ${db.countPoints(it.id)}" },
                    sites = sites,
                    usage = usage,
                    runningSegment = segment,
                    onSiteTap = { onSiteTap(it) },
                    isAdmin = Prefs.isAdmin(ctx),
                    onNewSite = { showNewSite = true },
                    onSaveHaendler = { showSaveHaendler = true },
                    onSiteLongPress = { menuSite = it },
                    timeline = timeline,
                    stops = stops,
                    doneStops = doneStops,
                    onStopPause = { confirmPause = it },
                    onStopName = { nameStop = it },
                    onStopContinue = { st ->
                        db.answerStop(st, "travel", null)
                        SyncWorker.enqueue(ctx)
                    },
                    onStopAtSite = { st, site -> answerAtSite(st, site) },
                    onStopChange = { changeStop = it },
                  )
                }
                1 -> PlaceholderScreen("Berichte", "Wochen- und Monatsnachweis kommen im nächsten Schritt.")
                else -> SettingsScreen()
            }
        }
    }

    confirmEndSite?.let { site ->
        AlertDialog(
            onDismissRequest = { confirmEndSite = null },
            title = { Text("Arbeit auf ${site.name} beenden?") },
            text = { Text("Zum Beispiel für die Fahrt zur nächsten Baustelle. Du kannst danach eine andere Baustelle antippen.") },
            confirmButton = {
                TextButton(onClick = {
                    day?.let { db.endOpenSegment(it.id, System.currentTimeMillis()) }
                    confirmEndSite = null
                    SyncWorker.enqueue(ctx)
                }) { Text("Ja, beenden", color = Rot, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirmEndSite = null }) { Text("Abbrechen") } },
        )
    }

    confirmStart?.let { site ->
        AlertDialog(
            onDismissRequest = { confirmStart = null },
            title = { Text("${site.name} starten?") },
            text = { Text(if (day == null) "Der Tag beginnt mit dieser Auswahl." else "Die Arbeit wechselt jetzt zu ${site.name}.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmStart = null
                    if (day == null) startDay(site.id)
                    else {
                        // Stehst du schon eine Weile in der Nähe (offener Halt), zählt die Arbeit ab dem Beginn des Halts.
                        val st = stops.filter { it.endedAt == null && site.lat != null && site.lng != null && distanceMeters(it.lat, it.lng, site.lat, site.lng) < NEAR_SITE_M }
                            .minByOrNull { it.startedAt }
                        // Steht man von Hand gewählt an einem Ort, der bekannt ist, aber von einer anderen Seite: diesen Punkt merken.
                        db.lastPoint()?.let { p -> if (System.currentTimeMillis() - p.ts < 3 * 60_000L && p.acc <= 50f) learnPoint(ctx, site, p.lat, p.lng) }
                        val open = db.openSegment(day.id)
                        if (st != null && (open == null || open.startedAt <= st.startedAt)) {
                            db.endOpenSegment(day.id, st.startedAt)
                            db.answerStop(st, "work", site.id)
                        } else {
                            db.switchSite(day.id, site.id, System.currentTimeMillis())
                        }
                        SyncWorker.enqueue(ctx)
                    }
                }) { Text("Ja, starten", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirmStart = null }) { Text("Abbrechen") } },
        )
    }

    positionSite?.let { s ->
        SetPositionDialog(s, onDismiss = { positionSite = null }, onDone = { positionSite = null })
    }

    if (showSaveHaendler) {
        SavePlaceDialog(
            position = db.lastPoint()?.let { Triple(it.lat, it.lng, it.acc) },
            positionAgeMin = db.lastPoint()?.let { (System.currentTimeMillis() - it.ts) / 60_000 } ?: Long.MAX_VALUE,
            title = "Ort hier speichern",
            isAdmin = Prefs.isAdmin(ctx),
            onDismiss = { showSaveHaendler = false },
            onSaved = { showSaveHaendler = false },
        )
    }

    nameStop?.let { st ->
        SavePlaceDialog(
            position = Triple(st.lat, st.lng, 0f),
            positionAgeMin = 0,
            title = "Ort benennen",
            isAdmin = Prefs.isAdmin(ctx),
            onDismiss = { nameStop = null },
            onSaved = { site ->
                db.answerStop(st, "work", site.id)
                nameStop = null
                changeStop = null
                SyncWorker.enqueue(ctx)
            },
        )
    }

    confirmPause?.let { st ->
        AlertDialog(
            onDismissRequest = { confirmPause = null },
            title = { Text("Als Pause eintragen?") },
            text = { Text("Die Zeit seit ${timeFmt.format(Instant.ofEpochMilli(st.startedAt))} Uhr zählt als Pause, bis du weiterfährst. Du kannst es später ändern.") },
            confirmButton = {
                TextButton(onClick = {
                    db.answerStop(st, "break", null)
                    confirmPause = null
                    changeStop = null
                    SyncWorker.enqueue(ctx)
                }) { Text("Ja, Pause", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirmPause = null }) { Text("Abbrechen") } },
        )
    }

    changeStop?.let { st ->
        AlertDialog(
            onDismissRequest = { changeStop = null },
            title = { Text("Halt ändern") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Du standest ab ${timeFmt.format(Instant.ofEpochMilli(st.startedAt))} Uhr an einem unbekannten Ort. Was war das?")
                    for (site in nearSites(sites, st)) {
                        Button(onClick = { answerAtSite(st, site) }, modifier = Modifier.fillMaxWidth().height(52.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32), contentColor = Color.White)) { Text("Ich war bei ${site.name}", fontWeight = FontWeight.Bold, maxLines = 2) }
                    }
                    Button(onClick = { confirmPause = st }, modifier = Modifier.fillMaxWidth().height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4B5159), contentColor = Color.White)) { Text("Pause") }
                    Button(onClick = { nameStop = st }, modifier = Modifier.fillMaxWidth().height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1B1C1E), contentColor = Color.White)) { Text("Ort benennen") }
                    OutlinedButton(onClick = {
                        db.answerStop(st, "travel", null)
                        changeStop = null
                        SyncWorker.enqueue(ctx)
                    }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Weiter wie Fahrt") }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { changeStop = null }) { Text("Abbrechen") } },
        )
    }

    menuSite?.let { s ->
        SiteMenuDialog(s, onPosition = { positionSite = s; menuSite = null }, onDismiss = { menuSite = null })
    }

    update?.let { info ->
        UpdateDialog(info, onDismiss = { update = null })
    }

    if (showNewSite) {
        NewSiteDialog(onDismiss = { showNewSite = false }, onCreated = { showNewSite = false })
    }

    sheetDayId?.let { id ->
        val d = remember(id, now / 5000) { db.dayById(id) }
        if (d != null) SheetDialog(d, now, siteMap, onDismiss = { sheetDayId = null })
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
                    sheetDayId = latestDay?.id
                }) { Text("Ja, beenden", color = Rot, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Abbrechen") } },
        )
    }
}

/** Reihenfolge der Kacheln: laufender Ort, dann die zuletzt benutzten, dann die am häufigsten benutzten, dann der Rest nach Name. */
fun orderSites(sites: List<SiteRow>, usage: Map<Long, Pair<Long, Int>>, runningId: Long?): List<SiteRow> {
    val running = sites.filter { it.id == runningId }
    val rest = sites.filter { it.id != runningId }
    val recent = rest.filter { usage[it.id] != null }.sortedByDescending { usage[it.id]!!.first }.take(3)
    val remaining = rest.filter { it !in recent }
    val frequent = remaining.filter { usage[it.id] != null }.sortedByDescending { usage[it.id]!!.second }
    val others = remaining.filter { usage[it.id] == null }.sortedWith(compareBy({ it.system != null }, { it.name.lowercase() }))
    return running + recent + frequent + others
}

@Composable
fun TodayScreen(
    running: Boolean,
    onToggle: () -> Unit,
    permissionHint: Boolean,
    pending: Int,
    now: Long,
    dayInfo: String?,
    sites: List<SiteRow>,
    usage: Map<Long, Pair<Long, Int>>,
    runningSegment: SegmentRow?,
    onSiteTap: (SiteRow) -> Unit,
    isAdmin: Boolean,
    onNewSite: () -> Unit,
    onSaveHaendler: () -> Unit,
    onSiteLongPress: (SiteRow) -> Unit,
    timeline: List<TimelineBlock>,
    stops: List<StopRow>,
    doneStops: List<Pair<StopRow, String>>,
    onStopPause: (StopRow) -> Unit,
    onStopName: (StopRow) -> Unit,
    onStopContinue: (StopRow) -> Unit,
    onStopAtSite: (StopRow, SiteRow) -> Unit,
    onStopChange: (StopRow) -> Unit,
) {
    val ctx = LocalContext.current
    val lastSync = Prefs.lastSync(ctx)
    var query by remember { mutableStateOf("") }
    val runningId = runningSegment?.siteId
    val ordered = remember(sites, usage, runningId) { orderSites(sites, usage, runningId) }
    val q = query.trim().lowercase()
    val shown = if (q.isEmpty()) ordered else ordered.filter { it.name.lowercase().contains(q) || (it.customerName ?: "").lowercase().contains(q) }
    // Baustellen stehen vorn (und der Ort, der gerade läuft). Lager, Firma und Händler sind eingeklappt, falls man sie einmal von Hand braucht.
    val baustellen = shown.filter { (it.system == null && it.kind != "haendler") || it.id == runningId }
    val others = shown.filter { it !in baustellen }
    var showOthers by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    // Das Suchfeld soll nicht hängen bleiben: Tipp irgendwo anders oder „Fertig“ auf der Tastatur nimmt den Cursor weg.
    LaunchedEffect(Unit) { focusManager.clearFocus() }
    Column(
        Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures(onTap = { focusManager.clearFocus() }) }.verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Button(
            onClick = onToggle,
            colors = ButtonDefaults.buttonColors(containerColor = if (running) Rot else Gruen, contentColor = Color.White),
            modifier = Modifier.fillMaxWidth().height(110.dp),
        ) { Text(if (running) "Tag beenden" else "Tag starten", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold) }

        var noteDialog by remember { mutableStateOf<Pair<LocalDate, Long?>?>(null) }
        var notesVersion by remember { mutableIntStateOf(0) }
        var photoMsg by remember { mutableStateOf(false) }
        val takePhoto = rememberPhotoTaker(runningId) { photoMsg = true }
        PhotoNoteButtons(onPhoto = takePhoto, onNote = { noteDialog = LocalDate.now() to runningId })
        if (photoMsg) Text("Foto gespeichert. Es wird hochgeladen, sobald Internet da ist.", color = Gruen, fontSize = 14.sp)
        run {
            val z = ZoneId.systemDefault()
            val d0 = LocalDate.now().atStartOfDay(z).toInstant().toEpochMilli()
            val today = Db.get(ctx).daysOnDate(d0, d0 + 86_400_000L).lastOrNull()
            if (today != null) SheetButton(today, now, sites.associateBy { it.id })
        }
        WeekSubmitButton(now, sites.associateBy { it.id })
        NotesList(LocalDate.now(), sites.associateBy { it.id }, notesVersion) { n -> noteDialog = LocalDate.now() to n.siteId }
        noteDialog?.let { (d, sid) ->
            NoteDialog(d, sid, sites.associateBy { it.id }, onDismiss = { noteDialog = null; notesVersion++ })
        }

        if (permissionHint) {
            Text(
                "Ohne Standortfreigabe kann Spur den Weg nicht aufzeichnen. Bitte unter Einstellungen den Standort erlauben.",
                color = Rot,
            )
        }
        Text(
            listOfNotNull(
                dayInfo,
                when {
                    pending == 0 && lastSync > 0 -> "Alles abgeglichen (${timeFmt.format(Instant.ofEpochMilli(lastSync))} Uhr)"
                    pending == 0 -> "Noch nichts aufgezeichnet"
                    else -> "$pending Punkte warten auf den Abgleich (Internet nötig)"
                },
            ).joinToString(" · "),
            color = Color(0xFF6A6F75),
            fontSize = 14.sp,
        )

        for (stop in stops) {
            val nearby = nearSites(sites, stop)
            StopCard(stop, nearby, onStopPause, onStopName, onStopContinue, onStopAtSite)
        }

        if (timeline.isNotEmpty()) {
            Text("Mein Tag", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            DayTimeline(timeline)
        }

        if (doneStops.isNotEmpty()) {
            Text("Halte heute", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
            for ((st, answer) in doneStops) {
                val from = timeFmt.format(Instant.ofEpochMilli(st.startedAt))
                val to = st.endedAt?.let { timeFmt.format(Instant.ofEpochMilli(it)) } ?: "läuft"
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White).padding(start = 14.dp, top = 4.dp, bottom = 4.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(answer, fontWeight = FontWeight.Bold)
                        Text("$from bis $to Uhr", color = Color(0xFF6A6F75), fontSize = 13.sp)
                    }
                    TextButton(onClick = { onStopChange(st) }) { Text("Ändern", fontWeight = FontWeight.Bold) }
                }
            }
        }

        Text("Baustellen", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
        if (sites.size > 8) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Suchen") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                trailingIcon = if (query.isNotEmpty()) ({ TextButton(onClick = { query = ""; focusManager.clearFocus() }) { Text("X", fontWeight = FontWeight.Bold) } }) else null,
            )
        }
        if (sites.isEmpty()) {
            Text(
                "Noch keine Baustellen. Lege sie am Desktop unter „Kunden und Projekte“ an. Sie erscheinen hier nach dem nächsten Abgleich.",
                color = Color(0xFF6A6F75),
            )
        }
        if (q.isNotEmpty() && shown.isEmpty()) Text("Nichts gefunden.", color = Color(0xFF6A6F75))
        for (site in baustellen) {
            SiteTile(site, runningSegment?.takeIf { it.siteId == site.id }, now, onLongClick = if (isAdmin) ({ onSiteLongPress(site) }) else null) { onSiteTap(site) }
        }
        if (others.isNotEmpty()) {
            val open = showOthers || q.isNotEmpty()
            OutlinedButton(onClick = { showOthers = !showOthers }, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Text(if (open) "Lager, Firma und Händler ausblenden ▲" else "Lager, Firma und Händler anzeigen (${others.size}) ▼")
            }
            if (open) {
                for (site in others) {
                    SiteTile(site, runningSegment?.takeIf { it.siteId == site.id }, now, onLongClick = if (isAdmin) ({ onSiteLongPress(site) }) else null) { onSiteTap(site) }
                }
            }
        }
        if (isAdmin) {
            Text("Tipp: Kachel lange drücken = Position der Baustelle auf deinen jetzigen Standort setzen.", color = Color(0xFF6A6F75), fontSize = 13.sp)
            OutlinedButton(onClick = onNewSite, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text("Neue Baustelle hier anlegen")
            }
        }
        OutlinedButton(onClick = onSaveHaendler, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text("Ort hier speichern (zum Beispiel Händler)")
        }
        Spacer(Modifier.height(8.dp))
    }
}

/** Ein früherer Tag: nur Zeitbalken und Summe. */
@Composable
fun PastDayScreen(date: LocalDate, now: Long, db: Db, siteMap: Map<Long, SiteRow>) {
    val zone = ZoneId.systemDefault()
    val from = date.atStartOfDay(zone).toInstant().toEpochMilli()
    val to = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    val days = remember(date, now / 10_000) { db.daysOnDate(from, to) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        var noteDialog by remember { mutableStateOf<Pair<LocalDate, Long?>?>(null) }
        var notesVersion by remember { mutableIntStateOf(0) }
        val ctx = LocalContext.current
        val locked = isDayLocked(db, date)
        if (!locked) PhotoNoteButtons(onPhoto = null, onNote = { noteDialog = date to null })
        NotesList(date, siteMap, notesVersion) { n -> if (!locked) noteDialog = date to n.siteId }
        noteDialog?.let { (d, sid) -> NoteDialog(d, sid, siteMap, onDismiss = { noteDialog = null; notesVersion++ }) }
        if (days.isEmpty()) {
            Text("An diesem Tag wurde nichts aufgezeichnet.", color = Color(0xFF6A6F75))
        }
        for (d in days) {
            val end = d.endedAt ?: now
            Text(
                "${timeFmt.format(Instant.ofEpochMilli(d.startedAt))} bis ${d.endedAt?.let { timeFmt.format(Instant.ofEpochMilli(it)) } ?: "nicht beendet"} · ${formatDuration(end - d.startedAt)} h",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
            )
            val blocks = buildTimeline(d.startedAt, d.endedAt, now, db.segmentsOfDay(d.id), siteMap)
            if (blocks.isEmpty()) Text("Keine Baustelle gebucht.", color = Color(0xFF6A6F75)) else DayTimeline(blocks)
            SheetButton(d, now, siteMap)
        }
        Text("Wische nach links oder tippe auf „Heute“, um zum heutigen Tag zurückzukehren.", color = Color(0xFF6A6F75), fontSize = 13.sp)
        Spacer(Modifier.height(8.dp))
    }
}

/** Menü beim langen Drücken auf eine Kachel (nur Chef): Position setzen oder Art ändern. */
@Composable
fun SiteMenuDialog(site: SiteRow, onPosition: () -> Unit, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val toHaendler = site.kind != "haendler"
    var editing by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf(site.name) }
    var makeCustomer by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(site.name) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onPosition, modifier = Modifier.fillMaxWidth().height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1B1C1E), contentColor = Color.White)) {
                    Text("Position auf meinen Standort setzen")
                }
                if (site.system == null) {
                    OutlinedButton(
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        onClick = {
                            busy = true
                            error = ""
                            scope.launch {
                                try {
                                    val o = withContext(Dispatchers.IO) {
                                        Api.post(ctx, "/api/sites/${site.id}/kind", JSONObject().put("kind", if (toHaendler) "haendler" else "baustelle"), Prefs.token(ctx) ?: "")
                                    }
                                    withContext(Dispatchers.IO) { Db.get(ctx).upsertSite(site.copy(kind = o.optString("kind", site.kind), color = o.optString("color", site.color))) }
                                    SyncWorker.enqueue(ctx)
                                    onDismiss()
                                } catch (e: Api.ApiException) {
                                    error = e.message ?: "Fehler"
                                } catch (e: Exception) {
                                    error = "Keine Verbindung zum Server"
                                }
                                busy = false
                            }
                        },
                    ) { Text(if (toHaendler) "Art ändern: zum Händler" else "Art ändern: zur Baustelle") }
                }
                if (site.system == null) {
                    OutlinedButton(onClick = { editing = !editing }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Name ändern / Kunde anlegen") }
                    if (editing) {
                        OutlinedTextField(value = newName, onValueChange = { newName = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        if (site.customerName == null && site.kind != "haendler") {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = makeCustomer, onCheckedChange = { makeCustomer = it })
                                Text("Kunde mit diesem Namen anlegen")
                            }
                        }
                        Button(
                            enabled = !busy && newName.isNotBlank(),
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            onClick = {
                                busy = true
                                error = ""
                                scope.launch {
                                    try {
                                        val body = JSONObject().put("name", newName.trim()).put("create_customer", makeCustomer)
                                        val o = withContext(Dispatchers.IO) { Api.post(ctx, "/api/sites/${site.id}/edit", body, Prefs.token(ctx) ?: "") }
                                        withContext(Dispatchers.IO) {
                                            Db.get(ctx).upsertSite(site.copy(name = o.optString("name", site.name), customerName = if (o.isNull("customer_name")) null else o.optString("customer_name")))
                                        }
                                        SyncWorker.enqueue(ctx)
                                        onDismiss()
                                    } catch (e: Api.ApiException) {
                                        error = e.message ?: "Fehler"
                                    } catch (e: Exception) {
                                        error = "Keine Verbindung zum Server"
                                    }
                                    busy = false
                                }
                            },
                        ) { Text("Speichern", fontWeight = FontWeight.Bold) }
                    }
                }
                if (error.isNotEmpty()) Text(error, color = Rot)
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Schließen") } },
    )
}

/** Hinweis auf eine neue App-Version mit Herunterladen und Installieren. */
@Composable
fun UpdateDialog(info: UpdateInfo, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var progress by remember { mutableStateOf(-1) }
    var message by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (progress < 0) onDismiss() },
        title = { Text("Neue Version ${info.versionName}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Eine neuere Spur-App ist auf dem Server (${info.sizeBytes / 1_000_000} MB). Beim Installieren fragt Android noch einmal nach.")
                if (progress >= 0) Text("Lädt herunter … $progress %")
                if (message.isNotEmpty()) Text(message, color = Rot)
            }
        },
        confirmButton = {
            TextButton(enabled = progress < 0, onClick = {
                message = ""
                progress = 0
                scope.launch {
                    val err = downloadAndInstall(ctx) { progress = it }
                    if (err != null) message = err
                    progress = -1
                }
            }) { Text("Jetzt installieren", fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(enabled = progress < 0, onClick = onDismiss) { Text("Später") } },
    )
}

/** Lädt die neue App und öffnet die Installation. Gibt eine Fehlermeldung zurück oder null. */
suspend fun downloadAndInstall(ctx: android.content.Context, onProgress: (Int) -> Unit): String? {
    if (!Updater.canInstall(ctx)) {
        Updater.openInstallPermissionSettings(ctx)
        return "Bitte erlaube Spur im Handy, Apps zu installieren (Schalter in den Einstellungen) und drücke danach noch einmal."
    }
    return try {
        val file = withContext(Dispatchers.IO) { Updater.download(ctx, onProgress) }
        Updater.install(ctx, file)
        null
    } catch (e: Exception) {
        e.message ?: "Herunterladen fehlgeschlagen"
    }
}

/** Nachfrage nach einem Halt an einem unbekannten Ort. */
@Composable
fun StopCard(stop: StopRow, nearby: List<SiteRow>, onPause: (StopRow) -> Unit, onName: (StopRow) -> Unit, onContinue: (StopRow) -> Unit, onAtSite: (StopRow, SiteRow) -> Unit) {
    val since = timeFmt.format(Instant.ofEpochMilli(stop.startedAt))
    val until = stop.endedAt?.let { timeFmt.format(Instant.ofEpochMilli(it)) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFFFFF3C4)).border(2.dp, Color(0xFFF5C400), RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Wo warst du?", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text(
            if (until == null) "Du stehst seit $since Uhr an einem unbekannten Ort." else "Du standest von $since bis $until Uhr an einem unbekannten Ort.",
            fontSize = 14.sp,
        )
        for (site in nearby) {
            Button(onClick = { onAtSite(stop, site) }, modifier = Modifier.fillMaxWidth().height(52.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32), contentColor = Color.White)) { Text("Ja, ich bin bei ${site.name}", fontWeight = FontWeight.Bold, maxLines = 2) }
        }
        Button(onClick = { onPause(stop) }, modifier = Modifier.fillMaxWidth().height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4B5159), contentColor = Color.White)) { Text("Pause") }
        Button(onClick = { onName(stop) }, modifier = Modifier.fillMaxWidth().height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1B1C1E), contentColor = Color.White)) { Text("Ort benennen (zum Beispiel Brillux)") }
        OutlinedButton(onClick = { onContinue(stop) }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Weiter wie Fahrt") }
    }
}

/** Lange Kachel in der Farbe der Baustelle. Die laufende Baustelle hat einen dicken dunklen Rand. */
@Composable
@OptIn(ExperimentalFoundationApi::class)
fun SiteTile(site: SiteRow, running: SegmentRow?, now: Long, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    val bg = Color(android.graphics.Color.parseColor(site.color))
    val fg = if (bg.luminance() > 0.5f) Color(0xFF1B1C1E) else Color.White
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 76.dp)
            .clip(shape)
            .background(bg)
            .then(if (running != null) Modifier.border(5.dp, Color(0xFF1B1C1E), shape) else Modifier)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Column {
            Text(site.name, color = fg, fontSize = 21.sp, fontWeight = FontWeight.Bold)
            if (!site.customerName.isNullOrBlank()) Text(site.customerName, color = fg.copy(alpha = 0.85f), fontSize = 14.sp)
            if (running != null) {
                Text(
                    "● läuft seit ${timeFmt.format(Instant.ofEpochMilli(running.startedAt))} · ${formatDuration(now - running.startedAt)} h",
                    color = fg,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
fun SetPositionDialog(site: SiteRow, onDismiss: () -> Unit, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val point = remember { Db.get(ctx).lastPoint() }
    val ageMin = if (point == null) Long.MAX_VALUE else (System.currentTimeMillis() - point.ts) / 60_000
    val fresh = ageMin < 10
    val accurate = point != null && point.acc <= 50f
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Position von ${site.name} setzen?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Die Position dieses Ortes wird auf deinen jetzigen Standort gesetzt. Stelle dich dafür möglichst in die Mitte.")
                Text(
                    when {
                        point == null || !fresh -> "Kein aktueller Standort. Starte zuerst den Tag und warte kurz."
                        !accurate -> "Der Standort ist noch zu ungenau (${point.acc.toInt()} m). Warte kurz im Freien und versuche es noch einmal."
                        else -> "Dein Standort: vor $ageMin Min., Genauigkeit ${point.acc.toInt()} m"
                    },
                    color = if (fresh && accurate) Color(0xFF6A6F75) else Rot,
                )
                if (error.isNotEmpty()) Text(error, color = Rot)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && fresh && accurate,
                onClick = {
                    busy = true
                    error = ""
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                Api.post(
                                    ctx,
                                    "/api/sites/${site.id}/position",
                                    JSONObject().put("lat", point!!.lat).put("lng", point.lng),
                                    Prefs.token(ctx) ?: "",
                                )
                            }
                            SyncWorker.enqueue(ctx)
                            onDone()
                        } catch (e: Api.ApiException) {
                            error = e.message ?: "Fehler"
                        } catch (e: Exception) {
                            error = "Keine Verbindung zum Server"
                        }
                        busy = false
                    }
                },
            ) { Text("Position setzen", fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/** Legt einen Ort an der aktuellen Position an. Händler darf jeder anlegen, Baustellen nur der Chef. */
@Composable
fun SavePlaceDialog(
    position: Triple<Double, Double, Float>?,
    positionAgeMin: Long,
    title: String,
    isAdmin: Boolean,
    onDismiss: () -> Unit,
    onSaved: (SiteRow) -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("haendler") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val fresh = position != null && positionAgeMin < 10
    val accurate = position != null && (position.third == 0f || position.third <= 50f)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (isAdmin) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (kind == "haendler") Button(onClick = {}, modifier = Modifier.weight(1f)) { Text("Händler") } else OutlinedButton(onClick = { kind = "haendler" }, modifier = Modifier.weight(1f)) { Text("Händler") }
                        if (kind == "baustelle") Button(onClick = {}, modifier = Modifier.weight(1f)) { Text("Baustelle") } else OutlinedButton(onClick = { kind = "baustelle" }, modifier = Modifier.weight(1f)) { Text("Baustelle") }
                    }
                }
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(if (kind == "haendler") "Name, zum Beispiel Brillux" else "Name, zum Beispiel Lilienstraße 77") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = false),
                )
                Text(
                    when {
                        position == null || !fresh -> "Kein aktueller Standort. Starte zuerst den Tag und warte kurz."
                        !accurate -> "Der Standort ist noch zu ungenau (${position.third.toInt()} m). Warte kurz im Freien und versuche es noch einmal."
                        else -> "Position: %.5f, %.5f".format(Locale.GERMANY, position.first, position.second)
                    },
                    color = if (fresh && accurate) Color(0xFF6A6F75) else Rot,
                )
                if (position != null) {
                    TextButton(onClick = {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps?q=${position.first},${position.second}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }) { Text("In Google Maps prüfen") }
                }
                Text(
                    if (kind == "haendler") "Danach erkennt die App diesen Ort selbst und fragt dort nicht mehr." else "Adresse, Kunde und Farbe ergänzt du später am Desktop.",
                    color = Color(0xFF6A6F75),
                    fontSize = 13.sp,
                )
                if (error.isNotEmpty()) Text(error, color = Rot)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && fresh && accurate && name.isNotBlank(),
                onClick = {
                    busy = true
                    error = ""
                    scope.launch {
                        try {
                            // Gibt es den Ort schon mit diesem Namen, wird er benutzt und nichts doppelt angelegt.
                            val same = withContext(Dispatchers.IO) {
                                Db.get(ctx).sites().firstOrNull { it.system == null && it.name.trim().equals(name.trim(), ignoreCase = true) }
                            }
                            if (same != null) {
                                busy = false
                                onSaved(same)
                                return@launch
                            }
                            val o = withContext(Dispatchers.IO) {
                                Api.post(
                                    ctx,
                                    "/api/sites",
                                    JSONObject().put("name", name.trim()).put("kind", kind).put("lat", position!!.first).put("lng", position.second),
                                    Prefs.token(ctx) ?: "",
                                )
                            }
                            val site = SiteRow(
                                id = o.getLong("id"), name = o.getString("name"), customerName = null, color = o.getString("color"),
                                lat = o.optDouble("lat"), lng = o.optDouble("lng"), radius = o.optDouble("radius_m", 100.0), system = null, kind = kind,
                            )
                            withContext(Dispatchers.IO) { Db.get(ctx).upsertSite(site) }
                            SyncWorker.enqueue(ctx)
                            onSaved(site)
                        } catch (e: Api.ApiException) {
                            error = e.message ?: "Fehler"
                        } catch (e: Exception) {
                            error = "Keine Verbindung zum Server. Bitte später noch einmal versuchen."
                        }
                        busy = false
                    }
                },
            ) { Text("Speichern", fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
fun NewSiteDialog(onDismiss: () -> Unit, onCreated: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val point = remember { Db.get(ctx).lastPoint() }
    val ageMin = if (point == null) Long.MAX_VALUE else (System.currentTimeMillis() - point.ts) / 60_000
    val fresh = ageMin < 10
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Neue Baustelle hier") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name, zum Beispiel Lilienstraße 77") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = false),
                )
                Text(
                    if (fresh) "Position: dein aktueller Standort (vor $ageMin Min.)" else "Kein aktueller Standort. Starte zuerst den Tag und warte kurz.",
                    color = if (fresh) Color(0xFF6A6F75) else Rot,
                )
                Text("Adresse, Kunde und Farbe ergänzt du später am Desktop.", color = Color(0xFF6A6F75), fontSize = 13.sp)
                if (error.isNotEmpty()) Text(error, color = Rot)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && fresh && name.isNotBlank(),
                onClick = {
                    busy = true
                    error = ""
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                Api.post(
                                    ctx,
                                    "/api/sites",
                                    JSONObject().put("name", name.trim()).put("lat", point!!.lat).put("lng", point.lng),
                                    Prefs.token(ctx) ?: "",
                                )
                            }
                            SyncWorker.enqueue(ctx)
                            onCreated()
                        } catch (e: Api.ApiException) {
                            error = e.message ?: "Fehler"
                        } catch (e: Exception) {
                            error = "Keine Verbindung zum Server"
                        }
                        busy = false
                    }
                },
            ) { Text("Anlegen", fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
fun PlaceholderScreen(title: String, text: String) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text(text, color = Color(0xFF6A6F75))
    }
}

@Composable
fun UpdateSection() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("") }
    var info by remember { mutableStateOf<UpdateInfo?>(null) }
    var progress by remember { mutableStateOf(-1) }
    var busy by remember { mutableStateOf(false) }
    OutlinedButton(
        enabled = !busy && progress < 0,
        modifier = Modifier.fillMaxWidth().height(52.dp),
        onClick = {
            busy = true
            status = "Sucht …"
            info = null
            scope.launch {
                try {
                    val found = withContext(Dispatchers.IO) { Updater.check(ctx) }
                    info = found
                    status = if (found == null) "Die App ist aktuell." else "Neue Version ${found.versionName} gefunden (${found.sizeBytes / 1_000_000} MB)."
                } catch (e: Exception) {
                    status = "Keine Verbindung zum Server oder keine Datei hinterlegt."
                }
                busy = false
            }
        },
    ) { Text("Nach Update suchen") }
    if (status.isNotEmpty()) Text(status, color = Color(0xFF6A6F75))
    info?.let {
        Button(
            enabled = progress < 0,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            onClick = {
                progress = 0
                scope.launch {
                    val err = downloadAndInstall(ctx) { progress = it }
                    if (err != null) status = err
                    progress = -1
                }
            },
        ) { Text(if (progress >= 0) "Lädt herunter … $progress %" else "Jetzt installieren") }
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
        Text("Version ${runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrDefault("?")}", fontWeight = FontWeight.Bold)
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


        Text("Erinnerung Tagesbeginn", fontWeight = FontWeight.Bold)
        ReminderSection()

        Text("App-Update", fontWeight = FontWeight.Bold)
        UpdateSection()

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

/** Einstellungen der Erinnerung zum Tagesbeginn: Wochentage, zwei Uhrzeiten, Ton und Vibration. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ReminderSection() {
    val ctx = LocalContext.current
    var cfg by remember { mutableStateOf(Prefs.reminder(ctx)) }
    fun change(next: ReminderConfig) {
        cfg = next
        Prefs.setReminder(ctx, next)
        Reminder.schedule(ctx)
    }
    fun pickTime(current: LocalTime, onPicked: (LocalTime) -> Unit) {
        android.app.TimePickerDialog(ctx, { _, h, m -> onPicked(LocalTime.of(h, m)) }, current.hour, current.minute, true).show()
    }
    fun two(n: Int) = n.toString().padStart(2, '0')

    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Vor Arbeitsbeginn erinnern, wenn der Tag noch nicht läuft", Modifier.weight(1f))
        Switch(checked = cfg.enabled, onCheckedChange = { change(cfg.copy(enabled = it)) })
    }
    if (cfg.enabled) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DayOfWeek.values().forEach { d ->
                FilterChip(
                    selected = d in cfg.days,
                    onClick = { change(cfg.copy(days = if (d in cfg.days) cfg.days - d else cfg.days + d)) },
                    label = { Text(d.getDisplayName(DayStyle.SHORT, java.util.Locale.GERMANY)) },
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                onClick = { pickTime(cfg.first) { change(cfg.copy(first = it)) } },
                modifier = Modifier.weight(1f).height(52.dp),
            ) { Text("Erste: ${two(cfg.first.hour)}:${two(cfg.first.minute)}") }
            OutlinedButton(
                onClick = { pickTime(cfg.second) { change(cfg.copy(second = it)) } },
                modifier = Modifier.weight(1f).height(52.dp),
            ) { Text("Zweite: ${two(cfg.second.hour)}:${two(cfg.second.minute)}") }
        }
        Text(
            "Nach der zweiten Erinnerung kommt alle ${ReminderPlan.REPEAT_MIN} Minuten eine neue, höchstens ${ReminderPlan.MAX_REPEAT_MIN / 60} Stunden lang, bis der Tag läuft.",
            color = Color(0xFF6A6F75), fontSize = 13.sp,
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Ton")
            Switch(checked = cfg.sound, onCheckedChange = { change(cfg.copy(sound = it)) })
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Vibration")
            Switch(checked = cfg.vibrate, onCheckedChange = { change(cfg.copy(vibrate = it)) })
        }
        if (!Reminder.canScheduleExact(ctx)) {
            Text("Damit die Erinnerung pünktlich kommt, muss Spur „Alarme und Erinnerungen“ nutzen dürfen.", color = Color(0xFF9A6B00), fontSize = 13.sp)
            OutlinedButton(
                onClick = {
                    if (Build.VERSION.SDK_INT >= 31) {
                        ctx.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}")))
                    }
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("„Alarme und Erinnerungen“ erlauben") }
        }
        OutlinedButton(onClick = { Reminder.show(ctx) }, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text("Erinnerung jetzt zum Test anzeigen")
        }
        Text("Bei „Nicht stören“ oder lautlosem Handy kommt kein Ton, nur Vibration.", color = Color(0xFF6A6F75), fontSize = 13.sp)
    }
}

/** Ein Halt, der so nah an einer bekannten Baustelle liegt, wird dort vorgeschlagen. */
const val NEAR_SITE_M = 600.0

/** Bis zu drei bekannte Orte (keine Lager/Firma) nahe am Halt, der nächste zuerst. */
fun nearSites(sites: List<SiteRow>, stop: StopRow): List<SiteRow> =
    sites.filter { it.system == null && it.lat != null && it.lng != null }
        .map { it to distanceMeters(stop.lat, stop.lng, it.lat!!, it.lng!!) }
        .filter { it.second < NEAR_SITE_M }
        .sortedBy { it.second }
        .take(3)
        .map { it.first }

/**
 * Merkt sich einen weiteren Punkt eines Ortes (zum Beispiel den Parkplatz auf der anderen Seite des Baumarkts),
 * damit er beim nächsten Mal von dort aus auch erkannt wird. Nur wenn der Punkt zwischen 60 und 500 m vom Ort liegt.
 */
fun learnPoint(ctx: Context, site: SiteRow, lat: Double, lng: Double) {
    if (site.system != null) return
    val d = site.distanceTo(lat, lng) ?: return
    if (d < 60.0 || d > 500.0) return
    Thread {
        runCatching {
            val o = Api.post(ctx, "/api/sites/${site.id}/points", JSONObject().put("lat", lat).put("lng", lng), Prefs.token(ctx) ?: "")
            Db.get(ctx).setSiteExtra(site.id, extraString(o))
        }
    }.start()
}
