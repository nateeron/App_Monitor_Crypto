package crypto.monitor.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.RemoteViews
import java.io.File
import java.io.FileOutputStream

object WidgetUpdater {
    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, CryptoWidgetProvider::class.java))
        ids.forEach { id -> update(context, id) }
    }

    fun update(context: Context, widgetId: Int) {
        val symbol = WidgetPrefs.symbol(context, widgetId)
        val interval = WidgetPrefs.interval(context, widgetId)
        try {
            val candles = Binance.klines(symbol, interval, 250)
            val dayOpen = runCatching { Binance.klines(symbol, "1d", 1).lastOrNull()?.open }.getOrNull()
            val (width, height) = sizePx(context, widgetId)
            val bitmap = ChartBitmap.render(width, height, symbol, interval, candles, dayOpen)
            save(context, widgetId, bitmap)
            showChart(context, widgetId, bitmap)
        } catch (_: Exception) {
            val cached = load(context, widgetId)
            if (cached != null) showChart(context, widgetId, cached)
            else showMessage(context, widgetId, "เชื่อมต่อ Binance ไม่สำเร็จ")
        }
    }

    fun hasCache(context: Context, widgetId: Int): Boolean = cacheFile(context, widgetId).isFile

    fun showMessage(context: Context, widgetId: Int, message: String) {
        val views = RemoteViews(context.packageName, R.layout.widget_chart)
        views.setTextViewText(R.id.message, message)
        views.setViewVisibility(R.id.message, android.view.View.VISIBLE)
        views.setViewVisibility(R.id.chart, android.view.View.GONE)
        bindRefresh(context, views, widgetId)
        AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views)
    }

    private fun showChart(context: Context, widgetId: Int, bitmap: Bitmap) {
        val views = RemoteViews(context.packageName, R.layout.widget_chart)
        views.setImageViewBitmap(R.id.chart, bitmap)
        views.setViewVisibility(R.id.chart, android.view.View.VISIBLE)
        views.setViewVisibility(R.id.message, android.view.View.GONE)
        bindRefresh(context, views, widgetId)
        AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views)
    }

    private fun bindRefresh(context: Context, views: RemoteViews, widgetId: Int) {
        val intent = Intent(context, CryptoWidgetProvider::class.java).apply {
            action = CryptoWidgetProvider.ACTION_REFRESH
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        }
        val pending = PendingIntent.getBroadcast(
            context,
            widgetId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.root, pending)
    }

    private fun sizePx(context: Context, widgetId: Int): Pair<Int, Int> {
        val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId)
        val portrait = context.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
        val widthDp = options.getInt(
            if (portrait) AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,
        )
        val heightDp = options.getInt(
            if (portrait) AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,
        )
        val density = context.resources.displayMetrics.density
        var width = ((if (widthDp > 0) widthDp else 180) * density).toInt()
        var height = ((if (heightDp > 0) heightDp else 160) * density).toInt()
        width = width.coerceIn(180, 900)
        height = height.coerceIn(160, 900)
        while (width * height * 4 > 450_000) {
            width = (width * 0.85f).toInt().coerceAtLeast(120)
            height = (height * 0.85f).toInt().coerceAtLeast(100)
        }
        return width to height
    }

    private fun cacheFile(context: Context, widgetId: Int) = File(context.filesDir, "widget-$widgetId.png")

    private fun save(context: Context, widgetId: Int, bitmap: Bitmap) {
        FileOutputStream(cacheFile(context, widgetId)).use { stream ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 90, stream)
        }
    }

    private fun load(context: Context, widgetId: Int): Bitmap? {
        val file = cacheFile(context, widgetId)
        if (!file.isFile) return null
        return BitmapFactory.decodeFile(file.absolutePath)
    }

    fun deleteCache(context: Context, widgetId: Int) {
        cacheFile(context, widgetId).delete()
    }
}
