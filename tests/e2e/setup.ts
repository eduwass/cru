/**
 * E2E test environment setup.
 *
 * Creates a new iTerm2 window, starts tmux -CC in it, then launches Claude
 * Code. Tests run in that isolated window without interfering with your work.
 *
 * Lifecycle:
 *   1. checkPrereqs()     — verify it2, tmux, claude are available
 *   2. createTestEnv()    — new window → tmux -CC → claude, wait for ready
 *   3. ... run tests ...
 *   4. env.resetForNextTest() — kill worker panes, wait for Claude prompt
 *   5. env.teardown()     — kill the tmux session (closes the window)
 */
import { $ } from 'bun'
import { poll, createRunDir } from './helpers'

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
  /** Lead tmux pane ID. */
  leadPaneId: string
  /** Run directory for artifacts (screenshots, pane captures, logs). */
  runDir: string
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
}

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

/** Singleton — only one test env per process. */
let _env: TestEnv | null = null

export async function createTestEnv(testName = 'test'): Promise<TestEnv> {
  if (_env) return _env

  await checkPrereqs()

  const cwd = process.cwd()
  const tmuxSession = `cru-e2e-${Date.now()}`
  const runDir = createRunDir(testName)

  // Snapshot existing iTerm2 sessions so we can detect the new one
  const beforeSessions = new Set(
    ((await $`it2 session list --format json`.nothrow().json()) as any[]).map((s) => s.SessionID),
  )

  // 1. Create a new iTerm2 window
  const winOutput = (await $`it2 window create`.text()).trim()
  const winSessionMatch = winOutput.match(/Session ID:\s*(.+)/)
  if (!winSessionMatch) {
    throw new Error(`Could not parse Session ID from it2 window create:\n${winOutput}`)
  }
  const nativeSessionId = winSessionMatch[1].trim()

  console.log(`  [setup] native window session=${nativeSessionId}`)

  // 2. Start tmux -CC in the new window
  await Bun.sleep(500)
  await $`it2 session send-text ${nativeSessionId} --skip-confirm ${'tmux -CC new-session -s ' + tmuxSession}`

  // 3. Wait for the tmux session to appear and find its pane info
  await poll(
    async () => {
      const out = await $`tmux has-session -t ${tmuxSession}`.nothrow().quiet()
      return out.exitCode === 0 ? true : null
    },
    { timeout: 10_000, interval: 500, label: 'tmux session created' },
  )

  // Get the tmux window/pane info
  const paneInfo = (
    await $`tmux list-panes -t ${tmuxSession} -F '#{window_id} #{pane_id} #{pane_pid}'`.text()
  ).trim()
  const [tmuxWindow, leadPaneId, shellPid] = paneInfo.split(' ')

  console.log(`  [setup] tmux session=${tmuxSession} window=${tmuxWindow} pane=${leadPaneId} pid=${shellPid}`)

  // 4. Find the iTerm2 session for the tmux pane (new session created by -CC mode)
  const sessionId = await poll(
    async () => {
      const sessions: any[] = await $`it2 session list --format json`.nothrow().json()
      // Match by PID
      const pidMatch = sessions.find((s) => String(s.ShellPID) === shellPid)
      if (pidMatch) return pidMatch.SessionID as string
      // Fallback: find a session that didn't exist before
      const newSession = sessions.find((s) => !beforeSessions.has(s.SessionID) && s.SessionID !== nativeSessionId)
      if (newSession) return newSession.SessionID as string
      return null
    },
    { timeout: 15_000, interval: 500, label: 'iTerm2 session for tmux pane' },
  )

  console.log(`  [setup] iterm session=${sessionId}`)

  // 5. Resize the iTerm2 window to a proper size for readable layouts
  const sessionInfo: any[] = await $`it2 session list --format json`.nothrow().json()
  const itermSession = sessionInfo.find((s) => s.SessionID === sessionId)
  if (itermSession?.WindowID) {
    const frame = '{"origin":{"x":0,"y":0},"size":{"width":1400,"height":900}}'
    await $`it2 window set-property ${itermSession.WindowID} frame ${frame}`.nothrow().quiet()
    await Bun.sleep(500) // let iTerm2 + tmux settle after resize
    console.log(`  [setup] resized window ${itermSession.WindowID} to 1400x900`)
  }

  // 5. Set up the test environment — install skill, start Claude
  await $`tmux send-keys -t ${leadPaneId} ${'cd ' + cwd} Enter`.nothrow()
  await Bun.sleep(300)
  await $`tmux send-keys -t ${leadPaneId} 'bun src/cli.ts init --force' Enter`.nothrow()
  await Bun.sleep(1500)
  await $`tmux send-keys -t ${leadPaneId} 'claude --dangerously-skip-permissions' Enter`.nothrow()

  // 6. Wait for Claude to be ready
  await waitForClaudeReady(sessionId)

  console.log(`  [setup] Claude ready`)

  const env: TestEnv = {
    sessionId,
    tmuxWindow,
    tmuxSession,
    leadPaneId,
    runDir,

    async send(text: string) {
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
      for (const pane of panes.reverse()) {
        if (pane.id !== leadPaneId) {
          await $`tmux kill-pane -t ${pane.id}`.nothrow().quiet()
        }
      }
      await waitForClaudeReady(sessionId, 30_000)
    },

    async teardown() {
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
