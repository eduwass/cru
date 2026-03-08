/**
 * E2E tests for /cru with explicit worker count.
 *
 * These tests require:
 * - tmux running
 * - iTerm2 with API enabled
 * - it2 CLI installed
 * - Claude Code running in the lead pane
 *
 * Run: bun test tests/e2e/explicit-count.test.ts
 */
import { describe, test, expect, afterAll } from 'bun:test'
import {
  sendText,
  waitForPanes,
  getScreen,
  waitForClaudeIdle,
  killTeam,
  listPanes,
  currentSessionId,
} from './helpers'

// Use current session as the lead — tests are run from within Claude Code
const TIMEOUT = 90_000

describe('/cru with explicit count', () => {
  const teams: string[] = []

  afterAll(async () => {
    // Clean up any teams created during tests
    for (const team of teams) {
      await killTeam(team)
    }
  })

  test(
    '/cru 3 say hi → spawns exactly 3 workers',
    async () => {
      const leadSession = await currentSessionId()
      const teamName = `test-explicit-${Date.now()}`
      teams.push(teamName)

      // Send the skill command
      await sendText(leadSession, `/cru 3 say hi to the lead`)

      // Wait for the lead's Claude to finish spawning
      await waitForClaudeIdle(leadSession, { timeout: 60_000 })

      // Verify pane structure: we should have 4 panes (1 lead + 3 workers)
      // Find the tmux window — it's the one with 4 panes
      const panes = await listPanes(leadSession)
      expect(panes.length).toBe(4)

      // Lead pane should be the largest (40% default)
      const leadPane = panes[0]
      const workerPanes = panes.slice(1)

      expect(leadPane.width).toBeGreaterThan(workerPanes[0].width)

      // Each worker should have non-empty screen content
      for (const worker of workerPanes) {
        const screen = await getScreen(worker.id, {
          waitStable: true,
          tolerance: 'high',
        })
        expect(screen.length).toBeGreaterThan(0)
      }
    },
    TIMEOUT,
  )

  test(
    '/cru 2 compare bun vs deno → spawns exactly 2 workers',
    async () => {
      const leadSession = await currentSessionId()
      const teamName = `test-explicit2-${Date.now()}`
      teams.push(teamName)

      await sendText(leadSession, `/cru 2 compare bun vs deno`)
      await waitForClaudeIdle(leadSession, { timeout: 60_000 })

      const panes = await listPanes(leadSession)
      expect(panes.length).toBe(3) // 1 lead + 2 workers
    },
    TIMEOUT,
  )
})
