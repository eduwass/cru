/**
 * iTerm2-specific e2e test helpers.
 * Wraps the `it2` CLI for session management, screen reading, and Claude state.
 */
import { $ } from 'bun'
import { poll, type PollOptions } from './common'

export async function getScreen(
  sessionId: string,
  opts: { waitStable?: boolean; tolerance?: string } = {},
): Promise<string> {
  const { waitStable = true, tolerance = 'normal' } = opts
  if (waitStable) {
    return $`it2 get-screen ${sessionId} --wait-stable --wait-stable-tolerance=${tolerance}`.text()
  }
  return $`it2 get-screen ${sessionId}`.text()
}

export async function getBuffer(sessionId: string, lines?: number): Promise<string> {
  if (lines) {
    return $`it2 get-buffer ${sessionId} --lines ${lines}`.text()
  }
  return $`it2 get-buffer ${sessionId}`.text()
}

export async function screenshot(path: string): Promise<void> {
  const windowId = await $`osascript -e 'tell application "iTerm2" to get the id of the front window'`
    .nothrow()
    .text()
  const id = windowId.trim()
  if (id && /^\d+$/.test(id)) {
    await $`screencapture -x -o -l${id} ${path}`.nothrow().quiet()
  } else {
    await $`screencapture -x -D1 ${path}`.nothrow().quiet()
  }
}

export async function sendText(
  sessionId: string,
  text: string,
  opts: { require?: string; skipConfirm?: boolean } = {},
): Promise<void> {
  const { require: precondition = 'is-claude-session,is-at-prompt', skipConfirm = true } = opts
  const args: string[] = []
  if (precondition) args.push(`--require`, precondition)
  if (skipConfirm) args.push('--skip-confirm')
  await $`it2 session send-text ${args} ${sessionId} ${text}`
}

export async function isClaudeIdle(sessionId: string): Promise<boolean> {
  const result = await $`it2-session-has-no-queued-claude-messages ${sessionId}`.nothrow().text()
  return result.trim() === 'true'
}

export async function waitForClaudeIdle(sessionId: string, opts: PollOptions = {}): Promise<void> {
  await poll(
    async () => (await isClaudeIdle(sessionId)) || null,
    { timeout: 120_000, interval: 3_000, ...opts, label: `Claude idle in ${sessionId}` },
  )
}

export async function autoApprove(sessionId: string): Promise<string> {
  return $`it2-session-claude-auto-approve ${sessionId}`.nothrow().text().then((s) => s.trim())
}

export async function currentSessionId(): Promise<string> {
  return $`it2 session current`.text().then((s) => s.trim())
}

export async function listSessions(): Promise<any[]> {
  return $`it2 session list --format json`.json()
}
