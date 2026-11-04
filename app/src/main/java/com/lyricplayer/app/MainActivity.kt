package com.lyricplayer.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var back: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#120f0d"))
        setContentView(root)

        // Layers, bottom to top: the YouTube Music page (always "visible" so it keeps playing), then the player screen.
        val ytLayer = FrameLayout(this)
        val uiLayer = FrameLayout(this)
        root.addView(ytLayer, FrameLayout.LayoutParams(-1, -1))
        root.addView(uiLayer, FrameLayout.LayoutParams(-1, -1))
        back = TextView(this).apply {
            text = "‹  Back to lyrics"
            setTextColor(Color.parseColor("#f1e6d8"))
            setTypeface(typeface, Typeface.BOLD)
            textSize = 14f
            setPadding(44, 22, 44, 22)
            setBackgroundColor(Color.parseColor("#e6120f0d"))
            visibility = View.GONE
            setOnClickListener {
                Hub.ui?.evaluateJavascript("document.getElementById('btnBrowse') && document.getElementById('btnBrowse').click()", null)
            }
        }
        val lp = FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START)
        lp.setMargins(24, 24, 0, 0)
        root.addView(back, lp)

        Hub.activity = this
        Hub.attach(this, uiLayer, ytLayer)
        showBrowse(Hub.browsing)

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        ContextCompat.startForegroundService(this, Intent(this, PlaybackService::class.java))
    }

    /** "YouTube Music" button: show the real site (to accept cookies or sign in) instead of the player screen. */
    fun showBrowse(on: Boolean) {
        Hub.ui?.visibility = if (on) View.INVISIBLE else View.VISIBLE
        back.visibility = if (on) View.VISIBLE else View.GONE
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (Hub.browsing) {
            Hub.yt?.let { if (it.canGoBack()) { it.goBack(); return } }
            back.performClick()
            return
        }
        moveTaskToBack(true) // leave the music playing
    }

    override fun onDestroy() {
        if (Hub.activity === this) Hub.activity = null
        Hub.detach()
        super.onDestroy()
    }
}
