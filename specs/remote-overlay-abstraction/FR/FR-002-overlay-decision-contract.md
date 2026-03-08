# FR-002: OverlayDecision Normalized Verdict Contract

## Metadata
- **Area:** Overlay Abstraction
- **Priority:** MUST
- **Source:** constitution.md — Deliverables; `src/types/overlay-protocol.ts` (OverlayDecision, OverlayInvokeOutputSchema); `src/overlays/local-overlay-provider.ts` (mapping logic)

## Description

The system must define `OverlayDecision` as the single normalized return type that every
overlay provider — regardless of runtime — returns to the engine. The engine must only ever
consume `OverlayDecision` values; it must never receive raw `OverlayResult`,
`PostTaskOverlayResult`, or MCP wire-format objects.

### `OverlayVerdict` type

The verdict must be a string union of exactly four values:

```
"PASS" | "REWORK" | "FAIL" | "HIL"
```

This is a string union (not an `enum` keyword) so TypeScript exhaustiveness checking compiles
correctly. No additional verdict values are permitted in this release.

### `OverlayDecision` structure

```typescript
interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  updated_context?: Partial<AgentContext>;  // identity fields stripped before engine applies it
  evidence?: OverlayEvidence;
}

interface OverlayEvidence {
  overlay_id: string;
  source: OverlayRuntime;   // "local" | "cli" | "mcp"
  checks?: string[];
  report_ref?: string;
  data?: Record<string, unknown>;
}
```

### MCP wire-format validation

The MCP `overlay.invoke` tool returns a JSON payload. The system must validate it against the
following Zod schema before converting it to `OverlayDecision`:

```typescript
const OverlayInvokeOutputSchema = z.object({
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

Any response that fails this schema — including an unrecognized verdict, a missing
`protocol_version`, a non-`"1"` protocol version, or invalid JSON — must produce
`OverlayDecision { verdict: "FAIL" }` and must never reach the engine's state transition
logic. This outcome is governed by FR-008 Tier 2 (schema violation — always fail_closed)
and is independent of the configured `failure_policy`.

### `LocalOverlayProvider` verdict mapping

`LocalOverlayProvider` must map `OverlayResult` and `PostTaskOverlayResult` to `OverlayDecision`
using the following deterministic rules:

| Source result | Mapped OverlayDecision verdict |
|---------------|-------------------------------|
| `OverlayResult { proceed: true }` | `PASS` |
| `OverlayResult { proceed: false, hil_trigger: true }` | `HIL` |
| `OverlayResult { proceed: false, hil_trigger: false/undefined }` | `REWORK` |
| `PostTaskOverlayResult { accept: true }` | `PASS` |
| `PostTaskOverlayResult { accept: false, new_status: "FAILED" }` | `FAIL` |
| `PostTaskOverlayResult { accept: false, new_status: "COMPLETED" }` | throws `TypeError` |
| `PostTaskOverlayResult { accept: false, new_status: undefined/"NEEDS_REWORK" }` | `REWORK` |

Returning `accept: false` with `new_status: "COMPLETED"` is a contract violation — only the
engine may transition a task to `COMPLETED`. This must throw at the `LocalOverlayProvider`
level, not silently pass.

## Acceptance criteria

```gherkin
Feature: Normalized OverlayDecision contract

  Scenario: Engine receives only OverlayDecision values from local provider
    Given a BaseOverlay wrapped in LocalOverlayProvider
    When LocalOverlayProvider.invokePre is called
    Then the result is an OverlayDecision
    And the raw OverlayResult is not accessible outside the provider

  Scenario: Valid MCP response is validated and mapped to OverlayDecision
    Given a remote MCP server that returns protocol_version "1" and verdict "REWORK"
    When McpOverlayProvider.invokePost processes the response
    Then the returned OverlayDecision has verdict "REWORK"
    And evidence.source equals "mcp"

  Scenario: MCP response with protocol_version "2" is rejected as schema violation
    Given a remote MCP server that returns protocol_version "2"
    When the Zod schema validates the response
    Then validation fails with a schema violation
    And the engine receives OverlayDecision with verdict "FAIL"
    And this is not affected by the configured failure_policy

  Scenario: MCP response with unrecognized verdict is rejected
    Given a remote MCP server that returns verdict "FORCE_ACCEPT"
    When the Zod schema validates the response
    Then validation fails
    And the engine receives OverlayDecision with verdict "FAIL"

  Scenario: MCP response with missing verdict field is rejected
    Given a remote MCP server that returns a response with no "verdict" field
    When Zod validation runs
    Then it fails
    And the engine receives OverlayDecision with verdict "FAIL"

  Scenario: LocalOverlayProvider accept false with COMPLETED throws
    Given a BaseOverlay's postTask that returns accept false with new_status "COMPLETED"
    When LocalOverlayProvider.invokePost processes the result
    Then it throws a TypeError
    And the error message names the overlay and states only the engine may set COMPLETED

  Scenario: proceed false without hil_trigger maps to REWORK
    Given a BaseOverlay's preTask that returns proceed false without hil_trigger
    When LocalOverlayProvider.invokePre maps the result
    Then the OverlayDecision verdict is "REWORK"
```

## Related
- FR: FR-007 (engine consumes OverlayDecision produced here), FR-008 (schema violation is Tier 2 failure)
- NFR: NFR-003 (Zod validation as injection guard), NFR-004 (LocalOverlayProvider must produce identical outcomes to direct invocation)
- Depends on: FR-001 (OverlayProvider interface)
