#!/usr/bin/env node
import { Cli } from 'incur'
import { init } from './commands/init.js'
import { config } from './commands/config.js'
import { grid } from './commands/grid.js'
import { status } from './commands/status.js'
import { list } from './commands/list.js'

Cli.create('agent-teams', {
  description: 'Manage tmux layouts for Claude Code agent teams',
  version: '1.0.0',
})
  .command('init', init)
  .command('config', config)
  .command('grid', grid)
  .command('status', status)
  .command('list', list)
  .serve()
