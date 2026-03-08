/**
 * E2E tests for /cru with automatic worker count.
 *
 * The LLM decides how many workers to spawn.
 * Assertions use ranges instead of exact counts.
 *
 * Run: bun test tests/e2e/auto-count.test.ts
 */
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './setup'

const TIMEOUT = 120_000

describe('/cru with auto count', () => {
  let env: TestEnv

  beforeAll(async () => {
    env = await createTestEnv()
  }, 90_000)

  afterEach(async () => {
    await env?.resetForNextTest()
  })

  afterAll(async () => {
    await env?.teardown()
  })

  test(
    '/cru review security, perf, and tests → ~3 workers',
    async () => {
      await env.send(
        '/cru review this codebase — one worker on security, one on performance, one on test coverage',
      )

      // Task enumerates 3 concerns → expect 3-4 workers (4-5 panes)
      const panes = await env.waitForPaneCountInRange(4, 5, 60_000)
      expect(panes.length).toBeGreaterThanOrEqual(4)
      expect(panes.length).toBeLessThanOrEqual(5)

      console.log('  panes:', panes.length, '(expected 4-5)')
    },
    TIMEOUT,
  )

  test(
    '/cru compare bun vs deno → ~2 workers',
    async () => {
      await env.send('/cru compare bun vs deno')

      // Binary comparison → expect 2-3 workers (3-4 panes)
      const panes = await env.waitForPaneCountInRange(3, 4, 60_000)
      expect(panes.length).toBeGreaterThanOrEqual(3)
      expect(panes.length).toBeLessThanOrEqual(4)

      console.log('  panes:', panes.length, '(expected 3-4)')
    },
    TIMEOUT,
  )
})
