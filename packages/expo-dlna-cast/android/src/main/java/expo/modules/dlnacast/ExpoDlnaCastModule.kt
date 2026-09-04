package expo.modules.dlnacast

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.yinnho.upnpcast.DLNACast
import com.yinnho.upnpcast.DLNACast.Device
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class ExpoDlnaCastModule : Module() {
    private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val activeDevices = mutableMapOf<String, Device>()

    override fun definition() = ModuleDefinition {
        Name("ExpoDlnaCast")

        Events("onDeviceFound", "onDeviceLost", "onPlaybackStateChanged")

        AsyncFunction("searchDevices") { timeoutMs: Long ->
            val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
            DLNACast.init(context)
            val devices = runBlocking {
                withTimeoutOrNull(if (timeoutMs > 0) timeoutMs else 5000L) {
                    DLNACast.search(timeout = if (timeoutMs > 0) timeoutMs else 5000L)
                } ?: emptyList()
            }

            devices.map { device ->
                activeDevices[device.address] = device
                mapOf(
                    "id" to device.address,
                    "name" to device.name,
                    "address" to device.address,
                    "type" to "DLNA",
                    "isTV" to device.isTV
                )
            }
        }

        AsyncFunction("connect") { deviceId: String ->
            activeDevices[deviceId] != null
        }

        AsyncFunction("disconnect") { deviceId: String ->
            activeDevices.remove(deviceId)
            moduleScope.launch {
                try {
                    DLNACast.stop()
                } catch (e: Exception) {
                    // ignore
                }
            }
        }

        AsyncFunction("cast") { deviceId: String, url: String, title: String, startPositionMs: Long? ->
            val device = activeDevices[deviceId]
            if (device == null) {
                false
            } else {
                try {
                    val ok = runBlocking { DLNACast.castToDevice(device, url, title) }
                    if (ok && startPositionMs != null && startPositionMs > 0) {
                        runBlocking { DLNACast.seek(startPositionMs) }
                    }
                    ok
                } catch (e: Exception) {
                    false
                }
            }
        }

        AsyncFunction("play") { deviceId: String ->
            moduleScope.launch {
                try {
                    DLNACast.play()
                    sendEvent("onPlaybackStateChanged", mapOf("state" to "PLAYING"))
                } catch (e: Exception) {
                    // ignore
                }
            }
        }

        AsyncFunction("pause") { deviceId: String ->
            moduleScope.launch {
                try {
                    DLNACast.pause()
                    sendEvent("onPlaybackStateChanged", mapOf("state" to "PAUSED"))
                } catch (e: Exception) {
                    // ignore
                }
            }
        }

        AsyncFunction("stop") { deviceId: String ->
            moduleScope.launch {
                try {
                    DLNACast.stop()
                    sendEvent("onPlaybackStateChanged", mapOf("state" to "STOPPED"))
                } catch (e: Exception) {
                    // ignore
                }
            }
        }

        AsyncFunction("seek") { deviceId: String, positionMs: Long ->
            moduleScope.launch {
                try {
                    DLNACast.seek(positionMs)
                } catch (e: Exception) {
                    // ignore
                }
            }
        }

        AsyncFunction("getPosition") { deviceId: String ->
            try {
                val progress = runBlocking { DLNACast.getProgressRealtime() }
                mapOf(
                    "currentTime" to ((progress?.first ?: 0L) / 1000.0),
                    "duration" to ((progress?.second ?: 0L) / 1000.0)
                )
            } catch (e: Exception) {
                mapOf("currentTime" to 0.0, "duration" to 0.0)
            }
        }

        AsyncFunction("getPlaybackState") { deviceId: String ->
            val state = DLNACast.getState()
            when (state.playbackState) {
                DLNACast.PlaybackState.PLAYING, DLNACast.PlaybackState.BUFFERING -> "PLAYING"
                DLNACast.PlaybackState.PAUSED -> "PAUSED"
                DLNACast.PlaybackState.ERROR -> "ERROR"
                else -> "STOPPED"
            }
        }

        AsyncFunction("setVolume") { deviceId: String, volume: Double ->
            moduleScope.launch {
                try {
                    DLNACast.setVolume(volume.toInt().coerceIn(0, 100))
                } catch (e: Exception) {
                    // ignore
                }
            }
        }

        AsyncFunction("getVolume") { deviceId: String ->
            try {
                val result = runBlocking { DLNACast.getVolume() }
                (result?.first ?: 0).toDouble()
            } catch (e: Exception) {
                0.0
            }
        }
    }
}
