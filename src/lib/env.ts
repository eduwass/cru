import { execSync } from 'node:child_process'

/** Check if a binary exists on PATH. Returns its path or null. */
export function hasBinary(name: string): string | null {
  try {
    return execSync(`which ${name}`, { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

/** Get version string from a command, or null on failure. */
export function getVersion(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

/** Check if we're inside an active tmux session. */
export function inTmux(): boolean {
  return !!process.env.TMUX
}

/** Detect terminal emulator from environment. */
export function detectTerminal(): string {
  if (process.env.ITERM_SESSION_ID) return 'iterm2'
  if (process.env.TERM_PROGRAM === 'iTerm.app') return 'iterm2'
  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return 'terminal'
  if (process.env.TERM_PROGRAM === 'WezTerm') return 'wezterm'
  if (process.env.TERM_PROGRAM === 'Alacritty') return 'alacritty'
  if (process.env.WT_SESSION) return 'windows-terminal'
  return process.env.TERM_PROGRAM || 'unknown'
}
