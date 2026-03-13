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

import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

function tmux(cmd: string, socket?: string): string {
  const prefix = socket ? `tmux -L ${socket}` : 'tmux'
  // Short timeout to skip dead sockets fast
  return execSync(`${prefix} ${cmd}`, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

/** Find claude-swarm tmux socket names, newest first. */
export function findSwarmSockets(): string[] {
  const uid = process.getuid?.() ?? 501
  const sockDir = join('/tmp', `tmux-${uid}`)
  try {
    const { statSync } = require('node:fs')
    return readdirSync(sockDir)
      .filter((f) => f.startsWith('claude-swarm-'))
      .map((f) => ({ name: f, mtime: statSync(join(sockDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime) // newest first
      .map((f) => f.name)
  } catch {
    return []
  }
}

/** Check if a PID is still running. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 = just check if process exists
    return true
  } catch {
    return false
  }
}

/** Find live swarm sockets that have active sessions. */
export function findLiveSwarms(): Array<{ socket: string; session: string; paneCount: number }> {
  const results: Array<{ socket: string; session: string; paneCount: number }> = []

  for (const socket of findSwarmSockets()) {
    // Socket format: claude-swarm-<PID> — skip if PID is dead
    const pid = Number(socket.replace('claude-swarm-', ''))
    if (pid && !isPidAlive(pid)) continue

    try {
      // Get the main session (skip view sessions we created)
      const sessions = tmux('list-sessions -F "#{session_name}"', socket)
        .split('\n').filter(Boolean)
        .filter(s => !s.startsWith('view-'))
      if (sessions.length === 0) continue
      const session = sessions[0]

      // Count ALL unique panes on the socket (dedup across session groups)
      const allPanes = tmux('list-panes -a -F "#{pane_id}"', socket)
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

  // If we know the expected count, find a match
  // Lead runs in user's terminal, NOT in the swarm — all swarm panes are workers
  if (expectedWorkers) {
    const match = swarms.find((s) => s.paneCount >= expectedWorkers)
    if (match) return match
  }

  // Otherwise return the one with the most panes
  swarms.sort((a, b) => b.paneCount - a.paneCount)
  return swarms[0]
}

/** Get worker pane IDs from a swarm socket. All panes are workers (lead runs in user's terminal). */
export function getWorkerPanes(socket: string, _session?: string): string[] {
  try {
    // List ALL panes on the socket, dedup (session groups share panes)
    const allPanes = tmux('list-panes -a -F "#{pane_id}"', socket)
      .split('\n').filter(Boolean)
    return [...new Set(allPanes)].sort()
  } catch {
    return []
  }
}

/** Enable remain-on-exit globally so panes stay visible after worker exits. */
export function setRemainOnExit(socket: string): void {
  try { tmux('set-option -g remain-on-exit on', socket) } catch {}
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
): { ghosttyTerminal: string; viewSession: string } {
  const { splitTerminal, sendCommand } = require('./ghostty')

  const windowName = `worker-${index + 1}`
  const viewName = `view-${index + 1}`

  // Break pane into its own tmux window
  try {
    tmux(`break-pane -s ${paneId} -d -n ${windowName}`, socket)
  } catch (e: any) {
    console.error(`  [mirror] break-pane ${paneId}: ${e.message}`)
  }

  // Create a session group member pointing at the worker's window
  try { tmux(`kill-session -t ${viewName}`, socket) } catch {}
  tmux(`new-session -d -t ${session} -s ${viewName}`, socket)
  tmux(`set-option -t ${viewName} status off`, socket)
  tmux(`select-window -t ${viewName}:${windowName}`, socket)

  // Create Ghostty split
  const newTermId = splitTerminal(splitTarget, splitDirection)
  Bun.sleepSync(300)

  // Attach to the view session via the custom socket
  sendCommand(newTermId, `tmux -L ${socket} attach -t ${viewName}`)
  Bun.sleepSync(200)

  console.log(`  [mirror] ${windowName} (${paneId}) → ghostty:${newTermId}`)
  return { ghosttyTerminal: newTermId, viewSession: viewName }
}

/**
 * Mirror tmux worker panes into Ghostty splits.
 *
 * @param socket - tmux socket name (e.g., "claude-swarm-51275")
 * @param session - tmux session name within that socket
 * @param workerPaneIds - pane IDs to mirror (auto-detected if omitted)
 */
export function mirrorToGhostty(
  socket: string,
  session: string,
  workerPaneIds?: string[],
): Array<{ tmuxPane: string; ghosttyTerminal: string; viewSession: string }> {
  const {
    currentTerminal,
    splitTerminal,
    sendCommand,
    focusTerminal,
  } = require('./ghostty')

  const panes = workerPaneIds || getWorkerPanes(socket, session)
  if (panes.length === 0) {
    throw new Error(`No worker panes found in ${socket}/${session}`)
  }

  // Keep dead panes visible after worker exits
  setRemainOnExit(socket)

  // 1. Break each worker pane into its own tmux window
  for (let i = panes.length - 1; i >= 0; i--) {
    const paneId = panes[i]
    const windowName = `worker-${i + 1}`
    try {
      tmux(`break-pane -s ${paneId} -d -n ${windowName}`, socket)
    } catch (e: any) {
      // Pane might already be in its own window
      console.error(`  [mirror] break-pane ${paneId}: ${e.message}`)
    }
  }

  // 2. Create Ghostty splits and attach each to a view session
  const leadTerminalId = currentTerminal()
  const result: Array<{ tmuxPane: string; ghosttyTerminal: string; viewSession: string }> = []

  for (let i = 0; i < panes.length; i++) {
    const paneId = panes[i]
    const windowName = `worker-${i + 1}`
    const viewName = `view-${i + 1}`

    // Create a session group member pointing at the worker's window
    try { tmux(`kill-session -t ${viewName}`, socket) } catch {}
    tmux(`new-session -d -t ${session} -s ${viewName}`, socket)
    tmux(`set-option -t ${viewName} status off`, socket)
    tmux(`select-window -t ${viewName}:${windowName}`, socket)

    // Create Ghostty split
    const splitDir = i === 0 ? 'right' : 'down'
    const splitTarget = i === 0
      ? leadTerminalId
      : result[result.length - 1].ghosttyTerminal
    const newTermId = splitTerminal(splitTarget, splitDir as 'right' | 'down')
    Bun.sleepSync(300)

    // Attach to the view session via the custom socket
    sendCommand(newTermId, `tmux -L ${socket} attach -t ${viewName}`)

    result.push({
      tmuxPane: paneId,
      ghosttyTerminal: newTermId,
      viewSession: viewName,
    })
    console.log(`  [mirror] ${windowName} (${paneId}) → ghostty:${newTermId}`)

    Bun.sleepSync(200)
  }

  // 3. Return focus to lead
  focusTerminal(leadTerminalId)

  return result
}

/** Clean up view sessions. */
export function cleanupViewSessions(socket: string, viewSessions: string[]): void {
  for (const name of viewSessions) {
    try { tmux(`kill-session -t ${name}`, socket) } catch {}
  }
}
