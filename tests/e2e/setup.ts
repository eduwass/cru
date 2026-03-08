/**
 * E2E test environment setup.
 *
 * Creates an isolated tmux session (separate iTerm2 window in -CC mode)
 * with Claude Code for testing. Tests run there without interfering with
 * your work.
 *
 * Lifecycle:
 *   1. checkPrereqs()     — verify it2, tmux, claude are available
 *   2. createTestEnv()    — new tmux session, start claude, wait for ready
 *   3. ... run tests ...
 *   4. env.resetForNextTest() — kill worker panes, wait for Claude prompt
 *   5. env.teardown()     — kill the test session (closes the window)
 */
import { $ } from 'bun'
import { poll } from './helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestEnv {
  /** iTerm2 session ID of the lead (Claude Code) session. */
  sessionId: string
  /** tmux window ID where the test is running. */
  tmuxWindow: string
  /** tmux session name (for teardown). */
  tmuxSession: string
  /** Send a command to the lead Claude session. */
  send: (text: string) => Promise<void>
  /** Capture the visible screen of a session. */
  captureScreen: (sessionId?: string) => Promise<string>
  /** List tmux panes in the test window. */
  listPanes: () => Promise<TmuxPane[]>
  /** Wait for a specific pane count in the test window. */
  waitForPaneCount: (expected: number, timeout?: number) => Promise<TmuxPane[]>
  /** Wait for pane count in a range. */
  waitForPaneCountInRange: (min: number, max: number, timeout?: number) => Promise<TmuxPane[]>
  /** Kill worker panes and wait for Claude to return to prompt. */
  resetForNextTest: () => Promise<void>
  /** Close the test session entirely. */
  teardown: () => Promise<void>
}

export interface TmuxPane {
  id: string
  index: number
  width: number
  height: number
  pid: number
}

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

export async function checkPrereqs(): Promise<void> {
  const checks = [
    { name: 'it2', cmd: 'which it2' },
    { name: 'tmux', cmd: 'which tmux' },
    { name: 'claude', cmd: 'which claude' },
  ]

  const missing: string[] = []
  for (const { name, cmd } of checks) {
    const result = await $`${{ raw: cmd }}`.nothrow().quiet()
    if (result.exitCode !== 0) missing.push(name)
  }

  if (missing.length > 0) {
    throw new Error(`Missing prerequisites: ${missing.join(', ')}`)
  }

  // Check iTerm2 API is reachable
  const auth = await $`it2 auth check`.nothrow().quiet()
  if (auth.exitCode !== 0) {
    throw new Error('iTerm2 API not reachable. Enable it in Preferences > General > Magic > Enable Python API')
  }

  // Check tmux is running
  const tmux = await $`tmux display-message -p '#{session_name}'`.nothrow().quiet()
  if (tmux.exitCode !== 0) {
    throw new Error('Not inside a tmux session. E2E tests require tmux.')
  }
}

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

/** Singleton — only one test env per process. */
let _env: TestEnv | null = null

