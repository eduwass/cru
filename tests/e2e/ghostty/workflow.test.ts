/**
 * E2E test: full /cru workflow in native Ghostty.
 *
 * Tests the real user flow:
 *   1. Claude Code runs in a Ghostty terminal (no tmux wrapper)
 *   2. User sends /cru — Claude creates team + spawns workers
 *   3. Workers land in a headless claude-swarm tmux session
 *   4. cru mirrors them into Ghostty splits
 *   5. cru teams / cru logs show team data
 *   6. cru panes close cleans up
 *
 * Requires: Ghostty v1.3.0+, claude, bun
 * Run: bun test tests/e2e/ghostty/workflow.test.ts --timeout 600000
 */
import { execSync, execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createGhosttyTestEnv, checkGhosttyPrereqs, type GhosttyTestEnv } from './setup'
import { poll } from '../../helpers/common'
import { findSwarmSockets } from '../../helpers/ghostty'

const TIMEOUT = 300_000
const TEAMS_DIR = `${process.env.HOME}/.claude/teams`

function execSafe(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim()
  } catch (e: any) {
    return e.stdout?.toString() ?? ''
  }
}

describe('ghostty: prerequisites', () => {
  test('ghostty and claude are available', () => {
    checkGhosttyPrereqs()
  })
})

describe('ghostty: /cru native workflow', () => {
  let env: GhosttyTestEnv
  let teamName: string | null = null
  let teamsBefore: Set<string>
  let terminalsBefore: number
  const ts = Date.now()

  beforeAll(async () => {
    // Snapshot existing teams
    try {
      teamsBefore = new Set(readdirSync(TEAMS_DIR))
    } catch {
      teamsBefore = new Set()
    }

    env = await createGhosttyTestEnv('ghostty-workflow')
    terminalsBefore = env.terminalCount()
    console.log(`  terminals before: ${terminalsBefore}`)
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
      await env.send(`/cru 2 workers, each echo DONE to /tmp/cru-e2e-${ts}.txt`)

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
    '2. Ghostty splits appear for workers',
    async () => {
      // Workers should trigger cru panes grid, creating Ghostty splits
      await poll(
        async () => {
          const count = env.terminalCount()
          return count > terminalsBefore ? count : null
        },
        { timeout: 60_000, interval: 2_000, label: 'Ghostty splits appeared' },
      )

      const count = env.terminalCount()
      console.log(`  terminals: ${terminalsBefore} → ${count}`)
      expect(count).toBeGreaterThan(terminalsBefore)
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
      const before = env.terminalCount()
      if (before <= 1) return console.log('  skipped: no splits to close')

      // Close all terminals except the lead
      const terms = env.terminalIds()
      for (const id of terms) {
        if (id !== env.leadTerminalId) {
          try {
            execFileSync('osascript', ['-e',
              `tell application "Ghostty" to close terminal id "${id}"`],
              { encoding: 'utf-8' })
          } catch {}
        }
      }
      await Bun.sleep(1000)

      const after = env.terminalCount()
      console.log(`  terminals: ${before} → ${after}`)
      expect(after).toBe(1)
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
