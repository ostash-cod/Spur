package de.ostash.spur

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import java.time.Instant
import java.time.ZoneId

/** Was als Nächstes mit dem laufenden Tag passieren soll. */
sealed class EveningStep {
    data class EndAt(val ts: Long) : EveningStep()
    object Ask : EveningStep()
    data class WaitUntil(val ts: Long) : EveningStep()
}

/** Reine Rechenlogik (ohne Android): Abendfrage, automatisches Ende, Mitternachts-Sicherung. */
object EveningPlan {
    const val ANSWER_WAIT_MIN = 15L
    const val ASK_AGAIN_MIN = 120L
    const val DEFAULT_ASK_MINUTE = 18 * 60

    /** Spätestens um Mitternacht nach dem Tagesbeginn ist Schluss. */
    fun hardStop(dayStart: Long, zone: ZoneId): Long =
        Instant.ofEpochMilli(dayStart).atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()

    /** Wann gefragt wird: zur eingestellten Uhrzeit, frühestens 1 Stunde nach Tagesbeginn, nach einem "Ja" erst wieder in 2 Stunden. */
    fun askAt(dayStart: Long, lastYes: Long, askMinute: Int, zone: ZoneId): Long {
        val date = Instant.ofEpochMilli(dayStart).atZone(zone).toLocalDate()
        val base = date.atStartOfDay(zone).plusMinutes(askMinute.toLong()).toInstant().toEpochMilli()
        var t = maxOf(base, dayStart + 60 * 60_000L)
        if (lastYes > 0) t = maxOf(t, lastYes + ASK_AGAIN_MIN * 60_000L)
        return t
    }

    fun decide(now: Long, dayStart: Long, lastYes: Long, pending: Long, askMinute: Int, zone: ZoneId): EveningStep {
        val hard = hardStop(dayStart, zone)
        if (now >= hard) return EveningStep.EndAt(hard)
        if (pending > 0) {
            val auto = pending + ANSWER_WAIT_MIN * 60_000L
            return if (now >= auto) EveningStep.EndAt(minOf(pending, hard)) else EveningStep.WaitUntil(minOf(auto, hard))
        }
        val ask = askAt(dayStart, lastYes, askMinute, zone)
        return if (now >= ask) EveningStep.Ask else EveningStep.WaitUntil(minOf(ask, hard))
    }
}

/** Plant den Wecker für die Abendfrage und beendet den Tag, wenn keiner antwortet. */
object EveningCheck {
    const val ACTION_FIRE = "de.ostash.spur.EVENING_FIRE"
    const val ACTION_YES = "de.ostash.spur.EVENING_YES"
    const val ACTION_END = "de.ostash.spur.EVENING_END"
    const val ACTION_ARRIVED_YES = "de.ostash.spur.ARRIVED_YES"
    const val ACTION_ARRIVED_NO = "de.ostash.spur.ARRIVED_NO"
    const val EXTRA_AT = "at"
    private const val ARRIVAL_NOTIFICATION_ID = 5
    private const val NOTIFICATION_ID = 4
    private const val ALARM_CODE = 200
    private const val CHANNEL = "evening_check"

    private fun zone() = ZoneId.systemDefault()

