import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { LayoutConf } from './tmux'

export const CONFIG_NAME = '.cru.json'

export interface CruConfig {
  layout: LayoutConf
}

export const DEFAULTS: CruConfig = {
  layout: {
    lead: { position: 'left', size: 40 },
    grid: { fill: 'row', maxCols: null, maxRows: null },
  },
}

export function configPaths(): string[] {
  return [
    join(process.cwd(), CONFIG_NAME),
    join(homedir(), '.config', 'cru', 'config.json'),
  ]
}

export function loadConfig(): CruConfig {
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

export function writeConfig(path: string, config: CruConfig): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
}

export function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
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
      ;(target as any)[key] = source[key]
    }
  }
  return target
}
