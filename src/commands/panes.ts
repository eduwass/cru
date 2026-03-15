import { z } from 'incur'
import { loadConfig } from '../lib/config'
import { readTeamConfig, findTeamWindow, findTeamForCurrentWindow } from '../lib/teams'
import {
  currentPane, paneWindow, getWindowDimensions, listWindowPanes,
  killPane, applyGrid, listPaneDetails,
} from '../lib/tmux'
import { computeGrid } from '../lib/layout'
import { loadPanes, savePanes } from '../lib/panes'
import { inGhostty, inCmux } from '../lib/env'

/**
 * Ghostty+tmux mirror flow:
 * Workers live in a headless tmux with a CUSTOM SOCKET (tmux -L claude-swarm-*).
 * We find the socket, discover worker panes, break each into its own tmux window,
 * create Ghostty splits, and attach each to a session-group view.
 *
 * Uses INCREMENTAL mirroring: opens each pane as soon as the worker spawns,
 * without waiting for all workers to be ready.
 */
function runGridGhostty(c) {
  const {
    findBestSwarm,
    getWorkerPanes,
    mirrorSingleWorker,
    setRemainOnExit,
  } = require('../lib/mirror')
  const {
    currentTerminal,
    focusTerminal,
  } = require('../lib/ghostty')

  const teamName = c.args.team
  const expectedWorkers = c.options.expect
  const deadline = Date.now() + 60_000

  // 1. Find the swarm socket
  // Only poll if --expect was passed (the skill sets this when workers are spawning).
  // Otherwise check once and fail fast — the user called this directly.
  let swarm: { socket: string; session: string } | null = null
  if (expectedWorkers) {
    while (Date.now() < deadline) {
      swarm = findBestSwarm(expectedWorkers)
      if (swarm) break
      Bun.sleepSync(200)
    }
  } else {
    swarm = findBestSwarm()
  }

  if (!swarm) {
    return c.error({
      code: 'NO_SWARM',
      message: 'No claude-swarm tmux session found. Is a Claude Code team running?',
    })
  }

  console.log(`  [grid] found swarm: ${swarm.socket}/${swarm.session}`)

  // Keep dead panes visible after worker exits
  setRemainOnExit(swarm.socket)

  // 2. Incrementally mirror workers as they appear
  const leadTerminalId = currentTerminal()
  const mirrored = new Map<string, { ghosttyTerminal: string; viewSession: string }>()

  while (Date.now() < deadline) {
    const allWorkers = getWorkerPanes(swarm.socket)
    const newWorkers = allWorkers.filter(p => !mirrored.has(p))

    for (const paneId of newWorkers) {
      const idx = mirrored.size
      const splitDir: 'right' | 'down' = idx === 0 ? 'right' : 'down'
      const splitTarget = idx === 0
        ? leadTerminalId
        : [...mirrored.values()].pop()!.ghosttyTerminal

      const result = mirrorSingleWorker(
        swarm.socket, swarm.session,
        paneId, idx, splitTarget, splitDir,
      )
      mirrored.set(paneId, result)
    }

    // All expected workers mirrored
    if (expectedWorkers && mirrored.size >= expectedWorkers) break

    // No expected count — wait for workers to stop appearing
    if (!expectedWorkers && mirrored.size > 0 && newWorkers.length === 0) {
      Bun.sleepSync(3000) // give stragglers 3s
      const finalWorkers = getWorkerPanes(swarm.socket)
      if (finalWorkers.filter(p => !mirrored.has(p)).length === 0) break
      continue
    }

    Bun.sleepSync(200)
  }

  if (mirrored.size === 0) {
    return c.error({
      code: 'NO_WORKERS',
      message: 'No worker panes found in swarm.',
    })
  }

  // 3. Focus lead
  focusTerminal(leadTerminalId)

  // 4. Save pane tracking
  if (teamName) {
    const mirrors = [...mirrored.entries()]
    savePanes(teamName, {
      leadPane: leadTerminalId,
      windowId: leadTerminalId, // Ghostty doesn't have tmux-style window IDs; use lead terminal as key
      backend: 'ghostty',
      createdAt: Date.now(),
      workers: mirrors.map(([, m], i) => ({
        name: `worker-${i + 1}`,
        paneId: m.ghosttyTerminal,
        color: ['green', 'blue', 'yellow', 'magenta', 'cyan', 'red'][i % 6],
      })),
    })
  }

  return {
    applied: true,
    backend: 'ghostty+tmux',
    swarm: `${swarm.socket}/${swarm.session}`,
    workers: mirrored.size,
    mirrors: [...mirrored.entries()].map(([paneId, m]) => ({
      tmux: paneId,
      ghostty: m.ghosttyTerminal,
      view: m.viewSession,
    })),
  }
}

