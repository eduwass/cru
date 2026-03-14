import type { LayoutConf } from './tmux'

export function computeGrid(N: number, conf: LayoutConf): { cols: number; rows: number } {
  let cols = Math.ceil(Math.sqrt(N))
  let rows = Math.ceil(N / cols)

  if (conf.grid.maxCols && cols > conf.grid.maxCols) {
    cols = conf.grid.maxCols
    rows = Math.ceil(N / cols)
  }
  if (conf.grid.maxRows && rows > conf.grid.maxRows) {
    rows = conf.grid.maxRows
    cols = Math.ceil(N / rows)
  }
  return { cols, rows }
}

export function buildLayout(
  W: number, H: number, leadId: number | string, workerIds: (number | string)[], conf: LayoutConf,
): string {
  const pos = conf.lead.position
  const sizePct = conf.lead.size
  const N = workerIds.length
  const { cols, rows } = computeGrid(N, conf)
  const isHorizontal = pos === 'left' || pos === 'right'

  const leadSize = Math.floor(((isHorizontal ? W : H) * sizePct) / 100)
  const gridTotal = (isHorizontal ? W : H) - leadSize - 1
  const gridCross = isHorizontal ? H : W

  const colSizes = distribute(isHorizontal ? gridTotal : gridCross, cols)
  const rowSizes = distribute(isHorizontal ? gridCross : gridTotal, rows)

  const ordered =
    conf.grid.fill === 'column'
      ? reorderColumnFirst(workerIds, rows, cols)
      : workerIds

  const leadFirst = pos === 'left' || pos === 'top'
  const gridOrigin = leadFirst ? leadSize + 1 : 0
  const leadOrigin = leadFirst ? 0 : gridTotal + 1

  const rowLayouts = buildRows({
    rows,
    cols,
    N,
    rowSizes,
    colSizes,
    gridOrigin,
    gridTotal,
    ordered,
    isHorizontal,
  })

  let gridLayout: string
  if (rowLayouts.length === 1) {
    gridLayout = rowLayouts[0]
  } else {
    const gx = isHorizontal ? gridOrigin : 0
    const gy = isHorizontal ? 0 : gridOrigin
    const gw = isHorizontal ? gridTotal : W
    const gh = isHorizontal ? H : gridTotal
    const bracket = isHorizontal
      ? `[${rowLayouts.join(',')}]`
      : `{${rowLayouts.join(',')}}`
    gridLayout = `${gw}x${gh},${gx},${gy}${bracket}`
  }

  const lx = isHorizontal ? leadOrigin : leadFirst ? 0 : gridTotal + 1
  const ly = isHorizontal ? 0 : leadFirst ? 0 : gridTotal + 1
  const lw = isHorizontal ? leadSize : W
  const lh = isHorizontal ? H : leadSize
  const leadLayout = `${lw}x${lh},${lx},${ly},${leadId}`

  const parts = leadFirst
    ? [leadLayout, gridLayout]
    : [gridLayout, leadLayout]
  const outerBracket = isHorizontal
    ? `{${parts.join(',')}}`
    : `[${parts.join(',')}]`

  return `${W}x${H},0,0${outerBracket}`
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function distribute(total: number, count: number): number[] {
  const base = Math.floor((total - (count - 1)) / count)
  const sizes = Array(count).fill(base)
  sizes[count - 1] = total - (count - 1) - base * (count - 1)
  return sizes
}

function reorderColumnFirst<T>(ids: T[], rows: number, cols: number): T[] {
  const out: T[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = c * rows + r
      if (idx < ids.length) out.push(ids[idx])
    }
  }
  return out
}

interface BuildRowsOpts {
  rows: number
  cols: number
  N: number
  rowSizes: number[]
  colSizes: number[]
  gridOrigin: number
  gridTotal: number
  ordered: (number | string)[]
  isHorizontal: boolean
}

function buildRows(opts: BuildRowsOpts): string[] {
  const {
    rows, cols, N, rowSizes, colSizes,
    gridOrigin, gridTotal, ordered, isHorizontal,
  } = opts
  const rowLayouts: string[] = []
  let idx = 0
  let primaryOffset = 0

  for (let r = 0; r < rows; r++) {
    const rSize = rowSizes[r]
    const cellParts: string[] = []
    let secondaryOffset = gridOrigin

    for (let c = 0; c < cols; c++) {
      if (idx >= N) break
      let cSize = colSizes[c]
      // Last pane in an incomplete row — expand to fill remaining space
      if (idx === N - 1 && c < cols - 1) {
        cSize = gridTotal - (secondaryOffset - gridOrigin)
      }
      const x = isHorizontal ? secondaryOffset : primaryOffset
      const y = isHorizontal ? primaryOffset : secondaryOffset
      const w = isHorizontal ? cSize : rSize
      const h = isHorizontal ? rSize : cSize
      cellParts.push(`${w}x${h},${x},${y},${ordered[idx]}`)
      secondaryOffset += cSize + 1
      idx++
    }

    if (cellParts.length === 1) {
      rowLayouts.push(cellParts[0])
    } else {
      const x = isHorizontal ? gridOrigin : primaryOffset
      const y = isHorizontal ? primaryOffset : gridOrigin
      const w = isHorizontal ? gridTotal : rSize
      const h = isHorizontal ? rSize : gridTotal
      rowLayouts.push(`${w}x${h},${x},${y}{${cellParts.join(',')}}`)
    }
    primaryOffset += rSize + 1
  }

  return rowLayouts
}
