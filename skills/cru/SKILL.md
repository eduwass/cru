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

3. **Pre-warm the swarm tmux server** (required — run BEFORE spawning agents):
   ```bash
   cru panes pre-warm
   ```
   This starts the tmux server that the agent framework will use, with an empty config
   to prevent user tmux hooks from interfering with the framework's window management.
   **This MUST complete before any Agent calls are made.**

4. **Spawn workers** using the Agent tool. For each worker (worker-1 through worker-N):
   - Set `team_name` to the team name from step 2
   - Set `name` to "worker-1", "worker-2", etc.
   - Set `subagent_type` to "general-purpose"
   - Do NOT set `run_in_background` — agents must run as foreground team members to get tmux panes
   - Give each worker its specific task slice in the `prompt`, plus:
     - Context about what other workers are doing
     - An instruction to message teammates to share findings and discuss

   **IMPORTANT:** Spawn all workers AND apply the grid layout in a **single message** — include all Agent calls AND the Bash call for `cru panes grid` together. This ensures the grid command starts polling immediately while workers are still launching.

5. **Apply grid layout** (in the same message as step 4):
   ```bash
   cru panes grid <team-name> --expect <worker-count>
   ```
   This polls for worker panes (up to 30s) and arranges them in a grid.

   **IMPORTANT:** ALWAYS run this command — do NOT skip it based on environment checks. The command detects the terminal backend internally (tmux, Ghostty, cmux) and handles each automatically. Ghostty works natively via AppleScript without tmux. Never assume tmux is required.

   If the command exits with a non-zero status, that's OK — workers still run as background agents. Tell the user to check `cru doctor` for environment issues.

6. **Report** the team is ready. Tell the user:
   - What each worker is focused on
   - `cru panes close <team-name>` to shut down when done

## Shutdown

1. **Send shutdown requests first** — use `SendMessage` with `type: "shutdown_request"` to each worker. Wait for approvals (or idle notifications).
2. **Then close panes** — `cru panes close <team-name>`
3. **Then delete team** — `TeamDelete`

Closing panes before agents approve kills them mid-process, which causes `TeamDelete` to see "active" members and refuse cleanup.

Team data (logs, messages) is preserved after close — reviewable via `cru logs <team>`. Use `cru clean` to remove old teams.
