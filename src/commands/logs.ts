import { z } from 'incur'
import { readTeamConfig, listTeams } from '@/lib/teams'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const COLORS: Record<string, string> = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  purple: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
}
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

type MsgKind = 'chat' | 'task' | 'idle' | 'shutdown'

interface Event {
  ts: number
  type: 'created' | 'joined' | 'message'
  kind?: MsgKind
  team?: string
  agent?: string
  color?: string
  from?: string
  to?: string
  text?: string
}

function readInboxes(teamName: string): Event[] {
  const inboxDir = join(homedir(), '.claude', 'teams', teamName, 'inboxes')
  if (!existsSync(inboxDir)) return []

  const events: Event[] = []
  for (const file of readdirSync(inboxDir)) {
    if (!file.endsWith('.json')) continue
    const to = basename(file, '.json')
    try {
      const messages = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'))
      for (const msg of messages) {
        let text = msg.summary || msg.text
        let kind: MsgKind = 'chat'
        try {
          const parsed = JSON.parse(msg.text)
          switch (parsed.type) {
            case 'task_assignment':
              text = parsed.subject || parsed.description || 'assigned'
              kind = 'task'
              break
            case 'shutdown_request':
              text = parsed.reason || 'requested'
              kind = 'shutdown'
              break
            case 'shutdown_approved':
              text = 'approved'
              kind = 'shutdown'
              break
            case 'idle_notification':
              kind = 'idle'
              text = parsed.idleReason || 'available'
              break
          }
        } catch {}

        events.push({
          ts: new Date(msg.timestamp).getTime(),
          type: 'message',
          kind,
          from: msg.from,
          to,
          text,
        })
      }
    } catch {}
  }
  return events
}

function teamEvents(teamName: string): { events: Event[]; colorMap: Record<string, string> } {
  const config = readTeamConfig(teamName)
  const colorMap: Record<string, string> = { 'team-lead': 'white' }
  for (const m of config.members) {
    if (m.color) colorMap[m.name] = m.color
  }

  const events: Event[] = []

  events.push({ ts: config.createdAt, type: 'created', team: teamName })

  for (const m of config.members) {
    if (m.agentType === 'team-lead') continue
    events.push({ ts: m.joinedAt, type: 'joined', team: teamName, agent: m.name, color: m.color })
  }

  const msgEvents = readInboxes(teamName)
  for (const e of msgEvents) {
    e.team = teamName
    e.color = colorMap[e.from!] || colorMap[e.to!]
  }
  events.push(...msgEvents)

  return { events, colorMap }
}

function truncate(s: string, n: number): string {
  if (!s) return ''
  const oneline = s.replace(/\n/g, ' ').trim()
  return oneline.length > n ? `${oneline.slice(0, n)}…` : oneline
}

function time(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function colorize(name: string, color?: string): string {
  const c = color && COLORS[color]
  return c ? `${c}${name}${RESET}` : name
}

function formatEvents(
  events: Event[],
  colorMap: Record<string, string>,
  opts: { full?: boolean; showTeam?: boolean },
): string {
  const lines: string[] = []

  for (const e of events) {
    const t = `${DIM}${time(e.ts)}${RESET}`
    const prefix = opts.showTeam ? `${DIM}${e.team}${RESET} ` : ''
    switch (e.type) {
      case 'created':
        lines.push(`${t}  ${prefix}${DIM}●${RESET} team created`)
        break
      case 'joined':
        lines.push(`${t}  ${prefix}${DIM}→${RESET} ${colorize(e.agent!, e.color)} joined`)
        break
      case 'message': {
        const from = colorize(e.from!, colorMap[e.from!])
        const to = colorize(e.to!, colorMap[e.to!])
        const text = opts.full ? e.text : truncate(e.text || '', 80)
        switch (e.kind) {
          case 'task':
            lines.push(`${t}  ${prefix}${BOLD}>${RESET} ${from} → ${to}: ${text}`)
            break
          case 'idle':
            lines.push(`${t}  ${prefix}${DIM}~ ${e.from} idle${RESET}`)
            break
          case 'shutdown':
            lines.push(`${t}  ${prefix}${DIM}x ${e.from} → ${e.to}: ${text}${RESET}`)
            break
          default:
            lines.push(`${t}  ${prefix}  ${from} → ${to}: ${text}`)
            break
        }
        break
      }
    }
  }

  return lines.join('\n')
}

export const logs = {
  description: 'Show team activity log',
  args: z.object({
    team: z.string().optional().describe('Team name (omit to show all teams)'),
  }),
  options: z.object({
    full: z.boolean().default(false).describe('Show full message text'),
    last: z.coerce.number().optional().describe('Show only the last N events'),
    follow: z.boolean().default(false).describe('Follow live events'),
  }),
  alias: { follow: 'f' },
  async run(c) {
    const teamNames = c.args.team ? [c.args.team] : listTeams()
    if (teamNames.length === 0) return { events: [], message: 'No teams found' }

    const allEvents: Event[] = []
    const mergedColorMap: Record<string, string> = {}

    for (const name of teamNames) {
      try {
        const { events, colorMap } = teamEvents(name)
        allEvents.push(...events)
        Object.assign(mergedColorMap, colorMap)
      } catch {}
    }

    allEvents.sort((a, b) => a.ts - b.ts)

    const limit = c.options.last ?? (c.args.team ? undefined : 50)
    const display = limit ? allEvents.slice(-limit) : allEvents

    if (c.agent) {
      return {
        teams: teamNames,
        events: display.map((e) => ({
          time: new Date(e.ts).toISOString(),
          type: e.type,
          ...(e.team ? { team: e.team } : {}),
          ...(e.agent ? { agent: e.agent } : {}),
          ...(e.from ? { from: e.from, to: e.to } : {}),
          ...(e.text ? { text: e.text } : {}),
        })),
      }
    }

    const showTeam = teamNames.length > 1
    if (!showTeam) {
      const created = new Date(allEvents[0]?.ts || Date.now())
      const date = created.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      console.log(`\n${BOLD}${teamNames[0]}${RESET} ${DIM}— ${date}${RESET}\n`)
    } else {
      console.log()
    }

    const fmtOpts = { full: c.options.full, showTeam }
    console.log(formatEvents(display, mergedColorMap, fmtOpts))

    if (!c.options.follow) {
      console.log(`\n${DIM}Run with -f to follow live${RESET}\n`)
      return
    }

    // Follow mode: poll for new events every 2s
    let seen = allEvents.length
    const poll = () => {
      const fresh: Event[] = []
      const freshColorMap: Record<string, string> = {}
      for (const name of teamNames) {
        try {
          const { events, colorMap } = teamEvents(name)
          fresh.push(...events)
          Object.assign(freshColorMap, colorMap)
        } catch {}
      }
      fresh.sort((a, b) => a.ts - b.ts)
      Object.assign(mergedColorMap, freshColorMap)

      if (fresh.length > seen) {
        const newEvents = fresh.slice(seen)
        process.stdout.write(formatEvents(newEvents, mergedColorMap, fmtOpts) + '\n')
        seen = fresh.length
      }
    }

    const interval = setInterval(poll, 2000)
    process.on('SIGINT', () => {
      clearInterval(interval)
      console.log(`\n${DIM}stopped${RESET}`)
      process.exit(0)
    })

    // Keep process alive
    await new Promise(() => {})
  },
}