const WORKER_COLORS = ['green', 'blue', 'yellow', 'magenta', 'cyan', 'red']

/** Resolve worker names from team config, falling back to "worker-N". */
function resolveWorkerNames(teamName: string | undefined, count: number): string[] {
  if (teamName) {
    try {
      const config = readTeamConfig(teamName)
      // Filter out the lead (role=lead or name=main/team-lead) — only want workers
      const names = (config.members || [])
        .filter((m: any) => m.role !== 'lead' && m.name !== 'main' && m.name !== 'team-lead')
        .map((m: any) => m.name)
      if (names.length >= count) return names.slice(0, count)
    } catch {}
  }
  return Array.from({ length: count }, (_, i) => `worker-${i + 1}`)
}

/** Apply config overrides from CLI options. */
function applyConfigOverrides(conf: ReturnType<typeof loadConfig>, options: any): void {
  if (options['lead-size'] != null) conf.layout.lead.size = options['lead-size']
  if (options['lead-position']) conf.layout.lead.position = options['lead-position']
  if (options.fill) conf.layout.grid.fill = options.fill
  if (options['max-cols'] != null) conf.layout.grid.maxCols = options['max-cols']
  if (options['max-rows'] != null) conf.layout.grid.maxRows = options['max-rows']
}

/**
 * cmux grid: mirror headless tmux workers into cmux splits.
 *
 * Same approach as Ghostty: workers spawn in `tmux -L claude-swarm-*`
 * sessions. We find the swarm, break each pane into its own tmux window,
 * create cmux splits, and attach each to a view session.
 */
