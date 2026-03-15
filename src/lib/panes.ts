import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { teamsDir } from './paths'
import { listAllPaneIds } from './tmux'

export interface PaneRecord {
  leadPane: string
  windowId: string
  workers: Array<{ name: string; paneId: string; color: string }>
  createdAt: number
  backend?: 'tmux' | 'ghostty' | 'cmux'
  leadOriginalTitle?: string
}

function panePath(teamName: string): string {
  return join(teamsDir(), teamName, 'cru-panes.json')
}

export function savePanes(teamName: string, record: PaneRecord): void {
  const dir = join(teamsDir(), teamName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(panePath(teamName), JSON.stringify(record, null, 2))
}

export function loadPanes(teamName: string): PaneRecord | null {
  try {
    return JSON.parse(readFileSync(panePath(teamName), 'utf-8'))
  } catch {
    return null
  }
}

/** Check if a team has live worker panes. */
export function isTeamAlive(teamName: string): boolean {
  try {
    const cruPanes = loadPanes(teamName)

    // For cmux-tracked teams, check via cmux CLI
    if (cruPanes?.backend === 'cmux') {
      try {
        const { listAllSurfaceIds } = require('./cmux')
        const allSurfaces = new Set(listAllSurfaceIds())
        return cruPanes.workers.some((w) => allSurfaces.has(w.paneId))
      } catch (e) {
        console.warn(`[isTeamAlive] failed to query cmux for team "${teamName}": ${e}`)
        return false
      }
    }

    // For ghostty-tracked teams, check via AppleScript
    if (cruPanes?.backend === 'ghostty') {
      try {
        const { listAllTerminals } = require('./ghostty')
        const allTerminals = new Set(listAllTerminals())
        return cruPanes.workers.some((w) => allTerminals.has(w.paneId))
      } catch (e) {
        console.warn(`[isTeamAlive] failed to query Ghostty for team "${teamName}": ${e}`)
        return false
      }
    }

    // For tmux teams, check pane IDs
    const allPanes = new Set(listAllPaneIds())

    if (cruPanes && cruPanes.workers.some((w) => allPanes.has(w.paneId))) return true

    // Fallback: check Claude's team config for tmuxPaneId entries
    // Late require to avoid circular dep (teams.ts imports panes.ts)
    const { readTeamConfig } = require('./teams')
    const config = readTeamConfig(teamName)
    return config.members.some((m: any) => m.tmuxPaneId && allPanes.has(m.tmuxPaneId))
  } catch {
    return false
  }
}
