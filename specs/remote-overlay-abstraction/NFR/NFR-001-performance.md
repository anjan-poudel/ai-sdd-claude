# NFR-001: Performance

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description

Remote overlay invocations must not introduce unbounded latency into the workflow engine. Every remote call must complete or be abandoned within a configurable upper bound, and the local provider chain must impose no measurable overhead compared to the current direct overlay invocation.

## Targets

| Metric | Target | Condition |
|--------|--------|-----------|
| Per-call timeout ceiling | 5000 ms default; configurable per backend via `timeout_ms` | All remote provider types (CLI and MCP) |
| `McpClientWrapper` timeout enforcement accuracy | Timeout triggers within ±50 ms of configured `timeout_ms` | Measured from call start to rejection |
| Local provider chain overhead | Less than 5 ms added latency over current direct overlay invocation | Measured for a chain of 5 local providers on reference hardware |
| Phase filtering decision | Less than 1 ms per provider evaluated and skipped | No I/O is performed for a phase-filtered provider |
| Provider registry build time | Less than 50 ms to compile config into the full provider chain | At engine startup; not per-task |

## Verification

1. Unit test with a mock MCP server that never responds: assert the `McpClientWrapper` rejects within `timeout_ms + 50 ms`.
2. Benchmark test: run `runPreProviderChain` with five `LocalOverlayProvider` instances on a no-op `BaseOverlay`; assert wall-clock time is within 5 ms of the current direct invocation baseline captured in the same test.
3. Unit test: assert that a phase-filtered provider's `invokePre` is not called (zero I/O) and that the chain completes in under 1 ms for the filtered case.
4. Integration test at engine startup: assert the registry build step completes before the first task is dispatched, with no measurable per-task penalty.

```gherkin
Feature: Remote overlay performance

  Scenario: Remote call is abandoned at configured timeout
    Given a McpClientWrapper with timeout_ms set to 200
    And a mock MCP server that delays its response indefinitely
    When callTool is called
    Then the call rejects within 250 ms (200 ms + 50 ms tolerance)
    And no response from the server is awaited beyond the timeout

  Scenario: Local provider chain adds negligible overhead
    Given a chain of five LocalOverlayProvider instances wrapping no-op overlays
    When runPreProviderChain is measured for wall-clock duration
    Then the duration is less than 5 ms above the baseline of direct overlay invocation

  Scenario: Phase-filtered provider introduces sub-millisecond latency
    Given a provider with phases: ["planning"] and current task phase "implementation"
    When the chain runner evaluates whether to invoke the provider
    Then invokePre is never called
    And the evaluation completes in under 1 ms
```

## Related
- FR: FR-003 (timeout enforced in McpClientWrapper), FR-004 (phase filtering in chain runner)
