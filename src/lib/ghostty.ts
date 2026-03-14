import { execFileSync, execSync } from 'node:child_process'

/** Run an AppleScript snippet targeting Ghostty. */
export function ghostty(script: string): string {
  const wrapped = `tell application "Ghostty"\n${script}\nend tell`
  return execSync('osascript', { input: wrapped, encoding: 'utf-8' }).trim()
}

/**
 * Find the Ghostty terminal ID that THIS process is running in.
 *
 * Ghostty's AppleScript API doesn't expose PID or TTY per terminal,
 * so we correlate via creation order:
 * 1. Walk up the process tree to find our ancestor TTY
 * 2. Find all of Ghostty's direct children (login processes) + their TTYs
 * 3. Get all terminal IDs from AppleScript
 * 4. Both lists are in creation order — match by position
 *
 * Falls back to the focused terminal if the lookup fails.
 */
export function currentTerminal(): string {
  try {
    // 1. Walk up from our PID to find the ancestor TTY
    let pid = process.pid
    let ourTty: string | null = null
    for (let i = 0; i < 20; i++) {
      const info = execFileSync('ps', ['-o', 'pid=,ppid=,tty=', '-p', String(pid)], { encoding: 'utf-8' }).trim()
      const parts = info.split(/\s+/)
      const tty = parts[2]
      if (tty && tty !== '??' && !tty.startsWith('??')) {
        ourTty = tty
        break
      }
      pid = parseInt(parts[1])
      if (!pid || pid <= 1) break
    }
    if (!ourTty) throw new Error('Could not find TTY')

    // 2. Find Ghostty's PID
    const ghosttyPid = execFileSync(
      'ps', ['-ax', '-o', 'pid=,comm='],
      { encoding: 'utf-8' },
    ).split('\n')
      .find((l) => l.includes('Ghostty.app/Contents/MacOS/ghostty'))
      ?.trim().split(/\s+/)[0]
    if (!ghosttyPid) throw new Error('Ghostty process not found')

    // 3. Find all Ghostty children (login processes) sorted by PID (= creation order)
    const children = execFileSync(
      'ps', ['-ax', '-o', 'pid=,ppid=,tty='],
      { encoding: 'utf-8' },
    ).split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p[1] === ghosttyPid)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))

    // 4. Find our position in the children list
    const ourIndex = children.findIndex((c) => c[2] === ourTty)
    if (ourIndex < 0) throw new Error(`TTY ${ourTty} not found in Ghostty children`)

    // 5. Get terminal IDs from AppleScript (same creation order)
    const terminalIds = listAllTerminals()
    if (ourIndex >= terminalIds.length) throw new Error('Terminal index out of range')

    return terminalIds[ourIndex]
  } catch {
    // Fallback: use the focused terminal (original behavior)
    return ghostty('get id of focused terminal of selected tab of front window')
  }
}

/** Get the frontmost window ID. */
export function currentWindow(): string {
  return ghostty('get id of front window')
}

/** List all terminals in the front window with their IDs. */
export function listTerminals(_windowId?: string): Array<{ id: string; index: number }> {
  // Ghostty's window id format doesn't work with `window id` in AppleScript.
  // Use front window — caller should ensure the right window is focused.
  const ids = ghostty('get id of every terminal of front window')
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
  // Snapshot terminal IDs before split
  const before = new Set(listAllTerminals())
  ghostty(`split terminal id "${terminalId}" direction ${direction}`)
  // Find the new terminal by diffing
  const after = listAllTerminals()
  const newId = after.find((id) => !before.has(id))
  if (!newId) throw new Error('Split did not create a new terminal')
  return newId
}

/** Close a terminal. */
export function closeTerminal(terminalId: string): void {
  try {
    ghostty(`close terminal id "${terminalId}"`)
  } catch {
    // terminal may already be closed
  }
}

/** Send paste-style text input to a terminal. */
export function inputText(terminalId: string, text: string): void {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  ghostty(`input text "${escaped}" to terminal id "${terminalId}"`)
}

/** Send a key press to a terminal. */
export function sendKey(terminalId: string, key: string): void {
  ghostty(`send key "${key}" to terminal id "${terminalId}"`)
}

/** Send text followed by Enter (like typing a command). */
export function sendCommand(terminalId: string, text: string): void {
  inputText(terminalId, text)
  sendKey(terminalId, 'enter')
}

/** Focus a terminal and bring its window to front. */
export function focusTerminal(terminalId: string): void {
  ghostty(`focus terminal id "${terminalId}"`)
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
