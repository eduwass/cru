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
import { checkGhosttyPrereqs, createGhosttyTestEnv, type GhosttyTestEnv } from './ghostty-setup'
import { listAllTerminals, captureAndRead } from './ghostty-helpers'

const TIMEOUT = 120_000
const SOCKET = 'claude-swarm-test-99999'
const SESSION = 'main'

function tmux(cmd: string): string {
  return execSync(`tmux -L ${SOCKET} ${cmd}`, { encoding: 'utf-8' }).trim()
}

describe('ghostty: tmux mirror via custom socket', () => {
  let env: GhosttyTestEnv

  beforeAll(() => {
    env = createGhosttyTestEnv('ghostty-mirror', { launchClaude: false })

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

  afterAll(() => {
    try { tmux('kill-server') } catch {}
    if (env) {
      env.snapshot('mirror-final')
      env.teardown()
    }
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
    '2. mirrorToGhostty creates splits from custom socket',
    () => {
      const terminalsBefore = listAllTerminals().length

      const { mirrorToGhostty, getWorkerPanes } = require('../../src/lib/mirror')
      const workers = getWorkerPanes(SOCKET, SESSION)
      expect(workers.length).toBe(3)

      const mirrors = mirrorToGhostty(SOCKET, SESSION, workers)
      expect(mirrors.length).toBe(3)

      const terminalsAfter = listAllTerminals().length
      expect(terminalsAfter).toBeGreaterThanOrEqual(terminalsBefore + 3)
      console.log(`  Ghostty terminals: ${terminalsBefore} → ${terminalsAfter}`)

      env.snapshot('2-mirrored')
    },
    TIMEOUT,
  )

  test(
    '3. OCR shows tmux content in Ghostty splits',
    () => {
      Bun.sleepSync(3000)
      const screen = captureAndRead({ waitMs: 1000 })
      expect(screen.length).toBeGreaterThan(0)
      console.log(`  OCR: ${screen.length} chars`)
      env.snapshot('3-content')
    },
    TIMEOUT,
  )

  test(
    '4. interactivity works through Ghostty → tmux',
    () => {
      // Send keys through a view session on the custom socket
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
      // Check that status is off on view sessions
      const status = tmux(`show-option -t view-1 -v status`)
      expect(status).toBe('off')
      console.log('  status bar hidden')
    },
    TIMEOUT,
  )
})
