// newdaw CoreMIDI sidecar. NDJSON control is kept off CoreMIDI's callback thread.
// macOS 11+, MIDI 1.0 carried in UMP; no endpoint is selected automatically.
import Foundation
import CoreMIDI
import Darwin

struct BridgeError: Error { let code: String; let message: String }
func fail(_ code: String, _ message: String) throws -> Never { throw BridgeError(code: code, message: message) }
func check(_ status: OSStatus, _ operation: String) throws {
    if status != noErr { try fail("COREMIDI_ERROR", "\(operation): OSStatus \(status)") }
}
let writer = DispatchQueue(label: "newdaw.midi.json")
func emit(_ value: [String: Any]) {
    writer.async {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
    }
}
func exactInt(_ value: Any?, _ min: Int64, _ max: Int64, _ label: String) throws -> Int64 {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite,
          n.doubleValue.rounded() == n.doubleValue, n.doubleValue >= Double(min), n.doubleValue <= Double(max) else {
        try fail("INVALID_REQUEST", "\(label) must be an integer in \(min)...\(max)")
    }
    return n.int64Value
}
func property(_ object: MIDIObjectRef, _ key: CFString) -> String {
    var value: Unmanaged<CFString>?
    return MIDIObjectGetStringProperty(object, key, &value) == noErr ? (value?.takeRetainedValue() as String? ?? "") : ""
}
func uniqueID(_ endpoint: MIDIEndpointRef) -> Int32? {
    var value: Int32 = 0
    return MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &value) == noErr ? value : nil
}
func destination(_ id: Int32) throws -> MIDIEndpointRef {
    var object: MIDIObjectRef = 0; var type = MIDIObjectType.other
    try check(MIDIObjectFindByUniqueID(id, &object, &type), "Find destination \(id)")
    guard type == .destination || type == .externalDestination else { try fail("NOT_A_DESTINATION", "Unique ID is not a MIDI destination") }
    var offline: Int32 = 0
    _ = MIDIObjectGetIntegerProperty(object, kMIDIPropertyOffline, &offline)
    guard offline == 0 else { try fail("DESTINATION_OFFLINE", "MIDI destination is offline") }
    return object
}
func endpointInfo(_ endpoint: MIDIEndpointRef, _ direction: String) -> [String: Any]? {
    guard let id = uniqueID(endpoint) else { return nil }
    var offline: Int32 = 0; _ = MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyOffline, &offline)
    return ["id": id, "direction": direction, "name": property(endpoint, kMIDIPropertyName),
            "displayName": property(endpoint, kMIDIPropertyDisplayName), "manufacturer": property(endpoint, kMIDIPropertyManufacturer),
            "offline": offline != 0]
}
// Each message is explicit status + data, or one complete F0...F7 SysEx7.
// Reject unsupported system/running-status bytes rather than silently changing them.
func encode(_ bytes: [UInt8]) throws -> [UInt32] {
    guard let status = bytes.first else { try fail("INVALID_MIDI", "Empty MIDI message") }
    if status >= 0x80 && status <= 0xEF {
        let size = (status & 0xF0 == 0xC0 || status & 0xF0 == 0xD0) ? 2 : 3
        guard bytes.count == size, bytes.dropFirst().allSatisfy({ $0 < 128 }) else { try fail("INVALID_MIDI", "Invalid channel message size/data") }
        return [0x20000000 | UInt32(status) << 16 | UInt32(bytes[1]) << 8 | (size == 3 ? UInt32(bytes[2]) : 0)]
    }
    if status == 0xF0 {
        guard bytes.count >= 2, bytes.last == 0xF7, bytes.dropFirst().dropLast().allSatisfy({ $0 < 128 }) else { try fail("INVALID_MIDI", "Only complete SysEx7 F0...F7 is accepted") }
        let data = Array(bytes.dropFirst().dropLast()); var words: [UInt32] = []
        let chunks = max(1, (data.count + 5) / 6)
        for i in 0..<chunks {
            let start = i * 6, count = min(6, data.count - start)
            let form = chunks == 1 ? 0 : (i == 0 ? 1 : (i == chunks - 1 ? 3 : 2))
            var b = [UInt8](repeating: 0, count: 8); b[0] = 0x30; b[1] = UInt8(form << 4 | count)
            if count > 0 { for j in 0..<count { b[j + 2] = data[start + j] } }
            words.append(UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3]))
            words.append(UInt32(b[4]) << 24 | UInt32(b[5]) << 16 | UInt32(b[6]) << 8 | UInt32(b[7]))
        }
        return words
    }
    try fail("UNSUPPORTED_MIDI", "System common/realtime and SMF F7 continuations require an explicit stream protocol")
}
var client: MIDIClientRef = 0, output: MIDIPortRef = 0
var receivers: [String: MIDIEndpointRef] = [:]
var usedChannels: [Int32: Set<UInt8>] = [:]
var activeNotes: [Int32: [UInt16: Int]] = [:]
var ownedEndpoints: [Int32: MIDIEndpointRef] = [:]
var timebase = mach_timebase_info_data_t(); mach_timebase_info(&timebase)
var closing = false
let testMode = CommandLine.arguments.contains("--test-receiver")
@discardableResult
func sendWords(_ endpoint: MIDIEndpointRef, _ words: [UInt32]) throws -> UInt64 {
    guard !words.isEmpty, words.count <= 65536 else { try fail("MIDI_LIMIT", "Empty or oversized UMP list") }
    let capacity = 32 + words.count * 4
    let memory = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: 8); defer { memory.deallocate() }
    let list = memory.bindMemory(to: MIDIEventList.self, capacity: 1)
    let initial = MIDIEventListInit(list, ._1_0), timestamp = mach_absolute_time()
    _ = words.withUnsafeBufferPointer { MIDIEventListAdd(list, capacity, initial, timestamp, $0.count, $0.baseAddress!) }
    try check(MIDISendEventList(output, endpoint, list), "MIDISendEventList")
    emit(["event": "transmitted", "destinationId": uniqueID(endpoint) as Any? ?? NSNull(), "hostTime": String(timestamp), "wordCount": words.count])
    return timestamp
}
func noteState(_ id: Int32, _ messages: [[UInt8]], initial: [UInt16: Int]? = nil) throws -> [UInt16: Int] {
    var notes = initial ?? activeNotes[id] ?? [:]; var total = notes.values.reduce(0, +)
    for b in messages where b[0] < 0xF0 {
        let channel = b[0] & 15, kind = b[0] & 0xF0
        if kind == 0x90 && b[2] > 0 {
            total += 1; guard total <= 4096 else { try fail("MIDI_LIMIT", "Active key safety limit is 4096") }
            notes[UInt16(channel) * 128 + UInt16(b[1]), default: 0] += 1
        }
        if kind == 0x80 || (kind == 0x90 && b[2] == 0) {
            let key = UInt16(channel) * 128 + UInt16(b[1]); let count = notes[key] ?? 0
            if count > 0 { notes[key] = count - 1; total -= 1 }
        }
        if kind == 0xB0 && (b[1] == 120 || b[1] >= 123) {
            for key in Array(notes.keys) where key / 128 == UInt16(channel) { total -= notes[key] ?? 0; notes[key] = 0 }
        }
    }
    return notes
}
// Backend teardown contract: release our keys and silence our used channels, preserving
// their controller values. Reset-on-stop and chase preservation are separate policies.
func release(_ id: Int32) throws -> Int {
    guard let channels = usedChannels[id], !channels.isEmpty else { return 0 }
    let endpoint = try destination(id)
    guard ownedEndpoints[id] == endpoint else { try fail("DESTINATION_REPLACED", "Refusing cleanup on a replacement endpoint") }
    var words: [UInt32] = []
    for (key, count) in (activeNotes[id] ?? [:]).sorted(by: { $0.key < $1.key }) {
        for _ in 0..<count { words += try encode([0x80 | UInt8(key / 128), UInt8(key % 128), 0]) }
    }
    for channel in channels.sorted() { words += try encode([0xB0 | channel, 120, 0]) }
    try sendWords(endpoint, words); activeNotes.removeValue(forKey: id); usedChannels.removeValue(forKey: id); ownedEndpoints.removeValue(forKey: id)
    return words.count
}
// Reset preferences are explicit for new callers; omitted protocol fields retain
// the v21 owned-note cleanup contract (no automatic all-channel reset).
struct ResetPreferences {
    let resetOnStop: Bool, neverResetChasedControllers: Bool
    static let legacy = ResetPreferences(resetOnStop: false, neverResetChasedControllers: true)
}
func resetPreferences(_ value: Any?) throws -> ResetPreferences {
    guard let value = value else { return .legacy }
    guard let d = value as? [String: Any], Set(d.keys) == Set(["resetOnStop", "neverResetChasedControllers"]),
          let on = d["resetOnStop"] as? NSNumber, CFGetTypeID(on) == CFBooleanGetTypeID(),
          let never = d["neverResetChasedControllers"] as? NSNumber, CFGetTypeID(never) == CFBooleanGetTypeID() else {
        try fail("MIDI_RESET_PREFERENCES", "Reset preferences require two exact boolean fields")
    }
    return ResetPreferences(resetOnStop: on.boolValue, neverResetChasedControllers: never.boolValue)
}
func resetWords(_ controllers: Bool) throws -> [UInt32] {
    var words: [UInt32] = []
    for channel: UInt8 in 0..<16 {
        for pitch: UInt8 in 0..<128 { words += try encode([0x80 | channel, pitch, 0]) }
        words += try encode([0xB0 | channel, 123, 0]); words += try encode([0xB0 | channel, 120, 0])
        if controllers { words += try encode([0xB0 | channel, 121, 0]) }
    }
    return words
}
func performReset(_ reason: String, _ preferences: ResetPreferences, _ ids: [Int32], _ endpoints: [Int32: MIDIEndpointRef]) -> [String: Any] {
    let requested = reason == "manual" || reason == "locate" || (reason == "stop" && preferences.resetOnStop)
    let controllers = requested && (reason == "manual" || !preferences.neverResetChasedControllers)
    var results: [[String: Any]] = [], errors: [[String: Any]] = []
    if requested {
        // All16 channels fit in one bounded native MIDIEventList per destination.
        // This action never yields to another helper request or transport callback.
        for id in ids {
            do {
                let endpoint = try destination(id)
                guard endpoint == endpoints[id] else { try fail("DESTINATION_REPLACED", "Reset destination was replaced") }
                let words = try resetWords(controllers), sent = try sendWords(endpoint, words)
                activeNotes.removeValue(forKey: id); usedChannels.removeValue(forKey: id); ownedEndpoints.removeValue(forKey: id)
                results.append(["destinationId": id, "status": "accepted", "messages": words.count, "sentHostTime": String(sent)])
            } catch {
                let item: [String: Any] = ["destinationId": id, "code": (error as? BridgeError)?.code ?? "MIDI_RESET_FAILED", "message": String(describing: error)]
                errors.append(item); results.append(["destinationId": id, "status": "failed"])
            }
        }
    }
    return ["policyVersion": 1, "reason": reason, "requested": requested, "resetControllers": controllers,
            "status": errors.isEmpty ? (requested ? "reset" : "unchanged") : "failed", "destinations": ids, "results": results, "errors": errors,
            "meaning": "CoreMIDI acceptance only; no hardware state acknowledgement or automatic retry"]
}
// One immutable prepared queue and one active transport. Future packets stay here,
// not in CoreMIDI's destination-wide queue, so stop never flushes another client.
struct ScheduledMessage {
    let offset: UInt64
    let destination: Int32
    let bytes: [UInt8]
    let words: [UInt32]
}
final class PreparedTransport {
    let id: String, duration: UInt64, expected: Int
    let endpoints: [Int32: MIDIEndpointRef]
    var resetPolicy: ResetPreferences = .legacy
    var events: [ScheduledMessage] = [], noteStates: [Int32: [UInt16: Int]] = [:], payload = 0
    init(_ id: String, _ duration: UInt64, _ expected: Int, _ endpoints: [Int32: MIDIEndpointRef]) {
        self.id = id; self.duration = duration; self.expected = expected; self.endpoints = endpoints
    }
}
final class ActiveTransport {
    let plan: PreparedTransport, started: UInt64
    var cursor = 0, maxLateness: UInt64 = 0
    init(_ plan: PreparedTransport) { self.plan = plan; started = DispatchTime.now().uptimeNanoseconds + 30_000_000 }
}
var preparedTransport: PreparedTransport?, activeTransport: ActiveTransport?
var seenTransportIDs: Set<String> = []
var transportTimer: DispatchSourceTimer?
var lastTransport: [String: Any] = ["status": "idle"]
func transportStatus() -> [String: Any] {
    guard let run = activeTransport else { return lastTransport }
    let now = DispatchTime.now().uptimeNanoseconds
    return ["jobId": run.plan.id, "status": "playing", "startedUptimeNs": String(run.started),
            "positionNs": min(run.plan.duration, now > run.started ? now - run.started : 0),
            "durationNs": run.plan.duration, "sentEvents": run.cursor, "eventCount": run.plan.expected, "maxLatenessNs": run.maxLateness]
}
@discardableResult
func finishTransport(_ reason: String, _ failure: String? = nil, resetReason: String? = nil, preferences: ResetPreferences? = nil, applyReset: Bool = true) -> [String: Any] {
    guard let run = activeTransport else { return lastTransport }
    var result = transportStatus(); activeTransport = nil; transportTimer?.cancel(); transportTimer = nil
    var errors: [[String: Any]] = []
    for id in run.plan.endpoints.keys.sorted() {
        do { _ = try release(id) } catch { errors.append(["destinationId": id, "message": String(describing: error)]) }
    }
    if applyReset && failure == nil && (resetReason != nil || reason == "completed") {
        let report = performReset(resetReason ?? "stop", preferences ?? run.plan.resetPolicy, run.plan.endpoints.keys.sorted(), run.plan.endpoints)
        result["reset"] = report
        errors += report["errors"] as? [[String: Any]] ?? []
    }
    result["status"] = failure == nil && errors.isEmpty ? reason : "failed"
    result["reason"] = reason; result["cleanupErrors"] = errors
    if let failure = failure { result["error"] = failure }
    lastTransport = result; emit(["event": "transport", "transport": result]); return result
}
func validateActiveDestinations() {
    guard let run = activeTransport else { return }
    do {
        for (id, endpoint) in run.plan.endpoints {
            guard try destination(id) == endpoint else { try fail("DESTINATION_REPLACED", "Active endpoint was replaced") }
        }
    } catch { _ = finishTransport("destination-disconnected", String(describing: error)) }
}
func armTransport() {
    guard let run = activeTransport, let timer = transportTimer else { return }
    let next = run.cursor < run.plan.events.count ? run.plan.events[run.cursor].offset : run.plan.duration
    timer.schedule(deadline: DispatchTime(uptimeNanoseconds: run.started + next), leeway: .microseconds(50))
}
func pumpTransport() {
    guard let run = activeTransport else { return }
    do {
        // Bound a callback so queued Stop and EOF/termination can run under density.
        var budget = 1024
        while run.cursor < run.plan.events.count && budget > 0 {
            let first = run.plan.events[run.cursor], deadline = run.started + first.offset
            let now = DispatchTime.now().uptimeNanoseconds
            if now < deadline { break }
            let late = now - deadline; run.maxLateness = max(run.maxLateness, late)
            guard late <= 250_000_000 else { try fail("NATIVE_DEADLINE_MISSED", "Native scheduler exceeded 250ms lateness; future events cancelled") }
            let endpoint = try destination(first.destination)
            guard endpoint == run.plan.endpoints[first.destination] else { try fail("DESTINATION_REPLACED", "Scheduled destination was replaced") }
            var messages: [[UInt8]] = [], words: [UInt32] = []
            while run.cursor + messages.count < run.plan.events.count && messages.count < budget {
                let next = run.plan.events[run.cursor + messages.count]
                if next.offset != first.offset || next.destination != first.destination || words.count + next.words.count > 65536 { break }
                messages.append(next.bytes); words += next.words
            }
            let notes = try noteState(first.destination, messages)
            try sendWords(endpoint, words); activeNotes[first.destination] = notes; ownedEndpoints[first.destination] = endpoint
            for message in messages where message[0] < 0xF0 { usedChannels[first.destination, default: []].insert(message[0] & 15) }
            run.cursor += messages.count; budget -= messages.count
        }
        if run.cursor == run.plan.events.count && DispatchTime.now().uptimeNanoseconds >= run.started + run.plan.duration {
            _ = finishTransport("completed")
        } else { armTransport() }
    } catch { _ = finishTransport("output-error", String(describing: error)) }
}
func transportAction(_ action: String, _ request: [String: Any]) throws -> [String: Any] {
    if action == "transport.status" { return ["transport": transportStatus(), "preparedJobId": preparedTransport?.id as Any? ?? NSNull()] }
    guard let id = request["jobId"] as? String, !id.isEmpty, id.utf8.count <= 100 else { try fail("INVALID_REQUEST", "Expected a short jobId") }
    switch action {
    case "transport.prepare":
        guard preparedTransport == nil else { try fail("NATIVE_PREPARED_BUSY", "Discard the prior prepared job first") }
        guard !seenTransportIDs.contains(id) else { try fail("NATIVE_JOB_REUSED", "Use a fresh jobId for this helper lifetime") }
        guard seenTransportIDs.count < 100000 else { try fail("NATIVE_JOB_LIMIT", "Reopen backend after 100000 jobs") }
        let policy = try resetPreferences(request["resetPreferences"])
        let duration = UInt64(try exactInt(request["durationNs"], 1, 3_600_000_000_000, "durationNs"))
        let count = Int(try exactInt(request["eventCount"], 0, 200000, "eventCount"))
        guard let ids = request["destinations"] as? [Any], !ids.isEmpty, ids.count <= 64 else { try fail("INVALID_REQUEST", "Expected 1...64 explicit destinations") }
        var endpoints: [Int32: MIDIEndpointRef] = [:]
        for value in ids {
            let unique = Int32(try exactInt(value, Int64(Int32.min), Int64(Int32.max), "destinationId"))
            guard endpoints[unique] == nil else { try fail("INVALID_REQUEST", "Duplicate destination") }
            endpoints[unique] = try destination(unique)
        }
        preparedTransport = PreparedTransport(id, duration, count, endpoints); preparedTransport?.resetPolicy = policy; seenTransportIDs.insert(id)
        return ["jobId": id, "status": "prepared", "appended": 0]
    case "transport.append":
        guard let draft = preparedTransport, draft.id == id else { try fail("NATIVE_JOB_CONFLICT", "Prepared job does not match") }
        guard let input = request["events"] as? [[String: Any]], !input.isEmpty, input.count <= 1024, draft.events.count + input.count <= draft.expected else { try fail("INVALID_REQUEST", "Append requires 1...1024 events within declared count") }
        var added: [ScheduledMessage] = [], states = draft.noteStates, payload = draft.payload
        var lastOffset = draft.events.last?.offset ?? 0
        for event in input {
            guard Set(event.keys) == Set(["offsetNs", "destinationId", "bytes"]), let raw = event["bytes"] as? [Any] else { try fail("INVALID_REQUEST", "Invalid scheduled event fields") }
            let offset = UInt64(try exactInt(event["offsetNs"], 0, Int64(draft.duration), "offsetNs"))
            guard offset >= lastOffset else { try fail("NATIVE_ORDER", "Scheduled events must be ordered") }; lastOffset = offset
            let dest = Int32(try exactInt(event["destinationId"], Int64(Int32.min), Int64(Int32.max), "destinationId"))
            guard draft.endpoints[dest] != nil else { try fail("NATIVE_ROUTE", "Event destination is not declared") }
            guard raw.count <= 65536, payload + raw.count <= 4 * 1024 * 1024 else { try fail("MIDI_LIMIT", "Scheduled payload exceeds limit") }; payload += raw.count
            let bytes = try raw.map { UInt8(try exactInt($0, 0, 255, "MIDI byte")) }, words = try encode(bytes)
            states[dest] = try noteState(dest, [bytes], initial: states[dest] ?? [:])
            added.append(ScheduledMessage(offset: offset, destination: dest, bytes: bytes, words: words))
        }
        draft.events += added; draft.noteStates = states; draft.payload = payload
        return ["jobId": id, "status": "prepared", "appended": draft.events.count]
    case "transport.start":
        guard activeTransport == nil else { try fail("NATIVE_PLAYING", "Stop the active transport before starting another") }
        guard let draft = preparedTransport, draft.id == id else { try fail("NATIVE_JOB_CONFLICT", "Prepared job does not match") }
        guard draft.events.count == draft.expected else { try fail("NATIVE_INCOMPLETE", "Prepared event count is incomplete") }
        for (dest, endpoint) in draft.endpoints {
            guard try destination(dest) == endpoint else { try fail("DESTINATION_REPLACED", "Prepared endpoint was replaced") }
            guard usedChannels[dest]?.isEmpty ?? true else { try fail("NATIVE_OWNED_NOTES", "Release manually sent MIDI before transport starts") }
        }
        activeTransport = ActiveTransport(draft); preparedTransport = nil
        let timer = DispatchSource.makeTimerSource(flags: .strict, queue: .main); transportTimer = timer
        timer.setEventHandler { pumpTransport() }; armTransport(); timer.resume()
        let result = transportStatus(); emit(["event": "transport", "transport": result]); return result
    case "transport.stop":
        let policy = request["resetPreferences"] == nil ? nil : try resetPreferences(request["resetPreferences"])
        let stopReason = request["reason"] as? String ?? "stop"
        guard ["stop", "locate", "shutdown", "failure"].contains(stopReason), request["reason"] == nil || request["reason"] is String else { try fail("INVALID_REQUEST", "Invalid Stop reason") }
        if activeTransport == nil && lastTransport["jobId"] as? String == id { return lastTransport }
        guard activeTransport?.plan.id == id else { try fail("NATIVE_JOB_CONFLICT", "Active job does not match; newer playback was preserved") }
        return finishTransport("stopped", resetReason: stopReason, preferences: policy)
    case "transport.discard":
        guard preparedTransport?.id == id else { try fail("NATIVE_JOB_CONFLICT", "Prepared job does not match") }
        preparedTransport = nil; return ["jobId": id, "status": "discarded"]
    default: try fail("INVALID_REQUEST", "Unknown transport action")
    }
}

