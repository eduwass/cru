/**
 * Shared e2e test helpers — polling, tmux utils, snapshots.
 * Terminal-agnostic; works with both iTerm2 and Ghostty test suites.
 */
import { $ } from 'bun'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pane {
  id: string
  index: number
  width: number
  height: number
  pid: number
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

export interface PollOptions {
  timeout?: number
  interval?: number
  label?: string
}

export async function poll<T>(
  fn: () => Promise<T>,
  opts: PollOptions = {},
): Promise<NonNullable<T>> {
  const { timeout = 30_000, interval = 1_000, label = 'condition' } = opts
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const result = await fn()
    if (result) return result as NonNullable<T>
    await Bun.sleep(interval)
  }

  throw new Error(`poll timed out waiting for: ${label}`)
}

// ---------------------------------------------------------------------------
// tmux helpers
// ---------------------------------------------------------------------------

export async function listPanes(target: string): Promise<Pane[]> {
  const out = await $`tmux list-panes -t ${target} -F '#{pane_id} #{pane_index} #{pane_width} #{pane_height} #{pane_pid}'`
    .text()

  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id, index, width, height, pid] = line.split(' ')
      return { id, index: Number(index), width: Number(width), height: Number(height), pid: Number(pid) }
    })
}

export async function paneCount(target: string): Promise<number> {
  return (await listPanes(target)).length
}

export async function waitForPanes(target: string, expected: number, opts: PollOptions = {}): Promise<Pane[]> {
  return poll(
    async () => {
      const panes = await listPanes(target).catch(() => [])
      return panes.length === expected ? panes : null
    },
    { ...opts, label: `${expected} panes in ${target}` },
  )
}

export async function captureTmuxPane(paneId: string): Promise<string> {
  return $`tmux capture-pane -t ${paneId} -p -S -500 -J`.nothrow().text()
}

// ---------------------------------------------------------------------------
// Debugging / snapshots
// ---------------------------------------------------------------------------

export async function saveDebugSnapshot(
  label: string,
  runDir?: string,
  opts?: { screenshotFn?: (path: string) => Promise<void>; tmuxWindow?: string },
): Promise<string> {
  const dir = runDir ?? `${import.meta.dir}/../artifacts`
  const prefix = runDir ? `${dir}/${label}` : `${dir}/${label}-${Date.now()}`

  await $`mkdir -p ${dir}`.quiet()

  // Screenshot (terminal-specific, optional)
  if (opts?.screenshotFn) {
    await opts.screenshotFn(`${prefix}.png`)
  }

  // Text capture of tmux panes (if tmuxWindow provided)
  if (opts?.tmuxWindow) {
    const paneList = await $`tmux list-panes -t ${opts.tmuxWindow} -F '#{pane_id} #{pane_index} #{pane_width} #{pane_height}'`
      .nothrow()
      .text()

    const captures: string[] = []
    for (const line of paneList.trim().split('\n').filter(Boolean)) {
      const [paneId, index, width, height] = line.split(' ')
      const content = await captureTmuxPane(paneId)
      captures.push(`=== Pane ${index} (${paneId}) ${width}x${height} ===\n${content}`)
    }
    await Bun.write(`${prefix}-panes.txt`, captures.join('\n\n'))
  }

  console.log(`  [debug] ${prefix}`)
  return prefix
}

export async function saveLogs(label: string, runDir?: string, teamName?: string): Promise<string> {
  const dir = runDir ?? `${import.meta.dir}/../artifacts`
  const prefix = runDir ? `${dir}/${label}` : `${dir}/${label}-${Date.now()}`

  await $`mkdir -p ${dir}`.quiet()

  const teamArg = teamName ?? ''
  const logsOutput = await $`bun src/cli.ts logs ${teamArg} --full`.nothrow().text()
  const clean = logsOutput.replace(/\x1b\[[0-9;]*m/g, '')

  await Bun.write(`${prefix}-logs.txt`, clean)
  console.log(`  [logs] ${prefix}-logs.txt`)

  if (teamName) {
    const teamDir = `${process.env.HOME}/.claude/teams/${teamName}`
    const destDir = `${dir}/${label}-team-data`
    await $`cp -r ${teamDir} ${destDir}`.nothrow().quiet()
  }

  return `${prefix}-logs.txt`
}

export function createRunDir(testName: string): string {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  return `${import.meta.dir}/../artifacts/${ts}-${testName}`
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function closeTeam(teamName: string): Promise<void> {
  await $`bun src/cli.ts panes close ${teamName}`.nothrow().quiet()
}

export async function isRunningClaude(pane: Pane): Promise<boolean> {
  const result = await $`ps -o comm= -p ${pane.pid}`.nothrow().text()
  return result.includes('claude')
}
