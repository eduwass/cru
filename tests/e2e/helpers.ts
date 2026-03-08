/**
 * E2E test helpers for cru + it2 + tmux.
 *
 * These helpers wrap it2 and tmux commands using Bun Shell ($)
 * to provide clean async APIs for e2e tests.
 */
import { $ } from 'bun'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pane {
  id: string
  index: number
  width: number
  height: number
  pid: number
}

export interface SessionInfo {
  leadPane: Pane
  workerPanes: Pane[]
  allPanes: Pane[]
  teamName: string
  tmuxSession: string
}

// ---------------------------------------------------------------------------
// tmux helpers
// ---------------------------------------------------------------------------

/** List all panes in a tmux target (session, window, or pane ID). */
export async function listPanes(target: string): Promise<Pane[]> {
  const out = await $`tmux list-panes -t ${target} -F '#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_pid}'`
    .text()

  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id, index, width, height, pid] = line.split(' ')
      return {
        id,
        index: Number(index),
        width: Number(width),
        height: Number(height),
        pid: Number(pid),
      }
    })
}

/** Get the pane count for a tmux target. */
export async function paneCount(target: string): Promise<number> {
  const panes = await listPanes(target)
  return panes.length
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

interface PollOptions {
  /** Max time to wait in ms. */
  timeout?: number
  /** Interval between checks in ms. */
  interval?: number
}

/**
 * Poll until a condition returns a truthy value, then return it.
 * Throws if timeout is exceeded.
 */
export async function poll<T>(
  fn: () => Promise<T>,
  opts: PollOptions & { label?: string } = {},
): Promise<NonNullable<T>> {
  const { timeout = 30_000, interval = 1_000, label = 'condition' } = opts
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const result = await fn()
    if (result) return result as NonNullable<T>
    await Bun.sleep(interval)
  }

  throw new Error(`poll timed out waiting for: ${label}`)
}

/**
 * Wait until a tmux target has exactly `expected` panes.
 * Returns the pane list once the count matches.
 */
export async function waitForPanes(
  target: string,
  expected: number,
  opts: PollOptions = {},
): Promise<Pane[]> {
  return poll(
    async () => {
      const panes = await listPanes(target).catch(() => [])
      return panes.length === expected ? panes : null
    },
    { ...opts, label: `${expected} panes in ${target}` },
  )
}

/**
 * Wait until a tmux target has at least `min` and at most `max` panes.
 * Returns the pane list once the count is in range.
 */
export async function waitForPanesInRange(
  target: string,
  min: number,
  max: number,
  opts: PollOptions = {},
): Promise<Pane[]> {
  return poll(
    async () => {
      const panes = await listPanes(target).catch(() => [])
      return panes.length >= min && panes.length <= max ? panes : null
    },
    { ...opts, label: `${min}-${max} panes in ${target}` },
  )
}

// ---------------------------------------------------------------------------
// it2 helpers
// ---------------------------------------------------------------------------

/**
 * Get the visible screen contents of an iTerm2 session.
 * Uses --wait-stable to wait for output to settle.
 */
export async function getScreen(
  sessionId: string,
  opts: { waitStable?: boolean; tolerance?: string } = {},
): Promise<string> {
  const { waitStable = true, tolerance = 'normal' } = opts

  if (waitStable) {
    return $`it2 get-screen ${sessionId} --wait-stable --wait-stable-tolerance=${tolerance}`
      .text()
  }
  return $`it2 get-screen ${sessionId}`.text()
}

/**
 * Get buffer contents (with scrollback) of an iTerm2 session.
 * Pass `lines` to limit output, or omit for full buffer.
 */
export async function getBuffer(
  sessionId: string,
  lines?: number,
): Promise<string> {
  if (lines) {
    return $`it2 get-buffer ${sessionId} --lines ${lines}`.text()
  }
  return $`it2 get-buffer ${sessionId}`.text()
}

// ---------------------------------------------------------------------------
// Debugging / snapshots
// ---------------------------------------------------------------------------

/**
 * Capture a text snapshot of a tmux pane's contents.
 * Uses -S to grab scrollback history, not just the visible area.
 */
export async function captureTmuxPane(paneId: string): Promise<string> {
  // -S -500: start 500 lines back in scrollback
  // -J: join wrapped lines for readable output
  return $`tmux capture-pane -t ${paneId} -p -S -500 -J`.nothrow().text()
}

/**
 * Take a screenshot of the frontmost iTerm2 window.
 * Uses AppleScript to get the CGWindowID, then screencapture -l.
 */
export async function screenshot(path: string): Promise<void> {
  const windowId = await $`osascript -e 'tell application "iTerm2" to get the id of the front window'`
    .nothrow()
    .text()
  const id = windowId.trim()
  if (id && /^\d+$/.test(id)) {
    await $`screencapture -x -o -l${id} ${path}`.nothrow().quiet()
  } else {
    // Fallback: capture the main display only
    await $`screencapture -x -D1 ${path}`.nothrow().quiet()
  }
}

/**
 * Save a debug snapshot: screenshot + text capture of all panes in a tmux window.
 * If `runDir` is provided, files go there with clean names (e.g. `after-send.png`).
 * Otherwise falls back to tests/artifacts/ with timestamped names.
 */