func resetAction(_ request: [String: Any]) throws -> [String: Any] {
    guard Set(request.keys).subtracting(["action", "requestId"]) == Set(["reason", "preferences", "destinations", "expectedJobId", "expectedPreparedJobId"]),
          let reason = request["reason"] as? String, ["manual", "stop", "locate"].contains(reason) else { try fail("INVALID_REQUEST", "Reset requires explicit policy, destinations and both job guards") }
    let policy = try resetPreferences(request["preferences"])
    func guardID(_ value: Any?) throws -> String? {
        if value is NSNull { return nil }
        guard let id = value as? String, !id.isEmpty, id.utf8.count <= 100 else { try fail("INVALID_REQUEST", "Job guard must be null or a short ID") }
        return id
    }
    let expected = try guardID(request["expectedJobId"]), draft = try guardID(request["expectedPreparedJobId"])
    guard expected == (activeTransport?.plan.id ?? lastTransport["jobId"] as? String), draft == preparedTransport?.id else { try fail("NATIVE_JOB_CONFLICT", "Reset job guard changed; newer playback/preparation preserved") }
    guard let values = request["destinations"] as? [Any], !values.isEmpty, values.count <= 64 else { try fail("MIDI_RESET_DESTINATIONS", "Reset requires1...64 explicit destinations") }
    var ids: [Int32] = [], endpoints: [Int32: MIDIEndpointRef] = [:]
    for value in values {
        let id = Int32(try exactInt(value, Int64(Int32.min), Int64(Int32.max), "destinationId"))
        guard endpoints[id] == nil else { try fail("MIDI_RESET_DESTINATIONS", "Duplicate Reset destination") }
        let endpoint = try destination(id)
        for prior in [ownedEndpoints[id], activeTransport?.plan.endpoints[id], preparedTransport?.endpoints[id]].compactMap({ $0 }) {
            guard prior == endpoint else { try fail("DESTINATION_REPLACED", "Refusing Reset on a replacement endpoint") }
        }
        ids.append(id); endpoints[id] = endpoint
    }
    // No output or transport mutation occurs above this line.
    let discarded = preparedTransport?.id, hadActiveTransport = activeTransport != nil; preparedTransport = nil
    let stopped = finishTransport("stopped", applyReset: false)
    var report = performReset(reason, policy, ids, endpoints)
    let cleanupErrors = hadActiveTransport ? (stopped["cleanupErrors"] as? [[String: Any]] ?? []) : []
    if !cleanupErrors.isEmpty { report["status"] = "failed" }
    report["cleanupErrors"] = cleanupErrors; report["transport"] = stopped
    report["discardedJobId"] = discarded as Any? ?? NSNull()
    emit(["event": "reset", "reset": report]); return report
}

