import { z } from 'incur'
import { readTeamConfig, listTeams as getTeams } from '@/lib/teams'
import { loadPanes, isTeamAlive } from '@/lib/panes'

function teamStatus(teamName: string) {
  const config = readTeamConfig(teamName)
  const cruPanes = loadPanes(teamName)

  // Build member list from Claude config
  const members = config.members.map((m) => ({
    name: m.name,
    role: m.agentType || 'worker',
    pane: m.tmuxPaneId || 'none',
    color: m.color || '',
    active: m.isActive ?? true,
  }))

  // Merge workers from cru pane tracking that aren't in Claude's config yet
  if (cruPanes) {
    const known = new Set(members.map((m) => m.name))
    for (const w of cruPanes.workers) {
      if (!known.has(w.name)) {
        members.push({
          name: w.name,
          role: 'worker',
          pane: w.paneId,
          color: w.color,
          active: true,
        })
      }
    }
    // Fill in pane IDs for members missing them
    for (const m of members) {
      if (m.pane === 'none') {
        const tracked = cruPanes.workers.find((w) => w.name === m.name)
        if (tracked) {
          m.pane = tracked.paneId
          if (!m.color) m.color = tracked.color
        }
        if (m.name === 'team-lead') m.pane = cruPanes.leadPane
      }
    }
  }

  return {
    team: config.name,
    description: config.description,
    members,
  }
}

export const status = {
  description: 'Show team members and their pane assignments',
  args: z.object({
    team: z.string().optional().describe('Team name (omit to show active teams)'),
  }),
  run(c) {
    if (c.args.team) return teamStatus(c.args.team)

    // No team specified — show all active teams
    const teams = getTeams().filter(isTeamAlive)
    if (teams.length === 0) return { teams: [], message: 'No active teams' }
    return { teams: teams.map(teamStatus) }
  },
}
