package crypto.monitor.widgets

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class RefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        return try {
            WidgetUpdater.updateAll(applicationContext)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
