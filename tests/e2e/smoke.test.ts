/**
 * Smoke test — verify the e2e harness plumbing works.
 *
 * Does NOT invoke /cru or spawn workers.
 * Just checks that it2, tmux, and the helpers are functional.
 *
 * Run: bun test tests/e2e/smoke.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import {
  listPanes,
  currentSessionId,
  getScreen,
  getBuffer,
  paneCount,
} from './helpers'

describe('smoke: tooling check', () => {
  test('it2 session current returns a session ID', async () => {
    const id = await currentSessionId()
    expect(id.length).toBeGreaterThan(0)
    console.log('  session ID:', id)
  })

  test('tmux list-panes returns at least 1 pane', async () => {
    const panes = await listPanes('%6') // current pane's window
    expect(panes.length).toBeGreaterThanOrEqual(1)
    console.log('  panes:', panes)
  })

  test('it2 get-screen returns content', async () => {
    const id = await currentSessionId()
    const screen = await getScreen(id, { waitStable: false })
    expect(screen.length).toBeGreaterThan(0)
    console.log('  screen length:', screen.length, 'chars')
  })

  test('it2 get-buffer returns content', async () => {
    const id = await currentSessionId()
    const buffer = await getBuffer(id)
    expect(buffer.length).toBeGreaterThan(0)
    console.log('  buffer length:', buffer.length, 'chars')
  })

  test('paneCount returns a number', async () => {
    const id = await currentSessionId()
    // Use the tmux window that contains the current pane
    const windowId = await $`tmux display-message -p '#{window_id}'`.text()
    const count = await paneCount(windowId.trim())
    expect(count).toBeGreaterThanOrEqual(1)
    console.log('  pane count:', count)
  })
})
