import ExpoModulesCore
import Darwin
import Foundation

struct DlnaDevice {
    let id: String
    let name: String
    let location: URL
    var controlURLs: [String: String] = [:] // serviceType -> controlURL
}

public class ExpoDlnaCastModule: Module {
    private var discoveredDevices: [String: DlnaDevice] = [:]
    private var renderer: DlnaDevice?
    private var discoveryCancelled = false
    private let deviceLock = DispatchQueue(label: "expo.dlnacast.deviceLock")

    private func withDevices<T>(_ body: (inout [String: DlnaDevice]) -> T) -> T {
        deviceLock.sync {
            body(&discoveredDevices)
        }
    }

    public func definition() -> ModuleDefinition {
        Name("ExpoDlnaCast")

        Events("onDeviceFound", "onDeviceLost", "onPlaybackStateChanged")

        AsyncFunction("searchDevices") { (timeoutMs: Double) -> [[String: Any]] in
            self.withDevices { $0.removeAll() }
            self.discoveryCancelled = false
            self.startDiscovery()
            let waitMs = max(timeoutMs, 1500)
            try await Task.sleep(nanoseconds: UInt64(waitMs * 1_000_000))
            self.stopDiscovery()
            return self.withDevices { $0.values.map { $0.toDict() } }
        }

        AsyncFunction("connect") { (deviceId: String) -> Bool in
            let device = self.withDevices { $0[deviceId] }
            guard let device else { return false }
            self.renderer = device
            return true
        }

        AsyncFunction("disconnect") { (deviceId: String) in
            self.renderer = nil
        }

        AsyncFunction("cast") { (deviceId: String, url: String, title: String, startPositionMs: Double) -> Bool in
            let device = self.withDevices { $0[deviceId] }
            guard let device else { return false }
            self.renderer = device
            do {
                try await self.setAVTransportURI(device: device, uri: url, meta: title)
                try await self.sendTransportAction(device: device, action: "Play", args: [("Speed", "1")])
                if startPositionMs > 0 {
                    try await self.seekTo(device: device, positionMs: startPositionMs)
                }
                return true
            } catch {
                return false
            }
        }

        AsyncFunction("play") { (deviceId: String) in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else { return }
            try? await self.sendTransportAction(device: device, action: "Play", args: [("Speed", "1")])
        }

        AsyncFunction("pause") { (deviceId: String) in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else { return }
            try? await self.sendTransportAction(device: device, action: "Pause", args: [])
        }

        AsyncFunction("stop") { (deviceId: String) in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else { return }
            try? await self.sendTransportAction(device: device, action: "Stop", args: [])
        }

        AsyncFunction("seek") { (deviceId: String, positionMs: Double) in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else { return }
            try? await self.seekTo(device: device, positionMs: positionMs)
        }

        AsyncFunction("getPosition") { (deviceId: String) -> [String: Any] in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else {
                return ["currentTime": 0.0, "duration": 0.0]
            }
            do {
                let xml = try await self.sendAction(device: device, service: "AVTransport", action: "GetPositionInfo", args: [("InstanceID", "0")])
                let ct = self.extractText(xml, tag: "RelTime") ?? "0"
                let dt = self.extractText(xml, tag: "TrackDuration") ?? "0"
                return ["currentTime": self.parseDuration(ct), "duration": self.parseDuration(dt)]
            } catch {
                return ["currentTime": 0.0, "duration": 0.0]
            }
        }

        AsyncFunction("getPlaybackState") { (deviceId: String) -> String in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else { return "NO_MEDIA_PRESENT" }
            do {
                let xml = try await self.sendAction(device: device, service: "AVTransport", action: "GetTransportInfo", args: [("InstanceID", "0")])
                return self.extractText(xml, tag: "CurrentTransportState") ?? "NO_MEDIA_PRESENT"
            } catch {
                return "NO_MEDIA_PRESENT"
            }
        }

        AsyncFunction("setVolume") { (deviceId: String, volume: Double) in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else { return }
            let v = max(0, min(100, Int(volume)))
            try? await self.sendAction(device: device, service: "RenderingControl", action: "SetVolume", args: [("InstanceID", "0"), ("Channel", "Master"), ("DesiredVolume", String(v))])
        }

        AsyncFunction("getVolume") { (deviceId: String) -> Double in
            let device = self.withDevices { $0[deviceId] } ?? self.renderer
            guard let device else { return 0.0 }
            do {
                let xml = try await self.sendAction(device: device, service: "RenderingControl", action: "GetVolume", args: [("InstanceID", "0"), ("Channel", "Master")])
                return Double(self.extractText(xml, tag: "CurrentVolume") ?? "0") ?? 0.0
            } catch {
                return 0.0
            }
        }
    }

