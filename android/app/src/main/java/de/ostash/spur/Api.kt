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
