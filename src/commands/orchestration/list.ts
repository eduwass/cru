import { readTeamConfig, listTeams as getTeams } from '@/lib/teams'

export const list = {
  description: 'List all teams',
  run() {
    const teams = getTeams()
    if (teams.length === 0) return { teams: [], message: 'No active teams' }
    return {
      teams: teams.map((t) => {
        const config = readTeamConfig(t)
        return {
          name: config.name,
          members: config.members.length,
          description: config.description,
        }
      }),
    }
  },
}
