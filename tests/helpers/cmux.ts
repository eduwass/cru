/**
 * cmux-specific e2e test helpers.
 *
 * Re-exports core functions from src/lib/cmux.ts and adds
 * test-specific helpers (sendLine, listSurfaceIds).
 */
import {
  cmux,
  isCmuxAvailable,
  currentSurface,
  splitSurface,
  closeSurface,
  renameSurface,
  readScreen,
  listAllSurfaceIds as listSurfaceIds,
} from '../../src/lib/cmux'

// Re-export library functions for tests
export { cmux, isCmuxAvailable, currentSurface, splitSurface, closeSurface, renameSurface, readScreen, listSurfaceIds }

/** Send text + Enter to a surface (like typing a command). */
export function sendLine(surfaceId: string, text: string): void {
  cmux('send', '--surface', surfaceId, text)
  Bun.sleepSync(100)
  cmux('send-key', '--surface', surfaceId, 'Return')
}
