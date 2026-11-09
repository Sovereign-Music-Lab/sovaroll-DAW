// Audio Unit discovery and explicit offline instantiation probe. No automatic loading.
import Foundation
import AVFoundation
import CryptoKit

struct AudioUnitError: Error { let code: String; let message: String }
let outputLock = NSLock()
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
}
func unitID(_ component: AVAudioUnitComponent) -> String {
    let description = component.audioComponentDescription
    let identity = "\(description.componentType):\(description.componentSubType):\(description.componentManufacturer):\(component.manufacturerName):\(component.name):\(component.versionString)"
    return SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
}
func metadata(_ component: AVAudioUnitComponent) -> [String: Any] {
    let description = component.audioComponentDescription
    return ["id": unitID(component), "name": component.name, "manufacturer": component.manufacturerName,
            "type": description.componentType, "subtype": description.componentSubType, "manufacturerCode": description.componentManufacturer,
            "version": component.versionString, "sandboxSafe": component.isSandboxSafe,
            "midiInput": component.hasMIDIInput, "midiOutput": component.hasMIDIOutput, "instantiated": false]
}
var components: [AVAudioUnitComponent] = []
var selected: String? = nil
var instantiatedUnit: AVAudioUnit? = nil
func exactComponent(_ id: String) throws -> AVAudioUnitComponent {
    if components.isEmpty { _ = discover() }
    let matches = components.filter { unitID($0) == id }
    guard matches.count == 1 else {
        if matches.isEmpty { throw AudioUnitError(code: "AUDIO_UNIT_NOT_FOUND", message: "Audio Unit is not present in the current discovery list") }
        throw AudioUnitError(code: "AMBIGUOUS_AUDIO_UNIT", message: "Audio Unit identity is ambiguous; use a versioned hosting plan")
    }
    return matches[0]
}
func instantiate(_ id: String, offline: Bool) throws {
    guard offline else { throw AudioUnitError(code: "OFFLINE_REQUIRED", message: "This probe requires explicit offline=true") }
    guard instantiatedUnit == nil else { throw AudioUnitError(code: "INSTANCE_ACTIVE", message: "Release the current Audio Unit probe before starting another") }
    let component = try exactComponent(id)
    AVAudioUnit.instantiate(with: component.audioComponentDescription, options: []) { unit, error in
        DispatchQueue.main.async {
            if let error { emit(["event": "error", "code": "INSTANTIATION_FAILED", "message": error.localizedDescription]); return }
            guard let unit else { emit(["event": "error", "code": "INSTANTIATION_FAILED", "message": "Audio Unit returned no instance"]); return }
            instantiatedUnit = unit; selected = id
            let inputChannels = unit.numberOfInputs > 0 ? unit.inputFormat(forBus: 0).channelCount : 0
            let outputChannels = unit.numberOfOutputs > 0 ? unit.outputFormat(forBus: 0).channelCount : 0
            let sampleRate = unit.numberOfOutputs > 0 ? unit.outputFormat(forBus: 0).sampleRate : 0
            emit(["event": "instantiated", "component": metadata(component), "inputChannels": inputChannels, "outputChannels": outputChannels, "sampleRate": sampleRate, "offline": true])
        }
    }
}
struct AUWave { let sampleRate: Int, channels: Int, frames: Int, pcm: Data, format: AVAudioFormat }
func auASCII(_ data: Data, _ at: Int, _ count: Int) -> String { String(data: data.subdata(in: at..<at+count), encoding: .ascii) ?? "" }
func au16(_ data: Data, _ at: Int) -> Int { Int(data[at]) | Int(data[at+1]) << 8 }
func au32(_ data: Data, _ at: Int) -> UInt32 { UInt32(data[at]) | UInt32(data[at+1]) << 8 | UInt32(data[at+2]) << 16 | UInt32(data[at+3]) << 24 }
func readAUWave(_ path: String) throws -> AUWave {
    guard !path.isEmpty, path.hasPrefix("/"), !path.contains("\0") else { throw AudioUnitError(code: "INVALID_PATH", message: "Use an absolute local WAV path") }
    let data: Data
    do { data = try Data(contentsOf: URL(fileURLWithPath: path), options: [.mappedIfSafe]) } catch { throw AudioUnitError(code: "WAV_NOT_READABLE", message: "Cannot read WAV: \(error.localizedDescription)") }
    guard data.count >= 44, auASCII(data, 0, 4) == "RIFF", auASCII(data, 8, 4) == "WAVE" else { throw AudioUnitError(code: "INVALID_WAV", message: "Expected RIFF/WAVE") }
    var at = 12, channels = 0, sampleRate = 0, blockAlign = 0, pcm: Data? = nil
    while at + 8 <= data.count {
        let size = Int(au32(data, at + 4)), end = at + 8 + size
        guard size >= 0, end <= data.count else { throw AudioUnitError(code: "INVALID_WAV", message: "Truncated WAV chunk") }
        let kind = auASCII(data, at, 4)
        if kind == "fmt " {
            guard size >= 16, au16(data, at + 8) == 1 else { throw AudioUnitError(code: "UNSUPPORTED_WAV", message: "Only integer PCM WAV is supported") }
            channels = au16(data, at + 10); sampleRate = Int(au32(data, at + 12)); blockAlign = au16(data, at + 20)
            guard [1, 2].contains(channels), sampleRate >= 1 && sampleRate <= 96000, au16(data, at + 22) == 16, blockAlign == channels * 2 else { throw AudioUnitError(code: "UNSUPPORTED_WAV", message: "Use mono/stereo PCM16 at 1..96000 Hz") }
        } else if kind == "data" {
            if pcm != nil { throw AudioUnitError(code: "UNSUPPORTED_WAV", message: "Multiple data chunks are not supported") }
            pcm = data.subdata(in: at + 8..<end)
        }
        at = end + (size % 2)
    }
    guard let pcm, blockAlign > 0, pcm.count % blockAlign == 0 else { throw AudioUnitError(code: "INVALID_WAV", message: "Missing or misaligned PCM data") }
    let frames = pcm.count / blockAlign
    guard frames > 0, frames <= sampleRate * 600 else { throw AudioUnitError(code: "WAV_LIMIT", message: "Offline Audio Unit input is limited to 600 seconds") }
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: AVAudioChannelCount(channels), interleaved: false) else { throw AudioUnitError(code: "INVALID_WAV", message: "Cannot create audio format") }
    return AUWave(sampleRate: sampleRate, channels: channels, frames: frames, pcm: pcm, format: format)
}
func auSamples(_ wave: AUWave) throws -> AVAudioPCMBuffer {
    guard let buffer = AVAudioPCMBuffer(pcmFormat: wave.format, frameCapacity: AVAudioFrameCount(wave.frames)) else { throw AudioUnitError(code: "AUDIO_BUFFER_FAILED", message: "Cannot allocate input buffer") }
    buffer.frameLength = AVAudioFrameCount(wave.frames)
    for channel in 0..<wave.channels {
        guard let output = buffer.floatChannelData?[channel] else { throw AudioUnitError(code: "AUDIO_BUFFER_FAILED", message: "Missing channel buffer") }
        for frame in 0..<wave.frames {
            let value = Int16(bitPattern: UInt16(au16(wave.pcm, (frame * wave.channels + channel) * 2)))
            output[frame] = Float(value) / (value < 0 ? 32768.0 : 32767.0)
        }
    }
    return buffer
}
func auPCMBytes(_ buffer: AVAudioPCMBuffer, channels: Int) -> Data {
    var data = Data(); data.reserveCapacity(Int(buffer.frameLength) * channels * 2)
    for frame in 0..<Int(buffer.frameLength) { for channel in 0..<channels {
        let value = buffer.floatChannelData![channel][frame]
        let scaled = Int((max(-1, min(1, value)) * (value < 0 ? 32768 : 32767)).rounded())
        let bits = UInt16(bitPattern: Int16(scaled)); data.append(UInt8(bits & 255)); data.append(UInt8(bits >> 8))
    } }
    return data
}
func shaHex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func renderAudioUnit(_ path: String, offline: Bool) throws {
    guard offline else { throw AudioUnitError(code: "OFFLINE_REQUIRED", message: "Audio Unit processing requires explicit offline=true") }
    guard let unit = instantiatedUnit else { throw AudioUnitError(code: "NO_INSTANCE", message: "Instantiate an exact Audio Unit before offline processing") }
    let wave = try readAUWave(path), engine = AVAudioEngine(), player = AVAudioPlayerNode()
    engine.attach(player); engine.attach(unit); engine.connect(player, to: unit, format: wave.format); engine.connect(unit, to: engine.mainMixerNode, format: wave.format)
    defer { player.stop(); engine.stop(); engine.detach(unit) }
    try engine.enableManualRenderingMode(.offline, format: wave.format, maximumFrameCount: AVAudioFrameCount(wave.frames))
    player.scheduleBuffer(try auSamples(wave), at: nil, options: []); try engine.start(); player.play()
    guard let output = AVAudioPCMBuffer(pcmFormat: wave.format, frameCapacity: AVAudioFrameCount(wave.frames)) else { throw AudioUnitError(code: "AUDIO_BUFFER_FAILED", message: "Cannot allocate output buffer") }
    let status = try engine.renderOffline(AVAudioFrameCount(wave.frames), to: output)
    guard status == .success, output.frameLength == wave.frames else { throw AudioUnitError(code: "OFFLINE_PROCESSING_FAILED", message: "Audio Unit offline processing did not produce the expected frames: \(status.rawValue)") }
    emit(["event": "rendered", "componentId": selected as Any, "frames": wave.frames, "sampleRate": wave.sampleRate, "channels": wave.channels, "sourceSha256": shaHex(wave.pcm), "pcmSha256": shaHex(auPCMBytes(output, channels: wave.channels)), "offline": true])
}
func discover() -> [AVAudioUnitComponent] {
    components = AVAudioUnitComponentManager.shared().components(matching: AudioComponentDescription()).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    return components
}
func handle(_ object: [String: Any]) throws {
    guard let command = object["command"] as? String else { throw AudioUnitError(code: "INVALID_REQUEST", message: "Missing command") }
    if command == "list" {
        guard Set(object.keys).isSubset(of: ["command", "limit"]) else { throw AudioUnitError(code: "INVALID_REQUEST", message: "Unknown list fields") }
        var limit = 64
        if object["limit"] != nil {
            guard let value = object["limit"] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite, value.doubleValue.rounded() == value.doubleValue, value.intValue >= 1 && value.intValue <= 256 else { throw AudioUnitError(code: "INVALID_LIMIT", message: "Audio Unit list limit must be 1..256") }
            limit = value.intValue
        }
        let list = discover().prefix(limit).map(metadata)
        emit(["event": "list", "components": list, "count": list.count, "availableCount": components.count, "instantiated": instantiatedUnit != nil])
    } else if command == "select" {
        guard Set(object.keys) == ["command", "id"], let id = object["id"] as? String else { throw AudioUnitError(code: "INVALID_REQUEST", message: "Select requires a component id") }
        guard instantiatedUnit == nil else { throw AudioUnitError(code: "INSTANCE_ACTIVE", message: "Release the current Audio Unit before changing selection") }
        let component = try exactComponent(id)
        selected = id
        emit(["event": "selected", "component": metadata(component), "instantiated": false])
    } else if command == "instantiate" {
        guard Set(object.keys) == ["command", "id", "offline"], let id = object["id"] as? String, let value = object["offline"] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw AudioUnitError(code: "INVALID_REQUEST", message: "Instantiate requires id and offline=true") }
        try instantiate(id, offline: value.boolValue)
    } else if command == "render" {
        guard Set(object.keys) == ["command", "path", "offline"], let path = object["path"] as? String, let value = object["offline"] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw AudioUnitError(code: "INVALID_REQUEST", message: "Render requires path and offline=true") }
        try renderAudioUnit(path, offline: value.boolValue)
    } else if command == "release" {
        guard Set(object.keys) == ["command"] else { throw AudioUnitError(code: "INVALID_REQUEST", message: "Unknown release fields") }
        instantiatedUnit = nil; emit(["event": "released", "instantiated": false])
    } else if command == "status" {
        emit(["event": "status", "count": components.count, "selected": selected as Any, "instantiated": instantiatedUnit != nil])
    } else if command == "quit" { instantiatedUnit = nil; exit(0) }
    else { throw AudioUnitError(code: "UNKNOWN_COMMAND", message: "Unsupported Audio Unit command") }
}
emit(["event": "ready", "protocol": 1, "backend": "AVAudioUnitComponentManager", "instantiated": false])
var input = Data()
FileHandle.standardInput.readabilityHandler = { fileHandle in
    let bytes = fileHandle.availableData
    if bytes.isEmpty { exit(0) }
    input.append(bytes)
    while let newline = input.firstIndex(of: 10) {
        let line = input.subdata(in: 0..<newline); input.removeSubrange(0...newline)
        DispatchQueue.main.async {
            do { let object = try JSONSerialization.jsonObject(with: line); guard let dictionary = object as? [String: Any] else { throw AudioUnitError(code: "INVALID_JSON", message: "Expected a JSON object") }; try handle(dictionary) }
            catch { if let error = error as? AudioUnitError { emit(["event": "error", "code": error.code, "message": error.message]) } else { emit(["event": "error", "code": "INVALID_JSON", "message": error.localizedDescription]) } }
        }
    }
}
RunLoop.main.run()
