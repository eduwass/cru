import { splitPane, sendKeys, selectPane } from './tmux'

const COLORS = ['blue', 'green', 'yellow', 'red', 'magenta', 'cyan']

/**
 * Spawn N worker agents as tmux panes.
 * Splits from the lead pane, starts `claude` in each, returns pane IDs.
 */
export function spawnWorkers(leadPane, { teamName, parentSessionId, workers, cwd }) {
  const panes = []

  for (let i = 0; i < workers; i++) {
    const name = `worker-${i + 1}`
    const color = COLORS[i % COLORS.length]

    // Alternate horizontal/vertical splits for a rough grid
    const horizontal = i % 2 === 1
    // Split from lead for first pane, from previous for subsequent
    const splitFrom = i === 0 ? leadPane : panes[i - 1].paneId
    const paneId = splitPane(splitFrom, { horizontal })

    const cmd = buildClaudeCmd({ name, teamName, color, parentSessionId, cwd })
    sendKeys(paneId, cmd)

    panes.push({ name, paneId, color })
  }

  // Refocus lead
  selectPane(leadPane)

  return panes
}

export function buildClaudeCmd({ name, teamName, color, parentSessionId, cwd }) {
  const parts = []
  if (cwd) parts.push(`cd ${JSON.stringify(cwd)} &&`)
  parts.push('claude')
  parts.push(`--agent-id ${name}@${teamName}`)
  parts.push(`--agent-name ${name}`)
  parts.push(`--team-name ${teamName}`)
  parts.push(`--agent-color ${color}`)
  parts.push(`--parent-session-id ${parentSessionId}`)
  parts.push('--agent-type general-purpose')
  return parts.join(' ')
}
