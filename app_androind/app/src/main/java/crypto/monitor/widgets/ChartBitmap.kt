package crypto.monitor.widgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

object ChartBitmap {
    private val background = Color.parseColor("#0B0E11")
    private val grid = Color.parseColor("#1C2430")
    private val muted = Color.parseColor("#9AA6B6")
    private val candleUp = Color.parseColor("#26A69A")
    private val candleDown = Color.parseColor("#EF5350")
    private val priceUp = Color.parseColor("#00E676")
    private val priceDown = Color.parseColor("#FF5252")
    private val sma5Color = Color.parseColor("#FF9800")
    private val sma200Color = Color.parseColor("#FFFFFF")
    private val zone = TimeZone.getTimeZone("Asia/Bangkok")

    fun render(
        width: Int,
        height: Int,
        symbol: String,
        interval: String,
        candles: List<Candle>,
        dayOpen: Double?,
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(background)
        if (candles.isEmpty()) return bitmap

        val scale = width / 360f
        val pad = 10f * scale
        val header = 34f * scale
        val timeRow = 16f * scale
        val scaleWidth = 58f * scale
        val chartLeft = pad
        val chartTop = header + 8f * scale
        val chartRight = width - scaleWidth
        val chartBottom = height - timeRow - 6f * scale
        if (chartRight <= chartLeft || chartBottom <= chartTop) return bitmap

        val visibleCount = (chartRight - chartLeft).toInt()
            .div(max(1f, 8f * scale).toInt())
            .coerceIn(20, 36)
            .coerceAtMost(candles.size)
        val start = candles.size - visibleCount
        val view = candles.subList(start, candles.size)
        val sma5 = sma(candles, 5)
        val sma200 = sma(candles, 200)
        var minPrice = view.minOf { it.low }
        var maxPrice = view.maxOf { it.high }
        for (index in view.indices) {
            sma5[start + index]?.let {
                minPrice = min(minPrice, it)
                maxPrice = max(maxPrice, it)
            }
            sma200[start + index]?.let {
                minPrice = min(minPrice, it)
                maxPrice = max(maxPrice, it)
            }
        }
        val padding = (maxPrice - minPrice) * 0.1
        val spanPad = if (padding > 0) padding else max(abs(maxPrice) * 0.01, 0.0001)
        minPrice -= spanPad
        maxPrice += spanPad
        val span = (maxPrice - minPrice).takeIf { it > 0 } ?: 1.0

        fun yOf(price: Double): Float {
            val fraction = ((price - minPrice) / span).toFloat()
            return chartBottom - fraction * (chartBottom - chartTop)
        }

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f
        paint.color = grid
        for (step in 0..3) {
            val y = chartTop + (chartBottom - chartTop) * step / 3f
            canvas.drawLine(chartLeft, y, chartRight, y, paint)
        }

        drawSma(canvas, paint, view, sma200, start, chartLeft, chartRight, sma200Color, ::yOf)
        drawSma(canvas, paint, view, sma5, start, chartLeft, chartRight, sma5Color, ::yOf)

        val slot = (chartRight - chartLeft) / view.size
        val body = (slot * 0.62f).coerceAtLeast(1.5f)
        paint.style = Paint.Style.FILL
        for (index in view.indices) {
            val candle = view[index]
            val rising = candle.close >= candle.open
            paint.color = if (rising) candleUp else candleDown
            val center = chartLeft + slot * index + slot / 2f
            val openY = yOf(candle.open)
            val closeY = yOf(candle.close)
            val top = min(openY, closeY)
            val bottom = max(openY, closeY).coerceAtLeast(top + 1f)
            canvas.drawLine(center, yOf(candle.high), center, yOf(candle.low), paint)
            canvas.drawRect(center - body / 2f, top, center + body / 2f, bottom, paint)
        }

        val last = view.last()
        val lastY = yOf(last.close)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f
        paint.color = if (last.close >= last.open) candleUp else candleDown
        paint.pathEffect = DashPathEffect(floatArrayOf(5f * scale, 4f * scale), 0f)
        canvas.drawLine(chartLeft, lastY, chartRight, lastY, paint)
        paint.pathEffect = null

        paint.style = Paint.Style.FILL
        paint.textAlign = Paint.Align.RIGHT
        paint.color = muted
        paint.textSize = 9f * scale
        for (step in 0..2) {
            val price = maxPrice - (maxPrice - minPrice) * step / 2.0
            val y = yOf(price)
            canvas.drawText(formatPrice(price), width - pad, y + 3f * scale, paint)
        }

        paint.color = if (last.close >= last.open) priceUp else priceDown
        val label = formatPrice(last.close)
        paint.textSize = 10f * scale
        val labelWidth = paint.measureText(label) + 8f * scale
        val pill = RectF(width - pad - labelWidth, lastY - 8f * scale, width - pad, lastY + 8f * scale)
        canvas.drawRoundRect(pill, 3f * scale, 3f * scale, paint)
        paint.color = background
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText(label, pill.centerX(), pill.centerY() + 3.5f * scale, paint)

        paint.textAlign = Paint.Align.LEFT
        paint.color = sma5Color
        paint.textSize = 9f * scale
        val sma5Value = sma5.lastOrNull { it != null }
        val sma200Value = sma200.lastOrNull { it != null }
        canvas.drawText(
            "SMA 5  ${sma5Value?.let { formatPrice(it) } ?: "—"}",
            chartLeft,
            chartTop + 11f * scale,
            paint,
        )
        paint.color = sma200Color
        canvas.drawText(
            "SMA 200  ${sma200Value?.let { formatPrice(it) } ?: "—"}",
            chartLeft,
            chartTop + 23f * scale,
            paint,
        )

        paint.color = muted
        paint.textSize = 9f * scale
        val times = listOf(view.first().time, view[view.size / 2].time, view.last().time)
        val positions = listOf(chartLeft, (chartLeft + chartRight) / 2f, chartRight)
        val aligns = listOf(Paint.Align.LEFT, Paint.Align.CENTER, Paint.Align.RIGHT)
        for (index in times.indices) {
            paint.textAlign = aligns[index]
            canvas.drawText(formatTime(times[index], interval), positions[index], height - 5f * scale, paint)
        }

        drawHeader(canvas, paint, width, scale, pad, symbol, interval, last.close, dayOpen)
        return bitmap
    }

