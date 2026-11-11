package crypto.monitor.widgets

import org.json.JSONArray
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class Candle(
    val time: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
)

object Binance {
    private val hosts = listOf(
        "https://api.binance.com",
        "https://data-api.binance.vision",
    )

    fun klines(symbol: String, interval: String, limit: Int): List<Candle> {
        require(Markets.allowedSymbol(symbol)) { "symbol" }
        require(Markets.allowedInterval(interval)) { "interval" }
        val size = limit.coerceIn(1, 1000)
        var lastError: Exception? = null
        for (host in hosts) {
            try {
                val body = get("$host/api/v3/klines?symbol=$symbol&interval=$interval&limit=$size")
                return parse(body)
            } catch (error: Exception) {
                lastError = error
            }
        }
        throw lastError ?: IOException("Binance unavailable")
    }

    private fun get(url: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 12000
            readTimeout = 12000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "CryptoMonitor/1.0")
        }
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream.bufferedReader().use { it.readText() }
            if (code !in 200..299) throw IOException("HTTP $code")
            return text
        } finally {
            connection.disconnect()
        }
    }

    private fun parse(body: String): List<Candle> {
        val rows = JSONArray(body)
        val candles = ArrayList<Candle>(rows.length())
        for (index in 0 until rows.length()) {
            val row = rows.getJSONArray(index)
            if (row.length() < 5) continue
            val time = row.getLong(0) / 1000L
            val open = row.getString(1).toDouble()
            val high = row.getString(2).toDouble()
            val low = row.getString(3).toDouble()
            val close = row.getString(4).toDouble()
            if (listOf(open, high, low, close).all { it.isFinite() }) {
                candles.add(Candle(time, open, high, low, close))
            }
        }
        candles.sortBy { it.time }
        val deduped = ArrayList<Candle>(candles.size)
        for (candle in candles) {
            val previous = deduped.lastOrNull()
            if (previous != null && previous.time == candle.time) deduped[deduped.lastIndex] = candle
            else deduped.add(candle)
        }
        return deduped
    }
}
