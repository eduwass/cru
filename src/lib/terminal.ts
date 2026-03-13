import { inGhostty } from './env'

export interface PaneInfo {
  id: string
  index: number
}

export interface PaneDetails {
  id: string
  index: number
  width: number
  height: number
  left: number
  top: number
  pid: number
}

export interface TerminalBackend {
  name: 'tmux' | 'ghostty'
  currentPane(): string
  paneWindow(paneId: string): string
  getWindowDimensions(windowId: string): { w: number; h: number }
  listWindowPanes(windowId: string): PaneInfo[]
  listAllPaneIds(): string[]
  killPane(paneId: string): void
  applyGrid(windowId: string, leadPaneId: string, workerPaneIds: string[], conf: any): void
  listPaneDetails(windowId: string): PaneDetails[]
  swapPanes(a: string, b: string): void
}

// --- TmuxBackend ---

class TmuxBackend implements TerminalBackend {
  name = 'tmux' as const

  currentPane(): string {
    const { currentPane } = require('./tmux')
    return currentPane()
  }

  paneWindow(paneId: string): string {
    const { paneWindow } = require('./tmux')
    return paneWindow(paneId)
  }

  getWindowDimensions(windowId: string): { w: number; h: number } {
    const { getWindowDimensions } = require('./tmux')
    return getWindowDimensions(windowId)
  }

  listWindowPanes(windowId: string): PaneInfo[] {
    const { listWindowPanes } = require('./tmux')
    return listWindowPanes(windowId)
  }

  listAllPaneIds(): string[] {
    const { tmux } = require('./tmux')
    return tmux('list-panes -a -F "#{pane_id}"').split('\n')
  }

  killPane(paneId: string): void {
    const { killPane } = require('./tmux')
    killPane(paneId)
  }

  applyGrid(windowId: string, leadPaneId: string, workerPaneIds: string[], conf: any): void {
    const { applyLayout, tmux } = require('./tmux')
    const { buildLayout } = require('./layout')
    const { w: W, h: H } = this.getWindowDimensions(windowId)
    const leadId = leadPaneId.replace('%', '')
    const workerIds = workerPaneIds.map((p) => p.replace('%', ''))
    const layoutStr = buildLayout(W, H, leadId, workerIds, conf)
    applyLayout(windowId, layoutStr)

    // Fix pane assignment for right/bottom — tmux assigns by window order, not layout IDs
    const pos = conf.lead.position
    if (pos === 'right' || pos === 'bottom') {
      const posKey = pos === 'right' ? 'pane_left' : 'pane_top'
      const afterInfo = tmux(`list-panes -t ${windowId} -F "#{pane_id} #{${posKey}}"`)
        .split('\n')
        .map((l) => { const [id, v] = l.split(' '); return { id, pos: Number(v) } })

      const leadAfter = afterInfo.find((p) => p.id === leadPaneId)
      const maxPos = Math.max(...afterInfo.map((p) => p.pos))
      if (leadAfter && leadAfter.pos !== maxPos) {
        const paneAtLeadPos = afterInfo.find((p) => p.pos === maxPos)
        if (paneAtLeadPos) {
          tmux(`swap-pane -d -s ${leadPaneId} -t ${paneAtLeadPos.id}`)
        }
      }
    }
  }

  listPaneDetails(windowId: string): PaneDetails[] {
    const { tmux } = require('./tmux')
    return tmux(`list-panes -t ${windowId} -F "#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_left} #{pane_top} #{pane_pid}"`)
      .split('\n')
      .map((l) => {
        const [id, index, width, height, left, top, pid] = l.split(' ')
        return { id, index: Number(index), width: Number(width), height: Number(height), left: Number(left), top: Number(top), pid: Number(pid) }
      })
  }

  swapPanes(a: string, b: string): void {
    const { tmux } = require('./tmux')
    tmux(`swap-pane -d -s ${a} -t ${b}`)
  }
}

// --- GhosttyBackend ---

class GhosttyBackend implements TerminalBackend {
  name = 'ghostty' as const

  currentPane(): string {
    const { currentTerminal } = require('./ghostty')
    return currentTerminal()
  }

  paneWindow(paneId: string): string {
    const { currentWindow } = require('./ghostty')
    // Ghostty doesn't have a pane→window lookup — use front window
    return currentWindow()
  }

  getWindowDimensions(windowId: string): { w: number; h: number } {
    // Ghostty doesn't expose dimensions via AppleScript.
    // Use tput from the current terminal as a reasonable approximation.
    const { execSync } = require('node:child_process')
    try {
      const cols = Number(execSync('tput cols', { encoding: 'utf-8' }).trim())
      const lines = Number(execSync('tput lines', { encoding: 'utf-8' }).trim())
      return { w: cols || 200, h: lines || 50 }
    } catch {
      return { w: 200, h: 50 }
    }
  }

  listWindowPanes(windowId: string): PaneInfo[] {
    const { listTerminals } = require('./ghostty')
    return listTerminals(windowId)
  }

  listAllPaneIds(): string[] {
    const { listAllTerminals } = require('./ghostty')
    return listAllTerminals()
  }

  killPane(paneId: string): void {
    const { closeTerminal } = require('./ghostty')
    closeTerminal(paneId)
  }

  applyGrid(_windowId: string, _leadPaneId: string, workerPaneIds: string[], _conf: any): void {
    // In Ghostty, worker panes live in a headless tmux session (claude-swarm-*).
    // Mirror them into Ghostty splits via tmux session groups.
    if (workerPaneIds.length > 0 && workerPaneIds[0].startsWith('%')) {
      // These are tmux pane IDs — mirror them to Ghostty
      const { mirrorToGhostty } = require('./mirror')
      mirrorToGhostty(workerPaneIds)
    }
    // Otherwise, splits were already created directly in Ghostty — nothing to do.
  }

  listPaneDetails(windowId: string): PaneDetails[] {
    const { listTerminals } = require('./ghostty')
    const terminals = listTerminals(windowId)
    // Ghostty doesn't expose per-terminal dimensions via AppleScript
    return terminals.map((t, i) => ({
      id: t.id,
      index: i,
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      pid: 0,
    }))
  }

  swapPanes(_a: string, _b: string): void {
    // Ghostty doesn't support pane swapping via AppleScript
  }
}

// --- Factory ---

let _backend: TerminalBackend | null = null

export function getBackend(): TerminalBackend {
  if (!_backend) {
    _backend = inGhostty() ? new GhosttyBackend() : new TmuxBackend()
  }
  return _backend
}

/** Reset cached backend (useful for testing). */
export function resetBackend(): void {
  _backend = null
}
