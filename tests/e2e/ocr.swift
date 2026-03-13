#!/usr/bin/env swift
// OCR helper using macOS Vision framework.
// Usage: swift ocr.swift <image-path>
// Prints recognized text to stdout, one line per text block (top to bottom).

import Vision
import AppKit
import Foundation

guard CommandLine.arguments.count > 1 else {
  fputs("Usage: ocr <image-path>\n", stderr)
  exit(1)
}

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path) else {
  fputs("Error: cannot load image at \(path)\n", stderr)
  exit(1)
}

guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fputs("Error: cannot convert to CGImage\n", stderr)
  exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false // terminal text, don't autocorrect

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

guard let results = request.results else {
  exit(0)
}

// Sort results top-to-bottom, left-to-right (Vision returns bottom-up y)
let sorted = results.sorted { a, b in
  let ay = 1.0 - a.boundingBox.origin.y - a.boundingBox.height
  let by = 1.0 - b.boundingBox.origin.y - b.boundingBox.height
  if abs(ay - by) < 0.01 {
    return a.boundingBox.origin.x < b.boundingBox.origin.x
  }
  return ay < by
}

for observation in sorted {
  if let candidate = observation.topCandidates(1).first {
    print(candidate.string)
  }
}
