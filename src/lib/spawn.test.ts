import { describe, test, expect, mock } from 'bun:test'
import { buildClaudeCmd } from './spawn'

const COLORS = ['blue', 'green', 'yellow', 'red', 'magenta', 'cyan']

describe('buildClaudeCmd', () => {
  const base = {
    name: 'worker-1',
    teamName: 'my-team',
    color: 'blue',
    parentSessionId: 'abc123',
    cwd: undefined,
  }

  test('includes agent ID as name@team', () => {
    const cmd = buildClaudeCmd(base)
    expect(cmd).toContain('--agent-id worker-1@my-team')
  })

  test('includes agent name', () => {
    const cmd = buildClaudeCmd(base)
    expect(cmd).toContain('--agent-name worker-1')
  })

  test('includes team name', () => {
    const cmd = buildClaudeCmd(base)
    expect(cmd).toContain('--team-name my-team')
  })

  test('includes color', () => {
    const cmd = buildClaudeCmd(base)
    expect(cmd).toContain('--agent-color blue')
  })

  test('includes parent session ID', () => {
    const cmd = buildClaudeCmd(base)
    expect(cmd).toContain('--parent-session-id abc123')
  })

  test('includes agent type', () => {
    const cmd = buildClaudeCmd(base)
    expect(cmd).toContain('--agent-type general-purpose')
  })

  test('starts with claude (no cd) when no cwd', () => {
    const cmd = buildClaudeCmd(base)
    expect(cmd.startsWith('claude ')).toBe(true)
  })

  test('prepends cd when cwd is set', () => {
    const cmd = buildClaudeCmd({ ...base, cwd: '/some/path' })
    expect(cmd.startsWith('cd "/some/path" && claude ')).toBe(true)
  })

  test('quotes cwd with spaces', () => {
    const cmd = buildClaudeCmd({ ...base, cwd: '/some path/here' })
    expect(cmd).toContain('cd "/some path/here"')
  })
})

describe('color cycling', () => {
  test('cycles through 6 colors', () => {
    for (let i = 0; i < 12; i++) {
      expect(COLORS[i % COLORS.length]).toBe(COLORS[i % 6])
    }
  })

  test('7th worker wraps to first color', () => {
    expect(COLORS[6 % COLORS.length]).toBe('blue')
  })
})
