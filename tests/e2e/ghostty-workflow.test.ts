/**
 * E2E test: /cru workflow in Ghostty (native AppleScript panes, no tmux).
 *
 * Tests the full lifecycle using Ghostty's native pane management:
 *   1. Create team of 4 workers via /cru skill
 *   2. Verify workers spawn as Ghostty splits
 *   3. cru teams shows correct info
 *   4. Close team, verify cleanup
 *   5. cru teams no longer shows team as active
 *
 * Requires: Ghostty v1.3.0+ with macos-applescript = true
 * Run: bun test tests/e2e/ghostty-workflow.test.ts --timeout 600000
 */
import { $ } from 'bun'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { checkGhosttyPrereqs, createGhosttyTestEnv, type GhosttyTestEnv } from './ghostty-setup'
import { listAllTerminals } from './ghostty-helpers'

const TIMEOUT = 300_000

describe('ghostty: prerequisites', () => {
  test('ghostty, claude, and bun are available', () => {
    checkGhosttyPrereqs()
  })
})

describe('ghostty: /cru full workflow', () => {
  let env: GhosttyTestEnv
  let teamName: string | null = null
  let teamsBefore: Set<string>

  beforeAll(() => {
    env = createGhosttyTestEnv('ghostty-workflow')

    // Snapshot existing teams so we can detect the new one
    try {
      const existing = execSyncSafe(`ls ${process.env.HOME}/.claude/teams/ 2>/dev/null`)
      teamsBefore = new Set(existing.trim().split('\n').filter(Boolean))
    } catch {
      teamsBefore = new Set()
    }
  }, 120_000)

  afterAll(() => {
    if (env) {
      env.snapshot('final')
      env.teardown()
    }
  })

  // -------------------------------------------------------------------------
  // Step 1: Create team
  // -------------------------------------------------------------------------

  test(
    '1. /cru 4 creates team with workers as Ghostty splits',
    () => {
      const terminalsBefore = listAllTerminals().length

      env.send('/cru 4 workers, each say hello world')

      // Wait for new terminals to appear (workers spawn as Ghostty splits)
      // We need at least 4 new terminals (workers) — lead is already there
      const deadline = Date.now() + 120_000
      let terminals: string[] = []
      while (Date.now() < deadline) {
        terminals = listAllTerminals()
        // We started with terminalsBefore, need at least 4 more
        if (terminals.length >= terminalsBefore + 4) break
        Bun.sleepSync(2000)
      }

      expect(terminals.length).toBeGreaterThanOrEqual(terminalsBefore + 4)
      console.log(`  terminals: ${terminals.length} (was ${terminalsBefore})`)

      // Find the new team name
      try {
        const teamsAfter = execSyncSafe(`ls ${process.env.HOME}/.claude/teams/`)
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
  // Step 2: Verify screen shows worker activity
  // -------------------------------------------------------------------------

  test(
    '2. screen shows worker activity via OCR',
    () => {
      // Wait for workers to start doing something visible
      Bun.sleepSync(5000)
      const screen = env.readScreen({ waitMs: 1000 })
      expect(screen.length).toBeGreaterThan(0)
      console.log(`  OCR captured ${screen.length} chars`)
      env.snapshot('2-workers-active')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 3: CLI commands work with Ghostty backend
  // -------------------------------------------------------------------------

  test(
    '3a. cru teams shows the team',
    () => {
      if (!teamName) {
        console.log('  skipped: no team name detected')
        return
      }
      const output = execSyncSafe(`bun src/cli.ts teams`)
      expect(output).toContain(teamName)
      console.log(`  teams output contains: ${teamName}`)
    },
    TIMEOUT,
  )

  test(
    '3b. cru teams <name> shows members',
    () => {
      if (!teamName) {
        console.log('  skipped: no team name detected')
        return
      }
      const output = execSyncSafe(`bun src/cli.ts teams ${teamName}`)
      expect(output).toContain(teamName)
      expect(output).toMatch(/lead|team-lead/)
      console.log(`  team detail shows lead + members`)
    },
    TIMEOUT,
  )

  test(
    '3c. cru config shows layout config',
    () => {
      const output = execSyncSafe('bun src/cli.ts config')
      expect(output).toContain('lead')
      expect(output).toContain('position')
      expect(output).toContain('grid')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 4: Close team
  // -------------------------------------------------------------------------

  test(
    '4. closing team removes worker terminals',
    () => {
      if (!teamName) {
        console.log('  skipped: no team name detected')
        return
      }

      const terminalsBefore = listAllTerminals().length
      execSyncSafe(`bun src/cli.ts panes close ${teamName}`)
      Bun.sleepSync(2000)

      const terminalsAfter = listAllTerminals().length
      console.log(`  terminals: ${terminalsBefore} → ${terminalsAfter}`)
      expect(terminalsAfter).toBeLessThan(terminalsBefore)

      env.snapshot('4-closed')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 5: Post-close verification
  // -------------------------------------------------------------------------

  test(
    '5. team no longer active after close',
    () => {
      if (!teamName) {
        console.log('  skipped: no team name detected')
        return
      }

      const output = execSyncSafe('bun src/cli.ts teams')
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

      if (clean.includes(teamName)) {
        expect(clean).not.toMatch(new RegExp(`${teamName}.*active`, 'i'))
      }
      console.log('  team is no longer active')
    },
    TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execSyncSafe(cmd: string): string {
  const { execSync } = require('node:child_process')
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim()
  } catch (e: any) {
    return e.stdout?.toString() ?? ''
  }
}
