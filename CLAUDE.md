# cru

CLI tool for managing terminal pane layouts when running AI coding agent teams.
Lead pane on one side, workers in an auto-sized grid on the other.

## Stack

- Runtime: Bun
- CLI framework: incur
- Pane backends: tmux (direct), Ghostty (AppleScript + tmux mirroring)

## Project structure

- `src/cli.ts` — entrypoint, wires commands to incur
- `src/commands/` — one file per CLI command
- `src/lib/` — shared modules (config, layout, tmux, ghostty, mirror, teams)
- `skills/` — skill source files (copied to `.claude/skills/` via `cru init`)
- `tests/unit/` — pure logic tests (no terminal needed)
- `tests/e2e/iterm/` — iTerm2 + tmux e2e tests
- `tests/e2e/ghostty/` — native Ghostty e2e tests
- `tests/helpers/` — shared test utilities
- `.cru.json` — user config file (layout preferences)

## Conventions

- TypeScript (Bun native, no build step)
- Path aliases: `@/` maps to `src/`
- Keep modules small and focused
- Config resolution: CLI flags > project config > global config > defaults
