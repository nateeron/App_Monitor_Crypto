package crypto.monitor.widgets

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView

class MainActivity : Activity() {
    private var loadGeneration = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }

    override fun onResume() {
        super.onResume()
        loadCharts()
    }

    private fun loadCharts() {
        val generation = ++loadGeneration
        val status = findViewById<TextView>(R.id.status)
        val xrpView = findViewById<ImageView>(R.id.xrpChart)
        val btcView = findViewById<ImageView>(R.id.btcChart)
        status.setText(R.string.loading)
        xrpView.post {
            val width = xrpView.width.coerceAtLeast(320)
            val height = (width * 0.72f).toInt()
            Thread {
                try {
                    val xrp = chart("XRPUSDT", width, height)
                    val btc = chart("BTCUSDT", width, height)
                    if (generation != loadGeneration || isDestroyed) return@Thread
                    runOnUiThread {
                        if (generation != loadGeneration) return@runOnUiThread
                        xrpView.setImageBitmap(xrp)
                        btcView.setImageBitmap(btc)
                        status.visibility = View.GONE
                    }
                } catch (_: Exception) {
                    if (generation != loadGeneration || isDestroyed) return@Thread
                    runOnUiThread {
                        status.setText(R.string.load_failed)
                    }
                }
            }.start()
        }
    }

    private fun chart(symbol: String, width: Int, height: Int) = ChartBitmap.render(
        width,
        height,
        symbol,
        "15m",
        Binance.klines(symbol, "15m", 250),
        runCatching { Binance.klines(symbol, "1d", 1).lastOrNull()?.open }.getOrNull(),
    )
}
