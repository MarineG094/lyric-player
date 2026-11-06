package com.lyricplayer.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.widget.RemoteViews

/**
 * Home screen widgets (phone only). The service calls [refresh] when the song, play state, cover or lyric line changes;
 * nothing runs on a timer. The buttons go through this receiver to the same commands the notification uses.
 */
open class LyricWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)

    override fun onReceive(context: Context, intent: Intent) {
        val cmd = when (intent.action) {
            ACTION_PLAY -> "toggle"
            ACTION_NEXT -> "next"
            ACTION_PREV -> "prev"
            else -> null
        }
        if (cmd == null) { super.onReceive(context, intent); return }
        if (Hub.ui != null) Hub.command(cmd)
        else try { context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
    }

    companion object {
        const val ACTION_PLAY = "com.lyricplayer.app.WIDGET_PLAY"
        const val ACTION_NEXT = "com.lyricplayer.app.WIDGET_NEXT"
        const val ACTION_PREV = "com.lyricplayer.app.WIDGET_PREV"

        fun refresh(ctx: Context) {
            val app = ctx.applicationContext
            val mgr = AppWidgetManager.getInstance(app)
            update(app, mgr, LyricWidget::class.java, R.layout.widget_small, false)
            update(app, mgr, LyricWidgetLarge::class.java, R.layout.widget_large, true)
        }

        private fun update(ctx: Context, mgr: AppWidgetManager, cls: Class<*>, layout: Int, large: Boolean) {
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, cls))
            if (ids.isEmpty()) return
            val np = Hub.last
            val v = RemoteViews(ctx.packageName, layout)
            v.setTextViewText(R.id.w_title, np?.title?.ifEmpty { null } ?: "Lyric Player")
            v.setTextViewText(R.id.w_artist, np?.artist?.ifEmpty { null } ?: "Tap to open")
            v.setImageViewResource(R.id.w_play, if (np?.playing == true) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
            val art = Hub.service?.widgetArt()
            if (art != null) v.setImageViewBitmap(R.id.w_art, art) else v.setImageViewResource(R.id.w_art, R.mipmap.ic_launcher)
            if (large) v.setTextViewText(R.id.w_lyric, if (np == null) "" else Hub.lyric)
            v.setOnClickPendingIntent(R.id.w_play, button(ctx, cls, ACTION_PLAY))
            v.setOnClickPendingIntent(R.id.w_next, button(ctx, cls, ACTION_NEXT))
            v.setOnClickPendingIntent(R.id.w_prev, button(ctx, cls, ACTION_PREV))
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            v.setOnClickPendingIntent(R.id.w_root, open)
            v.setOnClickPendingIntent(R.id.w_title, open)
            try { mgr.updateAppWidget(ids, v) } catch (_: Exception) { }
        }

        private fun button(ctx: Context, cls: Class<*>, action: String): PendingIntent =
            PendingIntent.getBroadcast(
                ctx, action.hashCode(), Intent(ctx, cls).setAction(action),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )

        /** Covers are shrunk before they go to the home screen (widget data has a size limit). */
        fun small(bmp: Bitmap): Bitmap =
            if (bmp.width <= 200) bmp else Bitmap.createScaledBitmap(bmp, 200, 200, true)
    }
}

class LyricWidgetLarge : LyricWidget()
