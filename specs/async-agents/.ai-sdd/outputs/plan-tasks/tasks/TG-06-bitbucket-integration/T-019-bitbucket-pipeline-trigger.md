# T-019: Bitbucket Pipeline Trigger

## Metadata
- **Group:** [TG-06 -- Bitbucket Integration](index.md)
- **Component:** BitbucketCodeReviewAdapter (pipeline subsystem)
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-018](T-018-bitbucket-pr-adapter.md)
- **Blocks:** T-020
- **Requirements:** [FR-012](../../../define-requirements/FR/FR-012-bitbucket-pipeline-trigger.md)

## Description
Implement `triggerPipeline` and `getPipelineStatus` methods on the BitbucketCodeReviewAdapter. Allows triggering a Bitbucket Pipeline on a specific branch with an optional pipeline name, and polling for pipeline completion status.

## Acceptance criteria

```gherkin
Feature: Bitbucket pipeline trigger

  Scenario: Trigger a pipeline on a branch
    Given valid Bitbucket credentials
    When triggerPipeline is called with repo, branch, and pipeline name
    Then POST /2.0/repositories/{workspace}/{repo}/pipelines/ is called
    And a PipelineRef is returned with the pipeline UUID

  Scenario: Check pipeline status
    Given a PipelineRef from a triggered pipeline
    When getPipelineStatus is called
    Then the current status (pending/running/passed/failed/stopped) is returned
```

## Implementation notes
- Uses the same BitbucketCodeReviewAdapter class
- Pipeline trigger body: `{ target: { ref_type: "branch", ref_name: branch }, selector: { pattern: pipelineName } }`
- Status mapping: Bitbucket states -> PipelineStatus enum

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured Bitbucket pipeline API fixtures
