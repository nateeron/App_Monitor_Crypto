package crypto.monitor.widgets

import android.content.Context

object WidgetPrefs {
    private const val file = "crypto-widgets"

    fun save(context: Context, widgetId: Int, symbol: String, interval: String) {
        context.getSharedPreferences(file, Context.MODE_PRIVATE).edit()
            .putString(key(widgetId, "symbol"), symbol)
            .putString(key(widgetId, "interval"), interval)
            .apply()
    }

    fun symbol(context: Context, widgetId: Int): String {
        val value = context.getSharedPreferences(file, Context.MODE_PRIVATE)
            .getString(key(widgetId, "symbol"), "XRPUSDT")
            ?: "XRPUSDT"
        return if (Markets.allowedSymbol(value)) value else "XRPUSDT"
    }

    fun interval(context: Context, widgetId: Int): String {
        val value = context.getSharedPreferences(file, Context.MODE_PRIVATE)
            .getString(key(widgetId, "interval"), "15m")
            ?: "15m"
        return if (Markets.allowedInterval(value)) value else "15m"
    }

    fun remove(context: Context, widgetId: Int) {
        context.getSharedPreferences(file, Context.MODE_PRIVATE).edit()
            .remove(key(widgetId, "symbol"))
            .remove(key(widgetId, "interval"))
            .apply()
    }

    private fun key(widgetId: Int, name: String) = "$widgetId.$name"
}
