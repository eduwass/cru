#!/usr/bin/env swift
// Finds the CGWindowID for the frontmost Ghostty window.
// Usage: ghostty-window-id
// Prints the integer window ID to stdout (for use with screencapture -l).
//
// Strategy: find the Ghostty window with the highest CGWindowNumber
// (most recently created) that is a normal layer-0 window with
// a reasonable size. If Ghostty is frontmost, this will be the
// window the user just created.

import CoreGraphics

let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as! [[String: Any]]
var best: (id: Int, area: Double) = (0, 0)

for w in windows {
    guard let name = w["kCGWindowOwnerName"] as? String,
          name.lowercased() == "ghostty",
          let layer = w["kCGWindowLayer"] as? Int, layer == 0,
          let bounds = w["kCGWindowBounds"] as? [String: Any],
          let width = bounds["Width"] as? Double,
          let height = bounds["Height"] as? Double,
          width > 100, height > 100
    else { continue }
    let id = w["kCGWindowNumber"] as! Int
    // Prefer the highest window ID (most recently created)
    if id > best.id {
        best = (id, width * height)
    }
}

if best.id > 0 {
    print(best.id)
} else {
    fputs("Error: no Ghostty window found\n", stderr)
    exit(1)
}
