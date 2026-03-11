---
description: Jira task tracking adapter implementation — REST v3 adapter with ADF support, BFS multi-hop transitions, mock test double, and fixture-based tests.
---

# Implementation Notes: Jira Task Tracking Adapter

## Summary

Implemented the Jira Cloud task tracking adapter (real + mock) with BFS multi-hop transition support.

## Files Created

- `src/collaboration/impl/jira-task-tracking-adapter.ts` — Real Jira Cloud REST v3 adapter. Supports createEpic, createTask (with parent linking), updateTask, transitionTask (with BFS path discovery), getTask, listTasks (JQL), addLabel, getAvailableTransitions, healthCheck. ADF conversion for description field.
- `src/collaboration/impl/mock-task-tracking-adapter.ts` — In-memory test double with simplified Kanban transition map (Backlog → In Progress → In Review/Done) and BFS path discovery.

## Testing

Tests in `tests/collaboration/adapters/impl/jira.test.ts`:
- MockTaskTrackingAdapter CRUD (createEpic, createTask with epic link, update, transition, list, label)
- BFS multi-hop transition test
- NOT_FOUND error test
- Fixture validation against `tests/fixtures/jira/create-issue-response.json` and `tests/fixtures/jira/transitions-response.json`

## Key Design Decisions

- ADF (Atlassian Document Format) conversion: `toAdf()` wraps plain text in minimal doc/paragraph structure; `extractDescription()` unwraps paragraph nodes back to plain text.
- BFS `findTransitionPath()` queries `/transitions` API at each node (Jira only returns transitions available from the current issue state, not a full graph).
- `parent_key` and `assignee` on TaskFields use `T | undefined` signature for `exactOptionalPropertyTypes` compliance.
