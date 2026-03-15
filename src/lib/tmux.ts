import { execFileSync } from 'node:child_process'
import { buildLayout } from './layout'

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

/** Run a tmux command safely (no shell interpolation). */
export function tmux(...args: string[]): string {
  return execFileSync('tmux', args, { encoding: 'utf-8' }).trim()
}

export function tmuxChecksum(layout: string): string {
  let csum = 0
  for (const c of layout) {
    csum = ((csum >> 1) + ((csum & 1) << 15)) & 0xffff
    csum = (csum + c.charCodeAt(0)) & 0xffff
  }
  return csum.toString(16).padStart(4, '0')
}

export function getWindowDimensions(windowId: string): { w: number; h: number } {
  // display-message can return empty in control mode — use list-windows as fallback
  const dims = tmux('display-message', '-t', windowId, '-p', '#{window_width}x#{window_height}')
  if (dims && dims.includes('x')) {
    const [w, h] = dims.split('x').map(Number)
    if (w && h) return { w, h }
  }
  const fallback = tmux('list-windows', '-a', '-F', '#{window_id} #{window_width} #{window_height}')
    .split('\n')
    .find((l) => l.startsWith(windowId + ' '))
  if (fallback) {
    const [, w, h] = fallback.split(' ')
    return { w: Number(w), h: Number(h) }
  }
  throw new Error(`Cannot get dimensions for window ${windowId}`)
}

export function listWindowPanes(windowId: string): PaneInfo[] {
  return tmux('list-panes', '-t', windowId, '-F', '#{pane_id} #{pane_index}')
    .split('\n')
    .map((l) => {
      const [id, idx] = l.split(' ')
      return { id, index: Number(idx) }
    })
}

export function listAllPaneIds(): string[] {
  return tmux('list-panes', '-a', '-F', '#{pane_id}').split('\n')
}

export function applyLayout(windowId: string, layoutStr: string): void {
  const full = `${tmuxChecksum(layoutStr)},${layoutStr}`
  tmux('select-layout', '-t', windowId, full)
}

/** Get the current pane ID (the pane running this process). */
export function currentPane(): string {
  // TMUX_PANE is set per-pane by tmux — most reliable source
  const envPane = process.env.TMUX_PANE
  if (envPane) {
    // Verify it still exists (can be stale in iTerm2 tmux -CC)
    try {
      const allPanes = tmux('list-panes', '-a', '-F', '#{pane_id}').split('\n')
      if (allPanes.includes(envPane)) return envPane
    } catch {}
  }
  // Fallback — may not work in control mode but worth trying
  return tmux('display-message', '-p', '#{pane_id}')
}

/** Get the window ID for a given pane. */
export function paneWindow(paneId: string): string {
  // display-message can return empty in tmux control mode (tmux -CC / VS Code)
  const result = tmux('display-message', '-t', paneId, '-p', '#{window_id}')
  if (result) return result

  // Fallback: search all panes
  const lines = tmux('list-panes', '-a', '-F', '#{pane_id} #{window_id}').split('\n')
  for (const line of lines) {
    const [pid, wid] = line.split(' ')
    if (pid === paneId) return wid
  }
  throw new Error(`Cannot find window for pane ${paneId}`)
}

/** Split a pane and return the new pane ID. */
export function splitPane(targetPane: string, { horizontal = false } = {}): string {
  const flag = horizontal ? '-v' : '-h'
  return tmux('split-window', flag, '-t', targetPane, '-P', '-F', '#{pane_id}')
}

/** Send keys to a pane (runs a command). */
export function sendKeys(paneId: string, text: string): void {
  tmux('send-keys', '-t', paneId, text, 'Enter')
}

/** Kill a specific pane. */
export function killPane(paneId: string): void {
  try {
    tmux('kill-pane', '-t', paneId)
  } catch {
    // pane may already be dead
  }
}

/** Select (focus) a pane. */
export function selectPane(paneId: string): void {
  tmux('select-pane', '-t', paneId)
}

export function listPaneDetails(windowId: string): PaneDetails[] {
  return tmux('list-panes', '-t', windowId, '-F', '#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_left} #{pane_top} #{pane_pid}')
    .split('\n')
    .map((l) => {
      const [id, index, width, height, left, top, pid] = l.split(' ')
      return { id, index: Number(index), width: Number(width), height: Number(height), left: Number(left), top: Number(top), pid: Number(pid) }
    })
}

export function swapPanes(a: string, b: string): void {
  tmux('swap-pane', '-d', '-s', a, '-t', b)
}

/** Apply a grid layout: lead pane on one side, workers in a grid on the other. */
export function applyGrid(windowId: string, leadPaneId: string, workerPaneIds: string[], conf: LayoutConf): void {
  const { w: W, h: H } = getWindowDimensions(windowId)
  const leadId = leadPaneId.replace('%', '')
  const workerIds = workerPaneIds.map((p) => p.replace('%', ''))
  const layoutStr = buildLayout(W, H, leadId, workerIds, conf)
  applyLayout(windowId, layoutStr)

  // Fix pane assignment for right/bottom — tmux assigns by window order, not layout IDs
  const pos = conf.lead.position
  if (pos === 'right' || pos === 'bottom') {
    const posKey = pos === 'right' ? 'pane_left' : 'pane_top'
    const afterInfo = tmux('list-panes', '-t', windowId, '-F', `#{pane_id} #{${posKey}}`)
      .split('\n')
      .map((l) => { const [id, v] = l.split(' '); return { id, pos: Number(v) } })

    const leadAfter = afterInfo.find((p) => p.id === leadPaneId)
    const maxPos = Math.max(...afterInfo.map((p) => p.pos))
    if (leadAfter && leadAfter.pos !== maxPos) {
      const paneAtLeadPos = afterInfo.find((p) => p.pos === maxPos)
      if (paneAtLeadPos) {
        swapPanes(leadPaneId, paneAtLeadPos.id)
      }
    }
  }
}

// Re-export layout config type for callers
export interface LayoutConf {
  lead: { position: 'left' | 'right' | 'top' | 'bottom'; size: number }
  grid: { fill: 'row' | 'column'; maxCols: number | null; maxRows: number | null }
}