func shutdown() {
    guard !closing else { return }; closing = true
    transportTimer?.cancel(); transportTimer = nil; activeTransport = nil; preparedTransport = nil
    for id in Array(usedChannels.keys) {
        do { _ = try release(id) } catch { emit(["event": "cleanup-error", "destinationId": id, "message": String(describing: error)]) }
    }
    for endpoint in receivers.values { _ = MIDIEndpointDispose(endpoint) }
    _ = MIDIPortDispose(output); _ = MIDIClientDispose(client)
    writer.sync {}; exit(0)
}
func handle(_ request: [String: Any]) throws -> [String: Any] {
    guard let action = request["action"] as? String else { try fail("INVALID_REQUEST", "Missing action") }
    let allowed: [String: Set<String>] = ["transport.prepare": ["jobId", "durationNs", "eventCount", "destinations", "resetPreferences"], "transport.append": ["jobId", "events"], "transport.start": ["jobId"], "transport.stop": ["jobId", "reason", "resetPreferences"], "transport.discard": ["jobId"], "transport.status": [], "reset": ["reason", "preferences", "destinations", "expectedJobId", "expectedPreparedJobId"], "ports": [], "send": ["destinationId", "messages"], "release": ["destinationId"], "close": [], "test.createReceiver": ["name"], "test.removeReceiver": ["name"]]
    guard let keys = allowed[action], Set(request.keys).subtracting(keys.union(["requestId", "action"])).isEmpty else { try fail("INVALID_REQUEST", "Unknown action or keys") }
    if action.hasPrefix("transport.") { return try transportAction(action, request) }
    switch action {
    case "reset": return try resetAction(request)
    case "ports":
        let sources = (0..<MIDIGetNumberOfSources()).compactMap { endpointInfo(MIDIGetSource($0), "input") }
        let destinations = (0..<MIDIGetNumberOfDestinations()).compactMap { endpointInfo(MIDIGetDestination($0), "output") }
        return ["sources": sources, "destinations": destinations, "backend": "CoreMIDI", "protocol": "MIDI1-UMP"]
    case "send":
        guard activeTransport == nil else { try fail("NATIVE_PLAYING", "Use transport Stop before manual output") }
        let id = Int32(try exactInt(request["destinationId"], Int64(Int32.min), Int64(Int32.max), "destinationId"))
        guard let messages = request["messages"] as? [[Any]], !messages.isEmpty, messages.count <= 1024 else { try fail("INVALID_MIDI", "Expected 1...1024 MIDI messages") }
        var validated: [[UInt8]] = []; var words: [UInt32] = []; var byteCount = 0
        for message in messages {
            byteCount += message.count
            guard byteCount <= 65536 else { try fail("MIDI_LIMIT", "Batch exceeds 65536 source bytes") }
            let bytes = try message.map { UInt8(try exactInt($0, 0, 255, "MIDI byte")) }
            words += try encode(bytes); validated.append(bytes)
        }
        let notes = try noteState(id, validated)
        let endpoint = try destination(id)
        if let prior = ownedEndpoints[id], prior != endpoint { try fail("DESTINATION_REPLACED", "Output endpoint changed while notes were owned") }
        let sentTime = try sendWords(endpoint, words); ownedEndpoints[id] = endpoint; activeNotes[id] = notes
        for bytes in validated where bytes[0] < 0xF0 { usedChannels[id, default: []].insert(bytes[0] & 15) }
        return ["acceptedMessages": validated.count, "acceptedWords": words.count, "destinationId": id, "sentHostTime": String(sentTime), "meaning": "CoreMIDI accepted; device response is not acknowledged"]
    case "release":
        guard activeTransport == nil else { try fail("NATIVE_PLAYING", "Use transport Stop to cancel future notes before release") }
        let id = Int32(try exactInt(request["destinationId"], Int64(Int32.min), Int64(Int32.max), "destinationId"))
        return ["acceptedWords": try release(id), "destinationId": id]
    case "test.createReceiver":
        guard testMode, let name = request["name"] as? String, !name.isEmpty, name.utf8.count <= 100, receivers[name] == nil, receivers.count < 8 else { try fail("INVALID_TEST_RECEIVER", "Test receiver requires flag and a new short name") }
        var endpoint: MIDIEndpointRef = 0
        try check(MIDIDestinationCreateWithProtocol(client, name as CFString, ._1_0, &endpoint) { list, _ in
            // Copy only bounded words while the CoreMIDI callback pointer is alive.
            let arrival = mach_absolute_time(); var copied: [[String: Any]] = []
            var packet = UnsafeRawPointer(list).advanced(by: MemoryLayout<MIDIEventList>.offset(of: \.packet)!).assumingMemoryBound(to: MIDIEventPacket.self)
            for _ in 0..<min(Int(list.pointee.numPackets), 4096) {
                let count = min(Int(packet.pointee.wordCount), 65536)
                let pointer = UnsafeRawPointer(packet).advanced(by: MemoryLayout<MIDIEventPacket>.offset(of: \.words)!).assumingMemoryBound(to: UInt32.self)
                let words = Array(UnsafeBufferPointer(start: pointer, count: count))
                copied.append(["timestamp": String(packet.pointee.timeStamp), "words": words]); packet = UnsafePointer(MIDIEventPacketNext(packet))
            }
            emit(["event": "received", "receiver": name, "arrivalHostTime": String(arrival), "packets": copied])
        }, "Create test destination")
        receivers[name] = endpoint
        return endpointInfo(endpoint, "output") ?? [:]
    case "test.removeReceiver":
        guard testMode, let name = request["name"] as? String, let endpoint = receivers[name] else { try fail("INVALID_TEST_RECEIVER", "Receiver is not owned by this helper") }
        if let id = uniqueID(endpoint) { _ = try release(id) }
        try check(MIDIEndpointDispose(endpoint), "Dispose test receiver"); receivers.removeValue(forKey: name)
        return ["removed": name]
    case "close": return ["closing": true]
    default: try fail("INVALID_REQUEST", "Unsupported action")
    }
}
do {
    try check(MIDIClientCreateWithBlock("newdaw" as CFString, &client) { note in
        let messageID = note.pointee.messageID.rawValue
        emit(["event": "ports-changed", "messageId": messageID])
        DispatchQueue.main.async { validateActiveDestinations() }
    }, "MIDIClientCreateWithBlock")
    try check(MIDIOutputPortCreate(client, "newdaw output" as CFString, &output), "MIDIOutputPortCreate")
} catch { emit(["event": "fatal", "code": "COREMIDI_UNAVAILABLE", "message": String(describing: error)]); writer.sync {}; exit(1) }
emit(["event": "ready", "protocolVersion": 1, "backend": "CoreMIDI", "testReceiverEnabled": testMode, "timebaseNumer": timebase.numer, "timebaseDenom": timebase.denom])
// Signals and stdin actions share the main queue; cleanup cannot race a send.
signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main), interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
terminate.setEventHandler { shutdown() }; interrupt.setEventHandler { shutdown() }; terminate.resume(); interrupt.resume()
DispatchQueue.global().async {
    while let line = readLine() {
        DispatchQueue.main.async {
            var requestId: String? = nil
            do {
                guard line.utf8.count <= 400000, let data = line.data(using: .utf8), let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let id = request["requestId"] as? String, !id.isEmpty, id.utf8.count <= 100 else { try fail("INVALID_REQUEST", "Expected bounded NDJSON object and requestId") }
                requestId = id
                let result = try handle(request); emit(["requestId": id, "ok": true, "result": result])
                if request["action"] as? String == "close" { shutdown() }
            } catch {
                let e = error as? BridgeError ?? BridgeError(code: "INVALID_REQUEST", message: String(describing: error))
                emit(["requestId": requestId as Any? ?? NSNull(), "ok": false, "error": ["code": e.code, "message": e.message]])
            }
        }
    }
    DispatchQueue.main.async { shutdown() }
}
CFRunLoopRun()
