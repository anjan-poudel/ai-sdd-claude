# FR-011: Bitbucket PR Creation and Review Flow

## Metadata
- **Area:** Bitbucket Integration
- **Priority:** MUST
- **Source:** requirements.md "coder will raise PR and notify channel" / "LE and others will review code and leave feedback in BB" / constitution.md "PR-based code review flow"

## Description
The system must provide a Bitbucket adapter that creates pull requests, retrieves review comments, and supports the merge flow. When a coder agent completes an implementation task, the adapter must create a PR from the working branch to the target branch in the configured Bitbucket repository. The adapter must retrieve PR review comments (both file-level and general) and make them available to the agent for processing. After all review feedback is addressed and approvals are received, the adapter must merge the PR. The adapter must also post a Slack notification (via FR-004) when a PR is created or updated.

## Acceptance criteria

```gherkin
Feature: Bitbucket PR creation and review flow

  Scenario: Agent creates a PR after implementation
    Given a coder agent has completed task "implement-auth" on branch "feature/auth"
    And valid Bitbucket credentials are configured
    When the adapter creates a PR
    Then a PR is created from "feature/auth" to the configured target branch
    And the PR title and description are derived from the task metadata
    And a Slack notification is posted to the configured channel

  Scenario: Review comments are retrieved for agent processing
    Given a PR with 5 review comments from reviewer "LE-Lead"
    When the agent polls for review feedback
    Then all 5 comments are retrieved with file path, line number, author, and body

  Scenario: PR is merged after approval
    Given a PR has received the required number of approvals
    And all review comments are resolved
    When the merge is triggered
    Then the PR is merged to the target branch
    And a Slack notification confirms the merge
```

## Related
- NFR: NFR-002 (Credential Security), NFR-005 (External API Retry)
- Depends on: FR-004
