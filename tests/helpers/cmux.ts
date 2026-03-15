/**
 * cmux-specific e2e test helpers.
 * Uses the cmux CLI for terminal management via Unix socket.
 */
import { execFileSync } from 'node:child_process'

/** Run a cmux CLI command. */
export function cmux(...args: string[]): string {
  return execFileSync('cmux', args, { encoding: 'utf-8', timeout: 10_000 }).trim()
}

/** Check if cmux is available and responding. */
export function isCmuxAvailable(): boolean {
  try {
    cmux('ping')
    return true
  } catch {
    return false
  }
}

/** Get the caller's surface ref via identify. */
export function callerSurface(): string {
  const info = JSON.parse(cmux('identify'))
  return info.caller?.surface_ref
}

/** Send text + Enter to a surface (like typing a command). */
export function sendLine(surfaceId: string, text: string): void {
  cmux('send', '--surface', surfaceId, text)
  Bun.sleepSync(100)
  cmux('send-key', '--surface', surfaceId, 'Return')
}

/** List all surface IDs in the current workspace. */
export function listSurfaceIds(): string[] {
  const output = cmux('list-panels')
  if (!output) return []
  return output.split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[*\s]*(surface:\d+)/)
      return match ? match[1] : null
    })
    .filter((s): s is string => s !== null)
}

/** Read screen content from a surface. */
export function readScreen(surfaceId: string, lines?: number): string {
  const args = ['read-screen', '--surface', surfaceId]
  if (lines) args.push('--lines', String(lines))
  return cmux(...args)
}

/**
 * Create a split and return the new surface ref.
 * Pass relativeTo to ensure the split happens next to a specific surface
 * (important when user focus may be elsewhere).
 */
export function splitSurface(
  direction: 'right' | 'down' | 'left' | 'up' = 'right',
  relativeTo?: string,
): string {
  const args = ['new-split', direction]
  if (relativeTo) args.push('--surface', relativeTo)
  const output = cmux(...args)
  const match = output.match(/surface:\d+/)
  if (!match) throw new Error(`Unexpected new-split output: ${output}`)
  return match[0]
}

/** Close a surface by ref. */
export function closeSurface(surfaceId: string): void {
  try {
    cmux('close-surface', '--surface', surfaceId)
  } catch {
    // may already be closed
  }
}

/** Rename a surface's tab. */
export function renameSurface(surfaceId: string, title: string): void {
  cmux('rename-tab', title, '--surface', surfaceId)
}
