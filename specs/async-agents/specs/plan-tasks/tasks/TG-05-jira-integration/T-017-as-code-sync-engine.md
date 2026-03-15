# T-017: AsCodeSyncEngine -- Hash-Based Diff and Sync

## Metadata
- **Group:** [TG-05 -- Jira Integration](index.md)
- **Component:** AsCodeSyncEngine
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-005](../TG-02-adapter-framework/T-005-adapter-interfaces.md)
- **Blocks:** T-021, T-023, T-026
- **Requirements:** [FR-010](../../../define-requirements/FR/FR-010-jira-as-code-sync.md)

## Description
Implement the AsCodeSyncEngine that synchronizes workflow YAML task definitions with external issue trackers. Uses SHA-256 content hashing to detect changes, creates/updates/orphans issues via the TaskTrackingAdapter interface, and persists a mapping file atomically. Code always wins on conflict. Parameterized by adapter so the same engine works with Jira (MVP1) and GitHub (MVP2).

## Acceptance criteria

```gherkin
Feature: AsCodeSyncEngine hash-based sync

  Scenario: New task creates an issue
    Given a workflow task with no existing mapping
    When sync is called
    Then a new issue is created via the TaskTrackingAdapter
    And a mapping with content_hash is persisted

  Scenario: Changed task updates the issue
    Given a workflow task whose content hash differs from the mapping
    When sync is called
    Then the issue is updated via updateTask
    And the mapping hash is updated

  Scenario: Removed task is marked orphaned (never deleted)
    Given a mapping for task "old-task" with no corresponding workflow task
    When sync is called
    Then the mapping is marked orphaned = true
    And an "orphaned" label is added to the issue
    And the issue is NOT deleted
```

## Implementation notes
- File: `src/collaboration/core/sync-engine.ts`
- Hash: SHA-256 via `node:crypto`, with `sortKeysDeep` and `stripNonSyncFields` normalization
- NON_SYNC_FIELDS: ["status", "run_id", "attempt", "timestamps", "collaboration_refs"]
- Mapping file: `.ai-sdd/sync-mappings/<adapter_type>.json` (atomic write via tmp+rename)
- Batch sync: use `Promise.allSettled` for independent creates/updates (< 5s for 50 tasks target)
- Individual failures recorded in SyncReport.errors, do not abort batch
- Emit `collab.sync.completed` event with SyncReport

## Definition of done
- [x] Code reviewed and merged
- [x] All Gherkin scenarios covered by automated tests
- [x] Mapping file atomically written (no partial writes)
- [x] Works with both MockTaskTrackingAdapter and JiraTaskTrackingAdapter

## Note: JiraHierarchySync

`AsCodeSyncEngine` implements flat hash-based sync (one issue per task, no Epic hierarchy). The **`JiraHierarchySync`** component (`src/collaboration/core/jira-hierarchy-sync.ts`) sits above it and adds Epic/Story/Subtask hierarchy management:

- 1 Epic per workflow (idempotent `ensureEpic`)
- Top-level tasks → Stories under the Epic
- Group-member tasks → Subtasks under their Story
- `transitionForStatus(adapter, taskId, taskStatus)` maps all `TaskStatus` values to Jira status names via `DEFAULT_STATUS_MAP` and calls `adapter.transitionTask`

`JiraHierarchySync` is wired in `run.ts` and operates alongside (not replacing) `AsCodeSyncEngine` for the status-transition use case during live workflow execution. See component #22 in `design-l2.md`.
