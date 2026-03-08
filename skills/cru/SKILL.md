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

3. **Spawn workers** using the Agent tool. For each worker (worker-1 through worker-N):
   - Set `team_name` to the team name from step 2
   - Set `name` to "worker-1", "worker-2", etc.
   - Set `subagent_type` to "general-purpose"
   - Set `run_in_background` to true
   - Give each worker its specific task slice in the `prompt`, plus:
     - Context about what other workers are doing
     - An instruction to message teammates to share findings and discuss

   Spawn all workers in a single message (parallel Agent calls).

4. **Apply grid layout** after spawning:
   ```bash
   cru grid --expect <worker-count>
   ```
   This waits for worker panes to appear in tmux, then arranges them in a grid (lead on one side, workers in an auto-sized grid on the other).

   If the grid command fails (e.g., not in a tmux session), that's OK — workers still run as background agents with the team bar visible. Tell the user they can start a tmux session for the grid layout.

5. **Report** the team is ready. Tell the user:
   - What each worker is focused on
   - `cru kill <team-name>` to shut down when done

## Shutdown

```bash
cru kill <team-name>
```

Team data (logs, messages) is preserved after kill — reviewable via `cru logs <team>`. Use `cru clean` to remove old teams.
