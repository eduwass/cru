import { z } from 'incur'
import { execSync } from 'node:child_process'

function hasBinary(name: string): string | null {
  try {
    return execSync(`which ${name}`, { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

function getVersion(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

function detectTerminal(): string {
  if (process.env.ITERM_SESSION_ID) return 'iterm2'
  if (process.env.TERM_PROGRAM === 'iTerm.app') return 'iterm2'
  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return 'terminal'
  if (process.env.TERM_PROGRAM === 'WezTerm') return 'wezterm'
  if (process.env.TERM_PROGRAM === 'Alacritty') return 'alacritty'
  if (process.env.WT_SESSION) return 'windows-terminal'
  return process.env.TERM_PROGRAM || 'unknown'
}

function inTmux(): boolean {
  return !!process.env.TMUX
}

export const doctor = {
  description: 'Check environment requirements for cru',
  args: z.object({}),
  options: z.object({
    json: z.boolean().default(false).describe('Output as JSON'),
  }),
  run(c) {
    const terminal = detectTerminal()
    const tmuxCmd = terminal === 'iterm2' ? 'tmux -CC' : 'tmux'

    const checks: Array<{
      name: string
      status: 'ok' | 'fail'
      detail: string
      fix?: string
    }> = []

    // 1. tmux installed
    const tmuxPath = hasBinary('tmux')
    if (!tmuxPath) {
      checks.push({
        name: 'tmux',
        status: 'fail',
        detail: 'not installed',
        fix: process.platform === 'darwin'
          ? 'brew install tmux'
          : 'sudo apt install tmux',
      })
    } else {
      checks.push({ name: 'tmux', status: 'ok', detail: getVersion('tmux -V') || 'installed' })
    }

    // 2. Inside a tmux session
    if (tmuxPath && !inTmux()) {
      checks.push({
        name: 'tmux-session',
        status: 'fail',
        detail: 'not inside a tmux session',
        fix: tmuxCmd,
      })
    } else if (tmuxPath) {
      checks.push({ name: 'tmux-session', status: 'ok', detail: 'active' })
    }

    // 3. claude CLI
    const claudePath = hasBinary('claude')
    if (!claudePath) {
      checks.push({
        name: 'claude',
        status: 'fail',
        detail: 'not installed',
        fix: 'npm install -g @anthropic-ai/claude-code',
      })
    } else {
      checks.push({ name: 'claude', status: 'ok', detail: getVersion('claude --version') || 'installed' })
    }

    // 4. bun
    const bunPath = hasBinary('bun')
    if (!bunPath) {
      checks.push({
        name: 'bun',
        status: 'fail',
        detail: 'not installed',
        fix: 'curl -fsSL https://bun.sh/install | bash',
      })
    } else {
      checks.push({ name: 'bun', status: 'ok', detail: `v${getVersion('bun --version')}` })
    }

    const ok = checks.every((ch) => ch.status === 'ok')

    if (c.options.json) {
      return { ok, terminal, tmuxCmd, checks }
    }

    return {
      status: ok ? 'READY' : 'NOT READY',
      checks: checks.map((ch) => ({
        [`${ch.status === 'ok' ? '✓' : '✗'} ${ch.name}`]: ch.detail,
        ...(ch.fix ? { fix: ch.fix } : {}),
      })),
    }
  },
}
