# FR-004: Slack Channel Notification Adapter

## Metadata
- **Area:** Slack Integration
- **Priority:** MUST
- **Source:** constitution.md "Slack as primary coordination bus" / requirements.md "agent will notify other agents via Slack message in a channel"

## Description
The system must provide a Slack adapter capable of posting structured notification messages to a configured Slack channel. Notifications must be sent when: (a) an agent completes a task and it enters AWAITING_APPROVAL, (b) a stakeholder approves or rejects a task, (c) a PR is raised or updated, and (d) a review cycle completes. Messages must include the task ID, a summary of the action taken, a link to the relevant artifact (Confluence page, PR, Jira ticket), and the actor (agent or stakeholder name). The Slack adapter must authenticate via a bot token provided through environment variables.

## Acceptance criteria

```gherkin
Feature: Slack channel notification

  Scenario: Agent posts task-ready notification to Slack
    Given a configured Slack channel and a valid bot token in environment variables
    When an async task completes and enters AWAITING_APPROVAL
    Then a message is posted to the configured Slack channel
    And the message contains the task ID, summary, and artifact link

  Scenario: Notification includes actor identity
    Given a Slack notification triggered by agent "BA-Agent"
    When the message is posted
    Then the message body includes "BA-Agent" as the actor

  Scenario: Slack adapter handles missing bot token
    Given the Slack bot token environment variable is not set
    When the engine attempts to send a Slack notification
    Then the adapter raises a configuration error
    And the error message identifies the missing environment variable
```

## Related
- NFR: NFR-002 (Credential Security), NFR-004 (Slack Message Latency)
- Depends on: FR-001
