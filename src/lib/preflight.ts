import { execSync } from 'node:child_process'

/**
 * Check if a binary exists on PATH.
 */
function hasBinary(name) {
  try {
    execSync(`which ${name}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if we're inside an active tmux session.
 */
function inTmux() {
  return !!process.env.TMUX
}

/**
 * Get tmux version string, or null if not installed.
 */
function tmuxVersion() {
  try {
    return execSync('tmux -V', { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

/**
 * Get claude CLI version, or null if not installed.
 */
function claudeVersion() {
  try {
    return execSync('claude --version', { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

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
 * Run preflight checks. Returns { ok, errors } where errors is an array
 * of { check, message, hint } objects.
 *
 * Checks available: 'tmux', 'tmux-session', 'claude'
 */
export function preflight(...checks) {
  const errors = []

  for (const check of checks) {
    switch (check) {
      case 'tmux':
        if (!hasBinary('tmux')) {
          errors.push({
            check: 'tmux',
            message: 'tmux is not installed',
            hint: platformHint('tmux'),
          })
        }
        break

      case 'tmux-session':
        if (!hasBinary('tmux')) {
          errors.push({
            check: 'tmux',
            message: 'tmux is not installed',
            hint: platformHint('tmux'),
          })
        } else if (!inTmux()) {
          errors.push({
            check: 'tmux-session',
            message: 'Not inside a tmux session',
            hint: 'Start one with: tmux new -s main',
          })
        }
        break

      case 'claude':
        if (!hasBinary('claude')) {
          errors.push({
            check: 'claude',
            message: 'Claude Code CLI is not installed',
            hint: platformHint('claude'),
          })
        }
        break
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Run preflight checks and return an error object if any fail.
 * Use in command handlers: `const err = guard('tmux-session', 'claude'); if (err) return err;`
 */
export function guard(...checks) {
  const result = preflight(...checks)
  if (result.ok) return null
  return {
    error: 'Preflight checks failed',
    issues: result.errors.map((e) => ({
      problem: e.message,
      fix: e.hint,
    })),
  }
}
