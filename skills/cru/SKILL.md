---
name: cru
description: Spawn an agent team with workers arranged in a grid layout. Use when the user wants to create a team of agents.
argument-hint: "<task description>"
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
   cru spawn <team-name> -n <count>
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

4. **Send the task** to each worker using SendMessage with their agent IDs. Give each worker:
   - Its specific slice of the task
   - Context about what the other workers are doing
   - An explicit instruction to message teammates to share findings and discuss (workers won't do this spontaneously)

5. **Report** the team is ready. Tell the user:
   - What each worker is focused on
   - `cru logs -f` to watch the team's activity live
   - `cru kill <team-name>` to shut down when done

## Shutdown

```bash
cru kill <team-name>
```

Team data (logs, messages) is preserved after kill — reviewable via `cru logs <team>`. Use `cru clean` to remove old teams.
