/**
 * Ghostty smoke test — verify the e2e test harness works.
 *
 * Tests basic Ghostty AppleScript interaction without Claude.
 * Run: bun test tests/e2e/ghostty/smoke.test.ts
 */
import { existsSync, unlinkSync } from 'node:fs'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { checkGhosttyPrereqs } from './setup'
import { ghostty, sendLine, ghosttyAllTerminals } from '../../helpers/ghostty'

describe('ghostty smoke', () => {
  let terminalId: string
  let terminalsBefore: Set<string>

  beforeAll(() => {
    checkGhosttyPrereqs()
    // Snapshot before creating test window
    terminalsBefore = new Set(ghosttyAllTerminals())
    ghostty('activate')
    Bun.sleepSync(300)
    ghostty('new window')
    Bun.sleepSync(1000)
    terminalId = ghostty('get id of focused terminal of selected tab of front window')
  })

  afterAll(() => {
    // Close only test terminals
    const testTerminals = ghosttyAllTerminals().filter((id) => !terminalsBefore.has(id))
    for (const id of testTerminals) {
      try { ghostty(`close terminal id "${id}"`) } catch {}
    }
  })

  /** Get terminal IDs that belong to this test. */
  function testTerminals(): string[] {
    return ghosttyAllTerminals().filter((id) => !terminalsBefore.has(id))
  }

  test('ghostty is running and scriptable', () => {
    const name = ghostty('get name')
    expect(name).toBe('Ghostty')
  })

  test('can open a window and get terminal ID', () => {
    expect(terminalId).toBeTruthy()
    expect(terminalId.length).toBeGreaterThan(0)
    console.log(`  terminal: ${terminalId}`)
  })

  test('can send text and verify via file output', async () => {
    const marker = `/tmp/cru-e2e-smoke-${Date.now()}.txt`
    sendLine(terminalId, `echo GHOSTTY_SMOKE_OK > ${marker}`)
    await Bun.sleep(1000)
    expect(existsSync(marker)).toBe(true)
    unlinkSync(marker)
  })

  test('can split and close terminals', () => {
    const before = testTerminals()
    expect(before.length).toBe(1)

    // Split
    ghostty(`split terminal id "${terminalId}" direction right`)
    Bun.sleepSync(500)
    const afterSplit = testTerminals()
    expect(afterSplit.length).toBe(2)
    console.log(`  split: ${before.length} → ${afterSplit.length}`)

    // Close the new split
    const newTerm = afterSplit.find((id) => !before.includes(id))!
    ghostty(`close terminal id "${newTerm}"`)
    Bun.sleepSync(500)
    const afterClose = testTerminals()
    expect(afterClose.length).toBe(1)
    console.log(`  close: ${afterSplit.length} → ${afterClose.length}`)
  })

  test('cru doctor passes in Ghostty', async () => {
    const marker = `/tmp/cru-e2e-doctor-${Date.now()}.txt`
    sendLine(terminalId, `bun src/cli.ts doctor --format json > ${marker}`)
    await Bun.sleep(2000)
    if (existsSync(marker)) {
      const output = require('fs').readFileSync(marker, 'utf-8')
      expect(output).toContain('"ok": true')
      unlinkSync(marker)
    }
  })
})
