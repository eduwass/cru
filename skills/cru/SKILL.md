---
name: cru
description: Spawn an agent team with workers arranged in a grid layout. Use when the user wants to create a team of agents.
argument-hint: "[num-agents] <task description>"
disable-model-invocation: true
---

# Spawn Agent Team

## Arguments

Parse `$ARGUMENTS` as a single string:

- If the **first word is a number**, use it as the worker count and the rest as the task description.
- If the **first word is NOT a number**, use the entire string as the task description and decide the worker count yourself based on the task (typically 2–5).

## Steps

1. **Determine worker count and task** from `$ARGUMENTS` using the rules above.

2. **Create the team** using TeamCreate.

3. **Spawn + layout in one shot:**
   ```bash
   bun src/cli.js spawn <team-name> --workers <count>
   ```
   This splits tmux panes, starts `claude` in each, and applies the grid layout.

   The spawn command runs environment checks internally. If it returns `"error": "Preflight checks failed"`, **STOP immediately.** Do NOT try workarounds.

   Tell the user what failed. Be brief — problem and fix, nothing else. Example for missing tmux session:

   > **cru needs tmux.** Start a tmux session first:
   >
   > `tmux -CC`
   >
   > Then pick up where you left off with `claude --continue` and re-run `/cru`.

   Use the `fix` value from the error response as the command to show the user. Then **stop**.

4. **Send the task** to each worker using SendMessage with their agent IDs, giving each worker its specific slice of the task.

5. **Report** the team is ready.

## Shutdown

```bash
bun src/cli.js shutdown <team-name>
```
