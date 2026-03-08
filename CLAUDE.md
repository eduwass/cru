# agent-teams

CLI tool for managing tmux pane layouts when running AI coding agent teams.
Lead pane on one side, workers in an auto-sized grid on the other.

## Stack

- Runtime: Bun
- CLI framework: incur
- Layout target: tmux

## Project structure

- `src/cli.js` — entrypoint, wires commands to incur
- `src/commands/` — one file per CLI command
- `src/lib/` — shared modules (config, layout, tmux, teams)
- `skills/` — skill source files (symlinked to `.claude/skills/` via `bun run setup`)
- `.agent-teams.json` — user config file (layout preferences)

## Conventions

- Plain JS (ESM), no TypeScript, no build step
- Keep modules small and focused
- Config resolution: CLI flags > project config > global config > defaults
