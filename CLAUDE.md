# cru

CLI tool for managing tmux pane layouts when running AI coding agent teams.
Lead pane on one side, workers in an auto-sized grid on the other.

## Stack

- Runtime: Bun
- CLI framework: incur
- Layout target: tmux

## Project structure

- `src/cli.ts` — entrypoint, wires commands to incur
- `src/commands/` — one file per CLI command
- `src/lib/` — shared modules (config, layout, tmux, teams)
- `skills/` — skill source files (copied to `.claude/skills/` via `cru init`)
- `.cru.json` — user config file (layout preferences)

## Conventions

- TypeScript (Bun native, no build step)
- Path aliases: `@/` maps to `src/`
- Keep modules small and focused
- Config resolution: CLI flags > project config > global config > defaults
