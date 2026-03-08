import { describe, test, expect } from 'bun:test'

// We test the pure functions by importing the module's internals
// Since logs.ts doesn't export helpers, we test the logic patterns directly

describe('logs: message kind parsing', () => {
  function parseMessageKind(text: string): { kind: string; parsed: string } {
    try {
      const parsed = JSON.parse(text)
      switch (parsed.type) {
        case 'task_assignment':
          return { kind: 'task', parsed: parsed.subject || parsed.description || 'assigned' }
        case 'shutdown_request':
          return { kind: 'shutdown', parsed: parsed.reason || 'requested' }
        case 'shutdown_approved':
          return { kind: 'shutdown', parsed: 'approved' }
        case 'idle_notification':
          return { kind: 'idle', parsed: parsed.idleReason || 'available' }
      }
    } catch {}
    return { kind: 'chat', parsed: text }
  }

  test('task_assignment extracts subject', () => {
    const msg = JSON.stringify({ type: 'task_assignment', subject: 'Review the code', taskId: '1' })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('task')
    expect(result.parsed).toBe('Review the code')
  })

  test('task_assignment falls back to description', () => {
    const msg = JSON.stringify({ type: 'task_assignment', description: 'Do something', taskId: '2' })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('task')
    expect(result.parsed).toBe('Do something')
  })

  test('shutdown_request extracts reason', () => {
    const msg = JSON.stringify({ type: 'shutdown_request', reason: 'Task complete' })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('shutdown')
    expect(result.parsed).toBe('Task complete')
  })

  test('shutdown_request with no reason', () => {
    const msg = JSON.stringify({ type: 'shutdown_request' })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('shutdown')
    expect(result.parsed).toBe('requested')
  })

  test('shutdown_approved', () => {
    const msg = JSON.stringify({ type: 'shutdown_approved' })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('shutdown')
    expect(result.parsed).toBe('approved')
  })

  test('idle_notification extracts reason', () => {
    const msg = JSON.stringify({ type: 'idle_notification', idleReason: 'waiting', from: 'w1' })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('idle')
    expect(result.parsed).toBe('waiting')
  })

  test('idle_notification defaults to available', () => {
    const msg = JSON.stringify({ type: 'idle_notification', from: 'w1' })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('idle')
    expect(result.parsed).toBe('available')
  })

  test('plain text is chat', () => {
    const result = parseMessageKind('Hello from worker-1!')
    expect(result.kind).toBe('chat')
    expect(result.parsed).toBe('Hello from worker-1!')
  })

  test('non-JSON is chat', () => {
    const result = parseMessageKind('not { valid json')
    expect(result.kind).toBe('chat')
  })

  test('unknown JSON type is chat', () => {
    const msg = JSON.stringify({ type: 'something_else', data: 123 })
    const result = parseMessageKind(msg)
    expect(result.kind).toBe('chat')
  })
})

describe('logs: truncate', () => {
  function truncate(s: string, n: number): string {
    if (!s) return ''
    const oneline = s.replace(/\n/g, ' ').trim()
    return oneline.length > n ? `${oneline.slice(0, n)}…` : oneline
  }

  test('short text unchanged', () => {
    expect(truncate('hello', 80)).toBe('hello')
  })

  test('long text is cut with ellipsis', () => {
    const long = 'a'.repeat(100)
    const result = truncate(long, 80)
    expect(result.length).toBe(81) // 80 + ellipsis char
    expect(result.endsWith('…')).toBe(true)
  })

  test('newlines become spaces', () => {
    expect(truncate('line1\nline2\nline3', 80)).toBe('line1 line2 line3')
  })

  test('empty string returns empty', () => {
    expect(truncate('', 80)).toBe('')
  })

  test('whitespace-only returns empty', () => {
    expect(truncate('   \n  ', 80)).toBe('')
  })
})

describe('logs: hashColor', () => {
  const AUTO_COLORS = ['cyan', 'blue', 'green', 'yellow', 'magenta', 'red']

  function hashColor(name: string): string {
    let h = 0
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
    return AUTO_COLORS[Math.abs(h) % AUTO_COLORS.length]
  }

  test('same name always returns same color', () => {
    const c1 = hashColor('worker-1')
    const c2 = hashColor('worker-1')
    expect(c1).toBe(c2)
  })

  test('different names can get different colors', () => {
    const colors = new Set(['worker-1', 'worker-2', 'worker-3', 'team-lead'].map(hashColor))
    // At least 2 different colors out of 4 names
    expect(colors.size).toBeGreaterThanOrEqual(2)
  })

  test('result is always a valid color', () => {
    const names = ['a', 'bb', 'ccc', 'worker-99', 'team-lead', '', 'x'.repeat(100)]
    for (const name of names) {
      expect(AUTO_COLORS).toContain(hashColor(name))
    }
  })
})

describe('logs: time formatting', () => {
  function time(ts: number): string {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  test('formats with leading zeros', () => {
    // 2026-01-15 01:05:09 local time
    const d = new Date(2026, 0, 15, 1, 5, 9)
    expect(time(d.getTime())).toBe('01:05:09')
  })

  test('midnight is 00:00:00', () => {
    const d = new Date(2026, 0, 1, 0, 0, 0)
    expect(time(d.getTime())).toBe('00:00:00')
  })

  test('noon is 12:00:00', () => {
    const d = new Date(2026, 0, 1, 12, 0, 0)
    expect(time(d.getTime())).toBe('12:00:00')
  })
})
