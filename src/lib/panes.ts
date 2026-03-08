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
