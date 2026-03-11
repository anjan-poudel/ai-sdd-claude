# NFR-002: Credential Security

## Metadata
- **Category:** Security
- **Priority:** MUST

## Description
All collaboration tool credentials (API tokens, bot tokens, personal access tokens, OAuth secrets) must be sourced exclusively from environment variables or a secure configuration store. No credential must ever appear in workflow YAML files, adapter configuration files checked into version control, log output, Slack messages, or error messages. The system must validate at startup that all required credentials for configured adapters are present, and must fail fast with a clear error identifying which credential is missing. Credential values must be redacted in all log output -- any string matching a configured credential pattern must be replaced with "[REDACTED]" before being written to any log sink. Zero credential leaks must occur in any log file, console output, or persisted state file.

## Acceptance criteria

```gherkin
Feature: Credential security

  Scenario: Credentials sourced from environment variables only
    Given a Slack adapter configured with SLACK_BOT_TOKEN
    When the adapter initializes
    Then the token value is read from process.env.SLACK_BOT_TOKEN
    And no credential appears in any YAML config file in the repository

  Scenario: Missing credential produces clear startup error
    Given the environment variable CONFLUENCE_API_TOKEN is not set
    And the Confluence adapter is configured in the workflow
    When the engine starts
    Then the engine fails within 5 seconds
    And the error message contains "CONFLUENCE_API_TOKEN"
    And the error message does NOT contain any actual credential value

  Scenario: Credentials are redacted in logs
    Given a Slack API call that includes the bot token in the request
    When the call is logged at debug level
    Then the log entry contains "[REDACTED]" in place of the token value
    And zero occurrences of the actual token exist in any log file
```

## Related
- FR: FR-004, FR-006, FR-011
