import { z } from 'incur'
import { readTeamConfig, findTeamForCurrentWindow } from '@/lib/teams'
import { killPane } from '@/lib/tmux'
import { loadPanes } from '@/lib/panes'

export const kill = {
  description: 'Kill all worker panes for a team',
  args: z.object({
    team: z.string().optional().describe('Team name (auto-detects from current window if omitted)'),
  }),
  run(c) {
    const teamName = c.args.team || findTeamForCurrentWindow()
    if (!teamName) return c.error({ code: 'NO_TEAM', message: 'No team specified and none found in current window' })
    const killed: Array<{ name: string; pane: string }> = []

    // Primary: use cru's own pane tracking
    const cruPanes = loadPanes(teamName)
    if (cruPanes && cruPanes.workers.length > 0) {
      for (const w of cruPanes.workers) {
        killPane(w.paneId)
        killed.push({ name: w.name, pane: w.paneId })
      }
    } else {
      // Fallback: use Claude's team config
      try {
        const config = readTeamConfig(teamName)
        const workers = config.members.filter((m) => m.tmuxPaneId)
        for (const member of workers) {
          killPane(member.tmuxPaneId)
          killed.push({ name: member.name, pane: member.tmuxPaneId })
        }
      } catch {}
    }

    // Team data (config.json, inboxes/, cru-panes.json) is preserved
    // for post-mortem review via `cru logs`. Use `cru clean` to remove.

    return { team: teamName, killed: killed.length, panes: killed }
  },
}
