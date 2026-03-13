import { z } from 'incur'
import { loadConfig } from '@/lib/config'
import { readTeamConfig, findTeamWindow, findTeamForCurrentWindow } from '@/lib/teams'
import * as terminal from '@/lib/terminal'
import { computeGrid } from '@/lib/layout'
import { loadPanes, savePanes } from '@/lib/panes'
import { inGhostty } from '@/lib/env'

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
  } = require('@/lib/mirror')
  const {
    currentTerminal,
    currentWindow,
    focusTerminal,
  } = require('@/lib/ghostty')

  const teamName = c.args.team
  const expectedWorkers = c.options.expect
  const deadline = Date.now() + 60_000

  // 1. Find the swarm socket
  let swarm: { socket: string; session: string } | null = null
  while (Date.now() < deadline) {
    swarm = findBestSwarm()
    if (swarm) break
    Bun.sleepSync(200)
  }

  if (!swarm) {
    return c.error({
      code: 'NO_SWARM',
      message: 'No claude-swarm tmux session found. Workers may not have spawned yet.',
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
      windowId: currentWindow(),
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

function runGrid(c) {
  // Ghostty: mirror tmux panes into native splits
  if (inGhostty()) {
    return runGridGhostty(c)
  }

  const conf = loadConfig()

  if (c.options['lead-size'] != null) conf.layout.lead.size = c.options['lead-size']
  if (c.options['lead-position']) conf.layout.lead.position = c.options['lead-position']
  if (c.options.fill) conf.layout.grid.fill = c.options.fill
  if (c.options['max-cols'] != null) conf.layout.grid.maxCols = c.options['max-cols']
  if (c.options['max-rows'] != null) conf.layout.grid.maxRows = c.options['max-rows']

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
    leadPaneId = terminal.currentPane()
    windowId = terminal.paneWindow(leadPaneId)
  }

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find terminal window' })

  if (c.options.expect) {
    const expectedTotal = c.options.expect + 1
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (terminal.listWindowPanes(windowId).length >= expectedTotal) break
      Bun.sleepSync(500)
    }
  }

  const { w: W, h: H } = terminal.getWindowDimensions(windowId)
  const panes = terminal.listWindowPanes(windowId)

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

  terminal.applyGrid(windowId, leadPane.id, workerPanes.map((p) => p.id), conf.layout)

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
  const teamName = c.args.team || findTeamForCurrentWindow()
  if (!teamName) return c.error({ code: 'NO_TEAM', message: 'No team specified and none found in current window' })
  const closed: Array<{ name: string; pane: string }> = []

  const cruPanes = loadPanes(teamName)
  if (cruPanes && cruPanes.workers.length > 0) {
    // Use the right kill method based on how panes were tracked
    const killFn = cruPanes.backend === 'ghostty'
      ? (id: string) => { try { require('@/lib/ghostty').closeTerminal(id) } catch {} }
      : (id: string) => terminal.killPane(id)

    for (const w of cruPanes.workers) {
      killFn(w.paneId)
      closed.push({ name: w.name, pane: w.paneId })
    }

    // If mirrored, also clean up tmux view sessions on the custom socket
    if (cruPanes.backend === 'ghostty') {
      try {
        const { findSwarmSockets } = require('@/lib/mirror')
        const { execSync } = require('node:child_process')
        for (const socket of findSwarmSockets()) {
          try {
            const sessions = execSync(
              `tmux -L ${socket} list-sessions -F "#{session_name}"`,
              { encoding: 'utf-8', timeout: 3000 },
            ).trim().split('\n')
            for (const name of sessions) {
              if (name.startsWith('view-')) {
                try { execSync(`tmux -L ${socket} kill-session -t ${name}`, { timeout: 3000 }) } catch {}
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
        terminal.killPane(member.tmuxPaneId)
        closed.push({ name: member.name, pane: member.tmuxPaneId })
      }
    } catch {}
  }

  if (closed.length === 0) {
    try {
      const lead = terminal.currentPane()
      const windowId = terminal.paneWindow(lead)
      const panes = terminal.listWindowPanes(windowId)
      for (const p of panes) {
        if (p.id !== lead) {
          terminal.killPane(p.id)
          closed.push({ name: `pane-${closed.length + 1}`, pane: p.id })
        }
      }
    } catch {}
  }

  return { team: teamName, closed: closed.length, panes: closed }
}

function runList(c) {
  const teamName = c.args.team
  let windowId: string | null = null

  if (teamName) {
    windowId = findTeamWindow(teamName)
  } else {
    try {
      const lead = terminal.currentPane()
      windowId = terminal.paneWindow(lead)
    } catch {}
  }

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find terminal window' })

  const info = terminal.listPaneDetails(windowId)
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