    private fun alarmIntent(ctx: Context) = PendingIntent.getBroadcast(
        ctx, ALARM_CODE, Intent(ctx, EveningReceiver::class.java).setAction(ACTION_FIRE),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun action(ctx: Context, code: Int, action: String) = PendingIntent.getBroadcast(
        ctx, code, Intent(ctx, EveningReceiver::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Ein neuer Tag beginnt: alte Antworten vergessen, Wecker stellen. */
    fun dayStarted(ctx: Context) {
        Prefs.setEveningPending(ctx, 0L)
        Prefs.setEveningLastYes(ctx, 0L)
        cancelNotification(ctx)
        schedule(ctx)
    }

    /** Der Tag wurde von Hand beendet. */
    fun dayEnded(ctx: Context) {
        Prefs.setEveningPending(ctx, 0L)
        Prefs.setEveningLastYes(ctx, 0L)
        cancelNotification(ctx)
        ctx.getSystemService(AlarmManager::class.java).cancel(alarmIntent(ctx))
    }

    fun cancelNotification(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }

    /** Läuft ein Tag, wird der nächste Zeitpunkt gestellt. Läuft keiner, wird alles aufgeräumt. */
    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = alarmIntent(ctx)
        val day = runCatching { Db.get(ctx).openDay() }.getOrNull()
        if (day == null || !Prefs.eveningOn(ctx)) {
            am.cancel(pi)
            return
        }
        val now = System.currentTimeMillis()
        val step = EveningPlan.decide(now, day.startedAt, Prefs.eveningLastYes(ctx), Prefs.eveningPending(ctx), Prefs.eveningAskMinute(ctx), zone())
        val at = when (step) {
            is EveningStep.WaitUntil -> step.ts
            else -> now + 1_000L
        }
        if (Reminder.canScheduleExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    /** Der Wecker hat geklingelt (oder das Handy ist wieder an): fragen, beenden oder weiter warten. */
    fun fire(ctx: Context) {
        val db = Db.get(ctx)
        val day = db.openDay() ?: run { dayEnded(ctx); return }
        val now = System.currentTimeMillis()
        when (val step = EveningPlan.decide(now, day.startedAt, Prefs.eveningLastYes(ctx), Prefs.eveningPending(ctx), Prefs.eveningAskMinute(ctx), zone())) {
            is EveningStep.EndAt -> autoEnd(ctx, step.ts)
            EveningStep.Ask -> {
                Prefs.setEveningPending(ctx, now)
                show(ctx)
                schedule(ctx)
            }
            is EveningStep.WaitUntil -> schedule(ctx)
        }
    }

    /** Ohne Antwort: Tag beenden, Aufzeichnung aus, am Morgen einen Hinweis zeigen. */
    fun autoEnd(ctx: Context, endAt: Long) {
        val db = Db.get(ctx)
        val day = db.openDay()
        if (day != null) {
            db.endOpenDayAt(endAt)
            Prefs.setAutoEnded(ctx, day.id, maxOf(endAt, day.startedAt))
        }
        runCatching { TrackingService.stop(ctx) }
        SyncWorker.enqueue(ctx)
        dayEnded(ctx)
    }

    fun yes(ctx: Context) {
        Prefs.setEveningPending(ctx, 0L)
        Prefs.setEveningLastYes(ctx, System.currentTimeMillis())
        cancelNotification(ctx)
        schedule(ctx)
    }

    fun endNow(ctx: Context) {
        val day = Db.get(ctx).openDay()
        cancelNotification(ctx)
        if (day != null) {
            Db.get(ctx).endOpenDayAt(System.currentTimeMillis())
            Prefs.setAutoEnded(ctx, day.id, System.currentTimeMillis())
        }
        runCatching { TrackingService.stop(ctx) }
        SyncWorker.enqueue(ctx)
        dayEnded(ctx)
    }

    /** Angekommen (zu Hause oder in der Firma): Tag beenden? Das Ende ist die Ankunftszeit. */
    fun askArrival(ctx: Context, at: Long) {
        if (Db.get(ctx).openDay() == null) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "Abendfrage", NotificationManager.IMPORTANCE_HIGH)
            ch.enableVibration(true)
            nm.createNotificationChannel(ch)
        }
        val open = PendingIntent.getActivity(
            ctx, 5, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        fun act(code: Int, a: String) = PendingIntent.getBroadcast(
            ctx, code, Intent(ctx, EveningReceiver::class.java).setAction(a).putExtra(EXTRA_AT, at),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val time = java.text.SimpleDateFormat("HH:mm", java.util.Locale.GERMANY).format(java.util.Date(at))
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle("Spur: Arbeitstag beenden?")
            .setContentText("Du bist seit $time Uhr angekommen. Mit „Ja“ endet der Tag um $time Uhr.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(open)
            .setAutoCancel(true)
            .addAction(0, "Ja, beenden", act(31, ACTION_ARRIVED_YES))
            .addAction(0, "Nein, weiter", act(32, ACTION_ARRIVED_NO))
            .build()
        runCatching { nm.notify(ARRIVAL_NOTIFICATION_ID, n) }
    }

    fun arrivedYes(ctx: Context, at: Long) {
        ctx.getSystemService(NotificationManager::class.java).cancel(ARRIVAL_NOTIFICATION_ID)
        val day = Db.get(ctx).openDay() ?: return
        val end = maxOf(at, day.startedAt)
        Db.get(ctx).endOpenDayAt(end)
        Prefs.setAutoEnded(ctx, day.id, end, "arrival")
        runCatching { TrackingService.stop(ctx) }
        SyncWorker.enqueue(ctx)
        dayEnded(ctx)
    }

    fun arrivedNo(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java).cancel(ARRIVAL_NOTIFICATION_ID)
    }

    private fun show(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "Abendfrage", NotificationManager.IMPORTANCE_HIGH)
            ch.enableVibration(true)
            nm.createNotificationChannel(ch)
        }
        val open = PendingIntent.getActivity(
            ctx, 4, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle("Spur: Arbeitest du noch?")
            .setContentText("Ohne Antwort wird der Tag in ${EveningPlan.ANSWER_WAIT_MIN} Minuten beendet.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(open)
            .setAutoCancel(false)
            .setTimeoutAfter(EveningPlan.ANSWER_WAIT_MIN * 60_000L)
            .addAction(0, "Ja, ich arbeite noch", action(ctx, 21, ACTION_YES))
            .addAction(0, "Tag beenden", action(ctx, 22, ACTION_END))
            .build()
        runCatching { nm.notify(NOTIFICATION_ID, n) }
    }
}

class EveningReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            EveningCheck.ACTION_FIRE -> EveningCheck.fire(ctx)
            EveningCheck.ACTION_YES -> EveningCheck.yes(ctx)
            EveningCheck.ACTION_END -> EveningCheck.endNow(ctx)
            EveningCheck.ACTION_ARRIVED_YES -> EveningCheck.arrivedYes(ctx, intent.getLongExtra(EveningCheck.EXTRA_AT, System.currentTimeMillis()))
            EveningCheck.ACTION_ARRIVED_NO -> EveningCheck.arrivedNo(ctx)
        }
    }
}
