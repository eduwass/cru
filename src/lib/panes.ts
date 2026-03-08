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
  const cruPanes = loadPanes(teamName)
  if (!cruPanes) return false
  try {
    const { execSync } = require('node:child_process')
    const allPanes: string = execSync('tmux list-panes -a -F "#{pane_id}"', { encoding: 'utf-8' }).trim()
    const paneSet = new Set(allPanes.split('\n'))
    return cruPanes.workers.some((w) => paneSet.has(w.paneId))
  } catch {
    return false
  }
}
