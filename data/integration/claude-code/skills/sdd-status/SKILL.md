---
name: sdd-status
description: Show the current ai-sdd workflow progress and cost summary
allowed-tools: Bash
---
Run `ai-sdd status --metrics --project {{PROJECT_PATH}}` and display the results
as a formatted table. Highlight any FAILED or HIL_PENDING tasks.

The active session is used automatically. To check the active session:
`ai-sdd sessions active --project {{PROJECT_PATH}}`
