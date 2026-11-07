package de.ostash.spur

import android.content.Context
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime

/** Kleine Ablage für Anmeldung und Einstellungen auf dem Handy. */
object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("spur", Context.MODE_PRIVATE)

    fun serverUrl(c: Context): String = sp(c).getString("server", "") ?: ""

    fun setServerUrl(c: Context, raw: String) {
        var url = raw.trim().trimEnd('/')
        if (url.isNotEmpty() && !url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://$url"
        }
        sp(c).edit().putString("server", url).apply()
    }

    fun token(c: Context): String? = sp(c).getString("token", null)
    fun userName(c: Context): String = sp(c).getString("name", "") ?: ""
    fun usesPrivateCar(c: Context): Boolean = sp(c).getBoolean("car", false)
    fun isAdmin(c: Context): Boolean = sp(c).getBoolean("admin", false)
    fun setAdmin(c: Context, admin: Boolean) { sp(c).edit().putBoolean("admin", admin).apply() }
    fun canReceipts(c: Context): Boolean = sp(c).getBoolean("receipts", false)
    fun setCanReceipts(c: Context, v: Boolean) { sp(c).edit().putBoolean("receipts", v).apply() }
    fun lastSync(c: Context): Long = sp(c).getLong("last_sync", 0L)

    fun setLastSync(c: Context, ts: Long) = sp(c).edit().putLong("last_sync", ts).apply()

    fun saveLogin(c: Context, token: String, name: String, usesPrivateCar: Boolean, isAdmin: Boolean) {
        sp(c).edit().putString("token", token).putString("name", name).putBoolean("car", usesPrivateCar).putBoolean("admin", isAdmin).apply()
    }

    /** Meldet ab, die lokalen Tage und Punkte bleiben erhalten, bis sie abgeglichen sind. */
    fun logout(c: Context) {
        sp(c).edit().remove("token").remove("name").remove("car").remove("admin").remove("receipts").apply()
    }

    // --- Erinnerung zum Tagesbeginn ---
    fun reminder(c: Context): ReminderConfig {
        val p = sp(c)
        val d = ReminderConfig()
        val days = p.getString("rem_days", null)
            ?.split(',')?.mapNotNull { it.toIntOrNull()?.takeIf { n -> n in 1..7 }?.let(DayOfWeek::of) }?.toSet() ?: d.days
        fun time(key: String, def: LocalTime): LocalTime {
            val m = p.getInt(key, def.hour * 60 + def.minute).coerceIn(0, 24 * 60 - 1)
            return LocalTime.of(m / 60, m % 60)
        }
        return ReminderConfig(
            enabled = p.getBoolean("rem_on", d.enabled),
            days = days,
            first = time("rem_first", d.first),
            second = time("rem_second", d.second),
            sound = p.getBoolean("rem_sound", d.sound),
            vibrate = p.getBoolean("rem_vibrate", d.vibrate),
        )
    }

    fun setReminder(c: Context, r: ReminderConfig) {
        sp(c).edit()
            .putBoolean("rem_on", r.enabled)
            .putString("rem_days", r.days.joinToString(",") { it.value.toString() })
            .putInt("rem_first", r.first.hour * 60 + r.first.minute)
            .putInt("rem_second", r.second.hour * 60 + r.second.minute)
            .putBoolean("rem_sound", r.sound)
            .putBoolean("rem_vibrate", r.vibrate)
            .apply()
    }

    /** Tag, an dem nicht mehr erinnert wird („Heute frei“ oder Tag läuft schon). */
    fun reminderFreeDate(c: Context): LocalDate? = sp(c).getString("rem_free", null)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    fun setReminderFreeDate(c: Context, d: LocalDate?) { sp(c).edit().putString("rem_free", d?.toString()).apply() }
    fun reminderSnoozeUntil(c: Context): Long = sp(c).getLong("rem_snooze", 0L)
    fun setReminderSnoozeUntil(c: Context, ts: Long) { sp(c).edit().putLong("rem_snooze", ts).apply() }
}
