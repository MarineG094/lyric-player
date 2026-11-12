package com.lyricplayer.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.MutableContextWrapper
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** What the player is doing right now, as reported by the page. */
data class NowPlaying(
    val title: String,
    val artist: String,
    val album: String,
    val art: String,
    val durMs: Long,
    val posMs: Long,
    val playing: Boolean,
    val cover: String = "s",
)

/**
 * Owns the two web pages (the player screen and the hidden YouTube Music page).
 * They live here, not in the activity, so music keeps going when the screen is closed or rotated.
 */
object Hub {
    private const val UI_URL = "https://appassets.androidplatform.net/assets/renderer/index.html"
    const val YT_URL = "https://music.youtube.com/"

    val main = Handler(Looper.getMainLooper())
    lateinit var store: Store
    @Volatile var service: PlaybackService? = null
    @Volatile var activity: MainActivity? = null
    @Volatile var last: NowPlaying? = null
    @Volatile var browsing = false
    /** True while the screen is showing the app; the page is then polled less often to save battery. */
    @Volatile var visible = true
    @Volatile var lyric = ""
    /** Two letters: shuffle on (1) / off (0), then repeat off (x) / playlist (a) / one song (o). */
    @Volatile var modes = "0x"

    var ui: WebView? = null
        private set
    var yt: WebView? = null
        private set
    private lateinit var appCtx: Context
    private var uiCtx: MutableContextWrapper? = null
    private var ytCtx: MutableContextWrapper? = null

    private val ytWaiting = HashMap<Int, (String) -> Unit>()
    private var ytSeq = 0
    private var ticking = false
    private val isTv: Boolean by lazy { appCtx.resources.getBoolean(R.bool.is_tv) }
    private val tick = object : Runnable {
        override fun run() {
            ui?.evaluateJavascript("window.__lpTick && window.__lpTick()", null)
            // Watching: 3 times a second. In the background: once a second (a bit slower again while paused),
            // but speeding up near the end of a song so the next one still starts on time.
            val np = last
            val remaining = if (np != null && np.durMs > 0) np.durMs - np.posMs else Long.MAX_VALUE
            val next = when {
                visible && last == null && isTv -> 1000L // nothing playing yet: the page is still loading, leave it the processor
                visible -> if (isTv) 500L else 300L
                remaining < 6000 -> 250L
                np != null && !np.playing -> 1500L
                else -> 1000L
            }
            main.postDelayed(this, next)
        }
    }

    /** Called from MainActivity.onCreate. Creates the pages once, then lends them to the activity. */
    @SuppressLint("SetJavaScriptEnabled")
    fun attach(activity: Activity, uiParent: ViewGroup, ytParent: ViewGroup) {
        val app = activity.applicationContext
        appCtx = app
        if (!::store.isInitialized) store = Store(app)
        AdBlock.enabled = store.adBlock()
        uiParentV = uiParent
        ytParentV = ytParent
        if (uiCtx == null) uiCtx = MutableContextWrapper(app)
        if (ytCtx == null) ytCtx = MutableContextWrapper(app)
        buildMissing()
        uiCtx!!.setBaseContext(activity)
        ytCtx!!.setBaseContext(activity)
        mount()
        ui?.requestFocus()
        if (!ticking) { ticking = true; main.post(tick) }
    }

    private var uiParentV: ViewGroup? = null
    private var ytParentV: ViewGroup? = null

    private fun buildMissing() {
        // The player screen loads first so the opening animation has the phone to itself. The YouTube Music page only gets
        // its warm-up load a moment later, and not at all if a song has already sent it somewhere.
        if (ui == null) { ui = buildUi(uiCtx!!); ui!!.loadUrl(UI_URL) }
        if (yt == null) {
            yt = buildYt(ytCtx!!)
            main.postDelayed({
                val u = yt?.url
                if (u.isNullOrEmpty() || u == "about:blank") yt?.loadUrl(YT_URL)
            }, 3000)
        }
    }

