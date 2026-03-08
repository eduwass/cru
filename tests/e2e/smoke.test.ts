/**
 * Smoke test — verify the e2e test environment works.
 *
 * Run: bun test tests/e2e/smoke.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createTestEnv, checkPrereqs, type TestEnv } from './setup'

describe('smoke: prerequisites', () => {
  test('it2, tmux, and claude are available', async () => {
    await checkPrereqs() // throws if missing
  })
})

describe('smoke: test environment', () => {
  let env: TestEnv

  beforeAll(async () => {
    env = await createTestEnv()
  }, 90_000)

  afterAll(async () => {
    await env?.teardown()
  })

  test('test env has a valid session ID', () => {
    expect(env.sessionId.length).toBeGreaterThan(0)
    console.log('  session ID:', env.sessionId)
  })

  test('Claude is running in the test session', async () => {
    const screen = await env.captureScreen()
    expect(screen.length).toBeGreaterThan(0)
    console.log('  screen length:', screen.length, 'chars')
  })

  test('can list tmux panes', async () => {
    const panes = await env.listPanes()
    expect(panes.length).toBeGreaterThanOrEqual(1)
    console.log('  panes:', panes.length)
  })
})
