/**
 * Ghostty e2e test environment setup.
 *
 * Creates a new Ghostty window, starts tmux inside it, then launches Claude
 * Code. Tests run in that isolated window without interfering with your work.
 *
 * This mirrors the iTerm2 setup (setup.ts) — both create a tmux session and
 * use tmux for all assertions. The only difference is window creation
 * (AppleScript vs it2) and Claude readiness detection.
 *
 * Lifecycle:
 *   1. checkGhosttyPrereqs() — verify Ghostty, tmux, claude are available
 *   2. createGhosttyTestEnv() — new window → tmux → claude, wait for ready
 *   3. ... run tests ...
 *   4. env.teardown() — kill the tmux session (closes panes)
 */
import { execSync } from 'node:child_process'
import { createRunDir, poll, captureTmuxPane } from './helpers'

// Re-export TestEnv from the shared setup — Ghostty tests use the same shape.
export type { TestEnv, TmuxPane } from './setup'
import type { TestEnv, TmuxPane } from './setup'

// ---------------------------------------------------------------------------
// AppleScript helpers (minimal — just window creation)
// ---------------------------------------------------------------------------

function ghostty(script: string): string {
  const wrapped = `tell application "Ghostty"\n${script}\nend tell`
  return execSync('osascript', { input: wrapped, encoding: 'utf-8' }).trim()
}

function sendLine(terminalId: string, text: string): void {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  ghostty(`input text "${escaped}" to terminal id "${terminalId}"`)
  ghostty(`send key "enter" to terminal id "${terminalId}"`)
}

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

export function checkGhosttyPrereqs(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Ghostty e2e tests require macOS (AppleScript)')
  }

  try {
    ghostty('get name')
  } catch {
    throw new Error('Ghostty is not running or AppleScript is disabled. Set macos-applescript = true in Ghostty config.')
  }

  const missing: string[] = []
  for (const bin of ['claude', 'bun', 'tmux']) {
    try { execSync(`which ${bin}`, { encoding: 'utf-8' }) } catch { missing.push(bin) }
  }
  if (missing.length > 0) {
    throw new Error(`Missing prerequisites: ${missing.join(', ')}`)
  }
}

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

let _env: TestEnv | null = null

export async function createGhosttyTestEnv(testName = 'test'): Promise<TestEnv> {
  if (_env) return _env

  checkGhosttyPrereqs()

  const cwd = process.cwd()
  const tmuxSession = `cru-e2e-ghostty-${Date.now()}`
  const runDir = createRunDir(testName)

  // 1. Create a new Ghostty window
  ghostty('activate')
  await Bun.sleep(300)
  ghostty('new window')
  await Bun.sleep(1000)

  const leadTerminalId = ghostty('get id of focused terminal of selected tab of front window')
  console.log(`  [setup] ghostty terminal=${leadTerminalId}`)

  // 2. Start tmux in the Ghostty terminal
  sendLine(leadTerminalId, `tmux new-session -s ${tmuxSession}`)
  await Bun.sleep(1500)

  // Wait for the tmux session
  await poll(
    async () => {
      try {
        execSync(`tmux has-session -t ${tmuxSession}`, { encoding: 'utf-8' })
        return true
      } catch { return null }
    },
    { timeout: 10_000, interval: 500, label: 'tmux session created' },
  )

  // Get tmux pane info
  const paneInfo = execSync(
    `tmux list-panes -t ${tmuxSession} -F '#{window_id} #{pane_id}'`,
    { encoding: 'utf-8' },
  ).trim()
  const [tmuxWindow, leadPaneId] = paneInfo.split(' ')

  console.log(`  [setup] tmux session=${tmuxSession} window=${tmuxWindow} pane=${leadPaneId}`)

  // 3. Set up test environment
  execSync(`tmux send-keys -t ${leadPaneId} 'cd ${cwd}' Enter`)
  await Bun.sleep(300)
  execSync(`tmux send-keys -t ${leadPaneId} 'bun src/cli.ts init --force' Enter`)
  await Bun.sleep(1500)
  execSync(`tmux send-keys -t ${leadPaneId} 'claude --dangerously-skip-permissions' Enter`)

  // 4. Wait for Claude to be ready (poll tmux pane content for prompt markers)
  console.log('  [setup] waiting for Claude to be ready...')
  await poll(
    async () => {
      const content = await captureTmuxPane(leadPaneId)
      const markers = ['bypass permissions on', 'What would you like to do', 'shift+tab']
      return markers.some((m) => content.includes(m)) ? true : null
    },
    { timeout: 90_000, interval: 2_000, label: 'Claude ready' },
  )
  console.log(`  [setup] Claude ready`)

  // 5. Build the TestEnv (same shape as iTerm setup)
  const env: TestEnv = {
    sessionId: leadTerminalId, // Ghostty terminal ID (for reference only)
    tmuxWindow,
    tmuxSession,
    leadPaneId,
    runDir,

    async send(text: string) {
      // Wait for Claude to be ready before sending
      await poll(
        async () => {
          const content = await captureTmuxPane(leadPaneId)
          const markers = ['bypass permissions on', 'What would you like to do', 'shift+tab']
          return markers.some((m) => content.includes(m)) ? true : null
        },
        { timeout: 60_000, interval: 2_000, label: 'Claude ready for input' },
      )
      execSync(`tmux send-keys -t ${leadPaneId} ${JSON.stringify(text)} Enter`)
    },

    async captureScreen(_sid?: string) {
      return captureTmuxPane(leadPaneId)
    },

    async listPanes() {
      const out = execSync(
        `tmux list-panes -t ${tmuxWindow} -F '#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_pid}'`,
        { encoding: 'utf-8' },
      ).trim()

      return out.split('\n').filter(Boolean).map((line) => {
        const [id, index, width, height, pid] = line.split(' ')
        return { id, index: Number(index), width: Number(width), height: Number(height), pid: Number(pid) }
      })
    },

    async waitForPaneCount(expected: number, timeout = 30_000) {
      return poll(
        async () => {
          const panes = await env.listPanes()
          return panes.length === expected ? panes : null
        },
        { timeout, label: `${expected} panes` },
      )
    },

    async waitForPaneCountInRange(min: number, max: number, timeout = 30_000) {
      return poll(
        async () => {
          const panes = await env.listPanes()
          return panes.length >= min && panes.length <= max ? panes : null
        },
        { timeout, label: `${min}-${max} panes` },
      )
    },

    async resetForNextTest() {
      const panes = await env.listPanes()
      for (const pane of panes.reverse()) {
        if (pane.id !== leadPaneId) {
          execSync(`tmux kill-pane -t ${pane.id}`, { encoding: 'utf-8' }).toString()
        }
      }
      await poll(
        async () => {
          const content = await captureTmuxPane(leadPaneId)
          const markers = ['bypass permissions on', 'What would you like to do', 'shift+tab']
          return markers.some((m) => content.includes(m)) ? true : null
        },
        { timeout: 30_000, interval: 2_000, label: 'Claude ready after reset' },
      )
    },

    async teardown() {
      try { execSync(`tmux kill-session -t ${tmuxSession}`) } catch {}
      // Also close the Ghostty window
      try { ghostty(`close front window`) } catch {}
      _env = null
    },
  }

  _env = env
  return env
}
