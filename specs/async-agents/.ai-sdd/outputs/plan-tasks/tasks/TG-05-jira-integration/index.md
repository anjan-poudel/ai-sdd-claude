# TG-05: Jira Integration

> **Jira Epic:** Jira Integration

## Description
Implements the JiraTaskTrackingAdapter for epic/story/subtask CRUD, Jira Kanban board transitions with BFS multi-hop path discovery, and the AsCodeSyncEngine for hash-based bidirectional sync (code-wins). Covers FR-008, FR-009, FR-010.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-015](T-015-jira-task-adapter.md) | JiraTaskTrackingAdapter -- Epic/Story/Subtask CRUD | L | T-005, T-006 | MEDIUM |
| [T-016](T-016-jira-kanban-transitions.md) | Jira Kanban Transitions (BFS Multi-Hop) | M | T-015 | HIGH |
| [T-017](T-017-as-code-sync-engine.md) | AsCodeSyncEngine -- Hash-Based Diff and Sync | L | T-005 | HIGH |

## Group effort estimate
- Optimistic (full parallel): 2 days
- Realistic (2 devs): 4 days
