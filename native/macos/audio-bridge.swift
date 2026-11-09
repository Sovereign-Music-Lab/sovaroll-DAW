// Experimental SovaRoll native audio-file preview sidecar. No GUI integration yet.
import Foundation
import AVFoundation
import CryptoKit

struct AudioError: Error { let code: String; let message: String }
func fail(_ code: String, _ message: String) throws -> Never { throw AudioError(code: code, message: message) }
let outputLock = NSLock()
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
}
func ascii(_ data: Data, _ at: Int, _ count: Int) -> String {
    return String(data: data.subdata(in: at..<at+count), encoding: .ascii) ?? ""
}
func u16(_ data: Data, _ at: Int) -> Int { return Int(data[at]) | Int(data[at+1]) << 8 }
func u32(_ data: Data, _ at: Int) -> UInt32 {
    return UInt32(data[at]) | UInt32(data[at+1]) << 8 | UInt32(data[at+2]) << 16 | UInt32(data[at+3]) << 24
}
struct WaveInput {
    let sampleRate: Int, channels: Int, frames: Int, pcm: Data, format: AVAudioFormat
}
func readWave(_ path: String) throws -> WaveInput {
    guard !path.isEmpty, path.hasPrefix("/"), !path.contains("\0") else { try fail("INVALID_PATH", "Use an absolute local WAV path") }
    let data: Data
    do { data = try Data(contentsOf: URL(fileURLWithPath: path), options: [.mappedIfSafe]) }
    catch { throw AudioError(code: "WAV_NOT_READABLE", message: "Cannot read WAV: \(error.localizedDescription)") }
    guard data.count >= 44, ascii(data, 0, 4) == "RIFF", ascii(data, 8, 4) == "WAVE" else { try fail("INVALID_WAV", "Expected RIFF/WAVE") }
    var at = 12, channels = 0, sampleRate = 0, bits = 0, blockAlign = 0, pcm: Data? = nil
    while at + 8 <= data.count {
        let size = Int(u32(data, at + 4)); let end = at + 8 + size
        guard size >= 0, end <= data.count else { try fail("INVALID_WAV", "Truncated WAV chunk") }
        let kind = ascii(data, at, 4)
        if kind == "fmt " {
            guard size >= 16, u16(data, at + 8) == 1 else { try fail("UNSUPPORTED_WAV", "Only PCM integer WAV is supported") }
            channels = u16(data, at + 10); sampleRate = Int(u32(data, at + 12)); bits = u16(data, at + 22); blockAlign = u16(data, at + 20)
            guard [1, 2].contains(channels), sampleRate >= 1 && sampleRate <= 96000, bits == 16, blockAlign == channels * 2 else { try fail("UNSUPPORTED_WAV", "Use mono/stereo PCM16 at 1..96000 Hz") }
            guard Int(u32(data, at + 16)) == sampleRate * blockAlign else { try fail("INVALID_WAV", "Invalid WAV byte rate") }
        } else if kind == "data" {
            if pcm != nil { try fail("UNSUPPORTED_WAV", "Multiple data chunks are not supported") }
            pcm = data.subdata(in: at + 8..<end)
        }
        at = end + (size % 2)
    }
    guard let pcm, blockAlign > 0, pcm.count % blockAlign == 0 else { try fail("INVALID_WAV", "Missing or misaligned PCM data") }
    let frames = pcm.count / blockAlign
    guard frames > 0, frames <= sampleRate * 600 else { try fail("WAV_LIMIT", "Audio preview is limited to 600 seconds") }
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: AVAudioChannelCount(channels), interleaved: false) else { try fail("INVALID_WAV", "Cannot create audio format") }
    return WaveInput(sampleRate: sampleRate, channels: channels, frames: frames, pcm: pcm, format: format)
}
func samples(_ wave: WaveInput) throws -> AVAudioPCMBuffer {
    guard let buffer = AVAudioPCMBuffer(pcmFormat: wave.format, frameCapacity: AVAudioFrameCount(wave.frames)) else { throw AudioError(code: "AUDIO_BUFFER_FAILED", message: "Cannot allocate audio buffer") }
    buffer.frameLength = AVAudioFrameCount(wave.frames)
    for channel in 0..<wave.channels {
        guard let output = buffer.floatChannelData?[channel] else { try fail("AUDIO_BUFFER_FAILED", "Missing channel buffer") }
        for frame in 0..<wave.frames {
            let at = (frame * wave.channels + channel) * 2
            let value = Int16(bitPattern: UInt16(u16(wave.pcm, at)))
            output[frame] = Float(value) / (value < 0 ? 32768.0 : 32767.0)
        }
    }
    return buffer
}
func pcmBytes(_ buffer: AVAudioPCMBuffer, channels: Int) -> Data {
    let frames = Int(buffer.frameLength); var data = Data(); data.reserveCapacity(frames * channels * 2)
    for frame in 0..<frames { for channel in 0..<channels {
        let value = buffer.floatChannelData![channel][frame]
        let scaled = Int((max(-1, min(1, value)) * (value < 0 ? 32768 : 32767)).rounded())
        let bits = UInt16(bitPattern: Int16(scaled)); data.append(UInt8(bits & 255)); data.append(UInt8(bits >> 8))
    } }
    return data
}
struct ActiveAudio {
    let id: String, engine: AVAudioEngine, player: AVAudioPlayerNode, wave: WaveInput, startAtUptimeNs: UInt64?
    init(id: String, engine: AVAudioEngine, player: AVAudioPlayerNode, wave: WaveInput, startAtUptimeNs: UInt64? = nil) { self.id = id; self.engine = engine; self.player = player; self.wave = wave; self.startAtUptimeNs = startAtUptimeNs }
}
var active: ActiveAudio? = nil
var scheduledAudioStart: DispatchWorkItem? = nil
var lastStatus = "idle"
var lastJob: String? = nil
func stopAudio() {
    guard let current = active else { return }
    scheduledAudioStart?.cancel(); scheduledAudioStart = nil
    current.player.stop(); current.engine.stop(); active = nil; lastStatus = "stopped"; lastJob = current.id
    emit(["event": "stopped", "jobId": current.id, "status": lastStatus])
}
func completeAudio(_ id: String, _ metadata: [String: Any] = [:]) {
    guard active?.id == id else { return }
    scheduledAudioStart?.cancel(); scheduledAudioStart = nil
    active?.player.stop(); active?.engine.stop(); active = nil; lastStatus = "completed"; lastJob = id
    emit(metadata.merging(["event": "completed", "jobId": id, "status": lastStatus]) { _, new in new })
}
func renderOffline(_ current: ActiveAudio) throws {
    let engine = current.engine, player = current.player
    try engine.enableManualRenderingMode(.offline, format: current.wave.format, maximumFrameCount: AVAudioFrameCount(current.wave.frames))
    let buffer = try samples(current.wave)
    player.scheduleBuffer(buffer, at: nil, options: [])
    try engine.start(); player.play()
    guard let output = AVAudioPCMBuffer(pcmFormat: current.wave.format, frameCapacity: AVAudioFrameCount(current.wave.frames)) else { try fail("AUDIO_BUFFER_FAILED", "Cannot allocate offline output") }
    let status = try engine.renderOffline(AVAudioFrameCount(current.wave.frames), to: output)
    guard status == .success, output.frameLength == buffer.frameLength else { try fail("OFFLINE_RENDER_FAILED", "AVAudioEngine offline render did not produce the expected frames: \(status.rawValue)") }
    let rendered = pcmBytes(output, channels: current.wave.channels)
    let digest = SHA256.hash(data: rendered).map { String(format: "%02x", $0) }.joined()
    completeAudio(current.id, ["frames": current.wave.frames, "sampleRate": current.wave.sampleRate, "channels": current.wave.channels, "pcmSha256": digest, "offline": true])
}
func playAudio(_ path: String, offline: Bool, allowDefaultOutput: Bool, startAtUptimeNs: UInt64? = nil) throws {
    guard active == nil else { try fail("ALREADY_PLAYING", "Stop the current native audio preview first") }
    if !offline && !allowDefaultOutput { throw AudioError(code: "OUTPUT_REQUIRED", message: "Native device playback requires explicit allowDefaultOutput=true") }
    if offline && startAtUptimeNs != nil { throw AudioError(code: "START_AT_OFFLINE", message: "Scheduled host-time start is only available for device playback") }
    if let target = startAtUptimeNs { let now = DispatchTime.now().uptimeNanoseconds; guard target >= now && target <= now + 60_000_000_000 else { throw AudioError(code: "INVALID_START_TIME", message: "startAtUptimeNs must be between now and 60 seconds in the future") } }
    let wave = try readWave(path)
    let engine = AVAudioEngine(), player = AVAudioPlayerNode(); engine.attach(player); engine.connect(player, to: engine.mainMixerNode, format: wave.format)
    let id = UUID().uuidString
    active = ActiveAudio(id: id, engine: engine, player: player, wave: wave, startAtUptimeNs: startAtUptimeNs); lastStatus = "playing"; lastJob = id
    emit(["event": "playing", "jobId": id, "status": lastStatus, "offline": offline, "startedUptimeNs": startAtUptimeNs == nil ? NSNull() : String(startAtUptimeNs!)])
    if offline {
        do { try renderOffline(ActiveAudio(id: id, engine: engine, player: player, wave: wave)) }
        catch { if active?.id == id { active = nil; lastStatus = "failed"; lastJob = id }; throw error }
    } else {
        do {
            let buffer = try samples(wave)
            try engine.start()
            player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: { DispatchQueue.main.async { completeAudio(id) } })
            if let target = startAtUptimeNs {
                let start = DispatchWorkItem {
                    guard active?.id == id else { return }
                    scheduledAudioStart = nil; player.play(); lastStatus = "playing"
                    emit(["event": "started", "jobId": id, "status": "playing", "actualStartUptimeNs": String(DispatchTime.now().uptimeNanoseconds)])
                }
                scheduledAudioStart = start; DispatchQueue.main.asyncAfter(deadline: DispatchTime(uptimeNanoseconds: target), execute: start)
            } else { player.play() }
        } catch { active = nil; lastStatus = "failed"; lastJob = id; throw error }
    }
}
func boolValue(_ value: Any?, _ name: String) throws -> Bool {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { try fail("INVALID_REQUEST", "\(name) must be boolean") }
    return number.boolValue
}
func handle(_ object: [String: Any]) throws {
    guard let command = object["command"] as? String else { try fail("INVALID_REQUEST", "Missing command") }
    if command == "play" {
        guard Set(object.keys).isSubset(of: ["command", "path", "offline", "allowDefaultOutput", "startAtUptimeNs"]) else { try fail("INVALID_REQUEST", "Unknown play fields") }
        guard let path = object["path"] as? String else { try fail("INVALID_PATH", "Missing WAV path") }
        let offline = try object["offline"] == nil ? false : boolValue(object["offline"], "offline")
        let allowDefaultOutput = try object["allowDefaultOutput"] == nil ? false : boolValue(object["allowDefaultOutput"], "allowDefaultOutput")
        var startAtUptimeNs: UInt64? = nil
        if object["startAtUptimeNs"] != nil { guard let value = object["startAtUptimeNs"] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite, value.doubleValue.rounded() == value.doubleValue, value.doubleValue >= 0 else { throw AudioError(code: "INVALID_START_TIME", message: "startAtUptimeNs must be a nonnegative integer") }; startAtUptimeNs = value.uint64Value }
        try playAudio(path, offline: offline, allowDefaultOutput: allowDefaultOutput, startAtUptimeNs: startAtUptimeNs)
    } else if command == "clock.now" {
        guard Set(object.keys) == ["command"] else { throw AudioError(code: "INVALID_REQUEST", message: "Unknown clock fields") }
        emit(["event": "clock", "uptimeNs": String(DispatchTime.now().uptimeNanoseconds)])
    } else if command == "stop" {
        guard Set(object.keys) == ["command"] else { try fail("INVALID_REQUEST", "Unknown stop fields") }
        if active == nil { emit(["event": "stopped", "status": "unchanged"]) } else { stopAudio() }
    } else if command == "status" {
        guard Set(object.keys) == ["command"] else { try fail("INVALID_REQUEST", "Unknown status fields") }
        emit(["event": "status", "status": lastStatus, "jobId": lastJob as Any, "playing": active != nil])
    } else if command == "quit" {
        stopAudio(); exit(0)
    } else { try fail("UNKNOWN_COMMAND", "Unsupported audio command: \(command)") }
}
emit(["event": "ready", "protocol": 1, "backend": "AVAudioEngine", "integrated": false])
var input = Data()
FileHandle.standardInput.readabilityHandler = { fileHandle in
    let bytes = fileHandle.availableData
    if bytes.isEmpty { stopAudio(); exit(0) }
    input.append(bytes)
    while let newline = input.firstIndex(of: 10) {
        let line = input.subdata(in: 0..<newline); input.removeSubrange(0...newline)
        DispatchQueue.main.async {
            do { let object = try JSONSerialization.jsonObject(with: line); guard let dictionary = object as? [String: Any] else { throw AudioError(code: "INVALID_JSON", message: "Expected a JSON object") }; try handle(dictionary) }
            catch { if let error = error as? AudioError { emit(["event": "error", "code": error.code, "message": error.message]) } else { emit(["event": "error", "code": "INVALID_JSON", "message": error.localizedDescription]) } }
        }
    }
}
RunLoop.main.run()
