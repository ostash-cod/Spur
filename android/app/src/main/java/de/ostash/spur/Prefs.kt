package de.ostash.spur

import android.content.Context

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
    fun lastSync(c: Context): Long = sp(c).getLong("last_sync", 0L)

    fun setLastSync(c: Context, ts: Long) = sp(c).edit().putLong("last_sync", ts).apply()

    fun saveLogin(c: Context, token: String, name: String, usesPrivateCar: Boolean, isAdmin: Boolean) {
        sp(c).edit().putString("token", token).putString("name", name).putBoolean("car", usesPrivateCar).putBoolean("admin", isAdmin).apply()
    }

    /** Meldet ab, die lokalen Tage und Punkte bleiben erhalten, bis sie abgeglichen sind. */
    fun logout(c: Context) {
        sp(c).edit().remove("token").remove("name").remove("car").remove("admin").apply()
    }
}
