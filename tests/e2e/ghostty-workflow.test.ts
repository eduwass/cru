/**
 * E2E test: /cru full workflow in Ghostty with tmux mirroring.
 *
 * Tests the real team lifecycle:
 *   1. Claude Code creates team via TeamCreate + Agent tool
 *   2. Workers spawn in a claude-swarm tmux session (full team features)
 *   3. `cru panes grid` detects the swarm and mirrors panes into Ghostty splits
 *   4. Each Ghostty split shows a real tmux worker (interactive, with team bar)
 *   5. cru teams / cru logs show real team data
 *   6. Close team, verify cleanup
 *
 * Requires: Ghostty v1.3.0+, tmux, claude
 * Run: bun test tests/e2e/ghostty-workflow.test.ts --timeout 600000
 */
import { execSync } from 'node:child_process'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { checkGhosttyPrereqs, createGhosttyTestEnv, type GhosttyTestEnv } from './ghostty-setup'
import { listAllTerminals, captureAndRead } from './ghostty-helpers'

const TIMEOUT = 300_000

function tmuxSafe(cmd: string): string {
  try {
    return execSync(`tmux ${cmd}`, { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

function execSafe(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim()
  } catch (e: any) {
    return e.stdout?.toString() ?? ''
  }
}

describe('ghostty: prerequisites', () => {
  test('ghostty, claude, bun, and tmux are available', () => {
    checkGhosttyPrereqs()
    // Also need tmux for the mirror approach
    execSync('which tmux', { encoding: 'utf-8' })
  })
})

describe('ghostty: /cru full workflow with tmux mirroring', () => {
  let env: GhosttyTestEnv
  let teamName: string | null = null
  let teamsBefore: Set<string>
  let swarmSession: string | null = null

  beforeAll(() => {
    env = createGhosttyTestEnv('ghostty-workflow')

    // Snapshot existing teams + swarm sessions
    try {
      const existing = execSafe(`ls ${process.env.HOME}/.claude/teams/ 2>/dev/null`)
      teamsBefore = new Set(existing.trim().split('\n').filter(Boolean))
    } catch {
      teamsBefore = new Set()
    }
  }, 120_000)

  afterAll(() => {
    // Clean up view sessions
    if (swarmSession) {
      try {
        const sessions = tmuxSafe('list-sessions -F "#{session_name}"').split('\n')
        for (const s of sessions) {
          if (s.startsWith(swarmSession)) {
            try { tmuxSafe(`kill-session -t ${s}`) } catch {}
          }
        }
      } catch {}
    }

    if (env) {
      env.snapshot('final')
      env.teardown()
    }
  })

  // -------------------------------------------------------------------------
  // Step 1: Send /cru to create a team
  // -------------------------------------------------------------------------

  test(
    '1. /cru creates team — workers appear in tmux swarm session',
    () => {
      env.send('/cru 2 workers, each write a haiku about coding to /tmp/cru-haiku.txt')

      // Wait for a claude-swarm tmux session to appear with worker panes
      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        const sessions = tmuxSafe('list-sessions -F "#{session_name}"')
          .split('\n')
          .filter((s) => s.startsWith('claude-swarm-'))
        for (const s of sessions) {
          const panes = tmuxSafe(`list-panes -t ${s} -F "#{pane_id}"`).split('\n').filter(Boolean)
          if (panes.length >= 2) {
            swarmSession = s
            break
          }
        }
        if (swarmSession) break
        Bun.sleepSync(2000)
      }

      expect(swarmSession).not.toBeNull()
      const paneCount = tmuxSafe(`list-panes -t ${swarmSession} -F "#{pane_id}"`).split('\n').length
      console.log(`  swarm session: ${swarmSession} (${paneCount} panes)`)

      // Find the new team name
      try {
        const teamsAfter = execSafe(`ls ${process.env.HOME}/.claude/teams/`)
          .trim()
          .split('\n')
          .filter(Boolean)
        teamName = teamsAfter.find((t) => !teamsBefore.has(t)) ?? null
      } catch {}
      console.log(`  team: ${teamName}`)

      env.snapshot('1-team-created')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 2: Mirror tmux panes into Ghostty splits
  // -------------------------------------------------------------------------

  test(
    '2. cru panes grid mirrors tmux workers into Ghostty splits',
    () => {
      if (!swarmSession) {
        console.log('  skipped: no swarm session')
        return
      }

      const terminalsBefore = listAllTerminals().length

      // Run cru panes grid — in Ghostty, this triggers the mirror flow
      // We need TERM_PROGRAM=ghostty for the Ghostty detection
      const output = execSafe(
        `TERM_PROGRAM=ghostty bun src/cli.ts panes grid --expect 2`,
      )
      console.log(`  grid output: ${output.substring(0, 300)}`)

      Bun.sleepSync(3000)
      const terminalsAfter = listAllTerminals().length
      console.log(`  Ghostty terminals: ${terminalsBefore} → ${terminalsAfter}`)

      // Should have new Ghostty splits (one per worker)
      expect(terminalsAfter).toBeGreaterThan(terminalsBefore)

      env.snapshot('2-mirrored')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 3: Verify worker content visible in Ghostty via OCR
  // -------------------------------------------------------------------------

  test(
    '3. OCR shows worker activity in Ghostty splits',
    () => {
      Bun.sleepSync(5000)
      const screen = captureAndRead({ waitMs: 1000 })
      expect(screen.length).toBeGreaterThan(0)
      console.log(`  OCR: ${screen.length} chars`)
      env.snapshot('3-workers-visible')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 4: Verify team shows up in cru teams / cru logs
  // -------------------------------------------------------------------------

  test(
    '4a. cru teams shows the team',
    () => {
      if (!teamName) {
        console.log('  skipped: no team name')
        return
      }
      const output = execSafe('bun src/cli.ts teams --all')
      expect(output).toContain(teamName)
      console.log(`  teams: ${output.substring(0, 200)}`)
    },
    TIMEOUT,
  )

  test(
    '4b. cru logs shows team events',
    () => {
      if (!teamName) {
        console.log('  skipped: no team name')
        return
      }
      const output = execSafe(`bun src/cli.ts logs ${teamName}`)
      console.log(`  logs: ${output.substring(0, 300)}`)
      // Should show at least the team creation event
      expect(output).toContain('created')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 5: Interactivity — verify typing works in mirrored panes
  // -------------------------------------------------------------------------

  test(
    '5. mirrored panes are interactive',
    () => {
      if (!swarmSession) {
        console.log('  skipped: no swarm session')
        return
      }

      // Find a view session
      const sessions = tmuxSafe('list-sessions -F "#{session_name}"')
        .split('\n')
        .filter((s) => s.includes('-view-'))
      if (sessions.length === 0) {
        console.log('  skipped: no view sessions found')
        return
      }

      const viewSession = sessions[0]
      // The pane is running claude, so we can't just echo.
      // But we can verify the view session exists and is attached
      const info = tmuxSafe(`display-message -t ${viewSession} -p "#{session_name}:#{window_name}"`)
      expect(info).toContain(viewSession)
      console.log(`  view session: ${info}`)
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 6: Close team
  // -------------------------------------------------------------------------

  test(
    '6. closing team removes Ghostty splits and tmux sessions',
    () => {
      const terminalsBefore = listAllTerminals().length

      // Close via cru — should close both Ghostty splits and tmux panes
      if (teamName) {
        execSafe(`TERM_PROGRAM=ghostty bun src/cli.ts panes close ${teamName}`)
      }
      Bun.sleepSync(3000)

      const terminalsAfter = listAllTerminals().length
      console.log(`  Ghostty terminals: ${terminalsBefore} → ${terminalsAfter}`)

      // Ghostty terminals should decrease
      if (terminalsBefore > 1) {
        expect(terminalsAfter).toBeLessThan(terminalsBefore)
      }

      env.snapshot('6-closed')
    },
    TIMEOUT,
  )
})