export async function createTestEnv(): Promise<TestEnv> {
  if (_env) return _env

  await checkPrereqs()

  const cwd = process.cwd()

  // Create a new tmux SESSION (not window).
  // In -CC mode, a new session = a new iTerm2 window.
  // A new window would just be a tab in the same iTerm2 window.
  const tmuxSession = `cru-e2e-${Date.now()}`
  const sessionInfo = (
    await $`tmux new-session -d -s ${tmuxSession} -x 200 -y 50 -P -F '#{window_id} #{pane_id} #{pane_pid}'`.text()
  ).trim()
  const [tmuxWindow, leadPaneId, shellPid] = sessionInfo.split(' ')

  // Set a unique pane title so we can find the iTerm2 session by title if PID matching fails
  await $`tmux select-pane -t ${leadPaneId} -T ${tmuxSession}`.nothrow()

  console.log(`  [setup] tmux session=${tmuxSession} window=${tmuxWindow} pane=${leadPaneId} pid=${shellPid}`)

  // Navigate to project dir, install skill, then start Claude
  await $`tmux send-keys -t ${leadPaneId} ${'cd ' + cwd} Enter`.nothrow()
  await Bun.sleep(300)
  await $`tmux send-keys -t ${leadPaneId} 'bun src/cli.ts init --force' Enter`.nothrow()
  await Bun.sleep(1500)
  await $`tmux send-keys -t ${leadPaneId} 'claude --dangerously-skip-permissions' Enter`.nothrow()

  // Find the iTerm2 session for this tmux pane
  await Bun.sleep(2000)
  const sessionId = await findItermSession(shellPid, tmuxSession)

  // Wait for Claude to be ready (prompt visible, no queued messages)
  await waitForClaudeReady(sessionId)

  console.log(`  [setup] ready — iterm session=${sessionId}`)

  const env: TestEnv = {
    sessionId,
    tmuxWindow,
    tmuxSession,

    async send(text: string) {
      // Wait for Claude to be at an idle prompt before sending
      await waitForClaudeReady(sessionId, 60_000)
      await $`it2 session send-text ${sessionId} --skip-confirm ${text}`
    },

    async captureScreen(sid?: string) {
      const target = sid ?? sessionId
      return $`it2 get-screen ${target} --wait-stable`.text()
    },

    async listPanes() {
      const out = await $`tmux list-panes -t ${tmuxWindow} -F '#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_pid}'`
        .nothrow()
        .text()

      return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
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
      // Kill all panes except the lead (reverse order to avoid index shifts)
      for (const pane of panes.reverse()) {
        if (pane.id !== leadPaneId) {
          await $`tmux kill-pane -t ${pane.id}`.nothrow().quiet()
        }
      }
      await waitForClaudeReady(sessionId, 30_000)
    },

    async teardown() {
      // Kill the entire tmux session (closes the iTerm2 window in -CC mode)
      await $`tmux kill-session -t ${tmuxSession}`.nothrow().quiet()
      _env = null
    },
  }

  _env = env
  return env
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wait until a Claude Code session is ready (idle, at prompt, no queued messages).
 * Uses it2 session list PluginData instead of standalone extension scripts.
 */
async function waitForClaudeReady(sessionId: string, timeout = 90_000) {
  await poll(
    async () => {
      const sessions: any[] = await $`it2 session list --format json`.nothrow().json()
      const session = sessions.find((s) => s.SessionID === sessionId)
      if (!session) return null

      const plugins = session.PluginData ?? {}
      const noQueued = plugins['has-no-queued-claude-messages'] === 'true'
      const noModal = plugins['claude-has-modal'] === 'none'

      return noQueued && noModal ? true : null
    },
    { timeout, interval: 2_000, label: 'Claude ready' },
  )
}

/**
 * Find the iTerm2 session ID for our test tmux pane.
 * Tries PID matching first, then falls back to window title matching.
 */
async function findItermSession(pid: string, tmuxSessionName: string): Promise<string> {
  // Also set the iTerm2 window title so we can match on it as a fallback
  // In -CC mode, we can find the window via `it2 window list` and match by title
  // But first try the simpler PID approach
  return poll(
    async () => {
      const sessions: any[] = await $`it2 session list --format json`.nothrow().json()

      // Try 1: PID match (most reliable when available)
      const pidMatch = sessions.find((s) => String(s.ShellPID) === pid)
      if (pidMatch) return pidMatch.SessionID

      // Try 2: Window title match — tmux session name shows as window/tab title in -CC mode
      const titleMatch = sessions.find(
        (s) =>
          s.WindowTitle?.includes(tmuxSessionName) ||
          s.TabTitle?.includes(tmuxSessionName) ||
          s.SessionName?.includes(tmuxSessionName),
      )
      if (titleMatch) return titleMatch.SessionID

      return null
    },
    { timeout: 15_000, interval: 500, label: `iTerm2 session for test env` },
  )
}
