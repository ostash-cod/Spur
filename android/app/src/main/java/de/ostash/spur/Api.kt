package de.ostash.spur

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Schlanker Zugriff auf den Spur-Server (ohne zusätzliche Bibliotheken). */
object Api {
    class ApiException(val code: Int, message: String) : Exception(message)

    fun login(ctx: Context, code: String): JSONObject =
        JSONObject(raw(ctx, "POST", "/api/login", JSONObject().put("code", code), null).ifBlank { "{}" })

    fun post(ctx: Context, path: String, body: JSONObject, token: String): JSONObject =
        JSONObject(raw(ctx, "POST", path, body, token).ifBlank { "{}" })

    /** Schickt eine Datei (zum Beispiel ein JPEG) mit zusätzlichen Kopfzeilen. */
    fun postBytes(ctx: Context, path: String, bytes: ByteArray, contentType: String, headers: Map<String, String>, token: String): JSONObject {
        val base = Prefs.serverUrl(ctx)
        if (base.isEmpty()) throw ApiException(0, "Serveradresse fehlt")
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.setRequestProperty("Content-Type", contentType)
            conn.setRequestProperty("Authorization", "Bearer $token")
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(bytes.size)
            conn.outputStream.use { it.write(bytes) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(text).optString("error") }.getOrDefault("")
                throw ApiException(code, msg.ifBlank { "Fehler $code" })
            }
            return JSONObject(text.ifBlank { "{}" })
        } finally {
            conn.disconnect()
        }
    }

    fun get(ctx: Context, path: String, token: String?): JSONObject =
        JSONObject(raw(ctx, "GET", path, null, token).ifBlank { "{}" })

    /** Lädt eine Datei vom Server in [target]. [onProgress] bekommt die Prozent (0 bis 100). */
    fun download(ctx: Context, path: String, target: java.io.File, onProgress: (Int) -> Unit = {}) {
        val base = Prefs.serverUrl(ctx)
        if (base.isEmpty()) throw ApiException(0, "Serveradresse fehlt")
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            if (conn.responseCode !in 200..299) throw ApiException(conn.responseCode, "Fehler ${conn.responseCode} beim Herunterladen")
            val total = conn.contentLengthLong
            target.parentFile?.mkdirs()
            conn.inputStream.use { input ->
                target.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (total > 0) onProgress((done * 100 / total).toInt())
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    fun getArray(ctx: Context, path: String, token: String): JSONArray =
        JSONArray(raw(ctx, "GET", path, null, token).ifBlank { "[]" })

    private fun raw(ctx: Context, method: String, path: String, body: JSONObject?, token: String?): String {
        val base = Prefs.serverUrl(ctx)
        if (base.isEmpty()) throw ApiException(0, "Serveradresse fehlt")
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 25_000
            conn.setRequestProperty("Content-Type", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(text).optString("error") }.getOrDefault("")
                throw ApiException(code, msg.ifBlank { "Fehler $code" })
            }
            return text
        } finally {
            conn.disconnect()
        }
    }
}
