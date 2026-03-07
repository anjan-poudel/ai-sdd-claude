# FR-002: Overlay Decision Contract

## Metadata
- **Area:** Overlay Abstraction
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §2.1, §3.1; remote-overlay-mcp-architecture-codex.md §1; hybrid-mcp-sidecar-strategy-codex.md §Best Abstraction

## Description

The system must define a normalized `OverlayDecision` type that is the universal return value from every overlay provider, regardless of runtime. No overlay provider may return a raw, transport-specific result to the engine. The engine must only consume `OverlayDecision` values.

The normalized types must be:

```typescript
// src/types/overlay-protocol.ts

type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

interface OverlayEvidence {
  overlay_id: string;
  source: OverlayRuntime;
  checks?: string[];
  report_ref?: string;
  data?: Record<string, unknown>;
}

interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  updated_context?: Partial<AgentContext>;
  evidence?: OverlayEvidence;
}
```

The `OverlayVerdict` enum must contain exactly four values: `PASS`, `REWORK`, `FAIL`, `HIL`. No other verdict values are valid. The system must Zod-validate every `OverlayDecision` produced by a remote provider before the engine consumes it. A remote provider that returns an unknown verdict (e.g., `"FORCE_ACCEPT"`, `"APPROVE"`) must cause an immediate `fail_closed` outcome regardless of the configured `failure_policy`.

The MCP output schema used by the `overlay.invoke` tool must also be Zod-validated on the ai-sdd side using:

```typescript
const OverlayInvokeOutput = z.object({
  protocol_version: z.literal("1"),
  verdict: z.enum(["PASS", "REWORK", "FAIL", "HIL"]),
  feedback: z.string().optional(),
  evidence: z.object({
    overlay_id: z.string(),
    checks: z.array(z.string()).optional(),
    report_ref: z.string().optional(),
    data: z.record(z.unknown()).optional(),
  }).optional(),
});
```

## Acceptance Criteria

```gherkin
Feature: Normalized OverlayDecision contract

  Scenario: Engine receives only OverlayDecision values
    Given a local overlay that returns a raw OverlayResult
    When LocalOverlayProvider.invokePre is called
    Then the result is mapped to OverlayDecision before the engine receives it
    And the original OverlayResult type is not visible outside the provider

  Scenario: Valid MCP response is parsed to OverlayDecision
    Given a remote MCP server that returns a valid overlay.invoke response
    And the response contains protocol_version "1" and verdict "REWORK"
    When McpOverlayProvider.invokePost is called
    Then the returned OverlayDecision has verdict "REWORK"
    And the evidence.source field equals "mcp"

  Scenario: Unknown verdict from remote causes fail_closed
    Given a remote MCP server that returns verdict "FORCE_ACCEPT"
    When the Zod schema validates the response
    Then validation fails
    And the engine transitions the task to FAILED
    And this outcome is not affected by the configured failure_policy

  Scenario: Missing required field from remote causes fail_closed
    Given a remote MCP server that returns a response missing the "verdict" field
    When the Zod schema validates the response
    Then validation fails
    And the engine transitions the task to FAILED

  Scenario: Non-JSON response from remote causes fail_closed
    Given a remote provider that returns a non-JSON string
    When the response parsing is attempted
    Then parsing fails
    And the engine transitions the task to FAILED regardless of failure_policy
```

## Related
- FR: FR-007 (engine verdict mapping)
- NFR: NFR-003 (security — schema enforcement as injection guard)
- Depends on: FR-001 (overlay provider interface)
