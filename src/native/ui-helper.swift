import ApplicationServices
import CoreGraphics
import Foundation

// ui-helper — read-only screen/window/permission introspection for macos-vision-mcp.
// Emits JSON on stdout. Never captures pixels itself (capture goes through
// /usr/sbin/screencapture); never synthesizes input. Eyes, not hands.

// ─── Result structs ──────────────────────────────────────────────────────────

struct WindowInfo: Codable {
    let windowId: Int
    let app: String
    let pid: Int
    let title: String
    // Global screen points, top-left origin (matches CGEvent click coordinates).
    let x: Double; let y: Double; let w: Double; let h: Double
    let layer: Int
    let isOnScreen: Bool
}

struct DisplayInfo: Codable {
    let displayId: Int
    let isMain: Bool
    // Global screen points, top-left origin.
    let x: Double; let y: Double; let w: Double; let h: Double
    let scale: Double
}

struct PermissionsInfo: Codable {
    let screenRecording: Bool
    let accessibility: Bool
}

func encodeJSON<T: Encodable>(_ value: T) -> String {
    guard let data = try? JSONEncoder().encode(value),
          let str = String(data: data, encoding: .utf8) else { return "[]" }
    return str
}

// ─── Modes ───────────────────────────────────────────────────────────────────

let args = CommandLine.arguments

if args.contains("--permissions") {
    let info = PermissionsInfo(
        screenRecording: CGPreflightScreenCaptureAccess(),
        accessibility: AXIsProcessTrusted()
    )
    print(encodeJSON(info))
    exit(0)
}

if args.contains("--displays") {
    var count: UInt32 = 0
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    // Online (not Active) list: an asleep display is still online, and captures/
    // window queries keep working while it sleeps — report it.
    CGGetOnlineDisplayList(16, &ids, &count)
    var results: [DisplayInfo] = []
    for i in 0..<Int(count) {
        let id = ids[i]
        let bounds = CGDisplayBounds(id) // points, top-left origin
        var scale = 1.0
        if let mode = CGDisplayCopyDisplayMode(id), mode.width > 0 {
            scale = Double(mode.pixelWidth) / Double(mode.width)
        }
        results.append(DisplayInfo(
            displayId: Int(id),
            isMain: CGDisplayIsMain(id) != 0,
            x: bounds.origin.x, y: bounds.origin.y,
            w: bounds.size.width, h: bounds.size.height,
            scale: scale
        ))
    }
    print(encodeJSON(results))
    exit(0)
}

if args.contains("--windows") {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        print("[]")
        exit(0)
    }
    var results: [WindowInfo] = []
    for w in list {
        guard let boundsDict = w[kCGWindowBounds as String] as? [String: Double] else { continue }
        let layer = w[kCGWindowLayer as String] as? Int ?? 0
        // Layer 0 = normal app windows; skip menu bar, dock, overlays unless --all.
        if layer != 0 && !args.contains("--all") { continue }
        let width = boundsDict["Width"] ?? 0
        let height = boundsDict["Height"] ?? 0
        if width < 40 || height < 40 { continue } // status items, tooltips
        results.append(WindowInfo(
            windowId: w[kCGWindowNumber as String] as? Int ?? 0,
            app: w[kCGWindowOwnerName as String] as? String ?? "",
            pid: w[kCGWindowOwnerPID as String] as? Int ?? 0,
            title: w[kCGWindowName as String] as? String ?? "",
            x: boundsDict["X"] ?? 0, y: boundsDict["Y"] ?? 0,
            w: width, h: height,
            layer: layer,
            isOnScreen: (w[kCGWindowIsOnscreen as String] as? Bool) ?? true
        ))
    }
    print(encodeJSON(results))
    exit(0)
}

print("Usage: ui-helper [--windows [--all] | --displays | --permissions]")
exit(1)
