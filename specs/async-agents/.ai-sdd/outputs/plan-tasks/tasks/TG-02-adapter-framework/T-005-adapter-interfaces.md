# T-005: Shared Adapter Interfaces and Types

## Metadata
- **Group:** [TG-02 -- Adapter Framework](index.md)
- **Component:** Collaboration adapter interfaces
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** --
- **Blocks:** T-006, T-007, T-008, T-009, T-012, T-015, T-018, T-021, T-022
- **Requirements:** [NFR-001](../../../define-requirements/NFR/NFR-001-adapter-pluggability.md), [NFR-006](../../../define-requirements/NFR/NFR-006-adapter-interface-portability.md)

## Description
Define all shared TypeScript types and the four adapter interfaces: NotificationAdapter, DocumentAdapter, TaskTrackingAdapter, CodeReviewAdapter. Also define Result<T, AdapterError>, all Ref types (MessageRef, PageRef, IssueRef, PRRef, PipelineRef, CommentRef), signal types, CollaborationEvent types, and mock adapter implementations for testing.

## Acceptance criteria

```gherkin
Feature: Shared adapter interfaces

  Scenario: All four interfaces are importable and type-safe
    Given the collaboration types module is imported
    When a class implements NotificationAdapter
    Then TypeScript enforces all method signatures including return types
    And Result<T, AdapterError> is the return type for all fallible methods

  Scenario: Mock adapters satisfy interface contracts
    Given MockNotificationAdapter implements NotificationAdapter
    When postNotification is called
    Then it returns Result<MessageRef> with ok = true
    And the call is recorded for test assertions
```

## Implementation notes
- Files: `src/collaboration/types.ts`, `src/collaboration/adapters/notification-adapter.ts`, `src/collaboration/adapters/document-adapter.ts`, `src/collaboration/adapters/task-tracking-adapter.ts`, `src/collaboration/adapters/code-review-adapter.ts`
- Mock implementations: `src/collaboration/adapters/mock/` (one file per interface)
- All Ref types must be opaque -- callers never inspect vendor-specific IDs
- MockOptions must support `failOn` and `latencyMs` for error injection testing

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] All four mock adapters implemented and passing type checks
- [ ] TypeScript strict mode -- no `any` in interface definitions
