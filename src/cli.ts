#!/usr/bin/env bun
import { Cli } from 'incur'

// Orchestration
import { spawn } from '@/commands/orchestration/spawn'
import { kill } from '@/commands/orchestration/kill'
import { status } from '@/commands/orchestration/status'
import { list } from '@/commands/orchestration/list'

// Layout
import { grid } from '@/commands/layout/grid'
import { config } from '@/commands/layout/config'

// Meta
import { init } from '@/commands/init'

Cli.create('cru', {
  description: '◫ Manage tmux layouts for Claude Code agent teams',
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
