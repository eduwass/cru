import { z } from 'incur'
import { readTeamConfig } from '../../lib/teams.js'
import { loadConfig } from '../../lib/config.js'
import { currentPane, paneWindow, getWindowDimensions, listWindowPanes, applyLayout } from '../../lib/tmux.js'
import { buildLayout, computeGrid } from '../../lib/layout.js'
import { spawnWorkers } from '../../lib/spawn.js'

export const spawn = {
  description: 'Spawn worker agents in tmux panes and apply grid layout',
  args: z.object({
    team: z.string().describe('Team name (from TeamCreate)'),
  }),
  options: z.object({
    workers: z.coerce.number().default(4).describe('Number of workers to spawn'),
    cwd: z.string().optional().describe('Working directory for agents'),
    'parent-session': z.string().optional().describe('Lead session ID (auto-detected from team config)'),
    'lead-size': z.coerce.number().optional().describe('Override lead pane size (%)'),
  }),
  alias: { workers: 'n' },
  run(c) {
    const teamName = c.args.team
    const numWorkers = c.options.workers
    const cwd = c.options.cwd || process.cwd()

    // Read team config for parent session ID
    const teamConf = readTeamConfig(teamName)
    const parentSessionId = c.options['parent-session'] || teamConf.leadSessionId
    if (!parentSessionId) {
      return { error: 'Could not determine parent session ID. Pass --parent-session or ensure team config has leadSessionId.' }
    }

    // Detect current pane as lead
    const leadPane = currentPane()
    const windowId = paneWindow(leadPane)

    // Spawn workers
    const panes = spawnWorkers(leadPane, {
      teamName,
      parentSessionId,
      workers: numWorkers,
      cwd,
    })

    // Apply grid layout
    const conf = loadConfig()
    if (c.options['lead-size'] != null) conf.layout.lead.size = c.options['lead-size']

    const { w: W, h: H } = getWindowDimensions(windowId)
    const allPanes = listWindowPanes(windowId)

    const workerPaneIds = new Set(panes.map((p) => p.paneId))
    const leadPaneEntry = allPanes.find((p) => !workerPaneIds.has(p.id))
    const workerPaneEntries = allPanes.filter((p) => workerPaneIds.has(p.id))

    if (leadPaneEntry && workerPaneEntries.length > 0) {
      const leadId = leadPaneEntry.id.replace('%', '')
      const workerIds = workerPaneEntries.map((p) => p.id.replace('%', ''))
      const layoutStr = buildLayout(W, H, leadId, workerIds, conf.layout)
      applyLayout(windowId, layoutStr)
    }

    // Build grid display
    const { cols, rows } = computeGrid(numWorkers, conf.layout)
    const grid = []
    let idx = 0
    for (let r = 0; r < rows; r++) {
      const row = []
      for (let col = 0; col < cols; col++) {
        if (idx < numWorkers) {
          row.push(panes[idx].name)
          idx++
        }
      }
      grid.push(row)
    }

    return {
      team: teamName,
      spawned: numWorkers,
      grid_size: `${rows}x${cols}`,
      grid,
      panes: panes.map((p) => ({ name: p.name, pane: p.paneId, color: p.color })),
    }
  },
}
