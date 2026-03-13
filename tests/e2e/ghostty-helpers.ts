/**
 * Ghostty e2e test helpers.
 *
 * Uses AppleScript for pane management and macOS Vision OCR for screen reading.
 * Mirrors the iTerm2 helpers API where possible.
 */
import { execSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const HELPERS_DIR = dirname(new URL(import.meta.url).pathname)
const OCR_SWIFT = join(HELPERS_DIR, 'ocr.swift')
const OCR_BIN = join(HELPERS_DIR, 'ocr')

// ---------------------------------------------------------------------------
// OCR binary management
// ---------------------------------------------------------------------------

/** Compile the OCR Swift helper if needed. */
export function ensureOcrBinary(): void {
  if (existsSync(OCR_BIN)) return
  const result = spawnSync('swiftc', [OCR_SWIFT, '-o', OCR_BIN, '-framework', 'Vision', '-framework', 'AppKit'], {
    encoding: 'utf-8',
    timeout: 60_000,
  })
  if (result.status !== 0) {
    throw new Error(`Failed to compile OCR helper: ${result.stderr}`)
  }
}

/** Run OCR on an image file. Returns recognized text. */
export function ocr(imagePath: string): string {
  ensureOcrBinary()
  return execSync(`${OCR_BIN} ${JSON.stringify(imagePath)}`, { encoding: 'utf-8' }).trim()
}

// ---------------------------------------------------------------------------
// Ghostty AppleScript helpers
// ---------------------------------------------------------------------------

function ghostty(script: string): string {
  const wrapped = `tell application "Ghostty"\n${script}\nend tell`
  return execSync(`osascript -e ${JSON.stringify(wrapped)}`, { encoding: 'utf-8' }).trim()
}

/** Get Ghostty's frontmost window ID. */
export function getWindowId(): string {
  return ghostty('get id of front window')
}

/** Get the focused terminal ID. */
export function getFocusedTerminal(): string {
  return ghostty('get id of focused terminal of selected tab of front window')
}

/** List all terminal IDs in a window. */
export function listTerminals(windowId: string): string[] {
  const ids = ghostty(`get id of every terminal of window id ${windowId}`)
  if (!ids) return []
  return ids.split(', ')
}

/** Split a terminal. Returns the new terminal's ID. */
export function splitTerminal(terminalId: string, direction: 'right' | 'down' = 'right'): string {
  ghostty(`split terminal id ${terminalId} direction ${direction}`)
  return getFocusedTerminal()
}

/** Send text to a terminal (paste-style). */
export function sendText(terminalId: string, text: string): void {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  ghostty(`input text "${escaped}" to terminal id ${terminalId}`)
}

/** Send text followed by a newline (like pressing Enter). */
export function sendLine(terminalId: string, text: string): void {
  sendText(terminalId, text + '\n')
}

/** Close a terminal. */
export function closeTerminal(terminalId: string): void {
  try {
    ghostty(`close terminal id ${terminalId}`)
  } catch {
    // may already be closed
  }
}

/** Focus a terminal. */
export function focusTerminal(terminalId: string): void {
  ghostty(`focus terminal id ${terminalId}`)
}

// ---------------------------------------------------------------------------
// Screenshot + OCR
// ---------------------------------------------------------------------------

/** Take a screenshot of the Ghostty window. Returns the image path. */
export function screenshot(outPath?: string): string {
  const windowId = getWindowId()
  const path = outPath || `/tmp/cru-ghostty-${Date.now()}.png`
  execSync(`screencapture -l${windowId} ${JSON.stringify(path)}`, { encoding: 'utf-8' })
  return path
}

/**
 * Capture the Ghostty window and OCR it. Returns recognized text.
 * This is the Ghostty equivalent of iTerm2's `getScreen()` / `getBuffer()`.
 */
export function captureAndRead(opts?: { waitMs?: number }): string {
  if (opts?.waitMs) Bun.sleepSync(opts.waitMs)
  const path = screenshot()
  return ocr(path)
}

/**
 * Wait until the screen contains specific text.
 * Polls via screenshot + OCR.
 */
export function waitForText(
  text: string,
  opts?: { timeout?: number; interval?: number; waitMs?: number },
): string {
  const timeout = opts?.timeout ?? 30_000
  const interval = opts?.interval ?? 2_000
  const waitMs = opts?.waitMs ?? 500
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const screen = captureAndRead({ waitMs })
    if (screen.includes(text)) return screen
    Bun.sleepSync(interval)
  }

  throw new Error(`Timed out waiting for text: "${text}" (${timeout}ms)`)
}

/**
 * Wait until the screen matches a regex.
 * Returns the match result.
 */
export function waitForMatch(
  pattern: RegExp,
  opts?: { timeout?: number; interval?: number; waitMs?: number },
): RegExpMatchArray {
  const timeout = opts?.timeout ?? 30_000
  const interval = opts?.interval ?? 2_000
  const waitMs = opts?.waitMs ?? 500
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const screen = captureAndRead({ waitMs })
    const match = screen.match(pattern)
    if (match) return match
    Bun.sleepSync(interval)
  }

  throw new Error(`Timed out waiting for match: ${pattern} (${timeout}ms)`)
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

/** Poll a function until it returns a truthy value. */
export async function poll<T>(
  fn: () => T | Promise<T>,
  opts?: { timeout?: number; interval?: number; label?: string },
): Promise<T> {
  const timeout = opts?.timeout ?? 30_000
  const interval = opts?.interval ?? 1_000
  const label = opts?.label ?? 'poll'
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const result = await fn()
    if (result) return result
    Bun.sleepSync(interval)
  }

  throw new Error(`${label}: timed out after ${timeout}ms`)
}

/** Wait for a specific number of terminals in a window. */
export function waitForTerminals(windowId: string, expected: number, timeout = 30_000): string[] {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const terminals = listTerminals(windowId)
    if (terminals.length >= expected) return terminals
    Bun.sleepSync(500)
  }
  throw new Error(`Timed out waiting for ${expected} terminals (${timeout}ms)`)
}

// ---------------------------------------------------------------------------
// Debug snapshots
// ---------------------------------------------------------------------------

/** Save a debug snapshot (screenshot + OCR text) for test debugging. */
export function saveDebugSnapshot(label: string, outDir: string): void {
  const { mkdirSync, writeFileSync } = require('node:fs')
  mkdirSync(outDir, { recursive: true })

  const imgPath = join(outDir, `${label}.png`)
  screenshot(imgPath)

  const text = ocr(imgPath)
  writeFileSync(join(outDir, `${label}.txt`), text)
}
