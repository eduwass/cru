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
    env = await createTestEnv('explicit-count')
  }, 90_000)

  afterAll(async () => {
    if (env) {
      await saveDebugSnapshot(env.tmuxWindow, 'final', env.runDir)
      await env.teardown()
    }
  })

  test(
    '/cru 3 say hi → 4 panes (1 lead + 3 workers)',
    async () => {
      await env.send('/cru 3 say hi to the lead')

      await Bun.sleep(5_000)
      await saveDebugSnapshot(env.tmuxWindow, 'after-send', env.runDir)

      const panes = await env.waitForPaneCount(4, 60_000)

      await saveDebugSnapshot(env.tmuxWindow, 'panes-visible', env.runDir)

      expect(panes.length).toBe(4)

      for (const p of panes) {
        console.log(`  pane ${p.index}: ${p.width}x${p.height} (${p.id})`)
      }
    },
    TIMEOUT,
  )
})
