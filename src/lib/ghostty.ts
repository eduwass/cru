import { execSync } from 'node:child_process'

/** Run an AppleScript snippet targeting Ghostty. */
export function ghostty(script: string): string {
  const wrapped = `tell application "Ghostty"\n${script}\nend tell`
  return execSync(`osascript -e ${JSON.stringify(wrapped)}`, { encoding: 'utf-8' }).trim()
}

/** Get the focused terminal ID in the frontmost window. */
export function currentTerminal(): string {
  return ghostty('get id of focused terminal of selected tab of front window')
}

/** Get the frontmost window ID. */
export function currentWindow(): string {
  return ghostty('get id of front window')
}

/** List all terminals in a window with their IDs. */
export function listTerminals(windowId: string): Array<{ id: string; index: number }> {
  const ids = ghostty(`get id of every terminal of window id ${windowId}`)
  if (!ids) return []
  return ids.split(', ').map((id, i) => ({ id, index: i }))
}

/** List all terminal IDs across all windows. */
export function listAllTerminals(): string[] {
  const ids = ghostty('get id of every terminal')
  if (!ids) return []
  return ids.split(', ')
}

/** Split a terminal and return the new terminal's ID. */
export function splitTerminal(terminalId: string, direction: 'right' | 'down'): string {
  // Split creates a new terminal adjacent to the target
  ghostty(`split terminal id ${terminalId} direction ${direction}`)
  // After split, the new terminal is focused — get its ID
  return currentTerminal()
}

/** Close a terminal. */
export function closeTerminal(terminalId: string): void {
  try {
    ghostty(`close terminal id ${terminalId}`)
  } catch {
    // terminal may already be closed
  }
}

/** Send paste-style text input to a terminal. */
export function inputText(terminalId: string, text: string): void {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  ghostty(`input text "${escaped}" to terminal id ${terminalId}`)
}

/** Focus a terminal and bring its window to front. */
export function focusTerminal(terminalId: string): void {
  ghostty(`focus terminal id ${terminalId}`)
}

/** Get Ghostty version string. */
export function ghosttyVersion(): string | null {
  try {
    return ghostty('get version')
  } catch {
    return null
  }
}

/** Check if Ghostty is running and scriptable. */
export function isGhosttyScriptable(): boolean {
  try {
    ghostty('get name')
    return true
  } catch {
    return false
  }
}
