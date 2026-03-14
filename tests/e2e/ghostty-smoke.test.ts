/**
 * Ghostty smoke test — verify the e2e pipeline works end-to-end.
 *
 * Creates a real Ghostty window with tmux, runs cru commands, and asserts
 * using tmux capture-pane (no OCR). Requires Ghostty with AppleScript enabled.
 *
 * Run: bun test tests/e2e/ghostty-smoke.test.ts
 */
import { execSync } from 'node:child_process'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { checkGhosttyPrereqs, createGhosttyTestEnv } from './ghostty-setup'
import type { TestEnv } from './setup'
import { captureTmuxPane } from './helpers'

describe('ghostty smoke: prerequisites', () => {
  test('ghostty is running and scriptable', () => {
    checkGhosttyPrereqs()
  })
})

describe('ghostty smoke: test environment', () => {
  let env: TestEnv

  beforeAll(async () => {
    env = await createGhosttyTestEnv('ghostty-smoke')
  }, 90_000)

  afterAll(async () => {
    await env?.teardown()
  })

  test('creates a tmux session with a lead pane', () => {
    expect(env.tmuxWindow).toBeTruthy()
    expect(env.leadPaneId).toBeTruthy()
    console.log(`  window: ${env.tmuxWindow}, lead: ${env.leadPaneId}`)
  })

  test('can capture pane content via tmux', async () => {
    const content = await captureTmuxPane(env.leadPaneId)
    expect(content.length).toBeGreaterThan(0)
    console.log(`  captured ${content.length} chars`)
  })

  test('can list tmux panes', async () => {
    const panes = await env.listPanes()
    expect(panes.length).toBeGreaterThanOrEqual(1)
    console.log(`  panes: ${panes.length}`)
  })

  test('can run a command and read output', async () => {
    // Send via tmux send-keys and capture
    execSync(`tmux send-keys -t ${env.leadPaneId} 'echo CRU_GHOSTTY_E2E_OK' Enter`)
    await Bun.sleep(1000)
    const content = await captureTmuxPane(env.leadPaneId)
    expect(content).toContain('CRU_GHOSTTY_E2E_OK')
  }, 10_000)

  test('can split and close panes via tmux', async () => {
    // Split
    execSync(`tmux split-window -h -t ${env.leadPaneId}`)
    let panes = await env.listPanes()
    expect(panes.length).toBe(2)
    console.log(`  split: ${panes.length} panes`)

    // Close worker
    await env.resetForNextTest()
    panes = await env.listPanes()
    expect(panes.length).toBe(1)
    console.log('  reset back to 1 pane')
  })
})
