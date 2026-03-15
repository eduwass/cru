/**
 * E2E test: /cru with explicit worker count.
 *
 * Run: bun test tests/e2e/explicit-count.test.ts --timeout 300000
 */
import { $ } from 'bun'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createTestEnv, type TestEnv } from './setup'
import { saveDebugSnapshot, saveLogs, captureTmuxPane, poll } from '../../helpers/common'

const TIMEOUT = 180_000

describe('/cru with explicit count', () => {
  let env: TestEnv
  let teamName: string | null = null

  beforeAll(async () => {
    env = await createTestEnv('explicit-count')
  }, 90_000)

  afterAll(async () => {
    if (env) {
      // Capture final artifacts before cleanup
      await saveLogs('final', env.runDir, teamName ?? undefined)
      await saveDebugSnapshot(env.tmuxWindow, 'final', env.runDir)

      // Kill worker panes via cru
      if (teamName) {
        await $`TERM_PROGRAM=iTerm.app bun src/cli.ts panes close ${teamName}`.nothrow().quiet()
        console.log(`  [cleanup] closed team ${teamName}`)
      }

      await env.teardown()
    }
  })

  test(
    '/cru 3 say hi → 4 panes (1 lead + 3 workers)',
    async () => {
      await env.send('/cru 3 say hi to the lead')

      // 1. Wait for panes to appear (lead + 3 workers = 4)
      const panes = await env.waitForPaneCount(4, 60_000)
      expect(panes.length).toBe(4)

      // Extract team name from lead pane (shown in spawn command output or status bar)
      const leadContent = await captureTmuxPane(env.leadPaneId)
      const spawnMatch = leadContent.match(/spawn\s+([\w-]+)/)
      if (spawnMatch) teamName = spawnMatch[1]
      console.log(`  team: ${teamName}`)

      await saveDebugSnapshot(env.tmuxWindow, '1-panes-created', env.runDir)

      // 2. Wait for all workers to have Claude loaded (look for @worker banner)
      const workerPanes = panes.filter((p) => p.id !== env.leadPaneId)
      await poll(
        async () => {
          for (const wp of workerPanes) {
            const content = await captureTmuxPane(wp.id)
            if (!content.includes('@worker-')) return null
          }
          return true
        },
        { timeout: 60_000, interval: 2_000, label: 'all workers loaded' },
      )

      await saveDebugSnapshot(env.tmuxWindow, '2-workers-ready', env.runDir)

      // 3. Wait for lead to finish (it should send tasks via SendMessage then go idle)
      await poll(
        async () => {
          const content = await captureTmuxPane(env.leadPaneId)
          if (content.includes('SendMessage') || content.includes('$0.')) return true
          return null
        },
        { timeout: 60_000, interval: 3_000, label: 'lead finished sending tasks' },
      )

      await saveDebugSnapshot(env.tmuxWindow, '3-tasks-sent', env.runDir)
      await saveLogs('3-tasks-sent', env.runDir, teamName ?? undefined)

      // Log layout info
      for (const p of panes) {
        console.log(`  pane ${p.index}: ${p.width}x${p.height} (${p.id})`)
      }
    },
    TIMEOUT,
  )
})
