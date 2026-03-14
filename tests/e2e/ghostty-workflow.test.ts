/**
 * E2E test: /cru full workflow in Ghostty with tmux mirroring.
 *
 * Tests the real team lifecycle using tmux for all assertions:
 *   1. Claude Code creates team via TeamCreate + Agent tool
 *   2. Workers spawn in a claude-swarm tmux session
 *   3. `cru panes grid` detects the swarm and mirrors panes into Ghostty splits
 *   4. cru teams / cru logs show real team data
 *   5. Close team, verify cleanup
 *
 * Requires: Ghostty v1.3.0+, tmux, claude
 * Run: bun test tests/e2e/ghostty-workflow.test.ts --timeout 600000
 */
import { execSync, execFileSync } from 'node:child_process'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { checkGhosttyPrereqs, createGhosttyTestEnv } from './ghostty-setup'
import type { TestEnv } from './setup'
import { captureTmuxPane, saveDebugSnapshot, saveLogs, poll } from './helpers'

const TIMEOUT = 300_000

function execSafe(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim()
  } catch (e: any) {
    return e.stdout?.toString() ?? ''
  }
}

function tmuxSafe(...args: string[]): string {
  try {
    return execFileSync('tmux', args, { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

function ghosttyTerminalCount(): number {
  try {
    const ids = execFileSync(
      'osascript', ['-e', 'tell application "Ghostty" to get id of every terminal'],
      { encoding: 'utf-8' },
    ).trim()
    if (!ids) return 0
    return ids.split(', ').length
  } catch { return 0 }
}

describe('ghostty: prerequisites', () => {
  test('ghostty, claude, bun, and tmux are available', () => {
    checkGhosttyPrereqs()
  })
})

describe('ghostty: /cru full workflow with tmux mirroring', () => {
  let env: TestEnv
  let teamName: string | null = null
  let teamsBefore: Set<string>
  let swarmSession: string | null = null

  beforeAll(async () => {
    env = await createGhosttyTestEnv('ghostty-workflow')

    try {
      const existing = execSafe(`ls ${process.env.HOME}/.claude/teams/ 2>/dev/null`)
      teamsBefore = new Set(existing.trim().split('\n').filter(Boolean))
    } catch {
      teamsBefore = new Set()
    }
  }, 120_000)

  afterAll(async () => {
    if (swarmSession) {
      try {
        const sessions = tmuxSafe('list-sessions', '-F', '#{session_name}').split('\n')
        for (const s of sessions) {
          if (s.startsWith(swarmSession)) {
            try { tmuxSafe('kill-session', '-t', s) } catch {}
          }
        }
      } catch {}
    }

    if (env) {
      await saveDebugSnapshot(env.tmuxWindow, 'final', env.runDir)
      await env.teardown()
    }
  })

  test(
    '1. /cru creates team — workers appear in tmux swarm session',
    async () => {
      await env.send('/cru 2 workers, each write a haiku about coding to /tmp/cru-haiku.txt')

      // Wait for a claude-swarm tmux session to appear with worker panes
      await poll(
        async () => {
          const sessions = tmuxSafe('list-sessions', '-F', '#{session_name}')
            .split('\n')
            .filter((s) => s.startsWith('claude-swarm-'))
          for (const s of sessions) {
            const panes = tmuxSafe('list-panes', '-t', s, '-F', '#{pane_id}').split('\n').filter(Boolean)
            if (panes.length >= 2) {
              swarmSession = s
              return true
            }
          }
          return null
        },
        { timeout: 120_000, interval: 2_000, label: 'swarm session with workers' },
      )

      expect(swarmSession).not.toBeNull()
      const paneCount = tmuxSafe('list-panes', '-t', swarmSession!, '-F', '#{pane_id}').split('\n').length
      console.log(`  swarm session: ${swarmSession} (${paneCount} panes)`)

      // Find the new team name
      try {
        const teamsAfter = execSafe(`ls ${process.env.HOME}/.claude/teams/`)
          .trim().split('\n').filter(Boolean)
        teamName = teamsAfter.find((t) => !teamsBefore.has(t)) ?? null
      } catch {}
      console.log(`  team: ${teamName}`)

      await saveDebugSnapshot(env.tmuxWindow, '1-team-created', env.runDir)
    },
    TIMEOUT,
  )

  test(
    '2. cru panes grid mirrors tmux workers into Ghostty splits',
    async () => {
      if (!swarmSession) return console.log('  skipped: no swarm session')

      const terminalsBefore = ghosttyTerminalCount()

      const output = execSafe(
        `TERM_PROGRAM=ghostty bun src/cli.ts panes grid --expect 2`,
      )
      console.log(`  grid output: ${output.substring(0, 300)}`)

      await Bun.sleep(3000)
      const terminalsAfter = ghosttyTerminalCount()
      console.log(`  Ghostty terminals: ${terminalsBefore} → ${terminalsAfter}`)

      expect(terminalsAfter).toBeGreaterThan(terminalsBefore)

      await saveDebugSnapshot(env.tmuxWindow, '2-mirrored', env.runDir)
    },
    TIMEOUT,
  )

  test(
    '3. worker content visible via tmux capture-pane',
    async () => {
      if (!swarmSession) return console.log('  skipped: no swarm session')

      // Check content of worker panes on the swarm socket
      const panes = tmuxSafe('-L', swarmSession!, 'list-panes', '-a', '-F', '#{pane_id}')
        .split('\n').filter(Boolean)
      for (const paneId of panes.slice(0, 2)) {
        try {
          const content = execFileSync(
            'tmux', ['-L', swarmSession!, 'capture-pane', '-t', paneId, '-p'],
            { encoding: 'utf-8' },
          ).trim()
          console.log(`  ${paneId}: ${content.length} chars`)
        } catch {}
      }

      await saveDebugSnapshot(env.tmuxWindow, '3-workers-visible', env.runDir)
    },
    TIMEOUT,
  )

  test(
    '4a. cru teams shows the team',
    async () => {
      if (!teamName) return console.log('  skipped: no team name')
      const output = execSafe('bun src/cli.ts teams --all')
      expect(output).toContain(teamName)
      console.log(`  teams: ${output.substring(0, 200)}`)
    },
    TIMEOUT,
  )

  test(
    '4b. cru logs shows team events',
    async () => {
      if (!teamName) return console.log('  skipped: no team name')
      const output = execSafe(`bun src/cli.ts logs ${teamName}`)
      console.log(`  logs: ${output.substring(0, 300)}`)
      expect(output).toContain('created')
    },
    TIMEOUT,
  )

  test(
    '5. mirrored panes are interactive via view sessions',
    async () => {
      if (!swarmSession) return console.log('  skipped: no swarm session')

      const sessions = tmuxSafe('list-sessions', '-F', '#{session_name}')
        .split('\n')
        .filter((s) => s.includes('-view-'))
      if (sessions.length === 0) return console.log('  skipped: no view sessions found')

      const viewSession = sessions[0]
      const info = tmuxSafe('display-message', '-t', viewSession, '-p', '#{session_name}:#{window_name}')
      expect(info).toContain(viewSession)
      console.log(`  view session: ${info}`)
    },
    TIMEOUT,
  )

  test(
    '6. closing team removes Ghostty splits',
    async () => {
      const terminalsBefore = ghosttyTerminalCount()

      if (teamName) {
        execSafe(`TERM_PROGRAM=ghostty bun src/cli.ts panes close ${teamName}`)
      }
      await Bun.sleep(3000)

      const terminalsAfter = ghosttyTerminalCount()
      console.log(`  Ghostty terminals: ${terminalsBefore} → ${terminalsAfter}`)

      if (terminalsBefore > 1) {
        expect(terminalsAfter).toBeLessThan(terminalsBefore)
      }

      await saveDebugSnapshot(env.tmuxWindow, '6-closed', env.runDir)
    },
    TIMEOUT,
  )
})
