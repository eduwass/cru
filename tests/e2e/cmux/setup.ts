/**
 * cmux native e2e test environment.
 *
 * Creates a new cmux workspace, launches Claude Code directly.
 * This tests the real native cmux flow where workers spawn in
 * headless claude-swarm tmux sessions and get mirrored into cmux splits.
 *
 * Lifecycle:
 *   1. checkCmuxPrereqs() — verify cmux, claude, bun
 *   2. createCmuxTestEnv() — new workspace → claude, wait for ready
 *   3. ... run tests ...
 *   4. env.teardown() — close test surfaces
 */
import { execSync, execFileSync } from 'node:child_process'
import { poll, createRunDir } from '../../helpers/common'
import { isCmuxAvailable, currentSurface, sendLine, listSurfaceIds, splitSurface, closeSurface } from '../../helpers/cmux'

export interface CmuxTestEnv {
  leadSurfaceId: string
  runDir: string
  /** Send text to Claude via cmux send. */
  send: (text: string) => Promise<void>
  /** Wait for Claude to be running (via process detection). */
  waitForClaudeReady: (timeout?: number) => Promise<void>
  /** Count surfaces in the current workspace. */
  surfaceCount: () => number
  /** Get surface IDs in the current workspace. */
  surfaceIds: () => string[]
  /** Tear down the test environment. */
  teardown: () => Promise<void>
}

export function checkCmuxPrereqs(): void {
  if (!process.env.CMUX_WORKSPACE_ID) {
    throw new Error('Not inside a cmux terminal. Run this test from cmux.')
  }

  if (!isCmuxAvailable()) {
    throw new Error('cmux socket is not responding.')
  }

  const missing: string[] = []
  for (const bin of ['claude', 'bun']) {
    try { execSync(`which ${bin}`, { encoding: 'utf-8' }) } catch { missing.push(bin) }
  }
  if (missing.length > 0) {
    throw new Error(`Missing prerequisites: ${missing.join(', ')}`)
  }
}

let _env: CmuxTestEnv | null = null

export async function createCmuxTestEnv(testName = 'test'): Promise<CmuxTestEnv> {
  if (_env) return _env

  checkCmuxPrereqs()

  const cwd = process.cwd()
  const runDir = createRunDir(testName)

  // Snapshot surfaces before creating test environment
  const surfacesBefore = new Set(listSurfaceIds())

  // Get the current lead surface (the one running this test)
  const leadSurfaceId = currentSurface()

  // Create a new split for Claude, explicitly relative to our surface
  const claudeSurfaceId = splitSurface('right', leadSurfaceId)
  await Bun.sleep(500)

  console.log(`  [setup] cmux lead=${leadSurfaceId}, claude=${claudeSurfaceId}`)

  // cd to project and install skill
  sendLine(claudeSurfaceId, `cd ${cwd}`)
  await Bun.sleep(300)
  sendLine(claudeSurfaceId, 'bun src/cli.ts init --force')
  await Bun.sleep(1500)

  // Start Claude
  sendLine(claudeSurfaceId, 'claude --dangerously-skip-permissions')
  console.log('  [setup] waiting for Claude to start...')

  // Wait for Claude process to appear
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

  /** Get surface IDs that belong to this test (created after snapshot). */
  function getTestSurfaces(): string[] {
    const all = listSurfaceIds()
    // Include all surfaces except the original ones before test
    return all.filter((id) => !surfacesBefore.has(id) || id === claudeSurfaceId)
  }

  const env: CmuxTestEnv = {
    leadSurfaceId: claudeSurfaceId,
    runDir,

    async send(text: string) {
      await Bun.sleep(1_000)
      sendLine(claudeSurfaceId, text)
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

    surfaceCount() {
      return listSurfaceIds().length
    },

    surfaceIds() {
      return getTestSurfaces()
    },

    async teardown() {
      // Close only test surfaces, not the test runner
      for (const id of getTestSurfaces()) {
        closeSurface(id)
      }
      _env = null
    },
  }

  _env = env
  return env
}
