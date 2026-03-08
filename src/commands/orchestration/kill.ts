import { z } from 'incur'
import { guard } from '@/lib/preflight'
import { readTeamConfig } from '@/lib/teams'
import { killPane } from '@/lib/tmux'

export const kill = {
  description: 'Kill all worker panes for a team',
  args: z.object({
    team: z.string().describe('Team name'),
  }),
  run(c) {
    const err = guard('tmux')
    if (err) return err

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
