import { z } from 'incur'
import { readTeamConfig, listTeams as getTeams } from '../lib/teams'
import { loadPanes, isTeamAlive } from '../lib/panes'

function age(createdAt: number): string {
  const ms = Date.now() - createdAt
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function teamDetail(teamName: string) {
  const config = readTeamConfig(teamName)
  const cruPanes = loadPanes(teamName)

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
    status: isTeamAlive(teamName) ? 'active' : 'dead',
    age: age(config.createdAt),
    members,
  }
}

export const teams = {
  description: 'List teams or show team detail',
  args: z.object({
    team: z.string().optional().describe('Team name (omit to list all teams)'),
  }),
  options: z.object({
    all: z.boolean().default(false).describe('Include dead teams'),
  }),
  run(c) {
    // Show detail for a specific team
    if (c.args.team) return teamDetail(c.args.team)

    // List all teams
    const teamNames = getTeams()
    if (teamNames.length === 0) return { teams: [], message: 'No teams' }

    const result = teamNames.map((t) => {
      const config = readTeamConfig(t)
      const alive = isTeamAlive(t)
      return {
        name: config.name,
        members: config.members.length,
        status: alive ? 'active' : 'dead',
        age: age(config.createdAt),
        description: config.description,
      }
    })

    const filtered = c.options.all ? result : result.filter((t) => t.status === 'active')

    if (filtered.length === 0 && !c.options.all) {
      const dead = result.length
      if (!c.agent && dead > 0) {
        console.log(`No active teams (${dead} dead — use --all to show, or 'cru clean' to remove)`)
      }
      return { teams: [], message: 'No active teams' }
    }

    return { teams: filtered }
  },
}
