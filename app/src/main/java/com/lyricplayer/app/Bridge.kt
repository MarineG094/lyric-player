package com.lyricplayer.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.concurrent.Executors

/** What the player page can ask the phone to do (the page sees this as `LPNative`). */
class Bridge {
    private val pool = Executors.newFixedThreadPool(3)

    // ----- quick, direct calls -----
    @JavascriptInterface fun settings(): String = Hub.store.settings()
    @JavascriptInterface fun mergeSettings(json: String) { Hub.store.merge(json) }
    @JavascriptInterface fun lyricsDir(): String = Hub.store.lyricsDir.absolutePath
    @JavascriptInterface fun listLyrics(): String = Hub.store.listLyrics()
    @JavascriptInterface fun readLyrics(name: String): String? {
        val t = Hub.store.readLyrics(name)
        return if (t.isEmpty()) null else t
    }
    @JavascriptInterface fun writeLyrics(name: String, content: String) { Hub.store.writeLyrics(name, content) }
    @JavascriptInterface fun nowPlaying(json: String) { Hub.nowPlaying(json) }
    @JavascriptInterface fun modes(code: String) { Hub.modes = code; Hub.main.post { Hub.service?.modesChanged() } }
    @JavascriptInterface fun lyricLine(text: String) { Hub.lyric = text; Hub.main.post { Hub.service?.lyricChanged() } }

    // ----- calls that finish later: the answer goes back through window.__lpResolve(id, json) -----
    @JavascriptInterface
    fun invoke(id: Int, method: String, argsJson: String) {
        val args = try { JSONObject(argsJson) } catch (e: Exception) { JSONObject() }
        when (method) {
            "sleep" -> Hub.main.postDelayed({ Hub.resolve(id, "true") }, args.optLong("ms", 0).coerceIn(0, 60000))
            "yt.eval" -> Hub.main.post { Hub.runYt(args.optString("script")) { Hub.resolve(id, it) } }
            "yt.load" -> Hub.main.post {
                val url = args.optString("url")
                if (url.startsWith("https://")) Hub.yt?.loadUrl(url)
                Hub.resolve(id, "true")
            }
            "yt.layout" -> Hub.main.post {
                Hub.browsing = args.optBoolean("browse")
                Hub.activity?.showBrowse(Hub.browsing)
                Hub.resolve(id, "true")
            }
            "http.get" -> pool.execute { Hub.resolve(id, Http.get(args.optString("url"), (args.optJSONObject("headers") ?: JSONObject()).toString())) }
            "art.thumb" -> pool.execute { Hub.resolve(id, Art.thumb(args.optString("url"), args.optInt("size", 24))) }
            "adblock" -> {
                AdBlock.enabled = args.optBoolean("on", true)
                Hub.store.merge(JSONObject().put("adBlock", AdBlock.enabled).toString())
                Hub.resolve(id, "true")
            }
            "clipboard" -> Hub.main.post {
                val cm = Hub.ui?.context?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                cm?.setPrimaryClip(ClipData.newPlainText("Lyric Player", args.optString("t")))
                Hub.resolve(id, "true")
            }
            else -> Hub.resolve(id, "null")
        }
    }
}
