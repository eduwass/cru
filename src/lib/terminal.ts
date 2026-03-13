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

// All pane management goes through tmux. Ghostty's grid flow (mirror.ts)
// bypasses this entirely and handles its own splits via AppleScript.

export function currentPane(): string {
  const { currentPane } = require('./tmux')
  return currentPane()
}

export function paneWindow(paneId: string): string {
  const { paneWindow } = require('./tmux')
  return paneWindow(paneId)
}

export function getWindowDimensions(windowId: string): { w: number; h: number } {
  const { getWindowDimensions } = require('./tmux')
  return getWindowDimensions(windowId)
}

export function listWindowPanes(windowId: string): PaneInfo[] {
  const { listWindowPanes } = require('./tmux')
  return listWindowPanes(windowId)
}

export function listAllPaneIds(): string[] {
  const { tmux } = require('./tmux')
  return tmux('list-panes -a -F "#{pane_id}"').split('\n')
}

export function killPane(paneId: string): void {
  const { killPane } = require('./tmux')
  killPane(paneId)
}

export function applyGrid(windowId: string, leadPaneId: string, workerPaneIds: string[], conf: any): void {
  const { applyLayout, tmux } = require('./tmux')
  const { buildLayout } = require('./layout')
  const { w: W, h: H } = getWindowDimensions(windowId)
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

export function listPaneDetails(windowId: string): PaneDetails[] {
  const { tmux } = require('./tmux')
  return tmux(`list-panes -t ${windowId} -F "#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_left} #{pane_top} #{pane_pid}"`)
    .split('\n')
    .map((l) => {
      const [id, index, width, height, left, top, pid] = l.split(' ')
      return { id, index: Number(index), width: Number(width), height: Number(height), left: Number(left), top: Number(top), pid: Number(pid) }
    })
}

export function swapPanes(a: string, b: string): void {
  const { tmux } = require('./tmux')
  tmux(`swap-pane -d -s ${a} -t ${b}`)
}
