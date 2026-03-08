import { z } from 'incur'
import { readTeamConfig } from '@/lib/teams'

export const status = {
  description: 'Show team members and their pane assignments',
  args: z.object({
    team: z.string().describe('Team name'),
  }),
  run(c) {
    const config = readTeamConfig(c.args.team)
    return {
      team: config.name,
      description: config.description,
      members: config.members.map((m) => ({
        name: m.name,
        role: m.agentType || 'worker',
        pane: m.tmuxPaneId || 'none',
        active: m.isActive ?? true,
      })),
    }
  },
}
