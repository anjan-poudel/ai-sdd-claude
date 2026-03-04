---
name: sdd-run
description: Run the ai-sdd SDD workflow. Spawns the correct agent for the active task,
             handles HIL approvals inline, and loops. Use this to drive the full workflow.
disable-model-invocation: false
context: fork
allowed-tools: Bash, Task
---
Run the ai-sdd SDD workflow. Follow these steps:

1. Run `ai-sdd status --json` via Bash to find the next READY task and its agent role.

2. Spawn the matching subagent using the Task tool based on the task's `agent` field
   returned by `ai-sdd status --json`. The agent field is the source of truth —
   do not hardcode task-name → agent mappings. Map agent names to subagents as:
   - ba        → Task(sdd-ba)
   - architect → Task(sdd-architect)
   - pe        → Task(sdd-pe)
   - le        → Task(sdd-le)
   - dev       → Task(sdd-dev)
   - reviewer  → Task(sdd-reviewer)

   If multiple tasks are READY simultaneously, spawn them sequentially one at a
   time and collect all results before continuing.

3. After the subagent returns, run `ai-sdd hil list --json` via Bash.
   If any PENDING HIL items:
   - Show the item context to the developer.
   - Ask: "Approve to continue? [yes/no]"
   - On yes: run `ai-sdd hil resolve <id>` via Bash.
   - On no:  run `ai-sdd hil reject <id> --reason "<reason>"` via Bash.

4. Run `ai-sdd status --json` again and show the updated workflow table.

5. Ask the developer: "Continue to next task? [yes/no/done]"
   - yes  → repeat from step 1
   - no   → stop and show final status
   - done → workflow complete
