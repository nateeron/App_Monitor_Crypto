package crypto.monitor.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner

class WidgetConfigureActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_configure)
        widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        val symbolSpinner = findViewById<Spinner>(R.id.symbolSpinner)
        val intervalSpinner = findViewById<Spinner>(R.id.intervalSpinner)
        symbolSpinner.adapter = adapter(Markets.symbols.map { it.second })
        intervalSpinner.adapter = adapter(Markets.intervals.map { it.second })

        val savedSymbol = WidgetPrefs.symbol(this, widgetId)
        val savedInterval = WidgetPrefs.interval(this, widgetId)
        symbolSpinner.setSelection(Markets.symbols.indexOfFirst { it.first == savedSymbol }.coerceAtLeast(0))
        intervalSpinner.setSelection(Markets.intervals.indexOfFirst { it.first == savedInterval }.coerceAtLeast(0))

        findViewById<Button>(R.id.saveButton).setOnClickListener {
            val symbol = Markets.symbols[symbolSpinner.selectedItemPosition].first
            val interval = Markets.intervals[intervalSpinner.selectedItemPosition].first
            WidgetPrefs.save(this, widgetId, symbol, interval)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
            val appContext = applicationContext
            val id = widgetId
            Thread { WidgetUpdater.update(appContext, id) }.start()
            finish()
        }
    }

    private fun adapter(labels: List<String>): ArrayAdapter<String> {
        return ArrayAdapter(this, R.layout.spinner_item, labels).also {
            it.setDropDownViewResource(R.layout.spinner_item)
        }
    }
}
