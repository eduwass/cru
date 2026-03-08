/**
 * E2E test: spawn without a tmux session returns a helpful error.
 *
 * This test runs the CLI directly (no iTerm2/tmux setup needed)
 * to verify preflight checks catch the missing tmux session.
 *
 * Run: bun test tests/e2e/no-tmux.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'

function envWithout(...keys: string[]) {
  const env = { ...process.env }
  for (const k of keys) env[k] = undefined as unknown as string
  return env
}

describe('spawn without tmux session', () => {
  test('returns preflight error', async () => {
    const result = await $`bun src/cli.ts spawn fake-team --workers 3`
      .env(envWithout('TMUX'))
      .nothrow()
      .text()

    expect(result).toContain('TMUX-SESSION')
    expect(result).toContain('Not inside a tmux session')
  })

  test('exit code is non-zero', async () => {
    const result = await $`bun src/cli.ts spawn fake-team --workers 3`
      .env(envWithout('TMUX'))
      .nothrow()

    expect(result.exitCode).not.toBe(0)
  })

  test('preflight fires before command logic', async () => {
    const result = await $`bun src/cli.ts spawn fake-team --workers 3`
      .env(envWithout('TMUX'))
      .nothrow()
      .text()

    // Should NOT show ENOENT from readTeamConfig — preflight catches first
    expect(result).not.toContain('ENOENT')
    expect(result).not.toContain('config.json')
  })
})
