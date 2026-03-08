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
