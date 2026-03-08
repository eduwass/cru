import { z } from 'incur'
import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { CONFIG_NAME, DEFAULTS, writeConfig } from '@/lib/config'

export const init = {
  description: 'Set up cru in the current project',
  options: z.object({
    force: z.boolean().default(false).describe('Overwrite existing files'),
  }),
  run(c) {
    const cwd = process.cwd()
    const files: Record<string, string> = {}

    // 1. Config file
    const configPath = join(cwd, CONFIG_NAME)
    if (!existsSync(configPath) || c.options.force) {
      writeConfig(configPath, DEFAULTS)
      files[CONFIG_NAME] = 'created'
    } else {
      files[CONFIG_NAME] = 'exists'
    }

    // 2. Install skill to .claude/skills/
    const pkgRoot = dirname(dirname(import.meta.dirname))
    const skillSrc = join(pkgRoot, 'skills', 'cru')
    const skillDest = join(cwd, '.claude', 'skills', 'cru')

    const skillExists = existsSync(join(skillDest, 'SKILL.md'))
    if (!skillExists || c.options.force) {
      mkdirSync(join(cwd, '.claude', 'skills'), { recursive: true })
      cpSync(skillSrc, skillDest, { recursive: true })
      files['.claude/skills/cru/'] = 'installed'
    } else {
      files['.claude/skills/cru/'] = 'exists'
    }

    return { files, tip: 'Use /cru in Claude Code to spawn a team.' }
  },
}
