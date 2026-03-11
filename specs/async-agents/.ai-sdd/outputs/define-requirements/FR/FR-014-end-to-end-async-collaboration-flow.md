# FR-014: End-to-End Async Collaboration Flow

## Metadata
- **Area:** Integration / Orchestration
- **Priority:** MUST
- **Source:** requirements.md full "How will it work" scenario / constitution.md "Core Capabilities"

## Description
The system must support the complete end-to-end async collaboration flow as described in the stakeholder brief: (1) BA agent produces a document in Confluence, (2) the agent notifies the Slack channel that the document is ready for review, (3) reviewers provide feedback via Confluence inline/standard comments, (4) the agent is notified via Slack that feedback is available, (5) the agent reads the feedback and updates the document, (6) the cycle repeats until approval, (7) upon approval the task transitions to DONE, (8) the next task (e.g., code implementation) begins. For code tasks: the coder raises a PR in Bitbucket, notifies via Slack, reviewers leave feedback in Bitbucket, the coder addresses feedback, and upon approval the PR is merged. This requirement validates that all individual adapters (FR-004 through FR-012) compose correctly into the intended workflow.

## Acceptance criteria

```gherkin
Feature: End-to-end async collaboration flow

  Scenario: Document review cycle via Confluence and Slack
    Given a workflow with async task "define-requirements" assigned to BA agent
    When the BA agent produces the requirements document
    Then a Confluence page is created with the document content
    And a Slack notification is posted: "define-requirements ready for review"
    When a reviewer adds 2 inline comments on the Confluence page
    And posts a Slack message indicating feedback is ready
    Then the BA agent retrieves the 2 inline comments
    And updates the Confluence page with revisions
    And posts a Slack notification: "define-requirements updated, please re-review"
    When the required stakeholders approve via Slack
    Then the task transitions to DONE

  Scenario: Code review cycle via Bitbucket and Slack
    Given a workflow with async task "implement-auth" assigned to Coder agent
    When the Coder agent completes implementation
    Then a Bitbucket PR is created
    And a Slack notification is posted: "implement-auth PR ready for review"
    When a reviewer leaves feedback on the PR
    And posts a Slack message indicating review feedback
    Then the Coder agent retrieves the PR comments
    And pushes updated code to the PR branch
    And posts a Slack notification: "implement-auth PR updated"
    When the required approvals are received
    Then the PR is merged
    And the task transitions to DONE
```

## Related
- NFR: NFR-004 (Slack Message Latency), NFR-005 (External API Retry)
- Depends on: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-011
