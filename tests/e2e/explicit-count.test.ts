/**
 * E2E test: /cru with explicit worker count.
 *
 * Run: bun test tests/e2e/explicit-count.test.ts --timeout 300000
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createTestEnv, type TestEnv } from './setup'
import { saveDebugSnapshot } from './helpers'

const TIMEOUT = 180_000

describe('/cru with explicit count', () => {
  let env: TestEnv

  beforeAll(async () => {
    env = await createTestEnv()
  }, 90_000)

  afterAll(async () => {
    // Take a final snapshot before teardown
    if (env) {
      await saveDebugSnapshot(env.tmuxWindow, 'final')
      await env.teardown()
    }
  })

  test(
    '/cru 3 say hi → 4 panes (1 lead + 3 workers)',
    async () => {
      // Send the skill command
      await env.send('/cru 3 say hi to the lead')

      // Snapshot right after sending
      await Bun.sleep(5_000)
      await saveDebugSnapshot(env.tmuxWindow, 'after-send')

      // Wait for panes to appear (lead + 3 workers = 4)
      const panes = await env.waitForPaneCount(4, 60_000)

      // Snapshot once panes are visible
      await saveDebugSnapshot(env.tmuxWindow, 'panes-visible')

      expect(panes.length).toBe(4)

      // Log layout info
      for (const p of panes) {
        console.log(`  pane ${p.index}: ${p.width}x${p.height} (${p.id})`)
      }
    },
    TIMEOUT,
  )
})