function runGridCmux(c) {
  const {
    findBestSwarm,
    getWorkerPanes,
    mirrorWorkerToCmux,
    setRemainOnExit,
  } = require('../lib/mirror')
  const {
    currentSurface,
    focusSurface,
    closeSurface,
    renameSurface,
    getSurfaceTitle,
    notify,
    setStatus,
    setProgress,
    log: cmuxLog,
    clearStatus,
    clearProgress,
    clearLog,
    setPhase,
    clearPhase,
    spawnProgressWatcher,
  } = require('../lib/cmux') as typeof import('../lib/cmux')

  const teamName = c.args.team
  const expectedWorkers = c.options.expect
  const leadSurface = currentSurface()
  const deadline = Date.now() + 60_000

  // Close previously-tracked workers (never arbitrary surfaces)
  if (teamName) {
    const existing = loadPanes(teamName)
    if (existing?.backend === 'cmux') {
      for (const w of existing.workers) closeSurface(w.paneId)
      Bun.sleepSync(300)
    }
  }

  // 1. Find the swarm socket
  let swarm: { socket: string; session: string } | null = null
  if (expectedWorkers) {
    while (Date.now() < deadline) {
      swarm = findBestSwarm(expectedWorkers)
      if (swarm) break
      Bun.sleepSync(200)
    }
  } else {
    swarm = findBestSwarm()
  }

  if (!swarm) {
    return c.error({
      code: 'NO_SWARM',
      message: 'No claude-swarm tmux session found. Is a Claude Code team running?',
    })
  }

  console.log(`  [grid] found swarm: ${swarm.socket}/${swarm.session}`)
  setRemainOnExit(swarm.socket)

  const label = teamName || 'cru'
  setStatus('team', label, { icon: 'person.2.fill', color: '#6366f1' })
  setPhase('spawning', label)
  cmuxLog(`Swarm found, mirroring workers...`, 'progress')

  // 2. Incrementally mirror workers into a grid layout
  const conf = loadConfig()
  applyConfigOverrides(conf, c.options)
  const totalExpected = expectedWorkers || 1
  const { cols } = computeGrid(totalExpected, conf.layout)
  const mirrored = new Map<string, { cmuxSurface: string; viewSession: string }>()
  const mirroredSurfaces: string[] = []

  setProgress(0, `0/${totalExpected} workers`)

  while (Date.now() < deadline) {
    const allWorkers = getWorkerPanes(swarm.socket)
    const newWorkers = allWorkers.filter((p: string) => !mirrored.has(p))

    for (const paneId of newWorkers) {
      const idx = mirrored.size
      const row = Math.floor(idx / cols)
      const col = idx % cols

      let splitDir: 'right' | 'down'
      let splitTarget: string
      if (idx === 0) {
        splitDir = 'right'
        splitTarget = leadSurface
      } else if (row === 0) {
        splitDir = 'right'
        splitTarget = mirroredSurfaces[idx - 1]
      } else {
        splitDir = 'down'
        splitTarget = mirroredSurfaces[(row - 1) * cols + col]
      }

      const result = mirrorWorkerToCmux(
        swarm.socket, swarm.session,
        paneId, idx, splitTarget, splitDir,
      )
      mirrored.set(paneId, result)
      mirroredSurfaces.push(result.cmuxSurface)

      // Update sidebar progress
      cmuxLog(`worker-${idx + 1} mirrored`, 'success')
      setProgress(mirrored.size / totalExpected, `${mirrored.size}/${totalExpected} workers`)
    }

    if (expectedWorkers && mirrored.size >= expectedWorkers) break

    if (!expectedWorkers && mirrored.size > 0 && newWorkers.length === 0) {
      Bun.sleepSync(3000)
      const finalWorkers = getWorkerPanes(swarm.socket)
      if (finalWorkers.filter((p: string) => !mirrored.has(p)).length === 0) break
      continue
    }

    Bun.sleepSync(200)
  }

  if (mirrored.size === 0) {
    clearProgress()
    clearStatus('team')
    clearPhase()
    return c.error({ code: 'NO_WORKERS', message: 'No worker panes found in swarm.' })
  }

  // 3. Label surfaces
  const leadOriginalTitle = getSurfaceTitle(leadSurface)
  try { renameSurface(leadSurface, `${leadOriginalTitle} (◫ lead @ ${label})`) } catch {}

  const mirrors = [...mirrored.entries()]
  const names = resolveWorkerNames(teamName, mirrors.length)
  const workers = mirrors.map(([, m], i) => {
    try { renameSurface(m.cmuxSurface, `⚡ ${names[i]} @ ${label}`) } catch {}
    return { name: names[i], paneId: m.cmuxSurface, color: WORKER_COLORS[i % WORKER_COLORS.length] }
  })

  // 4. Finalize sidebar and focus lead — clear spawn progress, switch to working
  clearProgress()
  setStatus('team', `${label} (${workers.length} workers)`, { icon: 'person.2.fill', color: '#22c55e' })
  setPhase('working', label)
  notify(`◫ ${label}`, `Team ready — ${workers.length} workers in grid`)
  focusSurface(leadSurface)

  if (teamName) {
    savePanes(teamName, {
      leadPane: leadSurface,
      windowId: leadSurface,
      backend: 'cmux',
      createdAt: Date.now(),
      workers,
      leadOriginalTitle,
    })

    // Start background task progress watcher
    spawnProgressWatcher(teamName, workers.length)
  }

  return {
    applied: true,
    backend: 'cmux',
    swarm: `${swarm.socket}/${swarm.session}`,
    workers: mirrored.size,
  }
}

