package de.ostash.spur

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Einstellungen der Erinnerung zum Tagesbeginn. */
data class ReminderConfig(
    val enabled: Boolean = true,
    val days: Set<DayOfWeek> = setOf(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY),
    val first: LocalTime = LocalTime.of(6, 55),
    val second: LocalTime = LocalTime.of(7, 0),
    val sound: Boolean = true,
    val vibrate: Boolean = true,
    /** An gesetzlichen Feiertagen (Bayern) nicht erinnern. */
    val skipHolidays: Boolean = true,
)

/** Reine Rechenlogik (ohne Android), damit sie sich testen lässt. */
object ReminderPlan {
    /** Nach der zweiten Erinnerung wird alle 5 Minuten wiederholt. */
    const val REPEAT_MIN = 5L

    /** Höchstens so lange nach der zweiten Erinnerung wird wiederholt (Schutz vor endlosem Klingeln). */
    const val MAX_REPEAT_MIN = 180L

    /** Alle Zeitpunkte eines Tages: erste, zweite, danach alle 5 Minuten. */
    fun slots(date: LocalDate, cfg: ReminderConfig, zone: ZoneId): List<ZonedDateTime> {
        val a = minOf(cfg.first, cfg.second)
        val b = maxOf(cfg.first, cfg.second)
        val base = date.atTime(b).atZone(zone)
        val out = mutableListOf(date.atTime(a).atZone(zone))
        var t = 0L
        while (t <= MAX_REPEAT_MIN) {
            out.add(base.plusMinutes(t))
            t += REPEAT_MIN
        }
        return out.distinct().sorted()
    }

    /** Der nächste Zeitpunkt streng nach [after]. [freeDate] ist ein Tag, an dem heute frei ist. */
    fun next(after: ZonedDateTime, cfg: ReminderConfig, freeDate: LocalDate?): ZonedDateTime? {
        if (!cfg.enabled || cfg.days.isEmpty()) return null
        var date = after.toLocalDate()
        repeat(9) {
            if (date.dayOfWeek in cfg.days && date != freeDate && !(cfg.skipHolidays && Holidays.isHoliday(date))) {
                slots(date, cfg, after.zone).firstOrNull { it.isAfter(after) }?.let { return it }
            }
            date = date.plusDays(1)
        }
        return null
    }
}

/** Plant den Wecker und zeigt die Benachrichtigung. */
object Reminder {
    const val ACTION_FIRE = "de.ostash.spur.REMINDER_FIRE"
    const val ACTION_START_DAY = "de.ostash.spur.REMINDER_START_DAY"
    const val ACTION_FREE_TODAY = "de.ostash.spur.REMINDER_FREE_TODAY"
    const val ACTION_SNOOZE = "de.ostash.spur.REMINDER_SNOOZE"
    const val SNOOZE_MIN = 10L
    private const val NOTIFICATION_ID = 3
    private const val ALARM_CODE = 100

    private fun zone() = ZoneId.systemDefault()

