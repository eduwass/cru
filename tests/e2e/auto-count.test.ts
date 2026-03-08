/**
 * E2E tests for /cru with automatic worker count.
 *
 * The LLM decides how many workers to spawn based on the task.
 * Assertions use ranges instead of exact counts.
 *
 * Run: bun test tests/e2e/auto-count.test.ts
 */
import { describe, test, expect, afterAll } from 'bun:test'
import {
  sendText,
  waitForPanesInRange,
  getScreen,
  waitForClaudeIdle,
  killTeam,
  currentSessionId,
} from './helpers'

const TIMEOUT = 90_000

describe('/cru with auto count', () => {
  const teams: string[] = []

  afterAll(async () => {
    for (const team of teams) {
      await killTeam(team)
    }
  })

  test(
    '/cru review security, perf, and tests → ~3 workers',
    async () => {
      const leadSession = await currentSessionId()
      const teamName = `test-auto-review-${Date.now()}`
      teams.push(teamName)

      await sendText(
        leadSession,
        `/cru review this codebase — one worker on security, one on performance, one on test coverage`,
      )
      await waitForClaudeIdle(leadSession, { timeout: 60_000 })

      // Task enumerates 3 things, expect 3-4 workers (+ 1 lead = 4-5 panes)
      const panes = await waitForPanesInRange(leadSession, 4, 5, {
        timeout: 30_000,
      })
      expect(panes.length).toBeGreaterThanOrEqual(4)
      expect(panes.length).toBeLessThanOrEqual(5)
    },
    TIMEOUT,
  )

  test(
    '/cru compare bun vs deno → ~2 workers',
    async () => {
      const leadSession = await currentSessionId()
      const teamName = `test-auto-compare-${Date.now()}`
      teams.push(teamName)

      await sendText(leadSession, `/cru compare bun vs deno`)
      await waitForClaudeIdle(leadSession, { timeout: 60_000 })

      // Binary comparison, expect 2-3 workers (+ 1 lead = 3-4 panes)
      const panes = await waitForPanesInRange(leadSession, 3, 4, {
        timeout: 30_000,
      })
      expect(panes.length).toBeGreaterThanOrEqual(3)
      expect(panes.length).toBeLessThanOrEqual(4)
    },
    TIMEOUT,
  )

  test(
    '/cru break this into subtasks → 2-5 workers',
    async () => {
      const leadSession = await currentSessionId()
      const teamName = `test-auto-subtasks-${Date.now()}`
      teams.push(teamName)

      await sendText(
        leadSession,
        `/cru break the codebase into review subtasks`,
      )
      await waitForClaudeIdle(leadSession, { timeout: 60_000 })

      // Open-ended task, expect 2-5 workers (+ 1 lead = 3-6 panes)
      const panes = await waitForPanesInRange(leadSession, 3, 6, {
        timeout: 30_000,
      })
      expect(panes.length).toBeGreaterThanOrEqual(3)
      expect(panes.length).toBeLessThanOrEqual(6)

      // Verify workers have content (not stuck at shell)
      const workerPanes = panes.slice(1)
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
})
