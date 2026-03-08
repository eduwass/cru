import { z } from 'incur'
import { loadConfig } from '@/lib/config'
import { readTeamConfig, findTeamWindow } from '@/lib/teams'
import { tmux, getWindowDimensions, listWindowPanes, applyLayout, currentPane, paneWindow } from '@/lib/tmux'
import { buildLayout, computeGrid } from '@/lib/layout'
import { loadPanes } from '@/lib/panes'

export const grid = {
  description: 'Apply grid layout to tmux panes (auto-detects or uses team tracking)',
  args: z.object({
    team: z.string().optional().describe('Team name (omit to auto-detect panes in current window)'),
  }),
  options: z.object({
    'lead-size': z.coerce.number().optional().describe('Override lead size (%)'),
    'lead-position': z.enum(['left', 'right', 'top', 'bottom']).optional().describe('Override lead position'),
    fill: z.enum(['row', 'column']).optional().describe('Override grid fill direction'),
    'max-cols': z.coerce.number().optional().describe('Override max columns'),
    'max-rows': z.coerce.number().optional().describe('Override max rows'),
    expect: z.coerce.number().optional().describe('Wait until N worker panes appear before applying layout'),
  }),
  run(c) {
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
      // Team mode: use cru's pane tracking or Claude's config
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
      // Auto-detect: current pane = lead, everything else = workers
      leadPaneId = currentPane()
      windowId = paneWindow(leadPaneId)
    }

    if (!windowId) return c.error({ code: 'NO_WINDOW', message: 'Could not find tmux window' })

    // Wait for expected number of worker panes if --expect is set
    if (c.options.expect) {
      const expectedTotal = c.options.expect + 1 // workers + lead
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
      // Team mode: identify by tracked pane IDs
      leadPane = panes.find((p) => !workerPaneIds.has(p.id))
      workerPanes = panes.filter((p) => workerPaneIds.has(p.id))
    } else {
      // Auto-detect mode: current pane is lead
      leadPane = panes.find((p) => p.id === leadPaneId)
      workerPanes = panes.filter((p) => p.id !== leadPaneId)
    }

    if (!leadPane) return c.error({ code: 'NO_LEAD', message: 'Could not identify lead pane' })
    if (workerPanes.length === 0) return c.error({ code: 'NO_WORKERS', message: 'No worker panes found' })

    const leadId = leadPane.id.replace('%', '')
    const workerIds = workerPanes.map((p) => p.id.replace('%', ''))

    const layoutStr = buildLayout(W, H, leadId, workerIds, conf.layout)
    applyLayout(windowId, layoutStr)

    // tmux assigns panes to layout cells by window order, not by IDs in the layout
    // string. For position left/top the lead is first in both orders, so it works.
    // For right/bottom, the lead cell is last but the lead pane is first — fix with swap.
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
  },
}