function runGrid(c) {
  // cmux: native pane management via CLI
  if (inCmux()) {
    return runGridCmux(c)
  }

  // Ghostty: mirror tmux panes into native splits
  if (inGhostty()) {
    return runGridGhostty(c)
  }

  const conf = loadConfig()
  applyConfigOverrides(conf, c.options)

  const teamName = c.args.team
  let windowId: string | null = null
  let leadPaneId: string | null = null
  let workerPaneIds: Set<string> | null = null
  let cruPanesData: ReturnType<typeof loadPanes> = null

  if (teamName) {
    cruPanesData = loadPanes(teamName)
    if (cruPanesData) {
      windowId = cruPanesData.windowId
      workerPaneIds = new Set(cruPanesData.workers.map((w) => w.paneId))
    } else {
      windowId = findTeamWindow(teamName)
      const teamConf = readTeamConfig(teamName)
      workerPaneIds = new Set(
        teamConf.members.filter((m) => m.tmuxPaneId).map((m) => m.tmuxPaneId),
      )
    }
  } else {
    leadPaneId = currentPane()
    windowId = paneWindow(leadPaneId)
  }

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find terminal window' })

  if (c.options.expect) {
    const expectedTotal = c.options.expect + 1
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (listWindowPanes(windowId).length >= expectedTotal) break
      Bun.sleepSync(500)
    }
  }

  const { w: W, h: H } = getWindowDimensions(windowId)
  const panes = listWindowPanes(windowId)

  if (panes.length < 2) {
    return c.error({ code: 'NO_WORKERS', message: 'Only one pane in window — nothing to arrange' })
  }

  let leadPane, workerPanes
  if (workerPaneIds) {
    leadPane = panes.find((p) => !workerPaneIds.has(p.id))
    workerPanes = panes.filter((p) => workerPaneIds.has(p.id))
  } else {
    leadPane = panes.find((p) => p.id === leadPaneId)
    workerPanes = panes.filter((p) => p.id !== leadPaneId)
  }

  if (!leadPane) return c.error({ code: 'NO_LEAD', message: 'Could not identify lead pane' })
  if (workerPanes.length === 0) return c.error({ code: 'NO_WORKERS', message: 'No worker panes found' })

  applyGrid(windowId, leadPane.id, workerPanes.map((p) => p.id), conf.layout)

  const N = workerPanes.length
  const { cols, rows } = computeGrid(N, conf.layout)
  const grid = []
  let idx = 0
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let col = 0; col < cols; col++) {
      if (idx < N) {
        const cruWorker = cruPanesData?.workers[idx]
        row.push(cruWorker?.name || `pane-${idx + 1}`)
        idx++
      }
    }
    grid.push(row)
  }

  return {
    applied: true,
    window: windowId,
    dimensions: `${W}x${H}`,
    lead: { position: conf.layout.lead.position, size: `${conf.layout.lead.size}%` },
    workers: N,
    grid_size: `${rows}x${cols}`,
    grid,
  }
}

function runClose(c) {
  let teamName = c.args.team
  if (!teamName && !inGhostty() && !inCmux()) {
    try { teamName = findTeamForCurrentWindow() } catch {}
  }
  if (!teamName) return c.error({ code: 'NO_TEAM', message: 'No team specified and none found in current window' })
  const closed: Array<{ name: string; pane: string }> = []

  const cruPanes = loadPanes(teamName)
  if (cruPanes && cruPanes.workers.length > 0) {
    // Use the right kill method based on how panes were tracked
    let killFn: (id: string) => void
    if (cruPanes.backend === 'cmux') {
      killFn = (id: string) => { try { require('../lib/cmux').closeSurface(id) } catch (e) { console.warn(`[close] failed to close cmux surface ${id}: ${e}`) } }
    } else if (cruPanes.backend === 'ghostty') {
      killFn = (id: string) => { try { require('../lib/ghostty').closeTerminal(id) } catch (e) { console.warn(`[close] failed to close Ghostty terminal ${id}: ${e}`) } }
    } else {
      killFn = (id: string) => killPane(id)
    }

    for (const w of cruPanes.workers) {
      killFn(w.paneId)
      closed.push({ name: w.name, pane: w.paneId })
    }

    // If mirrored, also clean up tmux view sessions on the custom socket
    if (cruPanes.backend === 'ghostty') {
      try {
        const { findSwarmSockets } = require('../lib/mirror')
        const { execFileSync } = require('node:child_process')
        for (const socket of findSwarmSockets()) {
          try {
            const sessions = execFileSync(
              'tmux', ['-L', socket, 'list-sessions', '-F', '#{session_name}'],
              { encoding: 'utf-8', timeout: 3000 },
            ).trim().split('\n')
            for (const name of sessions) {
              if (name.startsWith('view-')) {
                try { execFileSync('tmux', ['-L', socket, 'kill-session', '-t', name], { timeout: 3000 }) } catch {}
              }
            }
          } catch {}
        }
      } catch {}
    }
  } else {
    try {
      const config = readTeamConfig(teamName)
      const workers = config.members.filter((m) => m.tmuxPaneId)
      for (const member of workers) {
        killPane(member.tmuxPaneId)
        closed.push({ name: member.name, pane: member.tmuxPaneId })
      }
    } catch {}
  }

  if (closed.length === 0 && inCmux()) {
    // Fallback: close all non-lead cmux surfaces in the caller's workspace only
    try {
      const { currentSurface, currentWorkspace, listAllSurfaceIds, closeSurface } = require('../lib/cmux')
      const lead = currentSurface()
      const ws = currentWorkspace()
      const allSurfaces = listAllSurfaceIds(ws)
      for (const id of allSurfaces) {
        if (id !== lead) {
          closeSurface(id)
          closed.push({ name: `pane-${closed.length + 1}`, pane: id })
        }
      }
    } catch {}
  } else if (closed.length === 0 && inGhostty()) {
    // Fallback: close all non-lead Ghostty terminals
    // Uses process-tree-based currentTerminal() — works regardless of focus
    try {
      const { currentTerminal, listAllTerminals, closeTerminal } = require('../lib/ghostty')
      const lead = currentTerminal()
      const allTerminals = listAllTerminals()
      for (const id of allTerminals) {
        if (id !== lead) {
          closeTerminal(id)
          closed.push({ name: `pane-${closed.length + 1}`, pane: id })
        }
      }
    } catch {}
  } else if (closed.length === 0) {
    try {
      const lead = currentPane()
      const windowId = paneWindow(lead)
      const panes = listWindowPanes(windowId)
      for (const p of panes) {
        if (p.id !== lead) {
          killPane(p.id)
          closed.push({ name: `pane-${closed.length + 1}`, pane: p.id })
        }
      }
    } catch {}
  }

  // Restore lead pane's original title and clear sidebar
  if (cruPanes?.backend === 'cmux') {
    try {
      const { renameSurface, notify, log: cmuxLog, setPhase, spawnDelayedCleanup } = require('../lib/cmux')
      setPhase('closing', teamName)
      if (cruPanes.leadOriginalTitle != null) {
        renameSurface(cruPanes.leadPane, cruPanes.leadOriginalTitle)
      }
      cmuxLog(`Team closed — ${closed.length} panes removed`, 'info')
      notify(`◫ ${teamName}`, `Team shut down — ${closed.length} workers closed`)
      // Clear all sidebar state after 10s so user can see the "closed" status briefly
      spawnDelayedCleanup(10)
    } catch {}
  }

  // Clean up pane tracking file (team data stays for `cru logs` review)
  if (teamName && closed.length > 0) {
    try {
      const { unlinkSync } = require('node:fs')
      const { join } = require('node:path')
      const { teamsDir } = require('../lib/paths')
      unlinkSync(join(teamsDir(), teamName, 'cru-panes.json'))
    } catch {}
  }

  return { team: teamName, closed: closed.length, panes: closed }
}

