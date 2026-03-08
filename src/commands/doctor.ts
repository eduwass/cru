import { z } from 'incur'
import { hasBinary, getVersion, inTmux, detectTerminal } from '@/lib/env'

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

    const tmuxPath = hasBinary('tmux')
    if (!tmuxPath) {
      checks.push({
        name: 'tmux',
        status: 'fail',
        detail: 'not installed',
        fix: process.platform === 'darwin' ? 'brew install tmux' : 'sudo apt install tmux',
      })
    } else {
      checks.push({ name: 'tmux', status: 'ok', detail: getVersion('tmux -V') || 'installed' })
    }

    if (tmuxPath && !inTmux()) {
      checks.push({ name: 'tmux-session', status: 'fail', detail: 'not inside a tmux session', fix: tmuxCmd })
    } else if (tmuxPath) {
      checks.push({ name: 'tmux-session', status: 'ok', detail: 'active' })
    }

    const claudePath = hasBinary('claude')
    if (!claudePath) {
      checks.push({ name: 'claude', status: 'fail', detail: 'not installed', fix: 'npm install -g @anthropic-ai/claude-code' })
    } else {
      checks.push({ name: 'claude', status: 'ok', detail: getVersion('claude --version') || 'installed' })
    }

    const bunPath = hasBinary('bun')
    if (!bunPath) {
      checks.push({ name: 'bun', status: 'fail', detail: 'not installed', fix: 'curl -fsSL https://bun.sh/install | bash' })
    } else {
      checks.push({ name: 'bun', status: 'ok', detail: `v${getVersion('bun --version')}` })
    }

    const ok = checks.every((ch) => ch.status === 'ok')

    return { ok, terminal, tmuxCmd, checks }
  },
}
