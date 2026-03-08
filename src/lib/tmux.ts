import { execSync } from 'node:child_process'

export function tmux(cmd) {
  return execSync(`tmux ${cmd}`, { encoding: 'utf-8' }).trim()
}

export function tmuxChecksum(layout) {
  let csum = 0
  for (const c of layout) {
    csum = ((csum >> 1) + ((csum & 1) << 15)) & 0xffff
    csum = (csum + c.charCodeAt(0)) & 0xffff
  }
  return csum.toString(16).padStart(4, '0')
}

export function getWindowDimensions(windowId) {
  // display-message can return empty in control mode — use list-windows as fallback
  const dims = tmux(`display-message -t ${windowId} -p "#{window_width}x#{window_height}"`)
  if (dims && dims.includes('x')) {
    const [w, h] = dims.split('x').map(Number)
    if (w && h) return { w, h }
  }
  const fallback = tmux(`list-windows -a -F "#{window_id} #{window_width} #{window_height}"`)
    .split('\n')
    .find((l) => l.startsWith(windowId + ' '))
  if (fallback) {
    const [, w, h] = fallback.split(' ')
    return { w: Number(w), h: Number(h) }
  }
  throw new Error(`Cannot get dimensions for window ${windowId}`)
}

export function listWindowPanes(windowId) {
  return tmux(`list-panes -t ${windowId} -F "#{pane_id} #{pane_index}"`)
    .split('\n')
    .map((l) => {
      const [id, idx] = l.split(' ')
      return { id, index: Number(idx) }
    })
}

export function applyLayout(windowId, layoutStr) {
  const full = `${tmuxChecksum(layoutStr)},${layoutStr}`
  tmux(`select-layout -t ${windowId} '${full}'`)
}

/** Get the current pane ID (the pane running this process). */
export function currentPane() {
  // TMUX_PANE is set per-pane by tmux — most reliable source
  const envPane = process.env.TMUX_PANE
  if (envPane) {
    // Verify it still exists (can be stale in iTerm2 tmux -CC)
    try {
      const allPanes = tmux('list-panes -a -F "#{pane_id}"').split('\n')
      if (allPanes.includes(envPane)) return envPane
    } catch {}
  }
  // Fallback — may not work in control mode but worth trying
  return tmux('display-message -p "#{pane_id}"')
}

/** Get the window ID for a given pane. */
export function paneWindow(paneId) {
  // display-message can return empty in tmux control mode (tmux -CC / VS Code)
  const result = tmux(`display-message -t ${paneId} -p "#{window_id}"`)
  if (result) return result

  // Fallback: search all panes
  const lines = tmux('list-panes -a -F "#{pane_id} #{window_id}"').split('\n')
  for (const line of lines) {
    const [pid, wid] = line.split(' ')
    if (pid === paneId) return wid
  }
  throw new Error(`Cannot find window for pane ${paneId}`)
}

/** Split a pane and return the new pane ID. */
export function splitPane(targetPane, { horizontal = false } = {}) {
  const flag = horizontal ? '-v' : '-h'
  return tmux(`split-window ${flag} -t ${targetPane} -P -F "#{pane_id}"`)
}

/** Send keys to a pane (runs a command). */
export function sendKeys(paneId, text) {
  // Use send-keys with literal string to avoid shell escaping issues
  tmux(`send-keys -t ${paneId} ${JSON.stringify(text)} Enter`)
}

/** Kill a specific pane. */
export function killPane(paneId) {
  try {
    tmux(`kill-pane -t ${paneId}`)
  } catch {
    // pane may already be dead
  }
}

/** Select (focus) a pane. */
export function selectPane(paneId) {
  tmux(`select-pane -t ${paneId}`)
}
