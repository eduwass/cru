import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const CONFIG_NAME = '.agent-teams.json'

export const DEFAULTS = {
  layout: {
    lead: { position: 'left', size: 40 },
    grid: { fill: 'row', maxCols: null, maxRows: null },
  },
}

export function configPaths() {
  return [
    join(process.cwd(), CONFIG_NAME),
    join(homedir(), '.config', 'agent-teams', 'config.json'),
  ]
}

export function loadConfig() {
  for (const p of configPaths()) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'))
        return deepMerge(structuredClone(DEFAULTS), raw)
      } catch {
        // malformed — fall through
      }
    }
  }
  return structuredClone(DEFAULTS)
}

export function writeConfig(path, config) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}
