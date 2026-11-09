// Safe Audio Unit metadata discovery. Selection never instantiates plugin code.
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
        emit(["event": "list", "components": list, "count": list.count, "availableCount": components.count, "instantiated": false])
    } else if command == "select" {
        guard Set(object.keys) == ["command", "id"], let id = object["id"] as? String else { throw AudioUnitError(code: "INVALID_REQUEST", message: "Select requires a component id") }
        if components.isEmpty { _ = discover() }
        let matches = components.filter { unitID($0) == id }
        guard matches.count == 1 else {
            if matches.isEmpty { throw AudioUnitError(code: "AUDIO_UNIT_NOT_FOUND", message: "Audio Unit is not present in the current discovery list") }
            throw AudioUnitError(code: "AMBIGUOUS_AUDIO_UNIT", message: "Audio Unit identity is ambiguous; use a versioned hosting plan")
        }
        let component = matches[0]
        selected = id
        emit(["event": "selected", "component": metadata(component), "instantiated": false])
    } else if command == "status" {
        emit(["event": "status", "count": components.count, "selected": selected as Any, "instantiated": false])
    } else if command == "quit" { exit(0) }
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
