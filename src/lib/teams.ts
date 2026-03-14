import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { teamsDir } from './paths'
import { loadPanes } from './panes'
import { currentPane, paneWindow, tmux } from './tmux'

export function readTeamConfig(teamName: string): any {
  const p = join(teamsDir(), teamName, 'config.json')
  return JSON.parse(readFileSync(p, 'utf-8'))
}

export function listTeams(): string[] {
  const dir = teamsDir()
  try {
    return readdirSync(dir).filter((d) => {
      try {
        readFileSync(join(dir, d, 'config.json'), 'utf-8')
        return true
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/** Find which team owns the current terminal window. */
export function findTeamForCurrentWindow(): string | null {
  const windowId = paneWindow(currentPane())
  for (const name of listTeams()) {
    const panes = loadPanes(name)
    if (panes?.windowId === windowId) return name
  }
  return null
}

export function findTeamWindow(teamName: string): string | null {
  // Primary: cru's own pane tracking
  const cruPanes = loadPanes(teamName)
  if (cruPanes) return cruPanes.windowId

  // Fallback: search via Claude's team config
  const config = readTeamConfig(teamName)
  const workerPaneIds = config.members
    .filter((m: any) => m.tmuxPaneId)
    .map((m: any) => m.tmuxPaneId)
  if (workerPaneIds.length === 0) return null

  // Search all panes to find which window contains a worker pane
  const lines = tmux('list-panes', '-a', '-F', '#{window_id} #{pane_id}').split('\n')
  for (const line of lines) {
    const [winId, paneId] = line.split(' ')
    if (paneId === workerPaneIds[0]) return winId
  }
  return null
}