    fun canScheduleExact(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    private fun alarmIntent(ctx: Context) = PendingIntent.getBroadcast(
        ctx, ALARM_CODE, Intent(ctx, ReminderReceiver::class.java).setAction(ACTION_FIRE),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Berechnet den nächsten Zeitpunkt neu und stellt den Wecker. Ohne Anmeldung oder ausgeschaltet wird er gelöscht. */
    fun schedule(ctx: Context, now: ZonedDateTime = ZonedDateTime.now(zone())) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = alarmIntent(ctx)
        val cfg = Prefs.reminder(ctx)
        val snooze = Prefs.reminderSnoozeUntil(ctx)
        val next = when {
            Prefs.token(ctx) == null -> null
            snooze > now.toInstant().toEpochMilli() -> Instant.ofEpochMilli(snooze).atZone(zone())
            else -> ReminderPlan.next(now, cfg, Prefs.reminderFreeDate(ctx))
        }
        if (next == null) {
            am.cancel(pi)
            return
        }
        val at = next.toInstant().toEpochMilli()
        if (canScheduleExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    private fun channelFor(ctx: Context, cfg: ReminderConfig): String {
        // Ton und Vibration lassen sich bei einem bestehenden Kanal nicht mehr ändern, deshalb ein Kanal je Wahl.
        val id = "reminder_loud_${if (cfg.sound) "s" else "x"}${if (cfg.vibrate) "v" else "x"}"
        return LoudChannel.ensure(ctx, id, "Erinnerung Tagesbeginn (laut)", cfg.sound, cfg.vibrate)
    }

    private fun action(ctx: Context, code: Int, action: String) = PendingIntent.getBroadcast(
        ctx, code, Intent(ctx, ReminderReceiver::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun show(ctx: Context) {
        val cfg = Prefs.reminder(ctx)
        val open = PendingIntent.getActivity(
            ctx, 2, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, channelFor(ctx, cfg))
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle("Spur: Tag starten?")
            .setContentText("Dein Arbeitstag läuft noch nicht.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(open)
            .setAutoCancel(false)
            .addAction(0, "Tag starten", action(ctx, 11, ACTION_START_DAY))
            .addAction(0, "Heute frei", action(ctx, 12, ACTION_FREE_TODAY))
            .addAction(0, "In $SNOOZE_MIN Min. erinnern", action(ctx, 13, ACTION_SNOOZE))
            .build()
        runCatching { ctx.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, n) }
    }

    fun cancelNotification(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }

    /** Wird aufgerufen, sobald der Tag läuft: Meldung weg, Wecker für den nächsten Tag. */
    fun dayStarted(ctx: Context) {
        cancelNotification(ctx)
        Prefs.setReminderSnoozeUntil(ctx, 0L)
        // Heute nicht mehr erinnern, auch wenn der Tag später endet.
        Prefs.setReminderFreeDate(ctx, LocalDate.now(zone()))
        schedule(ctx)
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Reminder.ACTION_FIRE -> {
                val running = runCatching { Db.get(ctx).openDay() != null }.getOrDefault(false)
                val holiday = Prefs.reminder(ctx).skipHolidays && Holidays.isHoliday(LocalDate.now())
                if (Prefs.token(ctx) != null && !running && !holiday) Reminder.show(ctx) else Reminder.cancelNotification(ctx)
                Prefs.setReminderSnoozeUntil(ctx, 0L)
                Reminder.schedule(ctx)
            }
            Reminder.ACTION_START_DAY -> {
                Reminder.cancelNotification(ctx)
                val fine = ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                val started = fine && runCatching {
                    Db.get(ctx).startDayIfNone(System.currentTimeMillis())
                    TrackingService.start(ctx)
                }.isSuccess
                if (started) {
                    Reminder.dayStarted(ctx)
                } else {
                    // Ohne Standortfreigabe oder wenn das System den Start aus dem Hintergrund verbietet: App öffnen.
                    ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
            Reminder.ACTION_FREE_TODAY -> {
                Reminder.cancelNotification(ctx)
                Prefs.setReminderSnoozeUntil(ctx, 0L)
                Prefs.setReminderFreeDate(ctx, LocalDate.now())
                Reminder.schedule(ctx)
            }
            Reminder.ACTION_SNOOZE -> {
                Reminder.cancelNotification(ctx)
                Prefs.setReminderSnoozeUntil(ctx, System.currentTimeMillis() + Reminder.SNOOZE_MIN * 60_000L)
                Reminder.schedule(ctx)
            }
            // Neustart des Handys, Update der App, Zeitumstellung: Wecker neu stellen.
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> {
                Reminder.schedule(ctx)
                EveningCheck.fire(ctx) // nach Neustart: war inzwischen Zeit zum Fragen oder Beenden?
            }
        }
    }
}
