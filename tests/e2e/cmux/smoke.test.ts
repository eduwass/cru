/**
 * cmux smoke test — verify the e2e test harness works.
 *
 * Tests basic cmux CLI interaction without Claude.
 * Must be run from inside a cmux terminal.
 *
 * Run: bun test tests/e2e/cmux/smoke.test.ts
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import {
  cmux, isCmuxAvailable, currentSurface, sendLine,
  listSurfaceIds, readScreen, splitSurface, closeSurface, renameSurface,
} from '../../helpers/cmux'

describe('cmux smoke', () => {
  const createdSurfaces: string[] = []
  let mySurface: string

  beforeAll(() => {
    if (!process.env.CMUX_WORKSPACE_ID) {
      throw new Error('Not inside a cmux terminal. Run this test from cmux.')
    }
    if (!isCmuxAvailable()) {
      throw new Error('cmux socket is not responding.')
    }
    mySurface = currentSurface()
    console.log(`  caller surface: ${mySurface}`)
  })

  afterAll(() => {
    for (const id of createdSurfaces) {
      closeSurface(id)
    }
  })

  test('cmux is available and responding', () => {
    expect(isCmuxAvailable()).toBe(true)
  })

  test('can identify current workspace and surface', () => {
    const info = JSON.parse(cmux('identify'))
    // caller may be null if env vars are stale; fall back to focused
    const ctx = info.caller || info.focused
    expect(ctx).toBeDefined()
    expect(ctx.workspace_ref).toMatch(/^workspace:\d+$/)
    expect(ctx.surface_ref).toMatch(/^surface:\d+$/)
    expect(ctx.surface_ref).toBe(mySurface)
    console.log(`  workspace: ${ctx.workspace_ref}, surface: ${ctx.surface_ref}`)
  })

  test('can list surfaces', () => {
    const surfaces = listSurfaceIds()
    expect(surfaces.length).toBeGreaterThanOrEqual(1)
    expect(surfaces).toContain(mySurface)
    console.log(`  surfaces: ${surfaces.join(', ')}`)
  })

  test('split returns surface ref directly from output', () => {
    const newSurface = splitSurface('right')
    createdSurfaces.push(newSurface)
    expect(newSurface).toMatch(/^surface:\d+$/)
    expect(newSurface).not.toBe(mySurface)

    Bun.sleepSync(300)
    const surfaces = listSurfaceIds()
    expect(surfaces).toContain(newSurface)
    expect(surfaces).toContain(mySurface)
    console.log(`  split created: ${newSurface}`)

    // Clean up
    closeSurface(newSurface)
    createdSurfaces.pop()
    Bun.sleepSync(300)
    expect(listSurfaceIds()).not.toContain(newSurface)
  })

  test('close never kills the caller surface', () => {
    // Create a worker, close it, verify caller still exists
    const worker = splitSurface('right')
    createdSurfaces.push(worker)
    Bun.sleepSync(300)

    closeSurface(worker)
    createdSurfaces.pop()
    Bun.sleepSync(300)

    // Caller surface must still be alive
    const surfaces = listSurfaceIds()
    expect(surfaces).toContain(mySurface)
    console.log(`  after close: caller ${mySurface} still alive`)
  })

  test('can rename surfaces for identification', () => {
    const worker = splitSurface('right')
    createdSurfaces.push(worker)
    Bun.sleepSync(300)

    renameSurface(worker, 'test-worker-1')
    const panels = cmux('list-panels')
    expect(panels).toContain('test-worker-1')
    console.log(`  renamed ${worker} → "test-worker-1"`)

    closeSurface(worker)
    createdSurfaces.pop()
  })

  test('can send text and verify via file output', async () => {
    const worker = splitSurface('right')
    createdSurfaces.push(worker)
    await Bun.sleep(500)

    const marker = `/tmp/cru-e2e-cmux-smoke-${Date.now()}.txt`
    sendLine(worker, `echo CMUX_SMOKE_OK > ${marker}`)
    await Bun.sleep(1000)

    expect(existsSync(marker)).toBe(true)
    const content = readFileSync(marker, 'utf-8').trim()
    expect(content).toBe('CMUX_SMOKE_OK')
    unlinkSync(marker)

    closeSurface(worker)
    createdSurfaces.pop()
  })

  test('can read screen content', async () => {
    const worker = splitSurface('right')
    createdSurfaces.push(worker)
    await Bun.sleep(500)

    sendLine(worker, 'echo CMUX_READ_TEST_12345')
    await Bun.sleep(500)

    const content = readScreen(worker, 10)
    expect(content).toContain('CMUX_READ_TEST_12345')

    closeSurface(worker)
    createdSurfaces.pop()
  })

  test('can create multiple splits (grid-style)', async () => {
    const before = listSurfaceIds()

    const s1 = splitSurface('right')
    createdSurfaces.push(s1)
    renameSurface(s1, 'grid-col-1')
    await Bun.sleep(200)

    const s2 = splitSurface('down')
    createdSurfaces.push(s2)
    renameSurface(s2, 'grid-col-2')
    await Bun.sleep(200)

    const afterSplits = listSurfaceIds()
    expect(afterSplits.length).toBe(before.length + 2)
    // Caller still intact
    expect(afterSplits).toContain(mySurface)
    console.log(`  grid: ${before.length} → ${afterSplits.length}`)

    // Verify names show up
    const panels = cmux('list-panels')
    expect(panels).toContain('grid-col-1')
    expect(panels).toContain('grid-col-2')

    closeSurface(s2)
    createdSurfaces.pop()
    await Bun.sleep(200)
    closeSurface(s1)
    createdSurfaces.pop()
  })

  test('cru doctor detects cmux', { timeout: 30_000 }, () => {
    const { execFileSync } = require('node:child_process')
    const output = execFileSync('bun', ['src/cli.ts', 'doctor', '--json'], {
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env },
    })
    expect(output).toContain('"ok": true')
    expect(output).toContain('cmux')
  })
})
