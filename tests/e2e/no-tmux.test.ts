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

describe('spawn without tmux session', () => {
  test('returns preflight error with fix hint', async () => {
    // Run spawn with TMUX env var removed so preflight detects no session
    const env = { ...process.env }
    delete env.TMUX

    const result = await $`bun src/cli.ts spawn fake-team --workers 3`
      .env(env)
      .nothrow()
      .text()

    expect(result).toContain('Preflight checks failed')
    expect(result).toContain('Not inside a tmux session')
    // Fix should be tmux or tmux -CC — never 'tmux new -s main'
    expect(result).toMatch(/tmux/)
    expect(result).not.toContain('new -s main')
  })

  test('fix hint is tmux -CC when in iTerm2', async () => {
    const env = { ...process.env }
    delete env.TMUX
    // Ensure iTerm2 is detected
    env.ITERM_SESSION_ID = 'fake-session-id'
    env.TERM_PROGRAM = 'iTerm.app'

    const result = await $`bun src/cli.ts spawn fake-team --workers 3`
      .env(env)
      .nothrow()
      .text()

    expect(result).toContain('tmux -CC')
  })

  test('fix hint is plain tmux for non-iTerm terminals', async () => {
    const env = { ...process.env }
    delete env.TMUX
    delete env.ITERM_SESSION_ID
    env.TERM_PROGRAM = 'Alacritty'

    const result = await $`bun src/cli.ts spawn fake-team --workers 3`
      .env(env)
      .nothrow()
      .text()

    expect(result).toContain('Not inside a tmux session')
    // Should show plain 'tmux' not 'tmux -CC'
    expect(result).not.toContain('tmux -CC')
  })
})
