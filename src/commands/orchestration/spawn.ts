import { z } from 'incur'
import { readTeamConfig } from '@/lib/teams'
import { loadConfig } from '@/lib/config'
import { currentPane, paneWindow, getWindowDimensions, listWindowPanes, applyLayout, killPane } from '@/lib/tmux'
import { buildLayout, computeGrid } from '@/lib/layout'
import { spawnWorkers } from '@/lib/spawn'
import { savePanes } from '@/lib/panes'

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

    const teamConf = readTeamConfig(teamName)
    const parentSessionId = c.options['parent-session'] || teamConf.leadSessionId
    if (!parentSessionId) {
      return c.error({
        code: 'NO_PARENT_SESSION',
        message: 'Could not determine parent session ID. Pass --parent-session or ensure team config has leadSessionId.',
      })
    }

    const leadPane = currentPane()
    const windowId = paneWindow(leadPane)

    // Validate: only the lead pane should exist in this window
    const existingPanes = listWindowPanes(windowId)
    if (existingPanes.length > 1) {
      return c.error({
        code: 'EXTRA_PANES',
        message: `Window has ${existingPanes.length} panes (expected 1). Close extra panes or use a clean tmux window.`,
      })
    }

    const panes = spawnWorkers(leadPane, {
      teamName,
      parentSessionId,
      workers: numWorkers,
      cwd,
    })

    // Save pane tracking before layout (so kill works even if layout fails)
    savePanes(teamName, {
      leadPane,
      windowId,
      workers: panes.map((p) => ({ name: p.name, paneId: p.paneId, color: p.color })),
      createdAt: Date.now(),
    })

    // Apply grid layout — clean up spawned panes on failure
    try {
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
    } catch (err) {
      // Layout failed — kill orphaned panes so user isn't left with a mess
      for (const p of panes) killPane(p.paneId)
      return c.error({
        code: 'LAYOUT_FAILED',
        message: `Layout failed, cleaned up ${panes.length} panes. ${err instanceof Error ? err.message : err}`,
      })
    }

    const { cols, rows } = computeGrid(numWorkers, loadConfig().layout)
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
