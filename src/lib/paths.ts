import { join } from 'node:path'
import { homedir } from 'node:os'

export function teamsDir(): string {
  return join(homedir(), '.claude', 'teams')
}
