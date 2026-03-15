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

/** Run a tmux command on a specific socket (or default). */
function tmuxSocket(args: string[], socket?: string): string {
  const fullArgs = socket ? ['-L', socket, ...args] : args
  return execFileSync('tmux', fullArgs, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
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
        .filter(s => !s.startsWith('view-'))
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
    const allPanes = tmuxSocket(['list-panes', '-a', '-F', '#{pane_id}'], socket)
      .split('\n').filter(Boolean)
    return [...new Set(allPanes)].sort()
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
): { ghosttyTerminal: string; viewSession: string } {
  const windowName = `worker-${index + 1}`
  const viewName = `view-${index + 1}`

  // Break pane into its own tmux window
  try {
    tmuxSocket(['break-pane', '-s', paneId, '-d', '-n', windowName], socket)
  } catch (e: any) {
    console.error(`  [mirror] break-pane ${paneId}: ${e.message}`)
  }

  // Create a session group member pointing at the worker's window
  try { tmuxSocket(['kill-session', '-t', viewName], socket) } catch {}
  tmuxSocket(['new-session', '-d', '-t', session, '-s', viewName], socket)
  tmuxSocket(['set-option', '-t', viewName, 'status', 'off'], socket)
  tmuxSocket(['select-window', '-t', `${viewName}:${windowName}`], socket)

  // Create Ghostty split
  const newTermId = splitTerminal(splitTarget, splitDirection)
  Bun.sleepSync(300)

  // Attach to the view session via the custom socket
  ghosttySendCommand(newTermId, `tmux -L ${socket} attach -t ${viewName}`)
  Bun.sleepSync(200)

  console.log(`  [mirror] ${windowName} (${paneId}) → ghostty:${newTermId}`)
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
): { cmuxSurface: string; viewSession: string } {
  const { splitSurface, sendCommand: cmuxSendCommand } = require('./cmux')

  const windowName = `worker-${index + 1}`
  const viewName = `view-${index + 1}`

  // Break pane into its own tmux window
  try {
    tmuxSocket(['break-pane', '-s', paneId, '-d', '-n', windowName], socket)
  } catch (e: any) {
    console.error(`  [mirror] break-pane ${paneId}: ${e.message}`)
  }

  // Create a session group member pointing at the worker's window
  try { tmuxSocket(['kill-session', '-t', viewName], socket) } catch {}
  tmuxSocket(['new-session', '-d', '-t', session, '-s', viewName], socket)
  tmuxSocket(['set-option', '-t', viewName, 'status', 'off'], socket)
  tmuxSocket(['select-window', '-t', `${viewName}:${windowName}`], socket)

  // Create cmux split relative to the target surface
  const newSurface = splitSurface(splitDirection, splitTarget)
  Bun.sleepSync(300)

  // Attach to the view session via the custom socket
  cmuxSendCommand(newSurface, `tmux -L ${socket} attach -t ${viewName}`)
  Bun.sleepSync(200)

  console.log(`  [mirror] ${windowName} (${paneId}) → cmux:${newSurface}`)
  return { cmuxSurface: newSurface, viewSession: viewName }
}
