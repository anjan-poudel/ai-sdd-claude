# TG-01: Core Async Engine

> **Jira Epic:** Core Async Engine

## Description
Extends the ai-sdd engine state machine with async-specific states (AWAITING_APPROVAL, APPROVED, DOING), implements the AsyncTaskManager and ApprovalManager core components, and adds approval timeout with Slack escalation. This group is the foundation for all collaboration features.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-001](T-001-async-state-machine.md) | Async State Machine Extensions | M | -- | MEDIUM |
| [T-002](T-002-async-task-manager.md) | AsyncTaskManager Implementation | L | T-001 | HIGH |
| [T-003](T-003-approval-manager.md) | ApprovalManager Implementation | M | T-001 | MEDIUM |
| [T-004](T-004-approval-timeout.md) | Approval Timeout with Slack Escalation | M | T-002, T-003 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 3 days
- Realistic (2 devs): 5 days
