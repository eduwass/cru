import { z } from 'incur'
import { guard } from '@/lib/preflight'
import { loadConfig } from '@/lib/config'
import { readTeamConfig, findTeamWindow } from '@/lib/teams'
import { getWindowDimensions, listWindowPanes, applyLayout } from '@/lib/tmux'
import { buildLayout, computeGrid } from '@/lib/layout'

export const grid = {
  description: "Apply grid layout to a team's tmux panes",
  args: z.object({
    team: z.string().describe('Team name'),
  }),
  options: z.object({
    'lead-size': z.coerce.number().optional().describe('Override lead size (%)'),
    'lead-position': z.enum(['left', 'right', 'top', 'bottom']).optional().describe('Override lead position'),
    fill: z.enum(['row', 'column']).optional().describe('Override grid fill direction'),
    'max-cols': z.coerce.number().optional().describe('Override max columns'),
    'max-rows': z.coerce.number().optional().describe('Override max rows'),
  }),
  run(c) {
    const err = guard('tmux-session')
    if (err) return err

    const conf = loadConfig()

    // CLI flags take precedence over config file
    if (c.options['lead-size'] != null) conf.layout.lead.size = c.options['lead-size']
    if (c.options['lead-position']) conf.layout.lead.position = c.options['lead-position']
    if (c.options.fill) conf.layout.grid.fill = c.options.fill
    if (c.options['max-cols'] != null) conf.layout.grid.maxCols = c.options['max-cols']
    if (c.options['max-rows'] != null) conf.layout.grid.maxRows = c.options['max-rows']

    const teamName = c.args.team
    const teamConf = readTeamConfig(teamName)
    const windowId = findTeamWindow(teamName)
    if (!windowId) return { error: 'Could not find tmux window for team' }

    const { w: W, h: H } = getWindowDimensions(windowId)
    const panes = listWindowPanes(windowId)

    const workerPaneIds = new Set(
      teamConf.members.filter((m) => m.tmuxPaneId).map((m) => m.tmuxPaneId),
    )
    const leadPane = panes.find((p) => !workerPaneIds.has(p.id))
    const workerPanes = panes.filter((p) => workerPaneIds.has(p.id))

    if (!leadPane) return { error: 'Could not identify lead pane' }
    if (workerPanes.length === 0) return { error: 'No worker panes found' }

    const leadId = leadPane.id.replace('%', '')
    const workerIds = workerPanes.map((p) => p.id.replace('%', ''))

    const layoutStr = buildLayout(W, H, leadId, workerIds, conf.layout)
    applyLayout(windowId, layoutStr)

    // build grid for output
    const N = workerPanes.length
    const { cols, rows } = computeGrid(N, conf.layout)
    const grid = []
    let idx = 0
    for (let r = 0; r < rows; r++) {
      const row = []
      for (let col = 0; col < cols; col++) {
        if (idx < N) {
          const member = teamConf.members.find(
            (m) => m.tmuxPaneId === workerPanes[idx].id,
          )
          row.push(member?.name || `worker-${idx + 1}`)
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
