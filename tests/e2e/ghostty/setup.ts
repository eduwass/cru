/**
 * Ghostty native e2e test environment.
 *
 * Opens a Ghostty tab, launches Claude Code directly (no tmux wrapper).
 * This tests the real native Ghostty flow where workers spawn in
 * headless claude-swarm tmux sessions and get mirrored into Ghostty splits.
 *
 * Terminal tracking: snapshots all terminal IDs before creating the test
 * window, then identifies test terminals by diffing. This means you can
 * switch windows/tabs during the test without breaking assertions.
 *
 * Lifecycle:
 *   1. checkGhosttyPrereqs() — verify Ghostty, claude, bun
 *   2. createGhosttyTestEnv() — new tab → claude, wait for ready
 *   3. ... run tests ...
 *   4. env.teardown() — close test terminals
 */
import { execSync, execFileSync } from 'node:child_process'
import { poll, createRunDir } from '../../helpers/common'
import { ghostty, sendLine, ghosttyAllTerminals } from '../../helpers/ghostty'

export interface GhosttyTestEnv {
  leadTerminalId: string
  runDir: string
  /** Send text to Claude via Ghostty AppleScript input. */
  send: (text: string) => Promise<void>
  /** Wait for Claude to be running (via process detection). */
  waitForClaudeReady: (timeout?: number) => Promise<void>
  /** Count terminals belonging to this test (not other windows). */
  terminalCount: () => number
  /** Get terminal IDs belonging to this test. */
  terminalIds: () => string[]
  /** Tear down the test environment. */
  teardown: () => Promise<void>
}

export function checkGhosttyPrereqs(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Ghostty e2e tests require macOS (AppleScript)')
  }

  try {
    ghostty('get name')
  } catch {
    throw new Error('Ghostty is not running or AppleScript is not available.')
  }

  const missing: string[] = []
  for (const bin of ['claude', 'bun']) {
    try { execSync(`which ${bin}`, { encoding: 'utf-8' }) } catch { missing.push(bin) }
  }
  if (missing.length > 0) {
    throw new Error(`Missing prerequisites: ${missing.join(', ')}`)
  }
}

let _env: GhosttyTestEnv | null = null

export async function createGhosttyTestEnv(testName = 'test'): Promise<GhosttyTestEnv> {
  if (_env) return _env

  checkGhosttyPrereqs()

  const cwd = process.cwd()
  const runDir = createRunDir(testName)

  // Snapshot all terminal IDs BEFORE creating the test window
  const terminalsBefore = new Set(ghosttyAllTerminals())

  // 1. Open a new Ghostty window
  ghostty('activate')
  await Bun.sleep(300)
  ghostty('new window')
  await Bun.sleep(1000)

  const leadTerminalId = ghostty('get id of focused terminal of selected tab of front window')
  console.log(`  [setup] ghostty terminal=${leadTerminalId}`)

  // 2. cd to project and install skill
  sendLine(leadTerminalId, `cd ${cwd}`)
  await Bun.sleep(300)
  sendLine(leadTerminalId, 'bun src/cli.ts init --force')
  await Bun.sleep(1500)

  // 3. Start Claude
  sendLine(leadTerminalId, 'claude --dangerously-skip-permissions')
  console.log('  [setup] waiting for Claude to start...')

  // 4. Wait for Claude process to appear
  await poll(
    async () => {
      try {
        const result = execFileSync('pgrep', ['-f', 'claude.*dangerously'], { encoding: 'utf-8' }).trim()
        return result ? true : null
      } catch { return null }
    },
    { timeout: 30_000, interval: 1_000, label: 'Claude process started' },
  )
  // Give TUI time to render
  await Bun.sleep(5_000)
  console.log('  [setup] Claude ready')

  /** Get terminal IDs that belong to this test (created after our snapshot). */
  function getTestTerminals(): string[] {
    const all = ghosttyAllTerminals()
    return all.filter((id) => !terminalsBefore.has(id))
  }

  const env: GhosttyTestEnv = {
    leadTerminalId,
    runDir,

    async send(text: string) {
      await Bun.sleep(1_000)
      sendLine(leadTerminalId, text)
    },

    async waitForClaudeReady(timeout = 60_000) {
      await poll(
        async () => {
          try {
            execFileSync('pgrep', ['-f', 'claude.*dangerously'], { encoding: 'utf-8' })
            return true
          } catch { return null }
        },
        { timeout, interval: 2_000, label: 'Claude process alive' },
      )
    },

    terminalCount() {
      return getTestTerminals().length
    },

    terminalIds() {
      return getTestTerminals()
    },

    async teardown() {
      // Close only test terminals, not user's other windows
      for (const id of getTestTerminals()) {
        try { ghostty(`close terminal id "${id}"`) } catch {}
      }
      _env = null
    },
  }

  _env = env
  return env
}