export async function saveDebugSnapshot(
  tmuxWindow: string,
  label: string,
  runDir?: string,
): Promise<string> {
  const dir = runDir ?? `${import.meta.dir}/../artifacts`
  const prefix = runDir ? `${dir}/${label}` : `${dir}/${label}-${Date.now()}`

  await $`mkdir -p ${dir}`.quiet()

  // Screenshot
  await screenshot(`${prefix}.png`)

  // Text capture of each pane
  const paneList = await $`tmux list-panes -t ${tmuxWindow} -F '#{pane_id} #{pane_index} #{pane_width} #{pane_height}'`
    .nothrow()
    .text()

  const captures: string[] = []
  for (const line of paneList.trim().split('\n').filter(Boolean)) {
    const [paneId, index, width, height] = line.split(' ')
    const content = await captureTmuxPane(paneId)
    captures.push(`=== Pane ${index} (${paneId}) ${width}x${height} ===\n${content}`)
  }

  const textPath = `${prefix}-panes.txt`
  await Bun.write(textPath, captures.join('\n\n'))

  console.log(`  [debug] ${prefix}.png`)
  return prefix
}

/**
 * Capture `cru logs` output and team data files to the artifacts directory.
 * Saves logs (ANSI stripped) and copies the team's .claude/teams/ directory.
 */
export async function saveLogs(
  label: string,
  runDir?: string,
  teamName?: string,
): Promise<string> {
  const dir = runDir ?? `${import.meta.dir}/../artifacts`
  const prefix = runDir ? `${dir}/${label}` : `${dir}/${label}-${Date.now()}`

  await $`mkdir -p ${dir}`.quiet()

  const teamArg = teamName ?? ''
  const logsOutput = await $`bun src/cli.ts logs ${teamArg} --full`.nothrow().text()

  // Strip ANSI codes for readable text
  const clean = logsOutput.replace(/\x1b\[[0-9;]*m/g, '')

  await Bun.write(`${prefix}-logs.txt`, clean)
  console.log(`  [logs] ${prefix}-logs.txt`)

  // Copy team data files (config.json, inboxes/, cru-panes.json)
  if (teamName) {
    const teamDir = `${process.env.HOME}/.claude/teams/${teamName}`
    const destDir = `${dir}/${label}-team-data`
    await $`cp -r ${teamDir} ${destDir}`.nothrow().quiet()
    console.log(`  [team] ${destDir}`)
  }

  return `${prefix}-logs.txt`
}

/**
 * Create a run directory for a test file. Returns the absolute path.
 * Format: tests/artifacts/<YYYYMMDD-HHMMSS>-<test-name>/
 */
export function createRunDir(testName: string): string {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  const dir = `${import.meta.dir}/../artifacts/${ts}-${testName}`
  return dir
}

/**
 * Send text to an iTerm2 session.
 * By default, waits for a Claude prompt before sending.
 */
export async function sendText(
  sessionId: string,
  text: string,
  opts: { require?: string; skipConfirm?: boolean } = {},
): Promise<void> {
  const {
    require: precondition = 'is-claude-session,is-at-prompt',
    skipConfirm = true,
  } = opts

  const args: string[] = []
  if (precondition) args.push(`--require`, precondition)
  if (skipConfirm) args.push('--skip-confirm')

  await $`it2 session send-text ${args} ${sessionId} ${text}`
}

/**
 * Check if a Claude session has finished processing.
 */
export async function isClaudeIdle(sessionId: string): Promise<boolean> {
  const result = await $`it2-session-has-no-queued-claude-messages ${sessionId}`
    .nothrow()
    .text()
  return result.trim() === 'true'
}

/**
 * Wait until a Claude session is idle (no queued messages).
 */
export async function waitForClaudeIdle(
  sessionId: string,
  opts: PollOptions = {},
): Promise<void> {
  await poll(
    async () => (await isClaudeIdle(sessionId)) || null,
    { timeout: 120_000, interval: 3_000, ...opts, label: `Claude idle in ${sessionId}` },
  )
}

/**
 * Auto-approve safe modals in a Claude session.
 * Returns the result: "approved", "skipped", "no-modal", or "error".
 */
export async function autoApprove(sessionId: string): Promise<string> {
  return $`it2-session-claude-auto-approve ${sessionId}`
    .nothrow()
    .text()
    .then((s) => s.trim())
}

/**
 * Get the iTerm2 session ID for the current terminal.
 */
export async function currentSessionId(): Promise<string> {
  return $`it2 session current`.text().then((s) => s.trim())
}

/**
 * List all iTerm2 sessions as JSON.
 */
export async function listSessions(): Promise<any[]> {
  return $`it2 session list --format json`.json()
}

// ---------------------------------------------------------------------------
// Process inspection
// ---------------------------------------------------------------------------

/**
 * Check if a pane is running a `claude` process.
 * Looks at the pane's child processes.
 */
export async function isRunningClaude(pane: Pane): Promise<boolean> {
  const result = await $`ps -o comm= -p ${pane.pid}`.nothrow().text()
  return result.includes('claude')
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Close a cru team. Silently ignores errors if team doesn't exist.
 */
export async function closeTeam(teamName: string): Promise<void> {
  await $`bun src/cli.ts panes close ${teamName}`.nothrow().quiet()
}
