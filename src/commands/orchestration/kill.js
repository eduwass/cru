import { z } from 'incur'
import { readTeamConfig } from '../../lib/teams.js'
import { killPane } from '../../lib/tmux.js'

export const kill = {
  description: 'Kill all worker panes for a team',
  args: z.object({
    team: z.string().describe('Team name'),
  }),
  run(c) {
    const teamName = c.args.team
    const config = readTeamConfig(teamName)

    const workers = config.members.filter((m) => m.tmuxPaneId)
    const killed = []

    for (const member of workers) {
      killPane(member.tmuxPaneId)
      killed.push({ name: member.name, pane: member.tmuxPaneId })
    }

    return {
      team: teamName,
      killed: killed.length,
      panes: killed,
    }
  },
}
