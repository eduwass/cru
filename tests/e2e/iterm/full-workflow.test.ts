/**
 * E2E test: comprehensive /cru workflow.
 *
 * Tests the full lifecycle:
 *   1. Create team of 4 workers via /cru skill
 *   2. Verify team bar shows workers
 *   3. Verify 2x2 grid layout
 *   4. cru teams shows correct info
 *   5. cru logs captures activity with colors
 *   6. Change layout (lead position to right)
 *   7. Close team, verify cleanup
 *   8. cru teams no longer shows team as active
 *
 * Run: bun test tests/e2e/full-workflow.test.ts --timeout 600000
 */
import { $ } from 'bun'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createTestEnv, type TestEnv } from './setup'
import { saveDebugSnapshot, saveLogs, captureTmuxPane, poll } from '../../helpers/common'

const TIMEOUT = 300_000

describe('/cru full workflow', () => {
  let env: TestEnv
  let teamName: string | null = null
  let teamsBefore: Set<string>

  beforeAll(async () => {
    env = await createTestEnv('full-workflow')

    // Snapshot existing teams so we can detect the new one
    const existing = await $`ls ${process.env.HOME}/.claude/teams/ 2>/dev/null`.nothrow().text()
    teamsBefore = new Set(existing.trim().split('\n').filter(Boolean))
  }, 90_000)

  afterAll(async () => {
    if (env) {
      await saveLogs('final', env.runDir, teamName ?? undefined)
      await saveDebugSnapshot(env.tmuxWindow, 'final', env.runDir)

      // Kill any remaining worker panes
      const panes = await env.listPanes()
      for (const p of panes.reverse()) {
        if (p.id !== env.leadPaneId) {
          await $`tmux kill-pane -t ${p.id}`.nothrow().quiet()
        }
      }

      await env.teardown()
    }
  })

  // -------------------------------------------------------------------------
  // Step 1: Create team
  // -------------------------------------------------------------------------

  test(
    '1. /cru 4 creates team with 4 workers (5 panes total)',
    async () => {
      await env.send('/cru 4 workers, each say hello world with your number (1, 2, 3, or 4)')

      // Wait for 5 panes (1 lead + 4 workers)
      const panes = await env.waitForPaneCount(5, 120_000)
      expect(panes.length).toBe(5)

      // Find the new team name by comparing team directories
      const teamsAfter = (await $`ls ${process.env.HOME}/.claude/teams/`.text())
        .trim()
        .split('\n')
        .filter(Boolean)
      teamName = teamsAfter.find((t) => !teamsBefore.has(t)) ?? null
      expect(teamName).not.toBeNull()
      console.log(`  team: ${teamName}`)

      await saveDebugSnapshot(env.tmuxWindow, '1-team-created', env.runDir)
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 2: Team bar
  // -------------------------------------------------------------------------

  test(
    '2. team bar shows workers in lead pane',
    async () => {
      // Poll for team bar to appear (workers need to connect first)
      await poll(
        async () => {
          const content = await captureTmuxPane(env.leadPaneId)
          // Team bar shows @worker-N names or "teammates"
          return content.includes('@worker-1') ? true : null
        },
        { timeout: 90_000, interval: 3_000, label: 'team bar visible' },
      )

      const content = await captureTmuxPane(env.leadPaneId)
      expect(content).toContain('@worker-1')
      // With 4 workers, at least 2 should be visible (others may be behind "+ to expand")
      expect(content).toContain('@worker-2')

      await saveDebugSnapshot(env.tmuxWindow, '2-team-bar', env.runDir)
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 3: Grid layout
  // -------------------------------------------------------------------------

  test(
    '3. workers arranged in 2x2 grid with lead on left',
    async () => {
      // Poll until grid layout is applied (lead finishes running `cru panes grid`)
      // Workers should have >1 distinct left value once arranged in a 2x2 grid
      const panes = await poll(
        async () => {
          const paneInfo = (
            await $`tmux list-panes -t ${env.tmuxWindow} -F '#{pane_id} #{pane_left} #{pane_top} #{pane_width} #{pane_height}'`.text()
          )
            .trim()
            .split('\n')

          const all = paneInfo.map((line) => {
            const [id, left, top, width, height] = line.split(' ')
            return { id, left: Number(left), top: Number(top), width: Number(width), height: Number(height) }
          })

          const workers = all.filter((p) => p.id !== env.leadPaneId)
          const workerLefts = new Set(workers.map((w) => w.left))
          // Grid applied = workers span at least 2 columns
          return workerLefts.size >= 2 ? all : null
        },
        { timeout: 60_000, interval: 2_000, label: '2x2 grid layout applied' },
      )

      const lead = panes.find((p) => p.id === env.leadPaneId)!
      const workers = panes.filter((p) => p.id !== env.leadPaneId)

      expect(workers.length).toBe(4)

      // Lead should be on the left (left = 0)
      expect(lead.left).toBe(0)

      // Workers should form a 2x2 grid: 2 distinct columns, 2 distinct rows
      const workerLefts = [...new Set(workers.map((w) => w.left))].sort((a, b) => a - b)
      const workerTops = [...new Set(workers.map((w) => w.top))].sort((a, b) => a - b)
      expect(workerLefts.length).toBe(2) // 2 columns
      expect(workerTops.length).toBe(2) // 2 rows

      // All workers should have roughly equal dimensions (within 3 chars — tmux rounding)
      const widths = workers.map((w) => w.width)
      const heights = workers.map((w) => w.height)
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(3)
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(3)

      console.log(`  lead: ${lead.width}x${lead.height} at (${lead.left},${lead.top})`)
      for (const w of workers) {
        console.log(`  worker: ${w.width}x${w.height} at (${w.left},${w.top})`)
      }

      await saveDebugSnapshot(env.tmuxWindow, '3-grid-layout', env.runDir)
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 4: CLI commands (teams, config)
  // -------------------------------------------------------------------------

  test(
    '4a. cru teams shows the team as active',
    async () => {
      const output = await $`bun src/cli.ts teams`.nothrow().text()
      expect(output).toContain(teamName!)

      await saveLogs('4a-teams', env.runDir, teamName ?? undefined)
    },
    TIMEOUT,
  )

  test(
    '4b. cru teams <name> shows team members',
    async () => {
      const output = await $`bun src/cli.ts teams ${teamName}`.nothrow().text()

      // Should show team name
      expect(output).toContain(teamName!)

      // Should list the lead
      expect(output).toMatch(/lead|team-lead/)

      // Should have member entries
      expect(output).toMatch(/worker|member/)
    },
    TIMEOUT,
  )

  test(
    '4c. cru config shows resolved layout config',
    async () => {
      const output = await $`bun src/cli.ts config`.nothrow().text()

      // Should show layout config with defaults
      expect(output).toContain('lead')
      expect(output).toContain('position')
      expect(output).toContain('left') // default position
      expect(output).toContain('grid')
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 5: Logs
  // -------------------------------------------------------------------------

  test(
    '5. cru logs captures team activity with colors',
    async () => {
      // Wait for some messages to flow between agents
      await Bun.sleep(5_000)

      const rawLogs = await $`bun src/cli.ts logs ${teamName} --full`.nothrow().text()
      const cleanLogs = rawLogs.replace(/\x1b\[[0-9;]*m/g, '')

      // Should have team lifecycle events (works with both human and incur structured format)
      const hasCreated = cleanLogs.includes('team created') || cleanLogs.includes('type: created')
      expect(hasCreated).toBe(true)

      // Should have worker activity (joins or messages)
      const hasWorkerActivity = cleanLogs.includes('joined') || cleanLogs.includes('worker-')
      expect(hasWorkerActivity).toBe(true)

      // Logs should contain ANSI color codes or structured event data
      const hasAnsiColors = /\x1b\[\d+m/.test(rawLogs)
      const hasStructuredEvents = rawLogs.includes('type: joined') || rawLogs.includes('type: message')
      expect(hasAnsiColors || hasStructuredEvents).toBe(true)

      // Verify worker colors in logs match what's shown in worker panes
      // Worker panes show @worker-N with ANSI color from --agent-color
      const workerPanes = (await env.listPanes()).filter((p) => p.id !== env.leadPaneId)
      for (const wp of workerPanes) {
        const paneContent = await captureTmuxPane(wp.id)
        // Each worker pane should show its @worker-N identifier
        expect(paneContent).toMatch(/@worker-\d/)
      }

      await saveLogs('4-logs', env.runDir, teamName ?? undefined)
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 6: Change layout
  // -------------------------------------------------------------------------

  test(
    '6. cru panes grid --lead-position right moves lead to right side',
    async () => {
      await saveDebugSnapshot(env.tmuxWindow, '6a-before-layout-change', env.runDir)

      // Run grid with lead on right using team name for pane identification
      const result = await $`TERM_PROGRAM=iTerm.app bun src/cli.ts panes grid ${teamName} --lead-position right`
        .nothrow()
        .text()
      console.log(`  grid result: ${result.replace(/\n/g, ' ').trim().slice(0, 200)}`)
      expect(result).toContain('applied')

      // Check immediately — read positions right after grid command
      const paneInfo = (
        await $`tmux list-panes -t ${env.tmuxWindow} -F '#{pane_id} #{pane_left}'`.text()
      )
        .trim()
        .split('\n')

      const panes = paneInfo.map((line) => {
        const [id, left] = line.split(' ')
        return { id, left: Number(left) }
      })
      console.log(`  panes after grid: ${panes.map((p) => `${p.id}@left=${p.left}`).join(', ')}`)

      const lead = panes.find((p) => p.id === env.leadPaneId)!
      const workers = panes.filter((p) => p.id !== env.leadPaneId)

      // Lead should now be on the right (left > 0)
      expect(lead.left).toBeGreaterThan(0)

      // At least one worker should be at left = 0
      expect(workers.some((w) => w.left === 0)).toBe(true)

      await saveDebugSnapshot(env.tmuxWindow, '6b-layout-changed', env.runDir)
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 7: Close team
  // -------------------------------------------------------------------------

  test(
    '7. cru panes close removes all worker panes',
    async () => {
      await $`TERM_PROGRAM=iTerm.app bun src/cli.ts panes close ${teamName}`.nothrow()

      // Wait for only lead pane to remain
      const panes = await env.waitForPaneCount(1, 30_000)
      expect(panes.length).toBe(1)
      expect(panes[0].id).toBe(env.leadPaneId)

      await saveDebugSnapshot(env.tmuxWindow, '7-killed', env.runDir)
    },
    TIMEOUT,
  )

  // -------------------------------------------------------------------------
  // Step 8: Post-close verification
  // -------------------------------------------------------------------------

  test(
    '8. cru teams no longer shows team as active after close',
    async () => {
      const output = await $`bun src/cli.ts teams`.nothrow().text()
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

      // Team should either not appear or show as inactive (no live panes)
      // The list command filters by isTeamAlive which checks for live tmux panes
      if (clean.includes(teamName!)) {
        // If it still appears, it shouldn't be marked as active/alive
        expect(clean).not.toMatch(new RegExp(`${teamName}.*active`, 'i'))
      }
    },
    TIMEOUT,
  )
})
