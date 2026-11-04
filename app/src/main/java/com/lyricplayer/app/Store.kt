package com.lyricplayer.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Settings (a JSON blob, like the desktop app's settings file) and the saved lyrics files. */
class Store(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("lp", Context.MODE_PRIVATE)

    fun settings(): String = prefs.getString("settings", "{}") ?: "{}"

    fun merge(patchJson: String): String {
        val current = try { JSONObject(settings()) } catch (e: Exception) { JSONObject() }
        val patch = try { JSONObject(patchJson) } catch (e: Exception) { JSONObject() }
        val keys = patch.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            current.put(k, patch.get(k))
        }
        val out = current.toString()
        prefs.edit().putString("settings", out).apply()
        return out
    }

    fun adBlock(): Boolean = try { JSONObject(settings()).optBoolean("adBlock", true) } catch (e: Exception) { true }

    val lyricsDir: File
        get() {
            val dir = ctx.getExternalFilesDir("lyrics") ?: File(ctx.filesDir, "lyrics")
            dir.mkdirs()
            return dir
        }

    private fun safe(name: String): File? {
        val base = File(name).name
        if (!Regex("\\.(lrc|txt)$", RegexOption.IGNORE_CASE).containsMatchIn(base)) return null
        return File(lyricsDir, base)
    }

    fun listLyrics(): String {
        val out = JSONArray()
        val files = lyricsDir.listFiles { f -> f.isFile && Regex("\\.(lrc|txt)$", RegexOption.IGNORE_CASE).containsMatchIn(f.name) }
            ?: emptyArray()
        for (f in files.sortedBy { it.name }) {
            out.put(JSONObject().put("file", f.name).put("name", f.name.replace(Regex("\\.(lrc|txt)$", RegexOption.IGNORE_CASE), "")))
        }
        return out.toString()
    }

    fun readLyrics(name: String): String {
        val f = safe(name) ?: return ""
        return if (f.exists()) f.readText(Charsets.UTF_8) else ""
    }

    fun writeLyrics(name: String, content: String) {
        val f = safe(name) ?: return
        f.writeText(content, Charsets.UTF_8)
    }
}
