package com.lyricplayer.app

import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder

/**
 * TV only: a tiny web page on the home network. Open it on a phone, paste a YouTube Music link, and the TV plays it
 * (so nobody has to type with a remote).
 */
object LinkServer {
    @Volatile var port = 0
    private var started = false
    private val looksRight = Regex("youtu|MPREb_|^(PL|OLAK5uy_|UU|FL|RD)[A-Za-z0-9_-]{6,}$")

    @Synchronized
    fun start() {
        if (started) return
        started = true
        Thread { serve() }.apply { isDaemon = true }.start()
    }

    fun address(): String {
        if (port == 0) return ""
        try {
            val all = NetworkInterface.getNetworkInterfaces() ?: return ""
            for (ni in all) {
                if (!ni.isUp || ni.isLoopback) continue
                for (a in ni.inetAddresses) {
                    if (a is Inet4Address && a.isSiteLocalAddress) return "http://${a.hostAddress}:$port"
                }
            }
        } catch (e: Exception) {
            // no network
        }
        return ""
    }

    private fun serve() {
        var server: ServerSocket? = null
        for (p in 8080..8090) {
            try { server = ServerSocket(p); port = p; break } catch (e: Exception) { /* try the next one */ }
        }
        val s = server ?: return
        while (true) {
            val c = try { s.accept() } catch (e: Exception) { return }
            Thread { handle(c) }.apply { isDaemon = true }.start()
        }
    }

    private fun handle(c: Socket) {
        c.use {
            try {
                c.soTimeout = 5000
                val input = c.getInputStream().buffered()
                val head = StringBuilder()
                while (head.length < 8192 && !head.endsWith("\r\n\r\n")) {
                    val b = input.read()
                    if (b < 0) break
                    head.append(b.toChar())
                }
                val lines = head.toString().split("\r\n")
                val first = lines.firstOrNull()?.split(" ") ?: return
                val method = first.getOrNull(0) ?: return
                val path = first.getOrNull(1) ?: "/"
                val length = lines.firstOrNull { it.startsWith("Content-Length:", true) }?.substringAfter(":")?.trim()?.toIntOrNull() ?: 0
                val body = if (length in 1..4096) String(ByteArray(length).also { buf ->
                    var got = 0
                    while (got < length) { val n = input.read(buf, got, length - got); if (n < 0) break; got += n }
                }, Charsets.UTF_8) else ""

                val out = c.getOutputStream()
                when {
                    method == "GET" && path == "/" -> reply(out, page(""))
                    method == "POST" && path == "/play" -> {
                        val link = body.split("&").firstOrNull { it.startsWith("link=") }
                            ?.substringAfter("=")?.let { URLDecoder.decode(it, "UTF-8") }?.trim() ?: ""
                        if (link.length in 6..500 && looksRight.containsMatchIn(link)) {
                            Hub.main.post {
                                Hub.ui?.evaluateJavascript(
                                    "(function(u){var i=document.getElementById('urlInput');var b=document.getElementById('btnLoad');if(i&&b){i.value=u;b.click();}})(${JSONObject.quote(link)})",
                                    null,
                                )
                            }
                            reply(out, page("Sent to your TV. It should start in a moment."))
                        } else {
                            reply(out, page("That doesn't look like a YouTube Music link. Copy it with Share, then paste it here."))
                        }
                    }
                    else -> reply(out, "Not found", 404)
                }
            } catch (e: Exception) {
                // a dropped connection is fine
            }
        }
    }

    private fun reply(out: java.io.OutputStream, html: String, code: Int = 200) {
        val bytes = html.toByteArray(Charsets.UTF_8)
        out.write("HTTP/1.1 $code OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
        out.write(bytes)
        out.flush()
    }

    private fun page(message: String): String {
        val note = if (message.isEmpty()) "" else "<p class=note>${message.replace("<", "&lt;")}</p>"
        return """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Lyric Player TV</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#120f0d;color:#f1e6d8;font-family:system-ui,sans-serif}
main{width:min(520px,92vw);padding:28px}h1{font-weight:500;font-size:26px;margin:0 0 6px}p{color:#8f8071;line-height:1.5}
input{width:100%;box-sizing:border-box;padding:14px 16px;border-radius:12px;border:1px solid #3a2f27;background:#1f1914;color:#f1e6d8;font-size:16px}
button{margin-top:14px;width:100%;padding:14px;border:0;border-radius:999px;background:#c08a5e;color:#1a120c;font-weight:700;font-size:16px}
.note{color:#e0b48a;font-size:16px}</style></head><body><main>
<h1>Play on your TV</h1><p>Paste a YouTube Music playlist, album or song link.</p>$note
<form method=post action=/play><input name=link placeholder="https://music.youtube.com/..." autocomplete=off><button>Play</button></form>
</main></body></html>"""
    }
}
