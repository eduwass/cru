/**
 * Ghostty smoke test — verify the e2e pipeline works end-to-end.
 *
 * Creates a real Ghostty window, runs cru commands, and asserts on
 * OCR'd screen content. Requires Ghostty running with AppleScript enabled.
 *
 * Run: bun test tests/e2e/ghostty-smoke.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { checkGhosttyPrereqs, createGhosttyTestEnv, type GhosttyTestEnv } from './ghostty-setup'

describe('ghostty smoke: prerequisites', () => {
  test('ghostty is running and scriptable', () => {
    checkGhosttyPrereqs()
  })
})

describe('ghostty smoke: test environment', () => {
  let env: GhosttyTestEnv

  beforeAll(() => {
    env = createGhosttyTestEnv('ghostty-smoke')
  }, 30_000)

  afterAll(() => {
    env?.teardown()
  })

  test('creates a ghostty window with a lead terminal', () => {
    expect(env.windowId).toBeTruthy()
    expect(env.leadTerminalId).toBeTruthy()
    console.log(`  window: ${env.windowId}, lead: ${env.leadTerminalId}`)
  })

  test('can read screen via OCR', () => {
    const screen = env.readScreen({ waitMs: 1000 })
    expect(screen.length).toBeGreaterThan(0)
    console.log(`  OCR read ${screen.length} chars`)
  })

  test('can list terminals in window', () => {
    const terminals = env.listTerminals()
    expect(terminals.length).toBe(1) // just the lead
    console.log(`  terminals: ${terminals.length}`)
  })

  test('can run a command and read output via OCR', () => {
    env.send('echo CRU_GHOSTTY_E2E_OK')
    Bun.sleepSync(1000)
    const screen = env.readScreen({ waitMs: 500 })
    console.log(`  OCR output (${screen.length} chars): ${screen.slice(0, 200)}`)
    expect(screen).toContain('CRU_GHOSTTY_E2E_OK')
  }, 10_000)

  test('can split panes via AppleScript', () => {
    // Split the lead terminal to create a worker
    const { splitTerminal, getFocusedTerminal } = require('./ghostty-helpers')
    const newTermId = splitTerminal(env.leadTerminalId, 'right')
    expect(newTermId).toBeTruthy()

    const terminals = env.listTerminals()
    expect(terminals.length).toBe(2)
    console.log(`  split created terminal ${newTermId}, total: ${terminals.length}`)

    // Read screen — should show two panes
    env.snapshot('after-split')
  })

  test('can close worker panes', () => {
    env.resetForNextTest()
    const terminals = env.listTerminals()
    expect(terminals.length).toBe(1)
    console.log('  reset back to 1 terminal')
  })
})
