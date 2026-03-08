import { z } from 'incur'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { teamsDir } from '@/lib/teams'

export const clean = {
  description: 'Remove old team data from ~/.claude/teams',
  options: z.object({
    days: z.coerce.number().default(7).describe('Remove teams older than N days'),
    all: z.boolean().default(false).describe('Remove all teams'),
    'dry-run': z.boolean().default(false).describe('Show what would be removed without deleting'),
  }),
  run(c) {
    const dir = teamsDir()
    let teams: string[]
    try {
      teams = readdirSync(dir).filter((d) => {
        try {
          statSync(join(dir, d, 'config.json'))
          return true
        } catch {
          return false
        }
      })
    } catch {
      return { removed: 0, teams: [] }
    }

    const now = Date.now()
    const maxAge = c.options.days * 24 * 60 * 60 * 1000
    const toRemove: Array<{ name: string; age: string }> = []

    for (const name of teams) {
      const configPath = join(dir, name, 'config.json')
      try {
        const stat = statSync(configPath)
        const age = now - stat.mtimeMs

        if (c.options.all || age > maxAge) {
          const days = Math.floor(age / (24 * 60 * 60 * 1000))
          toRemove.push({ name, age: days === 0 ? 'today' : `${days}d ago` })
        }
      } catch {}
    }

    if (toRemove.length === 0) {
      if (!c.agent) console.log(`No teams older than ${c.options.days} days`)
      return { removed: 0, teams: [] }
    }

    if (c.options['dry-run']) {
      if (!c.agent) {
        console.log(`Would remove ${toRemove.length} teams:\n`)
        for (const t of toRemove) console.log(`  ${t.name}  ${t.age}`)
      }
      return { 'dry-run': true, would_remove: toRemove.length, teams: toRemove }
    }

    for (const t of toRemove) {
      rmSync(join(dir, t.name), { recursive: true, force: true })
    }

    if (!c.agent) {
      console.log(`Removed ${toRemove.length} teams`)
    }

    return { removed: toRemove.length, teams: toRemove }
  },
}
