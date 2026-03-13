/**
 * Ghostty e2e test environment setup.
 *
 * Creates a new Ghostty window via AppleScript, runs commands in it,
 * and uses screenshot + Vision OCR for assertions.
 *
 * Lifecycle:
 *   1. checkGhosttyPrereqs() — verify Ghostty, claude, cru are available
 *   2. createGhosttyTestEnv() — new window → cru init → claude
 *   3. ... run tests ...
 *   4. env.resetForNextTest() — close worker splits
 *   5. env.teardown() — close the test window
 */
import { execSync } from 'node:child_process'
import {
  ensureOcrBinary,
  ocr,
  screenshot,
  sendLine,
  sendText,
  splitTerminal,
  closeTerminal,
  focusTerminal,
  listTerminals,
  poll,
  waitForText,
  saveDebugSnapshot,
} from './ghostty-helpers'
import { createRunDir } from './helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhosttyTestEnv {
  /** Ghostty window ID. */
  windowId: string
  /** Lead terminal ID (where Claude runs). */
  leadTerminalId: string
  /** Run directory for artifacts. */
  runDir: string
  /** Send a line of text to the lead terminal. */
  send: (text: string) => void
  /** Read the screen via screenshot + OCR. */
  readScreen: (opts?: { waitMs?: number }) => string
  /** List terminal IDs in the test window. */
  listTerminals: () => string[]
  /** Wait for a specific terminal count. */
  waitForTerminalCount: (expected: number, timeout?: number) => string[]
  /** Wait until screen contains text. */
  waitForText: (text: string, timeout?: number) => string
  /** Save a debug snapshot (screenshot + OCR dump). */
  snapshot: (label: string) => void
  /** Close worker terminals, keep lead. */
  resetForNextTest: () => void
  /** Close the entire test window. */
  teardown: () => void
}

// ---------------------------------------------------------------------------
// AppleScript helpers (test-specific)
// ---------------------------------------------------------------------------

function ghostty(script: string): string {
  const wrapped = `tell application "Ghostty"\n${script}\nend tell`
  return execSync('osascript', { input: wrapped, encoding: 'utf-8' }).trim()
}

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

export function checkGhosttyPrereqs(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Ghostty e2e tests require macOS (AppleScript)')
  }

  // Check Ghostty is running and scriptable
  try {
    ghostty('get name')
  } catch {
    throw new Error('Ghostty is not running or AppleScript is disabled. Set macos-applescript = true in Ghostty config.')
  }

  // Check cru and claude are available
  const missing: string[] = []
  for (const bin of ['claude', 'bun']) {
    try {
      execSync(`which ${bin}`, { encoding: 'utf-8' })
    } catch {
      missing.push(bin)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing prerequisites: ${missing.join(', ')}`)
  }
}

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

let _env: GhosttyTestEnv | null = null

export function createGhosttyTestEnv(testName = 'test'): GhosttyTestEnv {
  if (_env) return _env

  checkGhosttyPrereqs()
  ensureOcrBinary()

  const cwd = process.cwd()
  const runDir = createRunDir(testName)

  // 1. Create a new Ghostty window
  ghostty('activate')
  Bun.sleepSync(300)
  ghostty('new window')
  Bun.sleepSync(1000) // let shell start

  // 2. Get window and lead terminal IDs
  const windowId = ghostty('get id of front window')
  const leadTerminalId = ghostty('get id of focused terminal of selected tab of front window')

  console.log(`  [setup] ghostty window=${windowId} lead=${leadTerminalId}`)

  // 3. Set up test environment
  sendLine(leadTerminalId, `cd ${cwd}`)
  Bun.sleepSync(300)
  sendLine(leadTerminalId, 'bun src/cli.ts init --force')
  Bun.sleepSync(1500)

  const env: GhosttyTestEnv = {
    windowId,
    leadTerminalId,
    runDir,

    send(text: string) {
      focusTerminal(leadTerminalId)
      sendLine(leadTerminalId, text)
    },

    readScreen(opts?: { waitMs?: number }) {
      const waitMs = opts?.waitMs ?? 500
      Bun.sleepSync(waitMs)
      const imgPath = screenshot()
      return ocr(imgPath)
    },

    listTerminals() {
      return listTerminals(windowId)
    },

    waitForTerminalCount(expected: number, timeout = 30_000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const terms = listTerminals(windowId)
        if (terms.length >= expected) return terms
        Bun.sleepSync(500)
      }
      throw new Error(`Timed out waiting for ${expected} terminals (${timeout}ms)`)
    },

    waitForText(text: string, timeout = 30_000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const screen = env.readScreen({ waitMs: 500 })
        if (screen.includes(text)) return screen
        Bun.sleepSync(1500)
      }
      throw new Error(`Timed out waiting for text: "${text}" (${timeout}ms)`)
    },

    snapshot(label: string) {
      saveDebugSnapshot(label, runDir)
    },

    resetForNextTest() {
      const terms = listTerminals(windowId)
      // Close all terminals except the lead
      for (const id of terms) {
        if (id !== leadTerminalId) {
          closeTerminal(id)
        }
      }
      Bun.sleepSync(500)
    },

    teardown() {
      // Ghostty doesn't support `close window` — close all terminals instead
      try {
        const terms = listTerminals(windowId)
        for (const id of terms) {
          try { ghostty(`close terminal id "${id}"`) } catch {}
        }
      } catch {
        // window may already be closed
      }
      _env = null
    },
  }

  _env = env
  return env
}
