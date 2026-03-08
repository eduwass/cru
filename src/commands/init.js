import { z } from 'incur'
import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { CONFIG_NAME, DEFAULTS, writeConfig } from '../lib/config.js'

export const init = {
  description: 'Set up agent-teams in the current project',
  options: z.object({
    force: z.boolean().default(false).describe('Overwrite existing files'),
  }),
  run(c) {
    const cwd = process.cwd()
    const results = []

    // 1. Config file
    const configPath = join(cwd, CONFIG_NAME)
    if (!existsSync(configPath) || c.options.force) {
      writeConfig(configPath, DEFAULTS)
      results.push({ file: CONFIG_NAME, status: 'created' })
    } else {
      results.push({ file: CONFIG_NAME, status: 'exists (use --force to overwrite)' })
    }

    // 2. Install skill to .claude/skills/
    // src/commands/ → src/ → package root
    const pkgRoot = dirname(dirname(import.meta.dirname))
    const skillSrc = join(pkgRoot, 'skills', 'spawn-team')
    const skillDest = join(cwd, '.claude', 'skills', 'spawn-team')

    if (!existsSync(skillDest) || c.options.force) {
      mkdirSync(join(cwd, '.claude', 'skills'), { recursive: true })
      cpSync(skillSrc, skillDest, { recursive: true })
      results.push({ file: '.claude/skills/spawn-team/', status: 'installed' })
    } else {
      results.push({ file: '.claude/skills/spawn-team/', status: 'exists (use --force to overwrite)' })
    }

    return {
      done: true,
      files: results,
      next_steps: [
        'agent-teams spawn <team> -n 4  — spawn workers',
        'agent-teams grid <team>        — re-apply layout',
        '/spawn-team 4 <task>           — via Claude Code skill',
      ],
    }
  },
}