    // MARK: - SSDP Discovery

    private func startDiscovery() {
        // Run SSDP M-SEARCH + response collection on a background thread.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.runSSDPDiscovery()
        }
    }

    private func stopDiscovery() {
        discoveryCancelled = true
    }

    private func runSSDPDiscovery() {
        var hints = addrinfo(
            ai_flags: AI_PASSIVE, ai_family: AF_UNSPEC, ai_socktype: SOCK_DGRAM,
            ai_protocol: 0, ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil
        )
        var res: UnsafeMutablePointer<addrinfo>?
        let lookup = getaddrinfo("239.255.255.250", "1900", &hints, &res)
        guard lookup == 0, let addrList = res else {
            return
        }

        let fd = socket(addrList.pointee.ai_family, addrList.pointee.ai_socktype, addrList.pointee.ai_protocol)
        guard fd >= 0 else {
            freeaddrinfo(addrList)
            return
        }

        // Allow sending to broadcast/multicast
        var broadcast: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &broadcast, socklen_t(MemoryLayout<Int32>.size))

        let message =
            "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: 239.255.255.250:1900\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 2\r\n" +
            "ST: upnp:rootdevice\r\n\r\n"

        _ = message.withCString { cstr in
            sendto(fd, cstr, message.utf8.count, 0, addrList.pointee.ai_addr, addrList.pointee.ai_addrlen)
        }
        freeaddrinfo(addrList)

        // Set receive timeout
        var tv = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var buffer = [UInt8](repeating: 0, count: 65536)
        while !discoveryCancelled {
            let n = recv(fd, &buffer, buffer.count, 0)
            if n > 0 {
                let data = Data(buffer[0..<n])
                if let response = String(data: data, encoding: .utf8) {
                    parseSSDPResponse(response)
                }
            } else if n == 0 {
                break
            } else {
                // EAGAIN (timeout) — continue; otherwise stop
                let err = errno
                if err != EAGAIN && err != EWOULDBLOCK {
                    break
                }
            }
        }
        close(fd)
    }

    private func parseSSDPResponse(_ response: String) {
        let lines = response.components(separatedBy: "\r\n")
        var location: String?
        for line in lines {
            let parts = line.split(separator: ":", maxSplits: 1).map { String($0).trimmingCharacters(in: .whitespaces) }
            if parts.count == 2 && parts[0].lowercased() == "location" {
                location = parts[1]
                break
            }
        }
        guard let location, let url = URL(string: location), !location.isEmpty else { return }
        // Parse the device's unique ID from the response if present (ST/USN), otherwise use location.
        var udn: String?
        for line in lines {
            let parts = line.split(separator: ":", maxSplits: 1).map { String($0).trimmingCharacters(in: .whitespaces) }
            if parts.count == 2 && parts[0].lowercased() == "usn" {
                let usn = parts[1]
                if let range = usn.range(of: "uuid:[^:\\s]*", options: .regularExpression) {
                    udn = String(usn[range])
                }
                break
            }
        }
        Task {
            await self.loadDeviceDescription(url: url, udn: udn)
        }
    }

    private func loadDeviceDescription(url: URL, udn: String?) async {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let xml = String(data: data, encoding: .utf8) ?? ""
            let name = extractText(xml, tag: "friendlyName") ?? "DLNA Device"
            let id = udn ?? extractText(xml, tag: "UDN") ?? url.absoluteString

            // Find AVTransport and RenderingControl service control URLs (relative to base)
            let avURL = extractControlURL(xml, serviceType: "urn:schemas-upnp-org:service:AVTransport")
            let rcURL = extractControlURL(xml, serviceType: "urn:schemas-upnp-org:service:RenderingControl")

            let device = DlnaDevice(
                id: id,
                name: name,
                location: url,
                controlURLs: [
                    "AVTransport": avURL,
                    "RenderingControl": rcURL,
                ]
            )
            self.withDevices { $0[id] = device }
            self.sendEvent("onDeviceFound", device.toDict())
        } catch {
            // ignore
        }
    }

    private func extractControlURL(_ xml: String, serviceType: String) -> String {
        // Parse <service> blocks, find matching serviceType, and extract <controlURL>
        let serviceBlocks = xml.components(separatedBy: "<service>")
        for block in serviceBlocks.dropFirst() {
            if block.contains(serviceType) {
                if let range = block.range(of: "<controlURL>(.*?)</controlURL>", options: .regularExpression) {
                    let control = String(block[range])
                        .replacingOccurrences(of: "<controlURL>", with: "")
                        .replacingOccurrences(of: "</controlURL>", with: "")
                    return control
                }
            }
        }
        return ""
    }

    // MARK: - SOAP Actions

    private func setAVTransportURI(device: DlnaDevice, uri: String, meta: String) async throws {
        try await sendAction(device: device, service: "AVTransport", action: "SetAVTransportURI", args: [
            ("InstanceID", "0"),
            ("CurrentURI", uri),
            ("CurrentURIMetaData", meta),
        ])
    }

    private func sendTransportAction(device: DlnaDevice, action: String, args: [(String, String)]) async throws {
        try await sendAction(device: device, service: "AVTransport", action: action, args: [("InstanceID", "0")] + args)
    }

    private func sendAction(device: DlnaDevice, service: String, action: String, args: [(String, String)]) async throws -> String {
        guard let controlPath = device.controlURLs[service], !controlPath.isEmpty else { throw NSError(domain: "DLNA", code: -1) }
        let controlURL: URL
        if controlPath.hasPrefix("http") {
            controlURL = URL(string: controlPath)!
        } else {
            controlURL = device.location.deletingLastPathComponent().appendingPathComponent(controlPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        }

        let bodyArgs = args.map { "<\($0.0)>\(escapeXml($0.1))</\($0.0)>" }.joined()
        let soapBody = """
        <?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
          <s:Body>
            <u:\(action) xmlns:u="urn:schemas-upnp-org:service:\(service):1">
              \(bodyArgs)
            </u:\(action)>
          </s:Body>
        </s:Envelope>
        """

        var request = URLRequest(url: controlURL)
        request.httpMethod = "POST"
        request.setValue("text/xml; charset=\"utf-8\"", forHTTPHeaderField: "Content-Type")
        request.setValue("\"urn:schemas-upnp-org:service:\(service):1#\(action)\"", forHTTPHeaderField: "SOAPAction")
        request.httpBody = soapBody.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            return NSString(data: data, encoding: String.Encoding.utf8.rawValue) as String? ?? ""
        }
        return String(data: data, encoding: .utf8) ?? ""
    }

    private func escapeXml(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "<", with: "&lt;")
         .replacingOccurrences(of: ">", with: "&gt;")
    }

    // MARK: - XML Helpers

    private func extractText(_ xml: String, tag: String) -> String? {
        guard let range = xml.range(of: "<\(tag)>(.*?)</\(tag)>", options: .regularExpression) else { return nil }
        let inner = String(xml[range])
            .replacingOccurrences(of: "<\(tag)>", with: "")
            .replacingOccurrences(of: "</\(tag)>", with: "")
        return inner.isEmpty ? nil : inner
    }

    private func parseDuration(_ duration: String) -> Double {
        let parts = duration.split(separator: ":").compactMap { Double($0) }
        if parts.count == 3 {
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        } else if parts.count == 2 {
            return parts[0] * 60 + parts[1]
        }
        return Double(duration) ?? 0
    }

    private func seekTo(device: DlnaDevice, positionMs: Double) async throws {
        let secs = Int(positionMs / 1000)
        let h = secs / 3600
        let m = (secs % 3600) / 60
        let s = secs % 60
        let target = String(format: "%02d:%02d:%02d", h, m, s)
        try await self.sendTransportAction(device: device, action: "Seek", args: [("Unit", "REL_TIME"), ("Target", target)])
    }
}

private extension DlnaDevice {
    func toDict() -> [String: Any] {
        ["id": id, "name": name, "address": location.absoluteString, "type": "DLNA", "isTV": true]
    }
}
