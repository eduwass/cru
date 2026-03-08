import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { teamsDir } from './teams'

interface PaneRecord {
  leadPane: string
  windowId: string
  workers: Array<{ name: string; paneId: string; color: string }>
  createdAt: number
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

/** Check if a team has live worker panes in tmux. */
export function isTeamAlive(teamName: string): boolean {
  try {
    const { execSync } = require('node:child_process')
    const allPanes: string = execSync('tmux list-panes -a -F "#{pane_id}"', { encoding: 'utf-8' }).trim()
    const paneSet = new Set(allPanes.split('\n'))

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
