#!/usr/bin/env bun
import { Cli } from 'incur'
import { preflight } from '@/lib/preflight'

// Entity commands
import { teams } from '@/commands/teams'
import { panes } from '@/commands/panes'
import { tasks } from '@/commands/tasks'

// Layout
import { config } from '@/commands/config'

// Meta
import { init } from '@/commands/init'
import { doctor } from '@/commands/doctor'
import { logs } from '@/commands/logs'
import { clean } from '@/commands/clean'

// Commands that require specific preflight checks
const PREFLIGHT: Record<string, string[]> = {
  panes: ['tmux'],
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
  // Entity commands
  .command('teams', teams)
  .command('panes', panes)
  .command('tasks', tasks)
  // Config & meta
  .command('config', config)
  .command('init', init)
  .command('doctor', doctor)
  .command('logs', logs)
  .command('clean', clean)
  .serve()
