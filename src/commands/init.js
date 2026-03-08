import { z } from 'incur'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { CONFIG_NAME, DEFAULTS, writeConfig } from '../lib/config.js'

export const init = {
  description: 'Create a config file with defaults',
  options: z.object({
    global: z.boolean().default(false).describe('Write to ~/.config instead of project'),
  }),
  run(c) {
    const target = c.options.global
      ? join(homedir(), '.config', 'agent-teams', 'config.json')
      : join(process.cwd(), CONFIG_NAME)

    if (existsSync(target)) {
      return { exists: true, path: target, message: 'Config already exists' }
    }

    writeConfig(target, DEFAULTS)
    return { created: true, path: target }
  },
}
