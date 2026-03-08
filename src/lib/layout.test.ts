import { describe, test, expect } from 'bun:test'
import { computeGrid, buildLayout } from './layout'

const conf = (overrides = {}) => ({
  lead: { position: 'left', size: 40 },
  grid: { fill: 'row', maxCols: null, maxRows: null },
  ...overrides,
})

// ---------------------------------------------------------------------------
// computeGrid
// ---------------------------------------------------------------------------

describe('computeGrid', () => {
  const grid = (n, c = conf()) => computeGrid(n, c)

  test('1 worker → 1x1', () => {
    expect(grid(1)).toEqual({ cols: 1, rows: 1 })
  })

  test('2 workers → 2x1', () => {
    expect(grid(2)).toEqual({ cols: 2, rows: 1 })
  })

  test('3 workers → 2x2', () => {
    expect(grid(3)).toEqual({ cols: 2, rows: 2 })
  })

  test('4 workers → 2x2', () => {
    expect(grid(4)).toEqual({ cols: 2, rows: 2 })
  })

  test('5 workers → 3x2', () => {
    expect(grid(5)).toEqual({ cols: 3, rows: 2 })
  })

  test('6 workers → 3x2', () => {
    expect(grid(6)).toEqual({ cols: 3, rows: 2 })
  })

  test('9 workers → 3x3', () => {
    expect(grid(9)).toEqual({ cols: 3, rows: 3 })
  })

  test('12 workers → 4x3', () => {
    expect(grid(12)).toEqual({ cols: 4, rows: 3 })
  })

  test('maxCols clamps columns and recalculates rows', () => {
    expect(grid(6, conf({ grid: { fill: 'row', maxCols: 2, maxRows: null } })))
      .toEqual({ cols: 2, rows: 3 })
  })

  test('maxRows clamps rows and recalculates columns', () => {
    expect(grid(6, conf({ grid: { fill: 'row', maxCols: null, maxRows: 2 } })))
      .toEqual({ cols: 3, rows: 2 })
  })

  test('maxCols + maxRows together', () => {
    // maxCols fires first (4→3, rows becomes 4), then maxRows (4→3, cols becomes 4)
    // maxRows recalc undoes maxCols — sequential clamping, not simultaneous
    expect(grid(12, conf({ grid: { fill: 'row', maxCols: 3, maxRows: 3 } })))
      .toEqual({ cols: 4, rows: 3 })
  })
})

// ---------------------------------------------------------------------------
// buildLayout
// ---------------------------------------------------------------------------

describe('buildLayout', () => {
  const W = 200
  const H = 100

  test('starts with WxH,0,0', () => {
    const result = buildLayout(W, H, 0, [1], conf())
    expect(result.startsWith(`${W}x${H},0,0`)).toBe(true)
  })

  test('contains all pane IDs', () => {
    const workers = [1, 2, 3, 4]
    const result = buildLayout(W, H, 0, workers, conf())
    for (const id of [0, ...workers]) {
      expect(result).toContain(`,${id}`)
    }
  })

  test('1 worker, lead left', () => {
    expect(buildLayout(W, H, 0, [1], conf())).toBe(
      '200x100,0,0{80x100,0,0,0,119x100,81,0,1}'
    )
  })

  test('2 workers, lead left', () => {
    expect(buildLayout(W, H, 0, [1, 2], conf())).toBe(
      '200x100,0,0{80x100,0,0,0,119x100,81,0{59x100,81,0,1,59x100,141,0,2}}'
    )
  })

  test('4 workers, lead left (2x2 grid)', () => {
    const result = buildLayout(W, H, 0, [1, 2, 3, 4], conf())
    expect(result).toBe(
      '200x100,0,0{80x100,0,0,0,119x100,81,0[119x49,81,0{59x49,81,0,1,59x49,141,0,2},119x50,81,50{59x50,81,50,3,59x50,141,50,4}]}'
    )
  })

  test('3 workers, lead left (incomplete last row expands)', () => {
    const result = buildLayout(W, H, 0, [1, 2, 3], conf())
    // Last row has 1 pane — it must span the full grid width (119), not just one column (59)
    expect(result).toBe(
      '200x100,0,0{80x100,0,0,0,119x100,81,0[119x49,81,0{59x49,81,0,1,59x49,141,0,2},119x50,81,50,3]}'
    )
  })

  test('5 workers, lead left (incomplete last row with 2 of 3 cols)', () => {
    const result = buildLayout(W, H, 0, [1, 2, 3, 4, 5], conf())
    // Last row has 2 of 3 columns — last pane expands to fill remaining space
    // colSizes = distribute(119, 3) = [39, 39, 39]
    // Last pane gets 119 - 40 = 79 instead of 39
    expect(result).toBe(
      '200x100,0,0{80x100,0,0,0,119x100,81,0[119x49,81,0{39x49,81,0,1,39x49,121,0,2,39x49,161,0,3},119x50,81,50{39x50,81,50,4,79x50,121,50,5}]}'
    )
  })

  test('lead right flips layout order', () => {
    const c = conf({ lead: { position: 'right', size: 40 } })
    const result = buildLayout(W, H, 0, [1], c)
    // grid comes first, then lead
    expect(result).toBe('200x100,0,0{119x100,0,0,1,80x100,120,0,0}')
  })

  test('lead top uses vertical split', () => {
    const c = conf({ lead: { position: 'top', size: 40 } })
    const result = buildLayout(W, H, 0, [1], c)
    // [] = vertical stacking
    expect(result).toBe('200x100,0,0[200x40,0,0,0,59x200,0,41,1]')
  })

  test('lead bottom uses vertical split', () => {
    const c = conf({ lead: { position: 'bottom', size: 40 } })
    const result = buildLayout(W, H, 0, [1], c)
    expect(result).toBe('200x100,0,0[59x200,0,0,1,200x40,60,60,0]')
  })

  test('lead size percentage is respected', () => {
    const c = conf({ lead: { position: 'left', size: 30 } })
    const result = buildLayout(W, H, 0, [1], c)
    // 30% of 200 = 60
    expect(result).toContain('60x100,0,0,0')
  })

  test('column fill reorders pane IDs', () => {
    const c = conf({ grid: { fill: 'column', maxCols: null, maxRows: null } })
    const rowResult = buildLayout(W, H, 0, [1, 2, 3, 4], conf())
    const colResult = buildLayout(W, H, 0, [1, 2, 3, 4], c)
    // Both contain all IDs but in different order
    expect(colResult).not.toBe(rowResult)
    for (const id of [0, 1, 2, 3, 4]) {
      expect(colResult).toContain(`,${id}`)
    }
  })
})
