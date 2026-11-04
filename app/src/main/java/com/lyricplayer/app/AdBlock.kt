package com.lyricplayer.app

import android.net.Uri

/** Same short list of ad servers and ad endpoints as the desktop app. */
object AdBlock {
    @Volatile var enabled = true

    private val hosts = Regex(
        "(^|\\.)(doubleclick\\.net|googlesyndication\\.com|googleadservices\\.com|adservice\\.google\\.com)$",
        RegexOption.IGNORE_CASE,
    )
    private val paths = Regex("^/(pagead/|api/stats/ads|ptracking|get_midroll_)", RegexOption.IGNORE_CASE)

    fun isAd(uri: Uri): Boolean {
        val host = uri.host ?: return false
        val path = uri.path ?: ""
        return hosts.containsMatchIn(host) || paths.containsMatchIn(path)
    }

    private val google = Regex(
        "(^|\\.)(youtube\\.com|google\\.com|gstatic\\.com|googleusercontent\\.com|accounts\\.youtube\\.com)$",
        RegexOption.IGNORE_CASE,
    )

    fun isGoogleHost(host: String): Boolean = google.containsMatchIn(host)
}