    private fun drawHeader(
        canvas: Canvas,
        paint: Paint,
        width: Int,
        scale: Float,
        pad: Float,
        symbol: String,
        interval: String,
        close: Double,
        dayOpen: Double?,
    ) {
        val centerY = 18f * scale
        paint.style = Paint.Style.FILL
        paint.color = Markets.accent(symbol)
        canvas.drawCircle(pad + 4f * scale, centerY, 4f * scale, paint)
        paint.color = Color.parseColor("#E6EBF2")
        paint.textAlign = Paint.Align.LEFT
        paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        paint.textSize = 12f * scale
        canvas.drawText(Markets.pretty(symbol), pad + 14f * scale, centerY + 4f * scale, paint)

        val up = dayOpen != null && close >= dayOpen
        val down = dayOpen != null && close < dayOpen
        paint.color = when {
            up -> priceUp
            down -> priceDown
            else -> Color.WHITE
        }
        paint.textSize = 12f * scale
        val price = formatPrice(close)
        val priceX = pad + 14f * scale + paint.measureText(Markets.pretty(symbol)) + 8f * scale
        canvas.drawText(price, priceX, centerY + 4f * scale, paint)
        val priceWidth = paint.measureText(price)
        if (dayOpen != null && dayOpen != 0.0) {
            val pct = (close - dayOpen) / dayOpen * 100.0
            paint.textSize = 11f * scale
            canvas.drawText(
                String.format(Locale.US, "%+.2f%%", pct),
                priceX + priceWidth + 6f * scale,
                centerY + 4f * scale,
                paint,
            )
        }
        paint.typeface = Typeface.DEFAULT
        paint.color = muted
        paint.textAlign = Paint.Align.RIGHT
        paint.textSize = 11f * scale
        canvas.drawText(interval, width - pad, centerY + 4f * scale, paint)
    }

    private fun drawSma(
        canvas: Canvas,
        paint: Paint,
        view: List<Candle>,
        series: List<Double?>,
        start: Int,
        chartLeft: Float,
        chartRight: Float,
        color: Int,
        yOf: (Double) -> Float,
    ) {
        val path = Path()
        var drawing = false
        val slot = (chartRight - chartLeft) / view.size
        for (index in view.indices) {
            val value = series[start + index] ?: continue
            val x = chartLeft + slot * index + slot / 2f
            val y = yOf(value)
            if (!drawing) {
                path.moveTo(x, y)
                drawing = true
            } else {
                path.lineTo(x, y)
            }
        }
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = color
        canvas.drawPath(path, paint)
    }

    private fun sma(candles: List<Candle>, period: Int): List<Double?> {
        val values = ArrayList<Double?>(candles.size)
        var sum = 0.0
        for (index in candles.indices) {
            sum += candles[index].close
            if (index >= period) sum -= candles[index - period].close
            values.add(if (index >= period - 1) sum / period else null)
        }
        return values
    }

    private fun formatPrice(value: Double): String {
        val digits = when {
            abs(value) >= 1000 -> 2
            abs(value) >= 1 -> 4
            else -> 6
        }
        return String.format(Locale.US, "%,.${digits}f", value)
    }

    private fun formatTime(epochSeconds: Long, interval: String): String {
        val pattern = if (interval == "1d" || interval == "4h" || interval == "2h") "d MMM" else "HH:mm"
        val format = SimpleDateFormat(pattern, Locale("th", "TH"))
        format.timeZone = zone
        return format.format(Date(epochSeconds * 1000L))
    }
}
