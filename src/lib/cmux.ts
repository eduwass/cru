/**
 * cmux backend — native pane management via the cmux CLI.
 *
 * cmux is a macOS terminal with a CLI for controlling panes/surfaces
 * via a Unix socket (/tmp/cmux.sock).
 *
 * IMPORTANT: All operations pass explicit --surface/--workspace flags
 * so they work regardless of which tab/surface the user has focused.
 * Never rely on the "focused" or "current" surface.
 *
 * Surface refs (surface:N) are monotonic — they don't shift when
 * other surfaces are created or destroyed, so they're safe to store.
 *
 * Environment variables set by cmux in each terminal:
 *   CMUX_WORKSPACE_ID, CMUX_SURFACE_ID, CMUX_SOCKET_PATH
 */

import { execFileSync } from 'node:child_process'
import { computeGrid } from './layout'
import type { LayoutConf } from './tmux'

export interface CmuxSurface {
  id: string   // e.g. "surface:15" — monotonic ref, stable for the session
  index: number
  title: string
  focused: boolean
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Run a cmux CLI command safely (no shell interpolation). */
export function cmux(...args: string[]): string {
  return execFileSync('cmux', args, { encoding: 'utf-8', timeout: 10_000 }).trim()
}

/** Check if cmux socket is responding. */
export function isCmuxAvailable(): boolean {
  try {
    cmux('ping')
    return true
  } catch {
    return false
  }
}

/** Get cmux version. */
export function cmuxVersion(): string | null {
  try {
    return cmux('version')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Get the caller's surface ref and workspace ref.
 * Uses `cmux identify` which reliably returns the calling process's context,
 * regardless of what the user has focused.
 */
export function identify(): { surface: string; workspace: string } {
  const info = JSON.parse(cmux('identify'))
  // Prefer caller (the process's own surface), fall back to focused surface
  const surface = info.caller?.surface_ref || info.focused?.surface_ref
  const workspace = info.caller?.workspace_ref || info.focused?.workspace_ref
  if (!surface) throw new Error('cmux identify did not return a surface_ref')
  return { surface, workspace: workspace || 'workspace:1' }
}

/** Get the caller's surface ref. */
export function currentSurface(): string {
  return identify().surface
}

/** Get the caller's workspace ref. */
export function currentWorkspace(): string {
  return identify().workspace
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** List all surfaces in a workspace. Defaults to the caller's workspace. */
export function listSurfaces(workspace?: string): CmuxSurface[] {
  const ws = workspace || currentWorkspace()
  const output = cmux('list-panels', '--workspace', ws)
  if (!output) return []

  return output.split('\n')
    .filter(Boolean)
    .map((line, i) => {
      // Format: "* surface:15  terminal  [focused]  "Title""
      // or:     "  surface:20  terminal  "Title""
      const match = line.match(/^([*\s]*)(surface:\d+)\s+\S+\s*(.*)$/)
      if (!match) return null
      const focused = match[3].includes('[focused]')
      const titleMatch = match[3].match(/"([^"]*)"/)
      return {
        id: match[2],
        index: i,
        title: titleMatch?.[1] || '',
        focused,
      }
    })
    .filter((s): s is CmuxSurface => s !== null)
}

/** List all surface IDs in a workspace. Defaults to the caller's workspace. */
export function listAllSurfaceIds(workspace?: string): string[] {
  return listSurfaces(workspace).map((s) => s.id)
}

/**
 * Split relative to a specific surface and return the new surface ref.
 * Always pass --surface so splits happen in the right place regardless of focus.
 */
export function splitSurface(
  direction: 'right' | 'down' | 'left' | 'up' = 'right',
  relativeTo?: string,
): string {
  const args = ['new-split', direction]
  if (relativeTo) args.push('--surface', relativeTo)
  // Output format: "OK surface:20 workspace:1"
  const output = cmux(...args)
  const match = output.match(/surface:\d+/)
  if (!match) throw new Error(`Unexpected new-split output: ${output}`)
  return match[0]
}

/** Close a surface by ref. */
export function closeSurface(surfaceId: string): void {
  try {
    cmux('close-surface', '--surface', surfaceId)
  } catch {
    // surface may already be closed
  }
}

/** Rename a surface's tab for identification. */
export function renameSurface(surfaceId: string, title: string): void {
  cmux('rename-tab', title, '--surface', surfaceId)
}

/** Get the current title of a surface. */
export function getSurfaceTitle(surfaceId: string): string {
  const surfaces = listSurfaces()
  return surfaces.find((s) => s.id === surfaceId)?.title || ''
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** Send text to a surface (pastes the text). */
export function sendText(surfaceId: string, text: string): void {
  cmux('send', '--surface', surfaceId, text)
}

/** Send a key press to a surface. */
export function sendKey(surfaceId: string, key: string): void {
  cmux('send-key', '--surface', surfaceId, key)
}

/** Send text followed by Enter (like typing a command). */
export function sendCommand(surfaceId: string, text: string): void {
  sendText(surfaceId, text)
  sendKey(surfaceId, 'Return')
}

/** Read the screen content of a surface. */
export function readScreen(surfaceId: string, lines?: number): string {
  const args = ['read-screen', '--surface', surfaceId]
  if (lines) args.push('--lines', String(lines))
  return cmux(...args)
}

// ---------------------------------------------------------------------------
// Notifications & Sidebar
// ---------------------------------------------------------------------------

/** Send a desktop notification. */
export function notify(title: string, body?: string, workspace?: string): void {
  const args = ['notify', '--title', title]
  if (body) args.push('--body', body)
  if (workspace) args.push('--workspace', workspace)
  try { cmux(...args) } catch {}
}

/** Set a status key in the sidebar. */
export function setStatus(key: string, value: string, opts?: { icon?: string; color?: string; workspace?: string }): void {
  const args = ['set-status', key, value]
  if (opts?.icon) args.push('--icon', opts.icon)
  if (opts?.color) args.push('--color', opts.color)
  if (opts?.workspace) args.push('--workspace', opts.workspace)
  try { cmux(...args) } catch {}
}

/** Clear a status key from the sidebar. */
export function clearStatus(key: string, workspace?: string): void {
  const args = ['clear-status', key]
  if (workspace) args.push('--workspace', workspace)
  try { cmux(...args) } catch {}
}

/** Set a progress bar in the sidebar (0.0 – 1.0). */
export function setProgress(value: number, label?: string, workspace?: string): void {
  const args = ['set-progress', String(Math.min(1, Math.max(0, value)))]
  if (label) args.push('--label', label)
  if (workspace) args.push('--workspace', workspace)
  try { cmux(...args) } catch {}
}

/** Clear the sidebar progress bar. */
export function clearProgress(workspace?: string): void {
  const args = ['clear-progress']
  if (workspace) args.push('--workspace', workspace)
  try { cmux(...args) } catch {}
}

/** Append a log entry to the sidebar. */
export function log(message: string, level: 'info' | 'progress' | 'success' | 'warning' | 'error' = 'info', workspace?: string): void {
  const args = ['log', '--level', level, '--source', 'cru']
  if (workspace) args.push('--workspace', workspace)
  args.push('--', message)
  try { cmux(...args) } catch {}
}

/** Clear all sidebar log entries. */
export function clearLog(workspace?: string): void {
  const args = ['clear-log']
  if (workspace) args.push('--workspace', workspace)
  try { cmux(...args) } catch {}
}

// ---------------------------------------------------------------------------
// Lifecycle status pills
// ---------------------------------------------------------------------------

/** Set the team lifecycle phase in the sidebar. Uses SF Symbol icons. */
export function setPhase(phase: 'spawning' | 'working' | 'done' | 'closing', teamName: string, detail?: string, workspace?: string): void {
  const phases = {
    spawning: { icon: 'circle.dotted', color: '#a78bfa', label: 'spawning' },
    working:  { icon: 'bolt.fill',     color: '#eab308', label: 'working' },
    done:     { icon: 'checkmark.circle.fill', color: '#22c55e', label: 'done' },
    closing:  { icon: 'xmark.circle',  color: '#ef4444', label: 'closing' },
  }
  const p = phases[phase]
  const value = detail ? `${p.label} — ${detail}` : p.label
  setStatus('phase', value, { icon: p.icon, color: p.color, workspace })
}

/** Clear the phase pill. */
export function clearPhase(workspace?: string): void {
  clearStatus('phase', workspace)
}

// ---------------------------------------------------------------------------
// Progress watcher
// ---------------------------------------------------------------------------

/**
 * Spawn a background process that polls Claude Code's task system
 * and updates the cmux sidebar with worker progress.
 *
 * Reads ~/.claude/tasks/<team>/*.json to track completed vs total tasks.
 * Exits when all tasks are done or the team is closed.
 */
export function spawnProgressWatcher(teamName: string, workerCount: number): void {
  const script = `
    const { readFileSync, readdirSync, existsSync } = require('node:fs');
    const { join } = require('node:path');
    const { execFileSync } = require('node:child_process');
    const { homedir } = require('node:os');

    const cmux = (...args) => {
      try { return execFileSync('cmux', args, { encoding: 'utf-8', timeout: 5000 }).trim(); }
      catch { return ''; }
    };

    const setPhase = (icon, color, label) => {
      cmux('set-status', 'phase', label, '--icon', icon, '--color', color);
    };

    const tasksDir = join(homedir(), '.claude', 'tasks', '${teamName}');
    const panesFile = join(homedir(), '.claude', 'teams', '${teamName}', 'cru-panes.json');
    let lastCompleted = 0;
    let staleCount = 0;

    setPhase('bolt.fill', '#eab308', 'working');
    let tasksStarted = false;

    while (true) {
      // Stop if team was closed (panes file removed)
      if (!existsSync(panesFile)) break;

      // Read task files
      let tasks = [];
      try {
        if (existsSync(tasksDir)) {
          for (const f of readdirSync(tasksDir)) {
            if (!f.endsWith('.json')) continue;
            try { tasks.push(JSON.parse(readFileSync(join(tasksDir, f), 'utf-8'))); } catch {}
          }
        }
      } catch {}

      if (tasks.length > 0) {
        // First time tasks appear — clear the "N workers ready" progress bar
        if (!tasksStarted) {
          tasksStarted = true;
          cmux('clear-progress');
        }

        const completed = tasks.filter(t => t.status === 'completed').length;
        const totalTasks = tasks.length;

        if (completed !== lastCompleted) {
          lastCompleted = completed;
          staleCount = 0;

          const ratio = totalTasks > 0 ? completed / totalTasks : 0;
          cmux('set-progress', String(ratio), '--label', completed + '/' + totalTasks + ' tasks done');

          if (completed > 0 && completed < totalTasks) {
            cmux('log', '--level', 'progress', '--source', 'cru', '--', completed + '/' + totalTasks + ' tasks completed');
            setPhase('bolt.fill', '#eab308', 'working — ' + completed + '/' + totalTasks + ' done');
          }

          if (completed >= totalTasks) {
            cmux('set-progress', '1', '--label', 'All tasks done');
            cmux('log', '--level', 'success', '--source', 'cru', '--', 'All ' + totalTasks + ' tasks completed');
            cmux('notify', '--title', '◫ ${teamName}', '--body', 'All tasks completed');
            setPhase('checkmark.circle.fill', '#22c55e', 'done');
            cmux('set-status', 'team', '${teamName} ✓', '--icon', 'person.2.fill', '--color', '#22c55e');
            break;
          }
        }
      }

      // Give up after 10 min of no changes
      staleCount++;
      if (staleCount > 300) break;

      Bun.sleepSync(2000);
    }
  `;

  // Spawn detached so cru can exit
  Bun.spawn(['bun', '-e', script], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  }).unref()
}

/**
 * Spawn a background process that clears all sidebar state after a delay.
 * Used after team close to give the user time to see the "closed" status
 * before returning to a clean sidebar.
 */
export function spawnDelayedCleanup(delaySec = 10): void {
  const script = `
    Bun.sleepSync(${delaySec * 1000});
    const { execFileSync } = require('node:child_process');
    const cmux = (...args) => {
      try { execFileSync('cmux', args, { encoding: 'utf-8', timeout: 5000 }); } catch {}
    };
    cmux('clear-status', 'team');
    cmux('clear-status', 'phase');
    cmux('clear-progress');
    cmux('clear-log');
  `;
  Bun.spawn(['bun', '-e', script], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  }).unref()
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

/** Focus a surface. */
export function focusSurface(surfaceId: string): void {
  const panes = cmux('list-panes')
  for (const line of panes.split('\n').filter(Boolean)) {
    const paneMatch = line.match(/^[*\s]*(pane:\d+)/)
    if (!paneMatch) continue
    const paneSurfaces = cmux('list-pane-surfaces', '--pane', paneMatch[1])
    if (paneSurfaces.includes(surfaceId)) {
      cmux('focus-pane', '--pane', paneMatch[1])
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Grid builder
// ---------------------------------------------------------------------------

/**
 * Build a grid layout using iterative splits.
 *
 * All splits use explicit --surface targeting so they work regardless
 * of what the user has focused. No focus changes needed.
 *
 * Returns the surface refs of the created worker panes.
 */
export function buildGrid(
  leadSurface: string,
  workerCount: number,
  conf: LayoutConf,
): string[] {
  const { cols, rows } = computeGrid(workerCount, conf)
  const isHorizontal = conf.lead.position === 'left' || conf.lead.position === 'right'
  const workerSurfaces: string[] = []

  const firstSplitDir = isHorizontal
    ? (conf.lead.position === 'left' ? 'right' : 'left')
    : (conf.lead.position === 'top' ? 'down' : 'up')

  // First worker: split relative to the lead surface
  const firstWorker = splitSurface(firstSplitDir as 'right' | 'down' | 'left' | 'up', leadSurface)
  workerSurfaces.push(firstWorker)
  Bun.sleepSync(100)

  if (workerCount <= 1) return workerSurfaces

  const colDir = isHorizontal ? 'down' : 'right'
  const rowDir = isHorizontal ? 'right' : 'down'
  let created = 1

  // Build columns in row 0 — each splits relative to the previous worker
  for (let c = 1; c < cols && created < workerCount; c++) {
    const s = splitSurface(rowDir as 'right' | 'down', workerSurfaces[workerSurfaces.length - 1])
    workerSurfaces.push(s)
    created++
    Bun.sleepSync(100)
  }

  // Add additional rows by splitting column panes downward
  for (let r = 1; r < rows && created < workerCount; r++) {
    for (let c = 0; c < cols && created < workerCount; c++) {
      const splitTarget = workerSurfaces[c + (r - 1) * cols]
      if (splitTarget) {
        const s = splitSurface(colDir as 'right' | 'down', splitTarget)
        workerSurfaces.push(s)
        created++
        Bun.sleepSync(100)
      }
    }
  }

  return workerSurfaces
}
