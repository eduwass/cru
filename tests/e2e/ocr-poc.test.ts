/**
 * POC: Vision OCR for terminal screen reading.
 *
 * Verifies that macOS Vision framework can extract text from terminal
 * screenshots — proving the approach works for Ghostty e2e test assertions.
 *
 * Run: bun test tests/e2e/ocr-poc.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { ensureOcrBinary, ocr } from './ghostty-helpers'

// Pre-generate the known-text test image before tests run.
// Done here (not in beforeAll) so Swift compilation doesn't eat test timeout.
const KNOWN_IMG = '/tmp/cru-ocr-known.png'
const SCREEN_IMG = '/tmp/cru-ocr-screen.png'

function generateTestImage() {
  const script = `
import AppKit
import Foundation
let size = NSSize(width: 800, height: 200)
let img = NSImage(size: size)
img.lockFocus()
NSColor.black.setFill()
NSRect(origin: .zero, size: size).fill()
let attrs: [NSAttributedString.Key: Any] = [
  .foregroundColor: NSColor.green,
  .font: NSFont.monospacedSystemFont(ofSize: 24, weight: .regular)
]
"CRU_TEST_MARKER_12345".draw(at: NSPoint(x: 20, y: 140), withAttributes: attrs)
"workers: 4".draw(at: NSPoint(x: 20, y: 100), withAttributes: attrs)
"grid_size: 2x2".draw(at: NSPoint(x: 20, y: 60), withAttributes: attrs)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: "${KNOWN_IMG}"))
`
  const swiftPath = '/tmp/cru-ocr-gen.swift'
  writeFileSync(swiftPath, script)
  execSync(`swift ${swiftPath}`, { timeout: 30_000 })
}

describe('Vision OCR POC', () => {
  beforeAll(() => {
    ensureOcrBinary()
    generateTestImage()
    execSync(`screencapture -D1 -x ${SCREEN_IMG}`)
  })

  test('reads text from a real screen capture', () => {
    const text = ocr(SCREEN_IMG)
    expect(text.length).toBeGreaterThan(0)
    console.log(`OCR extracted ${text.length} chars, ${text.split('\n').length} lines`)
  })

  test('accurately reads known text from a generated image', () => {
    const text = ocr(KNOWN_IMG)
    expect(text).toContain('CRU_TEST_MARKER_12345')
    expect(text).toContain('workers: 4')
    expect(text).toContain('grid_size: 2x2')
    console.log('OCR result:', text)
  })
})
