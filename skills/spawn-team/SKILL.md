---
name: spawn-team
description: Spawn an agent team with workers arranged in a grid layout. Use when the user wants to create a team of agents.
argument-hint: <num-agents> [task description]
disable-model-invocation: true
---

# Spawn Agent Team

## Arguments

- `$ARGUMENTS[0]` — number of worker agents (required)
- Remaining arguments — task/prompt for the workers (optional, defaults to "Say hi to the team lead")

## Steps

1. **Create the team** using TeamCreate.

2. **Spawn + layout in one shot:**
   ```bash
   bun src/cli.js spawn <team-name> --workers $ARGUMENTS[0]
   ```
   This splits tmux panes, starts `claude` in each, and applies the grid layout.

3. **Report** the team is ready.

## Shutdown

```bash
bun src/cli.js shutdown <team-name>
```
