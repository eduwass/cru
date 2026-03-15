import { existsSync } from 'node:fs'
import { configPaths, loadConfig } from '../lib/config'

export const config = {
  description: 'Show resolved config (merged defaults + overrides)',
  run() {
    const conf = loadConfig()
    const loaded = configPaths().find((p) => existsSync(p)) || 'defaults'
    return { source: loaded, config: conf }
  },
}
