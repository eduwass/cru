#!/usr/bin/env bun
import { Cli } from 'incur'
import { preflight } from '@/lib/preflight'

// Orchestration
import { spawn } from '@/commands/orchestration/spawn'
import { close } from '@/commands/orchestration/close'
import { status } from '@/commands/orchestration/status'
import { list } from '@/commands/orchestration/list'

// Layout
import { grid } from '@/commands/layout/grid'
import { config } from '@/commands/layout/config'

// Meta
import { init } from '@/commands/init'
import { doctor } from '@/commands/doctor'
import { logs } from '@/commands/logs'
import { tasks } from '@/commands/tasks'
import { clean } from '@/commands/clean'

// Commands that require specific preflight checks
const PREFLIGHT: Record<string, string[]> = {
  spawn: ['terminal', 'tmux-session', 'claude'],
  close: ['tmux'],
  grid: ['tmux-session'],
}

Cli.create('cru', {
  description: '◫ Manage tmux layouts for Claude Code agent teams',
  version: '1.0.0',
})
  .use(async (c, next) => {
    const checks = PREFLIGHT[c.command]
    if (checks) {
      const result = preflight(...checks)
      if (!result.ok) {
        const e = result.errors[0]
        return c.error({ code: e.check.toUpperCase(), message: e.message })
      }
    }
    await next()
  })
  // Orchestration
  .command('spawn', spawn)
  .command('close', close)
  .command('status', status)
  .command('list', list)
  // Layout
  .command('grid', grid)
  .command('config', config)
  // Meta
  .command('init', init)
  .command('doctor', doctor)
  .command('logs', logs)
  .command('tasks', tasks)
  .command('clean', clean)
  .serve()
