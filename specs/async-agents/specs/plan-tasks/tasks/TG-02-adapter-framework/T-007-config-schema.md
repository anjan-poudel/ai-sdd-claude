# T-007: Configuration Schema and YAML Parsing

## Metadata
- **Group:** [TG-02 -- Adapter Framework](index.md)
- **Component:** CollaborationConfigSchema
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** [T-005](T-005-adapter-interfaces.md)
- **Blocks:** T-008
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-async-sync-task-mode.md)

## Description
Define the Zod validation schema for the `collaboration` config block in workflow YAML and ai-sdd.yaml. Includes schemas for Slack, Confluence, Jira, Bitbucket, GitHub sub-blocks, adapter selection, and per-task async config (mode, min_approvals, approval_timeout_seconds). Integrates with the existing 4-layer config merge order.

## Acceptance criteria

```gherkin
Feature: Collaboration configuration schema

  Scenario: Valid configuration passes Zod validation
    Given a YAML config with collaboration.enabled = true and all required fields
    When CollaborationConfigSchema.parse is called
    Then validation succeeds and defaults are applied

  Scenario: Missing required fields are rejected
    Given a YAML config with collaboration.adapters.notification = "slack" but no slack config
    When CollaborationConfigSchema.parse is called
    Then a ZodError is thrown listing the missing slack fields
```

## Implementation notes
- File: `src/collaboration/config.ts`
- Schema must match the L2 design's CollaborationConfigSchema exactly
- Per-task `AsyncTaskConfigSchema` (mode, min_approvals, approval_timeout_seconds) participates in 4-layer merge
- `collaboration.enabled: false` (default) disables all collaboration -- existing workflows unaffected
- Add collaboration config to workflow-loader.ts merge logic

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Config-to-behaviour test: changing `enabled` field changes runtime behaviour (per dev standard #1)
