package com.lyricplayer.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Plain HTTPS GET for the lyric lookups. Returns JSON text: {"status":200,"body":"..."} or {"error":"..."}. */
object Http {
    fun get(url: String, headersJson: String): String {
        try {
            val u = URL(url)
            if (u.protocol != "https") return error("Only https is allowed")
            val c = u.openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 8000
            c.instanceFollowRedirects = true
            c.requestMethod = "GET"
            val headers = JSONObject(headersJson)
            val keys = headers.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                c.setRequestProperty(k, headers.getString(k))
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            c.disconnect()
            return JSONObject().put("status", code).put("body", body).toString()
        } catch (e: Exception) {
            return error(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun error(message: String): String = JSONObject().put("error", message).toString()
}

/** Cover pictures: only from Google / YouTube image hosts, returned as a small square of pixels. */
object Art {
    private val hostOk = Regex("(^|\\.)(googleusercontent\\.com|ggpht\\.com|ytimg\\.com|gstatic\\.com)$", RegexOption.IGNORE_CASE)
    private val cache = object : LinkedHashMap<String, android.graphics.Bitmap>(16, 0.75f, true) {
        override fun removeEldestEntry(e: MutableMap.MutableEntry<String, android.graphics.Bitmap>?) = size > 12
    }

    @Synchronized
    fun bitmap(url: String): android.graphics.Bitmap? {
        cache[url]?.let { return it }
        return try {
            val u = URL(url)
            if (u.protocol != "https" || !hostOk.containsMatchIn(u.host)) return null
            val c = u.openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 8000
            val bytes = c.inputStream.use { it.readBytes() }
            c.disconnect()
            val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
            cache[url] = bmp
            bmp
        } catch (e: Exception) {
            null
        }
    }

    /** {"w":..,"h":..,"b64":".."} with RGBA bytes, or {} when the picture can't be used. */
    fun thumb(url: String, size: Int): String {
        val bmp = bitmap(url) ?: return "{}"
        val s = android.graphics.Bitmap.createScaledBitmap(bmp, size, size, true)
        val px = IntArray(size * size)
        s.getPixels(px, 0, size, 0, 0, size, size)
        val out = ByteArray(px.size * 4)
        for (i in px.indices) {
            val p = px[i]
            out[i * 4] = ((p shr 16) and 0xFF).toByte()
            out[i * 4 + 1] = ((p shr 8) and 0xFF).toByte()
            out[i * 4 + 2] = (p and 0xFF).toByte()
            out[i * 4 + 3] = 0xFF.toByte()
        }
        if (s !== bmp) s.recycle()
        return JSONObject().put("w", size).put("h", size).put("b64", android.util.Base64.encodeToString(out, android.util.Base64.NO_WRAP)).toString()
    }
}