    private fun mount() {
        val y = yt; val u = ui
        val yp = ytParentV; val up = uiParentV
        if (y != null && yp != null) {
            (y.parent as? ViewGroup)?.removeView(y)
            yp.addView(y, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        if (u != null && up != null) {
            (u.parent as? ViewGroup)?.removeView(u)
            up.addView(u, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
    }

    /** Android ended a page's renderer (low memory, or a long time in the background). Without this the whole app crashes
     *  or freezes; instead the dead page is thrown away and a fresh one loads in its place. */
    fun recover(dead: WebView) {
        main.post {
            (dead.parent as? ViewGroup)?.removeView(dead)
            try { dead.destroy() } catch (_: Exception) { }
            if (dead === yt) yt = null
            if (dead === ui) ui = null
            if (::appCtx.isInitialized && uiCtx != null && ytCtx != null) {
                buildMissing()
                mount()
                ui?.requestFocus()
                activity?.showBrowse(browsing)
            }
        }
    }

    fun detach() {
        uiParentV = null
        ytParentV = null
        (yt?.parent as? ViewGroup)?.removeView(yt)
        (ui?.parent as? ViewGroup)?.removeView(ui)
        uiCtx?.setBaseContext(appCtx)
        ytCtx?.setBaseContext(appCtx)
    }

    /** A button press from the notification, headset or car: handled by the page's own player code. */
    fun command(name: String, arg: Double? = null) {
        main.post {
            val a = if (arg == null) "undefined" else arg.toString()
            ui?.evaluateJavascript("window.__lpCmd && window.__lpCmd('$name', $a)", null)
        }
    }

    /** Presses one of the page's own buttons (shuffle / repeat), so the app and the car stay in step. */
    fun click(id: String) {
        main.post { ui?.evaluateJavascript("(document.getElementById('$id')||{click(){}}).click()", null) }
    }

    fun nowPlaying(json: String) {
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        val np = NowPlaying(
            o.optString("title"), o.optString("artist"), o.optString("album"), o.optString("art"),
            (o.optDouble("dur", 0.0) * 1000).toLong(), (o.optDouble("cur", 0.0) * 1000).toLong(), o.optBoolean("playing"), o.optString("cover", "s"),
        )
        last = np
        main.post { service?.update(np); activity?.keepAwake(np.playing) }
    }

    /** Runs a script in the YouTube Music page and reports its result (waiting for promises). Always answers, even if the page is mid-navigation. */
    fun runYt(script: String, done: (String) -> Unit) {
        val web = yt ?: return done("{\"e\":\"no page\"}")
        val id = ++ytSeq
        ytWaiting[id] = done
        val wrapped = "(async()=>{try{const r=await (\n$script\n);LPYt.result($id,JSON.stringify({v:r===undefined?null:r}));}catch(e){LPYt.result($id,JSON.stringify({e:String(e)}));}})()"
        web.evaluateJavascript(wrapped, null)
        main.postDelayed({ ytWaiting.remove(id)?.invoke("{\"e\":\"timeout\"}") }, 5000)
    }

    private class YtBridge {
        @JavascriptInterface
        fun result(id: Int, json: String) {
            main.post { ytWaiting.remove(id)?.invoke(json) }
        }
    }

    fun resolve(id: Int, json: String) {
        main.post { ui?.evaluateJavascript("window.__lpResolve($id, ${JSONObject.quote(json)})", null) }
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun buildUi(ctx: Context): WebView {
        val w = WebView(ctx)
        w.setBackgroundColor(0xFF120F0D.toInt())
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
            .build()
        w.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { recover(view); return true }
        }
        w.addJavascriptInterface(Bridge(), "LPNative")
        WebView.setWebContentsDebuggingEnabled(true)
        return w
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun buildYt(ctx: Context): WebView {
        val w = WebView(ctx)
        val s = w.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowFileAccess = false
        s.allowContentAccess = false
        // Ask for the normal computer version of the site: it has the player the app reads from.
        s.userAgentString = s.userAgentString
            .replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)")
            .replace(Regex(" Version/\\S+"), "")
            .replace(" Mobile", "")
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.setSupportZoom(true)
        s.builtInZoomControls = true
        s.displayZoomControls = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true)
        w.addJavascriptInterface(YtBridge(), "LPYt")

        val script by lazy {
            ctx.assets.open("renderer/ytm-inject.js").bufferedReader().use { it.readText() }
                .replace("__ENABLED__", if (AdBlock.enabled) "true" else "false")
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, script, setOf("https://music.youtube.com"))
        }
        w.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                // Older WebViews can't run a script before the page's own: this is the fallback (it only runs once per page).
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(script, null)
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (AdBlock.enabled && AdBlock.isAd(request.url)) {
                    return WebResourceResponse("text/plain", "utf-8", 204, "No Content", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                return null
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { recover(view); return true }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                return !(u.scheme == "https" && AdBlock.isGoogleHost(u.host ?: ""))
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            // The site registers a "Leave page?" prompt while music plays. Always leave, so jumping to a song works.
            override fun onJsBeforeUnload(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
                result.confirm()
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
        }
        return w
    }
}
