import { z } from 'incur'
import { loadConfig } from '@/lib/config'
import { readTeamConfig, findTeamWindow, findTeamForCurrentWindow } from '@/lib/teams'
import { getBackend } from '@/lib/terminal'
import { computeGrid } from '@/lib/layout'
import { loadPanes } from '@/lib/panes'

function runGrid(c) {
  const backend = getBackend()
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
    leadPaneId = backend.currentPane()
    windowId = backend.paneWindow(leadPaneId)
  }

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find terminal window' })

  if (c.options.expect) {
    const expectedTotal = c.options.expect + 1
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (backend.listWindowPanes(windowId).length >= expectedTotal) break
      Bun.sleepSync(500)
    }
  }

  const { w: W, h: H } = backend.getWindowDimensions(windowId)
  const panes = backend.listWindowPanes(windowId)

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

  backend.applyGrid(windowId, leadPane.id, workerPanes.map((p) => p.id), conf.layout)

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
  const backend = getBackend()
  const teamName = c.args.team || findTeamForCurrentWindow()
  if (!teamName) return c.error({ code: 'NO_TEAM', message: 'No team specified and none found in current window' })
  const closed: Array<{ name: string; pane: string }> = []

  const cruPanes = loadPanes(teamName)
  if (cruPanes && cruPanes.workers.length > 0) {
    for (const w of cruPanes.workers) {
      backend.killPane(w.paneId)
      closed.push({ name: w.name, pane: w.paneId })
    }
  } else {
    try {
      const config = readTeamConfig(teamName)
      const workers = config.members.filter((m) => m.tmuxPaneId)
      for (const member of workers) {
        backend.killPane(member.tmuxPaneId)
        closed.push({ name: member.name, pane: member.tmuxPaneId })
      }
    } catch {}
  }

  if (closed.length === 0) {
    try {
      const lead = backend.currentPane()
      const windowId = backend.paneWindow(lead)
      const panes = backend.listWindowPanes(windowId)
      for (const p of panes) {
        if (p.id !== lead) {
          backend.killPane(p.id)
          closed.push({ name: `pane-${closed.length + 1}`, pane: p.id })
        }
      }
    } catch {}
  }

  return { team: teamName, closed: closed.length, panes: closed }
}

function runList(c) {
  const backend = getBackend()
  const teamName = c.args.team
  let windowId: string | null = null

  if (teamName) {
    windowId = findTeamWindow(teamName)
  } else {
    try {
      const lead = backend.currentPane()
      windowId = backend.paneWindow(lead)
    } catch {}
  }

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find terminal window' })

  const info = backend.listPaneDetails(windowId)
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
