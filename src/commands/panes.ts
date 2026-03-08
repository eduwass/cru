import { z } from 'incur'
import { loadConfig } from '@/lib/config'
import { readTeamConfig, findTeamWindow, findTeamForCurrentWindow } from '@/lib/teams'
import { tmux, getWindowDimensions, listWindowPanes, applyLayout, currentPane, paneWindow, killPane } from '@/lib/tmux'
import { buildLayout, computeGrid } from '@/lib/layout'
import { loadPanes } from '@/lib/panes'

function runGrid(c) {
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
    leadPaneId = currentPane()
    windowId = paneWindow(leadPaneId)
  }

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find tmux window' })

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

  const leadId = leadPane.id.replace('%', '')
  const workerIds = workerPanes.map((p) => p.id.replace('%', ''))

  const layoutStr = buildLayout(W, H, leadId, workerIds, conf.layout)
  applyLayout(windowId, layoutStr)

  // Fix pane assignment for right/bottom — tmux assigns by window order, not layout IDs
  const pos = conf.layout.lead.position
  if (pos === 'right' || pos === 'bottom') {
    const isH = pos === 'right'
    const posKey = isH ? 'pane_left' : 'pane_top'
    const afterInfo = tmux(`list-panes -t ${windowId} -F "#{pane_id} #{${posKey}}"`)
      .split('\n')
      .map((l) => { const [id, v] = l.split(' '); return { id, pos: Number(v) } })

    const leadAfter = afterInfo.find((p) => p.id === leadPane.id)
    const maxPos = Math.max(...afterInfo.map((p) => p.pos))
    if (leadAfter && leadAfter.pos !== maxPos) {
      const paneAtLeadPos = afterInfo.find((p) => p.pos === maxPos)
      if (paneAtLeadPos) {
        tmux(`swap-pane -d -s ${leadPane.id} -t ${paneAtLeadPos.id}`)
      }
    }
  }

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
    for (const w of cruPanes.workers) {
      killPane(w.paneId)
      closed.push({ name: w.name, pane: w.paneId })
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

  if (closed.length === 0) {
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

  return { team: teamName, closed: closed.length, panes: closed }
}

function runList(c) {
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

  if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find tmux window' })

  const info = tmux(`list-panes -t ${windowId} -F "#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_left} #{pane_top} #{pane_pid}"`)
    .split('\n')
    .map((l) => {
      const [id, index, width, height, left, top, pid] = l.split(' ')
      return { id, index: Number(index), width: Number(width), height: Number(height), left: Number(left), top: Number(top), pid: Number(pid) }
    })

  return { window: windowId, panes: info }
}

export const panes = {
  description: 'Manage tmux panes (list, grid layout, close)',
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
