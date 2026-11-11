package crypto.monitor.widgets

import android.graphics.Color

object Markets {
    val symbols = listOf(
        "XRPUSDT" to "XRP/USDT",
        "BTCUSDT" to "BTC/USDT",
    )

    val intervals = listOf(
        "1m" to "1 นาที",
        "3m" to "3 นาที",
        "5m" to "5 นาที",
        "15m" to "15 นาที",
        "30m" to "30 นาที",
        "1h" to "1 ชั่วโมง",
        "2h" to "2 ชั่วโมง",
        "4h" to "4 ชั่วโมง",
        "1d" to "1 วัน",
    )

    fun pretty(symbol: String): String = symbols.firstOrNull { it.first == symbol }?.second ?: symbol

    fun allowedSymbol(symbol: String): Boolean = symbols.any { it.first == symbol }

    fun allowedInterval(interval: String): Boolean = intervals.any { it.first == interval }

    fun accent(symbol: String): Int = when (symbol) {
        "BTCUSDT" -> Color.parseColor("#F7931A")
        else -> Color.parseColor("#00AAE4")
    }
}
