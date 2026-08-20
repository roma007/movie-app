package expo.modules.dlnacast

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoDlnaCastModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ExpoDlnaCast")

        Events("onDeviceFound", "onDeviceLost", "onPlaybackStateChanged")

        AsyncFunction("searchDevices") { timeoutMs: Long ->
            // TODO: Integrate UPnPCast library for SSDP device discovery
            // val discovery = UPnPCast.Discovery(appContext.reactContext)
            // discovery.start(timeoutMs) { device -> sendEvent("onDeviceFound", device) }
            emptyList<Map<String, Any?>>()
        }

        AsyncFunction("connect") { deviceId: String ->
            // TODO: Connect to DLNA renderer
            true
        }

        AsyncFunction("disconnect") { deviceId: String ->
            // TODO: Disconnect from DLNA renderer
        }

        AsyncFunction("cast") { deviceId: String, url: String, title: String ->
            // TODO: SetAVTransportURI + Play
            true
        }

        AsyncFunction("play") { deviceId: String ->
            // TODO: AVTransport Play
        }

        AsyncFunction("pause") { deviceId: String ->
            // TODO: AVTransport Pause
        }

        AsyncFunction("stop") { deviceId: String ->
            // TODO: AVTransport Stop
        }

        AsyncFunction("seek") { deviceId: String, positionMs: Long ->
            // TODO: AVTransport Seek (convert ms to HH:MM:SS format)
        }

        AsyncFunction("getPosition") { deviceId: String ->
            // TODO: AVTransport GetPositionInfo
            mapOf(
                "currentTime" to 0.0,
                "duration" to 0.0
            )
        }

        AsyncFunction("getPlaybackState") { deviceId: String ->
            // TODO: AVTransport GetTransportInfo
            "NO_MEDIA_PRESENT"
        }

        AsyncFunction("setVolume") { deviceId: String, volume: Double ->
            // TODO: RenderingControl SetVolume
        }

        AsyncFunction("getVolume") { deviceId: String ->
            // TODO: RenderingControl GetVolume
            0.0
        }
    }
}
