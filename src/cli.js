#!/usr/bin/env bun
import { Cli } from 'incur'

// Orchestration
import { spawn } from './commands/orchestration/spawn.js'
import { kill } from './commands/orchestration/kill.js'
import { status } from './commands/orchestration/status.js'
import { list } from './commands/orchestration/list.js'

// Layout
import { grid } from './commands/layout/grid.js'
import { config } from './commands/layout/config.js'

// Meta
import { init } from './commands/init.js'

Cli.create('agent-teams', {
  description: 'Manage tmux layouts for Claude Code agent teams',
  version: '1.0.0',
})
  // Orchestration
  .command('spawn', spawn)
  .command('kill', kill)
  .command('status', status)
  .command('list', list)
  // Layout
  .command('grid', grid)
  .command('config', config)
  // Meta
  .command('init', init)
  .serve()
