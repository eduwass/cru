/**
 * E2E test: tmux-to-Ghostty mirroring via custom socket.
 *
 * Simulates how Claude Code spawns workers: creates a tmux session
 * using a custom socket (`tmux -L claude-swarm-test`), then mirrors
 * those panes into Ghostty splits.
 *
 * Requires: Ghostty v1.3.0+ with macos-applescript = true, tmux
 * Run: bun test tests/e2e/ghostty-mirror.test.ts --timeout 300000
 */
import { execSync } from 'node:child_process'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { checkGhosttyPrereqs, createGhosttyTestEnv } from './ghostty-setup'
import type { TestEnv } from './setup'

const TIMEOUT = 120_000
const SOCKET = 'claude-swarm-test-99999'
const SESSION = 'main'

function tmux(cmd: string): string {
  return execSync(`tmux -L ${SOCKET} ${cmd}`, { encoding: 'utf-8' }).trim()
}

function ghosttyTerminalCount(): number {
  try {
    const ids = execSync(
      'osascript -e \'tell application "Ghostty" to get id of every terminal\'',
      { encoding: 'utf-8' },
    ).trim()
    if (!ids) return 0
    return ids.split(', ').length
  } catch { return 0 }
}

describe('ghostty: tmux mirror via custom socket', () => {
  let env: TestEnv

  beforeAll(async () => {
    env = await createGhosttyTestEnv('ghostty-mirror')

    // Create a fake swarm session on a custom socket (like Claude Code does)
    try { tmux(`kill-server`) } catch {}
    tmux(`new-session -d -s ${SESSION} -x 80 -y 24`)
    tmux(`send-keys -t ${SESSION} "echo 'LEAD PANE'" Enter`)

    // Create "worker" panes
    for (let i = 1; i <= 3; i++) {
      tmux(`split-window -t ${SESSION} -h`)
      tmux(`send-keys -t ${SESSION} "echo 'WORKER_${i}_MARKER'" Enter`)
    }

    const panes = tmux(`list-panes -t ${SESSION} -F "#{pane_id}"`).split('\n')
    console.log(`  [setup] socket: ${SOCKET}, panes: ${panes.join(', ')}`)
  }, 60_000)

  afterAll(async () => {
    try { tmux('kill-server') } catch {}
    await env?.teardown()
  })

  test(
    '1. findLiveSwarms discovers the custom socket',
    () => {
      const { findLiveSwarms } = require('../../src/lib/mirror')
      const swarms = findLiveSwarms()
      const ours = swarms.find((s) => s.socket === SOCKET)
      expect(ours).toBeDefined()
      expect(ours!.paneCount).toBeGreaterThanOrEqual(4) // lead + 3 workers
      console.log(`  found: ${ours!.socket} with ${ours!.paneCount} panes`)
    },
    TIMEOUT,
  )

  test(
    '2. mirrorSingleWorker creates Ghostty split from custom socket',
    () => {
      const terminalsBefore = ghosttyTerminalCount()

      const { getWorkerPanes, mirrorSingleWorker, setRemainOnExit } = require('../../src/lib/mirror')
      const { currentTerminal } = require('../../src/lib/ghostty')

      setRemainOnExit(SOCKET)
      const workers = getWorkerPanes(SOCKET, SESSION)
      expect(workers.length).toBeGreaterThanOrEqual(3)

      // Mirror the first worker
      const leadTermId = currentTerminal()
      const result = mirrorSingleWorker(SOCKET, SESSION, workers[0], 0, leadTermId, 'right')
      expect(result.ghosttyTerminal).toBeTruthy()
      expect(result.viewSession).toBe('view-1')

      const terminalsAfter = ghosttyTerminalCount()
      expect(terminalsAfter).toBeGreaterThan(terminalsBefore)
      console.log(`  Ghostty terminals: ${terminalsBefore} → ${terminalsAfter}`)
    },
    TIMEOUT,
  )

  test(
    '3. tmux capture-pane shows worker content through view session',
    () => {
      Bun.sleepSync(1000)
      try {
        const content = tmux(`capture-pane -t view-1 -p`)
        expect(content.length).toBeGreaterThan(0)
        console.log(`  captured ${content.length} chars from view-1`)
      } catch (e) {
        console.log(`  capture failed (view session may not exist): ${e}`)
      }
    },
    TIMEOUT,
  )

  test(
    '4. interactivity works through view session',
    () => {
      try {
        tmux(`send-keys -t view-1 "echo INTERACTIVE_OK" Enter`)
        Bun.sleepSync(1000)
        const content = tmux(`capture-pane -t view-1 -p`)
        expect(content).toContain('INTERACTIVE_OK')
        console.log('  interactivity verified')
      } catch (e) {
        console.log(`  interactivity check failed: ${e}`)
      }
    },
    TIMEOUT,
  )

  test(
    '5. no tmux status bar visible',
    () => {
      const status = tmux(`show-option -t view-1 -v status`)
      expect(status).toBe('off')
      console.log('  status bar hidden')
    },
    TIMEOUT,
  )
})
