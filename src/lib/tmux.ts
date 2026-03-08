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
  const dims = tmux(`display-message -t ${windowId} -p "#{window_width}x#{window_height}"`)
  const [w, h] = dims.split('x').map(Number)
  return { w, h }
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
  // TMUX_PANE is set by tmux per-pane and inherited by child processes.
  // This correctly identifies the pane even when it's not focused.
  // Fallback to display-message for edge cases (e.g. running outside tmux pane).
  return process.env.TMUX_PANE || tmux('display-message -p "#{pane_id}"')
}

/** Get the window ID for a given pane. */
export function paneWindow(paneId) {
  return tmux(`display-message -t ${paneId} -p "#{window_id}"`)
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
