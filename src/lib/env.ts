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
  // Check TERM_PROGRAM first — it reflects the actual terminal in use,
  // while vars like ITERM_SESSION_ID can leak from parent processes.
  const tp = process.env.TERM_PROGRAM
  if (tp === 'vscode') return 'vscode'
  if (tp === 'iTerm.app') return 'iterm2'
  if (tp === 'Apple_Terminal') return 'terminal'
  if (tp === 'WezTerm') return 'wezterm'
  if (tp === 'ghostty') return 'ghostty'
  if (tp === 'Alacritty') return 'alacritty'
  if (process.env.ITERM_SESSION_ID) return 'iterm2'
  if (process.env.WT_SESSION) return 'windows-terminal'
  return tp || 'unknown'
}

/** Check if we're in Ghostty without tmux (native pane mode). */
export function inGhostty(): boolean {
  return detectTerminal() === 'ghostty' && !inTmux()
}
