/**
 * Ghostty-specific e2e test helpers.
 * Uses AppleScript for terminal management.
 */
import { execSync, execFileSync } from 'node:child_process'

/** Run an AppleScript snippet targeting Ghostty. */
export function ghostty(script: string): string {
  const wrapped = `tell application "Ghostty"\n${script}\nend tell`
  return execSync('osascript', { input: wrapped, encoding: 'utf-8' }).trim()
}

/** Send text + Enter to a terminal (like typing a command). */
export function sendLine(terminalId: string, text: string): void {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  // Use input text for the content, then send key for Enter.
  // The 200ms delay ensures Claude's TUI has processed the pasted text
  // before we press Enter.
  ghostty(`input text "${escaped}" to terminal id "${terminalId}"`)
  Bun.sleepSync(200)
  ghostty(`send key "enter" to terminal id "${terminalId}"`)
}

/** Count all Ghostty terminals across all windows. */
export function ghosttyTerminalCount(): number {
  try {
    const ids = execFileSync(
      'osascript', ['-e', 'tell application "Ghostty" to get id of every terminal'],
      { encoding: 'utf-8' },
    ).trim()
    if (!ids) return 0
    return ids.split(', ').length
  } catch { return 0 }
}

/** Count terminals in the front window only. */
export function ghosttyFrontWindowTerminalCount(): number {
  try {
    const ids = ghostty('get id of every terminal of front window')
    if (!ids) return 0
    return ids.split(', ').length
  } catch { return 0 }
}

/** Get terminal IDs in the front window. */
export function ghosttyFrontWindowTerminals(): string[] {
  try {
    const ids = ghostty('get id of every terminal of front window')
    if (!ids) return []
    return ids.split(', ')
  } catch { return [] }
}

/** Get ALL terminal IDs across all windows. */
export function ghosttyAllTerminals(): string[] {
  try {
    const ids = execFileSync(
      'osascript', ['-e', 'tell application "Ghostty" to get id of every terminal'],
      { encoding: 'utf-8' },
    ).trim()
    if (!ids) return []
    return ids.split(', ')
  } catch { return [] }
}

/** Take a screenshot of the Ghostty front window. */
export async function screenshot(path: string): Promise<void> {
  const { $ } = await import('bun')
  // Fallback: capture the main display
  await $`screencapture -x -D1 ${path}`.nothrow().quiet()
}

/** Find claude-swarm tmux sockets in /tmp/tmux-<uid>/. */
export function findSwarmSockets(): string[] {
  const { readdirSync, statSync } = require('node:fs')
  const { join } = require('node:path')
  const uid = process.getuid?.() ?? 501
  const sockDir = join('/tmp', `tmux-${uid}`)
  try {
    return readdirSync(sockDir)
      .filter((f: string) => f.startsWith('claude-swarm-'))
      .map((f: string) => ({ name: f, mtime: statSync(join(sockDir, f)).mtimeMs }))
      .sort((a: any, b: any) => b.mtime - a.mtime)
      .map((f: any) => f.name)
  } catch {
    return []
  }
}
