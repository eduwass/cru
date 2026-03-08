import { describe, test, expect } from 'bun:test'
import { deepMerge, DEFAULTS } from './config'

describe('deepMerge', () => {
  test('merges flat objects', () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  test('later values override earlier', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  test('merges nested objects recursively', () => {
    const target = { layout: { lead: { position: 'left', size: 40 } } }
    const source = { layout: { lead: { size: 30 } } }
    expect(deepMerge(target, source)).toEqual({
      layout: { lead: { position: 'left', size: 30 } },
    })
  })

  test('does not merge arrays — replaces them', () => {
    const target = { tags: [1, 2] }
    const source = { tags: [3] }
    expect(deepMerge(target, source)).toEqual({ tags: [3] })
  })

  test('adds new nested keys', () => {
    const target = { layout: { lead: { position: 'left' } } }
    const source = { layout: { grid: { fill: 'column' } } }
    expect(deepMerge(target, source)).toEqual({
      layout: { lead: { position: 'left' }, grid: { fill: 'column' } },
    })
  })

  test('null values override', () => {
    const target = { layout: { grid: { maxCols: 3 } } }
    const source = { layout: { grid: { maxCols: null } } }
    expect(deepMerge(target, source)).toEqual({
      layout: { grid: { maxCols: null } },
    })
  })

  test('returns the mutated target', () => {
    const target = { a: 1 }
    const result = deepMerge(target, { b: 2 })
    expect(result).toBe(target)
  })

  test('works with DEFAULTS shape', () => {
    const overrides = { layout: { lead: { size: 25 }, grid: { maxCols: 3 } } }
    const result = deepMerge(structuredClone(DEFAULTS), overrides)
    expect(result).toEqual({
      layout: {
        lead: { position: 'left', size: 25 },
        grid: { fill: 'row', maxCols: 3, maxRows: null },
      },
    })
  })
})
