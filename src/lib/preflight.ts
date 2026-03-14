import { hasBinary, inTmux, inGhostty, detectTerminal } from '@/lib/env'

const INSTALL_HINTS: Record<string, Record<string, string>> = {
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

function platformHint(tool: string): string {
  const hints = INSTALL_HINTS[tool]
  if (!hints) return ''
  if (hints.all) return hints.all
  const platform = process.platform
  return hints[platform] || hints.fallback || ''
}

interface PreflightError {
  check: string
  message: string
  hint?: string
}

type Check = 'tmux' | 'tmux-session' | 'claude' | 'pane-session' | 'terminal'

/**
 * Run preflight checks. Returns { ok, errors, terminal }.
 */
export function preflight(...checks: Check[]): { ok: boolean; errors: PreflightError[]; terminal: string } {
  const terminal = detectTerminal()
  const tmuxCmd = terminal === 'iterm2' ? 'tmux -CC' : 'tmux'
  const errors: PreflightError[] = []

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

      case 'pane-session':
        if (inGhostty()) {
          if (process.platform !== 'darwin') {
            errors.push({ check: 'pane-session', message: 'Ghostty AppleScript is only available on macOS' })
          } else {
            try {
              const { isGhosttyScriptable } = require('./ghostty')
              if (!isGhosttyScriptable()) {
                errors.push({ check: 'pane-session', message: 'Ghostty is not responding to AppleScript. Check that macos-applescript is enabled.' })
              }
            } catch {
              errors.push({ check: 'pane-session', message: 'Cannot connect to Ghostty via AppleScript' })
            }
          }
        } else if (!hasBinary('tmux')) {
          errors.push({ check: 'pane-session', message: 'tmux is not installed (or use Ghostty for native pane support)', hint: platformHint('tmux') })
        } else if (!inTmux()) {
          errors.push({ check: 'pane-session', message: 'Not inside a tmux session (or use Ghostty for native pane support)', hint: tmuxCmd })
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
