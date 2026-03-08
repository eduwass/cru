import { z } from 'incur'
import { readTeamConfig, listTeams as getTeams } from '@/lib/teams'
import { isTeamAlive } from '@/lib/panes'

function age(createdAt: number): string {
  const ms = Date.now() - createdAt
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export const list = {
  description: 'List all teams',
  options: z.object({
    all: z.boolean().default(false).describe('Include dead teams'),
  }),
  run(c) {
    const teams = getTeams()
    if (teams.length === 0) return { teams: [], message: 'No teams' }

    const result = teams.map((t) => {
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