function runList(c) {
  if (inCmux()) {
    const { currentSurface, listSurfaces } = require('../lib/cmux')
    let currentId: string | null = null
    try { currentId = currentSurface() } catch {}
    const surfaces = listSurfaces()
    const panes = surfaces.map((s: { id: string; index: number }) => ({
      id: s.id,
      index: s.index,
      current: s.id === currentId,
    }))
    return { backend: 'cmux', panes }
  }

  if (inGhostty()) {
    const { ghostty, currentTerminal, listAllTerminals } = require('../lib/ghostty')
    const allIds = listAllTerminals()
    // Get working directories for all terminals
    let dirs: string[] = []
    try {
      const raw = ghostty('get working directory of every terminal')
      dirs = raw.split(', ')
    } catch {}
    let currentId: string | null = null
    try { currentId = currentTerminal() } catch {}
    const panes = allIds.map((id: string, i: number) => ({
      id,
      index: i,
      cwd: dirs[i] || '',
      current: id === currentId,
    }))
    return { backend: 'ghostty', panes }
  }

  const teamName = c.args.team
  let windowId: string | null = null

  if (teamName) {
    windowId = findTeamWindow(teamName)
  } else {
    try {
      const lead = currentPane()
      windowId = paneWindow(lead)
    } catch {}
  }

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find terminal window' })

  const info = listPaneDetails(windowId)
  return { window: windowId, panes: info }
}

export const panes = {
  description: 'Manage terminal panes (list, grid layout, close)',
  args: z.object({
    action: z.enum(['list', 'grid', 'close']).default('list').describe('Action: list, grid, or close'),
    team: z.string().optional().describe('Team name (omit to auto-detect)'),
  }),
  options: z.object({
    'lead-size': z.coerce.number().optional().describe('Grid: override lead size (%)'),
    'lead-position': z.enum(['left', 'right', 'top', 'bottom']).optional().describe('Grid: override lead position'),
    fill: z.enum(['row', 'column']).optional().describe('Grid: override fill direction'),
    'max-cols': z.coerce.number().optional().describe('Grid: max columns'),
    'max-rows': z.coerce.number().optional().describe('Grid: max rows'),
    expect: z.coerce.number().optional().describe('Grid: wait for N worker panes before applying'),
  }),
  run(c) {
    switch (c.args.action) {
      case 'grid': return runGrid(c)
      case 'close': return runClose(c)
      case 'list': return runList(c)
    }
  },
}
