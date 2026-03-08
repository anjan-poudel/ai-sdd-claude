# NFR-001: Performance — Latency Bounds on Remote Overlay Invocations

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description

Remote overlay invocations must not introduce unbounded latency into the workflow engine.
Every remote call must complete or be abandoned within a configurable upper bound. The local
provider chain runner must impose negligible overhead compared to the current direct overlay
invocation.

## Acceptance criteria

Numeric targets:

| Metric | Target | Measurement condition |
|--------|--------|----------------------|
| Default remote call timeout | 5000 ms | `config.timeout_ms` default when omitted |
| Timeout enforcement accuracy | Rejects within `timeout_ms + 50 ms` | Measured from `callTool` start to rejection |
| Local provider chain overhead | Less than 5 ms added over baseline | Chain of 5 `LocalOverlayProvider` no-op wrappers on reference hardware |
| Phase filter skip latency | Less than 1 ms per provider evaluated and skipped | No I/O performed for phase-filtered providers |
| Provider registry build time | Less than 50 ms | At engine startup; measured once, not per-task |

```gherkin
Feature: Remote overlay performance bounds

  Scenario: Remote call is abandoned at configured timeout
    Given a McpClientWrapper with timeout_ms set to 200
    And a mock MCP server that delays its response indefinitely
    When callTool is called
    Then the call rejects within 250 ms (200 ms + 50 ms tolerance)
    And no further response from the server is awaited after rejection

  Scenario: Local provider chain adds negligible latency
    Given a chain of five LocalOverlayProvider instances wrapping no-op BaseOverlay instances
    When runPreProviderChain is timed for wall-clock duration
    Then the duration is less than 5 ms above the baseline of calling the overlays directly

  Scenario: Phase-filtered provider introduces sub-millisecond evaluation cost
    Given a provider with phases: ["planning"] and current task phase "implementation"
    When the chain runner evaluates that provider
    Then invokePre is never called
    And the evaluation completes in under 1 ms
```

## Related
- FR: NFR-001 governs the timeout target enforced in FR-003 and the phase-filter behavior in FR-004
