import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { tmux } from './tmux.js'

export function teamsDir() {
  return join(homedir(), '.claude', 'teams')
}

export function readTeamConfig(teamName) {
  const p = join(teamsDir(), teamName, 'config.json')
  return JSON.parse(readFileSync(p, 'utf-8'))
}

export function listTeams() {
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

export function findTeamWindow(teamName) {
  const config = readTeamConfig(teamName)
  const workerPaneIds = config.members
    .filter((m) => m.tmuxPaneId)
    .map((m) => m.tmuxPaneId)
  if (workerPaneIds.length === 0) return null

  const lines = tmux('list-panes -a -F "#{window_id} #{pane_id}"').split('\n')
  for (const line of lines) {
    const [winId, paneId] = line.split(' ')
    if (paneId === workerPaneIds[0]) return winId
  }
  return null
}
