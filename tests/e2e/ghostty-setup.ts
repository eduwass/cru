/**
 * Ghostty e2e test environment setup.
 *
 * Creates a new Ghostty window via AppleScript, launches Claude Code,
 * and uses screenshot + Vision OCR for assertions and readiness detection.
 *
 * Lifecycle:
 *   1. checkGhosttyPrereqs() — verify Ghostty, claude, cru are available
 *   2. createGhosttyTestEnv() — new window → cru init → claude, wait for ready
 *   3. ... run tests ...
 *   4. env.resetForNextTest() — close worker splits, wait for Claude prompt
 *   5. env.teardown() — close the test window
 */
import { execSync } from 'node:child_process'
import {
  ensureOcrBinary,
  ocr,
  screenshot,
  sendLine,
  sendText,
  closeTerminal,
  focusTerminal,
  listTerminals,
  listAllTerminals,
  saveDebugSnapshot,
} from './ghostty-helpers'
import { createRunDir } from './helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhosttyTestEnv {
  /** Ghostty window ID (AppleScript format, e.g. tab-group-...). */
  windowId: string
  /** Lead terminal ID (where Claude runs). */
  leadTerminalId: string
  /** Run directory for artifacts. */
  runDir: string
  /** Send a line of text to the lead terminal. */
  send: (text: string) => void
  /** Send text without newline. */
  sendRaw: (text: string) => void
  /** Read the screen via screenshot + OCR. */
  readScreen: (opts?: { waitMs?: number }) => string
  /** List terminal IDs in the test window. */
  listTerminals: () => string[]
  /** Wait for a specific terminal count. */
  waitForTerminalCount: (expected: number, timeout?: number) => string[]
  /** Wait until screen contains text. */
  waitForText: (text: string, timeout?: number) => string
  /** Wait for Claude to be idle and at prompt. */
  waitForClaudeReady: (timeout?: number) => string
  /** Save a debug snapshot (screenshot + OCR dump). */
  snapshot: (label: string) => void
  /** Close worker terminals, keep lead, wait for Claude prompt. */
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
// Claude readiness detection via OCR
// ---------------------------------------------------------------------------

/**
 * Markers that indicate Claude is ready for input.
 * These appear in Claude Code's TUI when it's idle and waiting.
 */
const CLAUDE_READY_MARKERS = [
  'bypass permissions on',    // dangerously-skip-permissions prompt
  'is waiting for your input',
  'What would you like to do',
  'shift+tab to cycle',       // prompt hint
]

function isClaudeReadyScreen(screen: string): boolean {
  return CLAUDE_READY_MARKERS.some((m) => screen.includes(m))
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

export function createGhosttyTestEnv(testName = 'test', opts?: { launchClaude?: boolean }): GhosttyTestEnv {
  if (_env) return _env

  const launchClaude = opts?.launchClaude ?? true

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

  // 3. Set up test environment — cd to project, install skill
  sendLine(leadTerminalId, `cd ${cwd}`)
  Bun.sleepSync(300)
  sendLine(leadTerminalId, 'bun src/cli.ts init --force')
  Bun.sleepSync(1500)

  // 4. Launch Claude Code (if requested)
  if (launchClaude) {
    sendLine(leadTerminalId, 'claude --dangerously-skip-permissions')
    console.log('  [setup] waiting for Claude to be ready...')
  }

  // Build the env object
  const env: GhosttyTestEnv = {
    windowId,
    leadTerminalId,
    runDir,

    send(text: string) {
      focusTerminal(leadTerminalId)
      sendLine(leadTerminalId, text)
    },

    sendRaw(text: string) {
      focusTerminal(leadTerminalId)
      sendText(leadTerminalId, text)
    },

    readScreen(opts?: { waitMs?: number }) {
      const waitMs = opts?.waitMs ?? 500
      Bun.sleepSync(waitMs)
      // Ensure Ghostty is frontmost so screencapture gets the rendered content
      ghostty('activate')
      Bun.sleepSync(200)
      const imgPath = screenshot()
      return ocr(imgPath)
    },

    listTerminals() {
      return listTerminals(windowId)
    },

    waitForTerminalCount(expected: number, timeout = 30_000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        // Use listAllTerminals since we can't query by window ID reliably
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

    waitForClaudeReady(timeout = 90_000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const screen = env.readScreen({ waitMs: 1000 })
        if (isClaudeReadyScreen(screen)) return screen
        Bun.sleepSync(2000)
      }
      throw new Error(`Timed out waiting for Claude to be ready (${timeout}ms)`)
    },

    snapshot(label: string) {
      saveDebugSnapshot(label, runDir)
    },

    resetForNextTest() {
      const terms = listTerminals(windowId)
      for (const id of terms) {
        if (id !== leadTerminalId) {
          closeTerminal(id)
        }
      }
      Bun.sleepSync(1000)
      // Wait for Claude to return to prompt
      if (launchClaude) {
        env.waitForClaudeReady(60_000)
      }
    },

    teardown() {
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

  // 5. Wait for Claude to be ready
  if (launchClaude) {
    env.waitForClaudeReady(90_000)
    console.log('  [setup] Claude ready')
  }

  _env = env
  return env
}
