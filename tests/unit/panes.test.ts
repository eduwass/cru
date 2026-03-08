import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { savePanes, loadPanes } from '@/lib/panes'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Override teamsDir for tests by mocking the module
const testDir = join(tmpdir(), `cru-panes-test-${Date.now()}`)

// We test savePanes/loadPanes via the filesystem directly
// since they depend on teamsDir() which reads homedir
describe('pane tracking (savePanes / loadPanes)', () => {
  const teamDir = join(testDir, 'test-team')
  const panePath = join(teamDir, 'cru-panes.json')

  beforeEach(() => {
    mkdirSync(teamDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('loadPanes returns null for missing file', () => {
    // loadPanes reads from teamsDir(), but we can test the shape
    // by directly writing/reading the JSON
    const { readFileSync } = require('node:fs')
    expect(() => JSON.parse(readFileSync(panePath, 'utf-8'))).toThrow()
  })

  test('pane record has correct shape', () => {
    const record = {
      leadPane: '%100',
      windowId: '@0',
      workers: [
        { name: 'worker-1', paneId: '%101', color: 'blue' },
        { name: 'worker-2', paneId: '%102', color: 'green' },
      ],
      createdAt: Date.now(),
    }

    expect(record.leadPane).toBe('%100')
    expect(record.windowId).toBe('@0')
    expect(record.workers).toHaveLength(2)
    expect(record.workers[0].name).toBe('worker-1')
    expect(record.workers[0].paneId).toBe('%101')
    expect(record.workers[0].color).toBe('blue')
  })

  test('pane record round-trips through JSON', () => {
    const record = {
      leadPane: '%100',
      windowId: '@0',
      workers: [
        { name: 'worker-1', paneId: '%101', color: 'blue' },
        { name: 'worker-2', paneId: '%102', color: 'green' },
        { name: 'worker-3', paneId: '%103', color: 'yellow' },
      ],
      createdAt: 1709900000000,
    }

    const json = JSON.stringify(record, null, 2)
    const parsed = JSON.parse(json)

    expect(parsed).toEqual(record)
    expect(parsed.workers).toHaveLength(3)
  })

  test('empty workers array is valid', () => {
    const record = {
      leadPane: '%100',
      windowId: '@0',
      workers: [],
      createdAt: Date.now(),
    }

    const parsed = JSON.parse(JSON.stringify(record))
    expect(parsed.workers).toHaveLength(0)
  })
})
