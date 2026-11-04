package com.lyricplayer.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.util.concurrent.Executors

/**
 * Keeps the music alive in the background, shows the lock-screen / notification controls and
 * presents Lyric Player to Android Auto as a media app. The sound itself comes from the YouTube Music page.
 */
class PlaybackService : MediaBrowserServiceCompat() {
    private lateinit var session: MediaSessionCompat
    private val worker = Executors.newSingleThreadExecutor()
    private var started = false
    private var shownKey = ""
    private var art: Bitmap? = null
    private var artFor = ""
    private var lastStateAt = 0L
    private var lastPlaying: Boolean? = null

    override fun onCreate() {
        super.onCreate()
        Hub.service = this
        session = MediaSessionCompat(this, "LyricPlayer")
        session.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() = Hub.command("play")
            override fun onPause() = Hub.command("pause")
            override fun onStop() = Hub.command("pause")
            override fun onSkipToNext() = Hub.command("next")
            override fun onSkipToPrevious() = Hub.command("prev")
            override fun onSeekTo(pos: Long) = Hub.command("seek", pos / 1000.0)
            override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) = Hub.command("play")
        })
        session.isActive = true
        sessionToken = session.sessionToken
        setState(null)
        val channel = NotificationChannel(CHANNEL, "Now playing", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "lp.play" -> Hub.command("toggle")
            "lp.next" -> Hub.command("next")
            "lp.prev" -> Hub.command("prev")
        }
        if (!started) {
            started = true
            ServiceCompat.startForeground(this, NOTIF_ID, notification(Hub.last), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        if (Hub.service === this) Hub.service = null
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    // ----- Android Auto / media browsers: one item, "what's playing" -----
    override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot = BrowserRoot("root", null)

    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        val np = Hub.last
        val desc = MediaDescriptionCompat.Builder()
            .setMediaId("now")
            .setTitle(np?.title?.ifEmpty { null } ?: "Lyric Player")
            .setSubtitle(np?.artist ?: "Open the app on your phone to choose music")
            .build()
        result.sendResult(mutableListOf(MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)))
    }

    // ----- updates from the page (main thread) -----
    fun update(np: NowPlaying) {
        val key = "${np.title}|${np.artist}|${np.durMs / 1000}|${np.art}"
        if (key != shownKey) {
            shownKey = key
            loadArt(np.art)
            session.setMetadata(metadata(np))
        }
        val now = System.currentTimeMillis()
        if (lastPlaying != np.playing || now - lastStateAt > 2500) {
            lastStateAt = now
            setState(np)
        }
        if (lastPlaying != np.playing || key != notifKey) {
            notifKey = key
            lastPlaying = np.playing
            refreshNotification()
        }
    }

    private var notifKey = ""

    private fun loadArt(url: String) {
        if (url.isEmpty() || url == artFor) return
        artFor = url
        worker.execute {
            val bmp = Art.bitmap(url) ?: return@execute
            Hub.main.post {
                if (artFor == url) {
                    art = bmp
                    Hub.last?.let { session.setMetadata(metadata(it)) }
                    refreshNotification()
                }
            }
        }
    }

    /** The line being sung moves into the title slot, so it shows on the car screen and lock screen. */
    fun lyricChanged() {
        Hub.last?.let { session.setMetadata(metadata(it)) }
    }

    private fun metadata(np: NowPlaying): MediaMetadataCompat {
        val line = Hub.lyric
        val b = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, if (line.isNotEmpty()) line else np.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, if (line.isNotEmpty()) "${np.title} · ${np.artist}" else np.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, np.album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, np.durMs)
        art?.let { b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
        return b.build()
    }

    private fun setState(np: NowPlaying?) {
        val actions = PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_STOP
        val state = when {
            np == null -> PlaybackStateCompat.STATE_PAUSED
            np.playing -> PlaybackStateCompat.STATE_PLAYING
            else -> PlaybackStateCompat.STATE_PAUSED
        }
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, np?.posMs ?: 0L, if (np?.playing == true) 1f else 0f)
                .build(),
        )
    }

    // ----- notification -----
    private fun action(icon: Int, title: String, name: String): NotificationCompat.Action {
        val pi = PendingIntent.getService(
            this, name.hashCode(), Intent(this, PlaybackService::class.java).setAction(name),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Action(icon, title, pi)
    }

    private fun notification(np: NowPlaying?): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val playing = np?.playing == true
        val b = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(np?.title?.ifEmpty { null } ?: "Lyric Player")
            .setContentText(np?.artist ?: "Ready")
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", "lp.prev"))
            .addAction(
                if (playing) action(android.R.drawable.ic_media_pause, "Pause", "lp.play")
                else action(android.R.drawable.ic_media_play, "Play", "lp.play"),
            )
            .addAction(action(android.R.drawable.ic_media_next, "Next", "lp.next"))
            .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
        art?.let { b.setLargeIcon(it) }
        return b.build()
    }

    private fun refreshNotification() {
        if (!started) return
        try {
            getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(Hub.last))
        } catch (e: SecurityException) {
            // notifications not allowed: the music still plays
        }
    }

    companion object {
        private const val CHANNEL = "playback"
        private const val NOTIF_ID = 1
    }
}
