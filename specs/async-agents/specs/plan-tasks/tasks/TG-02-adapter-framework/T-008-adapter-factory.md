# T-008: CollaborationAdapterFactory

## Metadata
- **Group:** [TG-02 -- Adapter Framework](index.md)
- **Component:** CollaborationAdapterFactory
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-005](T-005-adapter-interfaces.md), [T-007](T-007-config-schema.md)
- **Blocks:** T-025
- **Requirements:** [NFR-001](../../../define-requirements/NFR/NFR-001-adapter-pluggability.md), [NFR-002](../../../define-requirements/NFR/NFR-002-credential-security.md)

## Description
Implement the CollaborationAdapterFactory that instantiates and caches adapter instances from configuration. Validates required environment variables at creation time (fail-fast). Registers all credential values with the log sanitizer for automatic redaction. Returns mock adapters when adapter type is "mock".

## Acceptance criteria

```gherkin
Feature: CollaborationAdapterFactory

  Scenario: Factory returns correct adapter based on config
    Given config has adapters.notification = "slack"
    When getNotificationAdapter is called
    Then a SlackNotificationAdapter instance is returned
    And subsequent calls return the same cached instance

  Scenario: Factory returns NotificationChannel wrapping the adapter
    Given config has adapters.notification = "slack"
    And a mentionConfig with role "pe" mapped to ["U01234567"]
    When getNotificationChannel("#ai-sdd", mentionConfig) is called
    Then a SlackNotificationChannel wrapping the SlackNotificationAdapter is returned
    And the channel has the mentionConfig attached for @mention resolution

  Scenario: getNotificationChannel returns MockNotificationChannel for mock config
    Given config has adapters.notification = "mock"
    When getNotificationChannel is called
    Then a MockNotificationChannel is returned without env var checks

  Scenario: Missing env var fails fast with descriptive error
    Given SLACK_BOT_TOKEN is not set
    When the factory is created with adapters.notification = "slack"
    Then validateCredentials returns an AUTH error
    And the error message names the missing variable

  Scenario: Mock adapters require no credentials
    Given config has adapters.notification = "mock"
    When getNotificationAdapter is called
    Then a MockNotificationAdapter is returned without env var checks
```

## Implementation notes
- File: `src/collaboration/core/adapter-factory.ts`
- Env var validation matrix from L2 design (SLACK_BOT_TOKEN, JIRA_API_TOKEN, etc.)
- Register all env var values with `src/security/log-sanitizer.ts` on adapter creation
- Adapters are singletons per factory instance; factory created once per engine run
- Factory must be created after config parsing (needs resolved adapter types)
- `getNotificationChannel(channel, mentionConfig)` is the preferred call site for all activity notifications; it creates a new `SlackNotificationChannel` (or `MockNotificationChannel`) wrapping the cached `NotificationAdapter`

## Definition of done
- [x] Code reviewed and merged
- [x] All Gherkin scenarios covered by automated tests
- [x] No credentials logged (verified by log-sanitizer registration test)
- [x] Integration test: factory wired into engine run lifecycle
- [x] `getNotificationChannel` method added and tested
