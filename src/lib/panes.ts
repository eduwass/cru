import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { teamsDir } from './teams'

interface PaneRecord {
  leadPane: string
  windowId: string
  workers: Array<{ name: string; paneId: string; color: string }>
  createdAt: number
  backend?: 'tmux' | 'ghostty'
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
    const { getBackend } = require('./terminal')
    const backend = getBackend()
    const allPanes = backend.listAllPaneIds()
    const paneSet = new Set(allPanes)

    // Check cru's own pane tracking first
    const cruPanes = loadPanes(teamName)
    if (cruPanes && cruPanes.workers.some((w) => paneSet.has(w.paneId))) return true

    // Fallback: check Claude's team config for tmuxPaneId entries
    const { readTeamConfig } = require('./teams')
    const config = readTeamConfig(teamName)
    return config.members.some((m: any) => m.tmuxPaneId && paneSet.has(m.tmuxPaneId))
  } catch {
    return false
  }
}
