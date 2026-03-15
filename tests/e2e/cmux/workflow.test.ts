/**
 * E2E test: full /cru workflow in cmux.
 *
 * Tests the real user flow:
 *   1. Claude Code runs in a cmux surface
 *   2. User sends /cru — Claude creates team + spawns workers
 *   3. Workers land in a headless claude-swarm tmux session
 *   4. cru creates cmux splits for them
 *   5. cru teams / cru logs show team data
 *   6. cru panes close cleans up
 *
 * Requires: cmux, claude, bun
 * Run: bun test tests/e2e/cmux/workflow.test.ts --timeout 600000
 */
import { execSync, execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createCmuxTestEnv, checkCmuxPrereqs, type CmuxTestEnv } from './setup'
import { poll } from '../../helpers/common'
import { cmux, listSurfaceIds, closeSurface } from '../../helpers/cmux'

const TIMEOUT = 300_000
const TEAMS_DIR = `${process.env.HOME}/.claude/teams`

/** Find claude-swarm tmux sockets in /tmp/tmux-<uid>/. */
function findSwarmSockets(): string[] {
  const { readdirSync: rd, statSync } = require('node:fs')
  const { join } = require('node:path')
  const uid = process.getuid?.() ?? 501
  const sockDir = join('/tmp', `tmux-${uid}`)
  try {
    return rd(sockDir)
      .filter((f: string) => f.startsWith('claude-swarm-'))
      .map((f: string) => ({ name: f, mtime: statSync(join(sockDir, f)).mtimeMs }))
      .sort((a: any, b: any) => b.mtime - a.mtime)
      .map((f: any) => f.name)
  } catch {
    return []
  }
}

function execSafe(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim()
  } catch (e: any) {
    return e.stdout?.toString() ?? ''
  }
}

describe('cmux: prerequisites', () => {
  test('cmux and claude are available', () => {
    checkCmuxPrereqs()
  })
})

describe('cmux: /cru native workflow', () => {
  let env: CmuxTestEnv
  let teamName: string | null = null
  let teamsBefore: Set<string>
  let surfacesBefore: number
  const ts = Date.now()

  beforeAll(async () => {
    // Snapshot existing teams
    try {
      teamsBefore = new Set(readdirSync(TEAMS_DIR))
    } catch {
      teamsBefore = new Set()
    }

    env = await createCmuxTestEnv('cmux-workflow')
    surfacesBefore = env.surfaceCount()
    console.log(`  surfaces before: ${surfacesBefore}`)
  }, 120_000)

  afterAll(async () => {
    // Clean up any swarm sessions we created
    for (const socket of findSwarmSockets()) {
      try {
        execFileSync('tmux', ['-L', socket, 'kill-server'], { timeout: 3000 })
      } catch {}
    }
    await env?.teardown()
  })

  test(
    '1. /cru creates team — workers spawn in swarm session',
    async () => {
      await env.send(`/cru 2 workers, each echo DONE to /tmp/cru-e2e-cmux-${ts}.txt`)

      // Wait for a claude-swarm session to appear with worker panes
      await poll(
        async () => {
          const sockets = findSwarmSockets()
          for (const socket of sockets) {
            try {
              const panes = execFileSync(
                'tmux', ['-L', socket, 'list-panes', '-a', '-F', '#{pane_id}'],
                { encoding: 'utf-8', timeout: 3000 },
              ).trim().split('\n').filter(Boolean)
              if (panes.length >= 2) return socket
            } catch {}
          }
          return null
        },
        { timeout: 120_000, interval: 2_000, label: 'swarm session with workers' },
      )

      console.log(`  swarm sockets: ${findSwarmSockets().join(', ')}`)

      // Find the new team
      try {
        const teamsAfter = readdirSync(TEAMS_DIR)
        teamName = teamsAfter.find((t) => !teamsBefore.has(t)) ?? null
      } catch {}
      console.log(`  team: ${teamName}`)
    },
    TIMEOUT,
  )

  test(
    '2. cmux splits appear for workers',
    async () => {
      // Workers should trigger cru panes grid, creating cmux splits
      await poll(
        async () => {
          const count = env.surfaceCount()
          return count > surfacesBefore ? count : null
        },
        { timeout: 60_000, interval: 2_000, label: 'cmux splits appeared' },
      )

      const count = env.surfaceCount()
      console.log(`  surfaces: ${surfacesBefore} → ${count}`)
      expect(count).toBeGreaterThan(surfacesBefore)
    },
    TIMEOUT,
  )

  test(
    '3. cru teams shows the team',
    async () => {
      if (!teamName) return console.log('  skipped: no team name')
      const output = execSafe('bun src/cli.ts teams --all')
      expect(output).toContain(teamName)
      console.log(`  teams: ${output.substring(0, 200)}`)
    },
    TIMEOUT,
  )

  test(
    '4. cru logs shows team events',
    async () => {
      if (!teamName) return console.log('  skipped: no team name')
      const output = execSafe(`bun src/cli.ts logs ${teamName}`)
      console.log(`  logs: ${output.substring(0, 300)}`)
      expect(output).toContain('created')
    },
    TIMEOUT,
  )

  test(
    '5. worker splits can be closed',
    async () => {
      const before = env.surfaceCount()
      if (before <= surfacesBefore) return console.log('  skipped: no splits to close')

      // Close all non-lead surfaces
      const surfaces = env.surfaceIds()
      for (const id of surfaces) {
        if (id !== env.leadSurfaceId) {
          closeSurface(id)
        }
      }
      await Bun.sleep(1000)

      const after = env.surfaceCount()
      console.log(`  surfaces: ${before} → ${after}`)
      expect(after).toBeLessThan(before)
    },
    TIMEOUT,
  )

  test(
    '6. team is no longer active',
    async () => {
      if (!teamName) return console.log('  skipped: no team name')
      const output = execSafe('bun src/cli.ts teams')
      // Should not appear in active teams (may appear in --all)
      const activeTeams = output.split('\n').filter((l) => l.includes('alive'))
      const isActive = activeTeams.some((l) => l.includes(teamName!))
      expect(isActive).toBe(false)
      console.log('  team is no longer active')
    },
    TIMEOUT,
  )
})
