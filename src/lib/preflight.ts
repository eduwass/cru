import { hasBinary, inTmux, detectTerminal } from '@/lib/env'

const INSTALL_HINTS = {
  tmux: {
    darwin: 'brew install tmux',
    linux: 'sudo apt install tmux  # or your package manager',
    fallback: 'https://github.com/tmux/tmux/wiki/Installing',
  },
  claude: {
    all: 'npm install -g @anthropic-ai/claude-code',
    docs: 'https://docs.anthropic.com/en/docs/claude-code',
  },
}

function platformHint(tool) {
  const hints = INSTALL_HINTS[tool]
  if (!hints) return ''
  if (hints.all) return hints.all
  const platform = process.platform
  return hints[platform] || hints.fallback || ''
}

/**
 * Run preflight checks. Returns { ok, errors, terminal }.
 * Checks available: 'tmux', 'tmux-session', 'claude'
 */
export function preflight(...checks) {
  const terminal = detectTerminal()
  const tmuxCmd = terminal === 'iterm2' ? 'tmux -CC' : 'tmux'
  const errors = []

  for (const check of checks) {
    switch (check) {
      case 'tmux':
        if (!hasBinary('tmux')) {
          errors.push({ check: 'tmux', message: 'tmux is not installed', hint: platformHint('tmux') })
        }
        break

      case 'tmux-session':
        if (!hasBinary('tmux')) {
          errors.push({ check: 'tmux', message: 'tmux is not installed', hint: platformHint('tmux') })
        } else if (!inTmux()) {
          errors.push({ check: 'tmux-session', message: 'Not inside a tmux session', hint: tmuxCmd })
        }
        break

      case 'claude':
        if (!hasBinary('claude')) {
          errors.push({ check: 'claude', message: 'Claude Code CLI is not installed', hint: platformHint('claude') })
        }
        break

      case 'terminal':
        if (terminal === 'vscode') {
          errors.push({
            check: 'terminal',
            message: 'VS Code terminal cannot display tmux panes. Use iTerm2 or a standalone terminal with tmux.',
          })
        }
        break
    }
  }

  return { ok: errors.length === 0, errors, terminal }
}
