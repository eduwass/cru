/**
 * Mirror tmux panes into native Ghostty splits.
 *
 * When Claude Code spawns a team via Agent tool, workers end up in a
 * headless tmux session using a CUSTOM SOCKET: `tmux -L claude-swarm-<PID>`.
 * These don't show up in the default `tmux list-sessions`.
 *
 * This module:
 * 1. Finds claude-swarm socket files in /tmp/tmux-<uid>/
 * 2. Queries each socket for worker panes
 * 3. Breaks panes into separate tmux windows
 * 4. Creates Ghostty splits, each running `tmux -L <socket> attach -t <view>`
 *
 * Result: each Ghostty split shows a real tmux pane with full interactivity.
 * Workers retain all team features (SendMessage, tasks, team bar).
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { splitTerminal, sendCommand as ghosttySendCommand } from './ghostty'

/** Run a tmux command on a specific socket. Socket is required to avoid
 *  accidentally mutating the user's default tmux server. */
function tmuxSocket(args: string[], socket: string): string {
  if (!socket) throw new Error('[mirror] tmuxSocket called without a socket — refusing to touch the default tmux server')
  const fullArgs = ['-L', socket, ...args]
  return execFileSync('tmux', fullArgs, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

/**
 * Pre-start the tmux server for a swarm socket with an empty config.
 *
 * The Claude Code agent framework creates a tmux server on `claude-swarm-<PID>`
 * and relies on window names (e.g. "swarm-view") for pane management. If the
 * user's ~/.tmux.conf has hooks (like `after-new-session rename-window ...`),
 * those hooks fire and rename windows, breaking the framework's lookups.
 *
 * By starting the server first with `-f /dev/null`, we ensure no user hooks
 * are loaded. The framework's subsequent `new-session` reuses this server.
 */
export function preWarmSwarmServer(socket: string): void {
  try {
    // Check if server is already running
    execFileSync('tmux', ['-L', socket, 'list-sessions'], {
      encoding: 'utf-8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Server already running — nothing to do
  } catch {
    // Server not running — create a dummy session with empty config to skip user hooks.
    // A bare `start-server` exits immediately (no sessions), so we need a session
    // to keep the server alive until the framework creates its own.
    try {
      execFileSync('tmux', ['-L', socket, '-f', '/dev/null', 'new-session', '-d', '-s', '_cru_prewarm'], {
        encoding: 'utf-8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {}
  }
}

/**
 * Find the lead Claude Code process PID by walking up the process tree.
 * The swarm socket name is `claude-swarm-<lead-PID>`.
 */
export function findLeadPid(): number | null {
  let pid = process.ppid
  for (let i = 0; i < 10; i++) {
    try {
      const info = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
        encoding: 'utf-8', timeout: 1000,
      }).trim()
      const comm = info.split(/\s+/).slice(1).join(' ')
      if (comm.includes('claude')) return pid
      pid = parseInt(info.split(/\s+/)[0])
      if (!pid || pid <= 1) break
    } catch { break }
  }
  return null
}

/** Find claude-swarm tmux socket names, newest first. */
export function findSwarmSockets(): string[] {
  const uid = process.getuid?.() ?? 501
  const sockDir = join('/tmp', `tmux-${uid}`)
  try {
    return readdirSync(sockDir)
      .filter((f) => f.startsWith('claude-swarm-'))
      .map((f) => ({ name: f, mtime: statSync(join(sockDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((f) => f.name)
  } catch {
    return []
  }
}

/** Check if a PID is still running. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Find live swarm sockets that have active sessions. */
export function findLiveSwarms(): Array<{ socket: string; session: string; paneCount: number }> {
  const results: Array<{ socket: string; session: string; paneCount: number }> = []

  for (const socket of findSwarmSockets()) {
    const pid = Number(socket.replace('claude-swarm-', ''))
    if (pid && !isPidAlive(pid)) continue

    try {
      const sessions = tmuxSocket(['list-sessions', '-F', '#{session_name}'], socket)
        .split('\n').filter(Boolean)
        .filter(s => !s.startsWith('view-') && !/^v\d+$/.test(s) && s !== '_cru_prewarm')
      if (sessions.length === 0) continue
      const session = sessions[0]

      const allPanes = tmuxSocket(['list-panes', '-a', '-F', '#{pane_id}'], socket)
        .split('\n').filter(Boolean)
      const uniquePanes = [...new Set(allPanes)]

      results.push({ socket, session, paneCount: uniquePanes.length })
    } catch {
      // Server not running — skip
    }
  }
  return results
}

/** Find the swarm with the most panes (most likely the current team). */
export function findBestSwarm(expectedWorkers?: number): { socket: string; session: string } | null {
  const swarms = findLiveSwarms()
  if (swarms.length === 0) return null

  if (expectedWorkers) {
    const match = swarms.find((s) => s.paneCount >= expectedWorkers)
    if (match) return match
  }

  swarms.sort((a, b) => b.paneCount - a.paneCount)
  return swarms[0]
}

/** Get worker pane IDs from a swarm socket. All panes are workers (lead runs in user's terminal). */
export function getWorkerPanes(socket: string, _session?: string): string[] {
  try {
    // List panes with their session name so we can exclude non-worker sessions
    const lines = tmuxSocket(['list-panes', '-a', '-F', '#{session_name} #{pane_id}'], socket)
      .split('\n').filter(Boolean)
    const workerPanes = lines
      .map(l => { const [sess, ...rest] = l.split(' '); return { session: sess, paneId: rest.join(' ') } })
      .filter(p => p.session !== '_cru_prewarm' && !p.session.startsWith('view-') && !/^v\d+$/.test(p.session))
      .map(p => p.paneId)
    return [...new Set(workerPanes)].sort()
  } catch {
    return []
  }
}

/** Enable remain-on-exit globally so panes stay visible after worker exits. */
export function setRemainOnExit(socket: string): void {
  try { tmuxSocket(['set-option', '-g', 'remain-on-exit', 'on'], socket) } catch {}
}

/**
 * Mirror a single tmux worker pane into a Ghostty split.
 * Used for incremental mirroring — opens each pane as soon as the worker spawns.
 */
export function mirrorSingleWorker(
  socket: string,
  session: string,
  paneId: string,
  index: number,
  splitTarget: string,
  splitDirection: 'right' | 'down',
): { ghosttyTerminal: string; viewSession: string } | null {
  // Use pane ID in names to guarantee uniqueness — avoids collisions when
  // a break-pane succeeds but later steps fail and we retry with a different pane.
  const paneSlug = paneId.replace('%', '')
  const windowName = `w${paneSlug}`
  const viewName = `v${paneSlug}`

  try {
    // Break pane into its own tmux window
    tmuxSocket(['break-pane', '-s', paneId, '-d', '-n', windowName], socket)

    // Create a session group member pointing at the worker's window
    try { tmuxSocket(['kill-session', '-t', viewName], socket) } catch {}
    tmuxSocket(['new-session', '-d', '-t', session, '-s', viewName], socket)
    tmuxSocket(['set-option', '-t', viewName, 'status', 'off'], socket)
    tmuxSocket(['select-window', '-t', `${viewName}:${windowName}`], socket)
  } catch (e: any) {
    console.error(`  [mirror] skipping worker-${index + 1} — tmux setup failed for pane ${paneId}: ${e.message}`)
    try { tmuxSocket(['kill-session', '-t', viewName], socket) } catch {}
    return null
  }

  // Create Ghostty split
  const newTermId = splitTerminal(splitTarget, splitDirection)
  Bun.sleepSync(300)

  // Attach to the view session via the custom socket
  ghosttySendCommand(newTermId, `tmux -L ${socket} attach -t ${viewName}`)
  Bun.sleepSync(200)

  console.log(`  [mirror] worker-${index + 1} (${paneId}) → ghostty:${newTermId}`)
  return { ghosttyTerminal: newTermId, viewSession: viewName }
}

/**
 * Mirror a single tmux worker pane into a cmux split.
 * Same approach as Ghostty mirroring but uses cmux CLI for splits.
 */
export function mirrorWorkerToCmux(
  socket: string,
  session: string,
  paneId: string,
  index: number,
  splitTarget: string,
  splitDirection: 'right' | 'down',
): { cmuxSurface: string; viewSession: string } | null {
  const { splitSurface, sendCommand: cmuxSendCommand } = require('./cmux')

  const paneSlug = paneId.replace('%', '')
  const windowName = `w${paneSlug}`
  const viewName = `v${paneSlug}`

  try {
    // Break pane into its own tmux window
    tmuxSocket(['break-pane', '-s', paneId, '-d', '-n', windowName], socket)

    // Create a session group member pointing at the worker's window
    try { tmuxSocket(['kill-session', '-t', viewName], socket) } catch {}
    tmuxSocket(['new-session', '-d', '-t', session, '-s', viewName], socket)
    tmuxSocket(['set-option', '-t', viewName, 'status', 'off'], socket)
    tmuxSocket(['select-window', '-t', `${viewName}:${windowName}`], socket)
  } catch (e: any) {
    console.error(`  [mirror] skipping worker-${index + 1} — tmux setup failed for pane ${paneId}: ${e.message}`)
    try { tmuxSocket(['kill-session', '-t', viewName], socket) } catch {}
    return null
  }

  // Create cmux split relative to the target surface
  const newSurface = splitSurface(splitDirection, splitTarget)
  Bun.sleepSync(300)

  // Attach to the view session via the custom socket
  cmuxSendCommand(newSurface, `tmux -L ${socket} attach -t ${viewName}`)
  Bun.sleepSync(200)

  console.log(`  [mirror] worker-${index + 1} (${paneId}) → cmux:${newSurface}`)
  return { cmuxSurface: newSurface, viewSession: viewName }
}
