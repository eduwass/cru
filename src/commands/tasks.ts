import { z } from 'incur'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { listTeams } from '../lib/teams'

function listTaskTeams(): string[] {
  const dir = join(homedir(), '.claude', 'tasks')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => {
    const full = join(dir, f)
    try { return readdirSync(full).some((e) => e.endsWith('.json')) } catch { return false }
  })
}

interface Task {
  id: string
  subject: string
  description?: string
  status: string
  owner?: string
  activeForm?: string
  blocks: string[]
  blockedBy: string[]
}

function tasksDir(teamName: string): string {
  return join(homedir(), '.claude', 'tasks', teamName)
}

function readTasks(teamName: string): Task[] {
  const dir = tasksDir(teamName)
  if (!existsSync(dir)) return []

  const tasks: Task[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      tasks.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')))
    } catch {}
  }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id))
}

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'

function statusIcon(status: string): string {
  switch (status) {
    case 'completed': return `${GREEN}✓${RESET}`
    case 'in_progress': return `${YELLOW}◉${RESET}`
    case 'blocked': return `${RED}✗${RESET}`
    default: return `${DIM}○${RESET}`
  }
}

export const tasks = {
  description: 'List tasks for a team',
  args: z.object({
    team: z.string().optional().describe('Team name (omit to show tasks from all active teams)'),
  }),
  options: z.object({
    all: z.boolean().default(false).describe('Include tasks from all teams (not just active)'),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional().describe('Filter by status'),
  }),
  run(c) {
    const teamNames = c.args.team ? [c.args.team] : listTaskTeams()
    if (teamNames.length === 0) return { teams: [], message: 'No teams found' }

    const result: Array<{ team: string; tasks: Task[] }> = []

    for (const name of teamNames) {
      let teamTasks = readTasks(name)
      if (teamTasks.length === 0) continue
      if (c.options.status) {
        teamTasks = teamTasks.filter((t) => t.status === c.options.status)
      }
      if (teamTasks.length > 0) {
        result.push({ team: name, tasks: teamTasks })
      }
    }

    if (result.length === 0) {
      return { teams: [], message: 'No tasks found' }
    }

    if (c.agent) {
      return { teams: result }
    }

    // Human-readable output
    for (const { team, tasks: teamTasks } of result) {
      const done = teamTasks.filter((t) => t.status === 'completed').length
      console.log(`\n${BOLD}${team}${RESET} ${DIM}— ${done}/${teamTasks.length} done${RESET}`)

      for (const t of teamTasks) {
        const icon = statusIcon(t.status)
        const owner = t.owner ? ` ${CYAN}@${t.owner}${RESET}` : ''
        const blocked = t.blockedBy.length > 0 ? ` ${RED}blocked by ${t.blockedBy.join(', ')}${RESET}` : ''
        console.log(`  ${icon} ${DIM}#${t.id}${RESET} ${t.subject}${owner}${blocked}`)
      }
    }
    console.log()
  },
}
