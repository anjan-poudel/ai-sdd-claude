# FR-012: Bitbucket Pipeline Trigger

## Metadata
- **Area:** Bitbucket Integration
- **Priority:** SHOULD
- **Source:** requirements.md "Bitbucket Pipeline" in scenario 1 tools list

## Description
The system must provide the ability to trigger a Bitbucket Pipeline run after a PR is merged to the target branch. The adapter must support triggering a named pipeline (or the default pipeline) for a given branch or tag. The adapter must poll or listen for pipeline completion status and report the outcome (pass/fail) back to the orchestrator. Pipeline trigger is part of the post-merge flow and may be configured as an automatic step or a manual gate.

## Acceptance criteria

```gherkin
Feature: Bitbucket pipeline trigger

  Scenario: Pipeline is triggered after PR merge
    Given a PR for task "implement-auth" has been merged to "master"
    And a Bitbucket pipeline is configured for the repository
    When the post-merge step executes
    Then a pipeline run is triggered for the "master" branch
    And the orchestrator records the pipeline run ID

  Scenario: Pipeline completion status is reported
    Given a pipeline run has been triggered with run ID "pipeline-123"
    When the pipeline completes with status "SUCCESSFUL"
    Then the orchestrator receives the success status
    And the task state advances accordingly

  Scenario: Pipeline failure is reported to Slack
    Given a pipeline run completes with status "FAILED"
    When the failure is detected
    Then a Slack notification is posted with the failure details and pipeline link
```

## Related
- NFR: NFR-005 (External API Retry)
- Depends on: FR-011
