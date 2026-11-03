package de.ostash.spur

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/** Neue Version auf dem Server gefunden. */
data class UpdateInfo(val versionCode: Long, val versionName: String, val sizeBytes: Long)

/** Prüft, ob der Server eine neuere App hat, lädt sie und öffnet die Installation. */
object Updater {
    fun installedCode(ctx: Context): Long =
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).longVersionCode }.getOrDefault(0L)

    /** Gibt die neue Version zurück oder null, wenn die App aktuell ist. Wirft bei Verbindungsfehlern. */
    fun check(ctx: Context): UpdateInfo? {
        val o = Api.get(ctx, "/api/app-version", null)
        val code = o.optLong("versionCode", 0)
        return if (code > installedCode(ctx)) UpdateInfo(code, o.optString("versionName", "?"), o.optLong("size", 0)) else null
    }

    fun download(ctx: Context, onProgress: (Int) -> Unit): File {
        val file = File(ctx.cacheDir, "updates/spur.apk")
        file.delete()
        Api.download(ctx, "/api/app.apk", file, onProgress)
        return file
    }

    /** Darf die App Installationen starten? Sonst öffnet sich die Einstellung dafür. */
    fun canInstall(ctx: Context): Boolean = Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    fun openInstallPermissionSettings(ctx: Context) {
        ctx.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun install(ctx: Context, file: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
        ctx.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
