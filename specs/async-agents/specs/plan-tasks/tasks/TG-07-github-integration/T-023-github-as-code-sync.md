# T-023: GitHub-as-Code Sync (Reuse AsCodeSyncEngine)

## Metadata
- **Group:** [TG-07 -- GitHub Integration (MVP2)](index.md)
- **Component:** AsCodeSyncEngine + GitHubTaskTrackingAdapter
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** [T-017](../TG-05-jira-integration/T-017-as-code-sync-engine.md), [T-021](T-021-github-task-tracking-adapter.md)
- **Blocks:** --
- **Requirements:** [FR-018](../../../define-requirements/FR/FR-018-mvp2-github-as-code-sync.md)

## Description
Wire the GitHubTaskTrackingAdapter into the AsCodeSyncEngine to enable GitHub-as-Code sync. The sync engine is already parameterized by TaskTrackingAdapter (T-017), so this task verifies the integration, adds GitHub-specific mapping file persistence, and writes integration tests for the GitHub sync flow.

## Acceptance criteria

```gherkin
Feature: GitHub-as-Code sync

  Scenario: Sync workflow tasks to GitHub Issues
    Given a workflow YAML with 5 tasks and adapters.task_tracking = "github"
    When sync is called with the GitHubTaskTrackingAdapter
    Then 5 GitHub Issues are created
    And mappings are saved to .ai-sdd/sync-mappings/github.json
    And the SyncReport shows created = 5
```

## Implementation notes
- Mapping file: `.ai-sdd/sync-mappings/github.json`
- Reuses AsCodeSyncEngine from T-017 -- no new sync logic needed
- Test focus: verify that the sync engine works with GitHub adapter (not just Jira)
- Test file: `tests/collaboration/integration/github-sync-roundtrip.test.ts`

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Mapping file written atomically
- [ ] SyncReport matches expected create/update/orphan counts
