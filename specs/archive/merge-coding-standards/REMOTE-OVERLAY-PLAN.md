# Remote Overlay Architecture — Implementation Plan

**Date**: 2026-03-07 (rev 2: incorporated Codex implementation plan)
**Supersedes**: MERGE-PLAN.md, MERGE-PLAN-OPUS.md, MERGE-PLAN-v2.md
**Architecture Refs**: remote-overlay-mcp-architecture-codex.md, hybrid-mcp-sidecar-strategy-codex.md, remote-overlay-implementation-plan-codex.md
**Quorum**: Claude Opus (C1, C2), Codex (CX) — unanimous: do not merge, use remote overlay

---

## 1. Design Philosophy

`ai-sdd` stays the **orchestration and enforcement plane**.
`coding-standards` becomes a **remote governance overlay provider** over MCP.

Key constraints:
1. Remote overlays are **pure decision services** — they return verdicts, never mutate state
2. The engine is the **single enforcement point** — it maps verdicts to state transitions
3. Overlays are **transport-agnostic** — local class or remote MCP, same contract
4. Existing local overlays work **unchanged** through provider adapters
5. **No Mutation Invariant** — remote overlays cannot reach back into ai-sdd to change task status, rewrite outputs, or update state files. The engine receives a verdict and *it alone* decides the state transition. Schema violations at the Zod boundary are always `fail_closed` regardless of configured `failure_policy` (which only governs transport errors like timeouts and connection failures). This is what makes remote overlays safely swappable.

---

## 2. Core Abstraction: OverlayProvider

### 2.1 Normalized Decision Contract

```typescript
// src/types/overlay-protocol.ts

type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

type OverlayHook = "pre_task" | "post_task";
type OverlayRuntime = "local" | "cli" | "mcp";

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

Engine mapping (enforced in engine.ts):
| Verdict | Task Status | Action |
|---------|-------------|--------|
| `PASS` | continue / `COMPLETED` | Proceed to next overlay or accept result |
| `REWORK` | `NEEDS_REWORK` | Bounce back with feedback |
| `FAIL` | `FAILED` | Terminal failure |
| `HIL` | `HIL_PENDING` | Queue for human review |

### 2.2 OverlayProvider Interface

```typescript
// src/overlays/provider.ts

interface OverlayProvider {
  readonly id: string;
  readonly runtime: OverlayRuntime;
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];  // phase filtering (from Codex)

  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}
```

### 2.3 TaskDefinition Extensions (from Codex)

These fields must exist on `TaskDefinition` so remote overlays have data to check:

```typescript
// Added to TaskDefinition in src/types/index.ts (all optional — zero breaking changes)
requirement_ids?: string[];
acceptance_criteria?: Array<{
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
}>;
scope_excluded?: string[];
budget?: {
  max_new_files?: number;
  max_loc_delta?: number;
  max_new_public_apis?: number;
};
phase?: string;  // planning | design | implementation | review
```

### 2.4 GatedHandoverState (from Codex)

Typed interface for governance-relevant metrics agents report back:

```typescript
// src/types/index.ts
export interface GatedHandoverState {
  tests_passed?: boolean;
  lint_passed?: boolean;
  security_clean?: boolean;
  ac_coverage?: Record<string, boolean>;
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  blockers?: string[];
}
```

Without this, remote overlays cannot verify budget compliance or AC coverage
since `handover_state` is currently `Record<string, unknown>`.

### 2.5 Project-Level Governance Config (from Codex)

```typescript
// Added to ProjectConfig
governance?: {
  requirements_lock?: "off" | "warn" | "enforce";  // default: "warn"
};
```

Simpler than burying mode inside each remote overlay's passthrough config.
The remote overlay reads this from the config block sent with each invocation.

### 2.6 Three Provider Types

**LocalOverlayProvider** — wraps existing BaseOverlay instances:
```typescript
// src/overlays/local-overlay-provider.ts

class LocalOverlayProvider implements OverlayProvider {
  readonly runtime = "local";

  constructor(private overlay: BaseOverlay) {
    this.id = overlay.name;
    this.hooks = [];
    if (overlay.preTask) this.hooks.push("pre_task");
    if (overlay.postTask) this.hooks.push("post_task");
  }

  async invokePre(ctx: OverlayContext): Promise<OverlayDecision> {
    const result = await this.overlay.preTask!(ctx);
    return mapOverlayResultToDecision(result);
  }

  async invokePost(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision> {
    const postResult = await this.overlay.postTask!(ctx, result);
    return mapPostResultToDecision(postResult);
  }
}
```

Mapping functions convert between existing OverlayResult/PostTaskOverlayResult and the new OverlayDecision — **zero behavioral change** for existing overlays.

**CliOverlayProvider** — spawns external command, passes JSON on stdin (from Codex):
```typescript
// src/overlays/cli/cli-overlay-provider.ts

class CliOverlayProvider implements OverlayProvider {
  readonly runtime = "cli" as const;

  constructor(private config: OverlayBackendConfig & { command: string[] }) {}

  private async invoke(
    hook: OverlayHook,
    ctx: OverlayContext,
    result?: TaskResult,
  ): Promise<OverlayDecision> {
    const input = buildOverlayInvokeInput(this.id, hook, ctx, result, this.config);
    const { stdout } = await spawnWithTimeout(
      this.config.command,
      JSON.stringify(input),
      this.config.timeout_ms ?? 5000,
    );
    return parseOverlayDecision(JSON.parse(stdout)); // Zod-validated
  }
}
```

This is the **pragmatic first transport**: reuses existing `validate-lock` and `query-lock`
CLIs in coding-standards directly, with no MCP client work. Same request/response schema as MCP.

**McpOverlayProvider** — delegates to a remote MCP server:
```typescript
// src/overlays/mcp/mcp-overlay-provider.ts

class McpOverlayProvider implements OverlayProvider {
  readonly runtime = "mcp";

  constructor(
    private client: McpClient,
    private config: RemoteOverlayConfig,
  ) {}

  async invokePre(ctx: OverlayContext): Promise<OverlayDecision> {
    return this.invoke("pre_task", ctx);
  }

  async invokePost(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision> {
    return this.invoke("post_task", ctx, result);
  }

  private async invoke(
    hook: "pre_task" | "post_task",
    ctx: OverlayContext,
    result?: TaskResult,
  ): Promise<OverlayDecision> {
    const response = await this.client.callTool(this.config.tool, {
      protocol_version: "1",
      overlay_id: this.id,
      hook,
      task: { id: ctx.task_id, ...extractTaskMeta(ctx) },
      workflow: { id: ctx.workflow_id, run_id: ctx.run_id },
      result: result ? { outputs: result.outputs, handover_state: result.handover_state } : undefined,
      config: this.config.passthrough ?? {},
    });
    return parseOverlayDecision(response); // Zod-validated
  }
}
```

### 2.7 Failure Handling for Remote Overlays

Applies to both `CliOverlayProvider` and `McpOverlayProvider`.

**Two-tier failure model** (critical distinction):

```
Tier 1: Transport errors → governed by configured failure_policy
  - timeout (default 5000ms)
  - connection refused / spawn failure
  - process crash (non-zero exit, no stdout)

Tier 2: Schema violations → ALWAYS fail_closed (not configurable)
  - response fails Zod validation
  - unknown verdict value (e.g. "FORCE_ACCEPT")
  - missing required fields (protocol_version, verdict)
  - response is not valid JSON
```

```typescript
type RemoteFailurePolicy = "skip" | "warn" | "fail_closed";
```

| Error type | `skip` | `warn` | `fail_closed` |
|------------|--------|--------|---------------|
| Timeout | PASS (silent) | PASS + event | FAIL |
| Connection error | PASS (silent) | PASS + event | FAIL |
| Invalid schema | **FAIL always** | **FAIL always** | **FAIL always** |
| Server returns valid REWORK | propagate | propagate | propagate |

This ensures a rogue or corrupted overlay can never silently pass governance
checks by returning malformed data.  Transport flakiness is tolerable in
`warn` mode; data integrity violations are not.

Default failure policy: `warn` (emit observability event, continue with PASS for transport errors).

---

## 3. Overlay MCP Protocol

### 3.1 Single Tool: `overlay.invoke`

One generic tool on the coding-standards MCP server. ai-sdd never calls raw graph/validator tools directly.

**Input Schema** (Zod on ai-sdd side, JSON Schema on MCP server):

```typescript
const OverlayInvokeInput = z.object({
  protocol_version: z.literal("1"),
  overlay_id: z.string(),
  hook: z.enum(["pre_task", "post_task"]),
  workflow: z.object({
    id: z.string(),
    run_id: z.string(),
  }),
  task: z.object({
    id: z.string(),
    phase: z.string().optional(),            // planning | design | implementation | review
    requirement_ids: z.array(z.string()).optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    scope_excluded: z.array(z.string()).optional(),
  }),
  artifacts: z.object({
    requirements_lock_path: z.string().optional(),
    state_path: z.string().optional(),
    outputs: z.array(z.object({ path: z.string() })).optional(),
  }).optional(),
  result: z.object({
    outputs: z.array(z.object({ path: z.string(), contract: z.string().optional() })).optional(),
    handover_state: z.record(z.unknown()).optional(),
  }).optional(),
  config: z.record(z.unknown()).optional(),
});
```

**Output Schema**:

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

### 3.2 What coding-standards Implements Internally

The `overlay.invoke` tool is a facade. Internally it routes to existing tools:

| overlay_id | hook | Internal tool used |
|------------|------|--------------------|
| `requirements_governor` | `pre_task` | `validate-lock` (lock_present, planning_completeness) |
| `requirements_governor` | `post_task` | `query-lock gaps`, `query-lock orphans`, scope-drift script |
| `traceability_gate` | `post_task` | `query-lock coverage`, `query-lock chain` |
| `spec_drift_gate` | `post_task` | `spec-hash` script, `semantic-drift-check` script |
| `planning_review` | `pre_task` | `validate-lock` full suite + `query-lock tasks` |

ai-sdd doesn't know or care about these internals.

---

## 4. Configuration

### 4.1 New Config Keys (in `.ai-sdd/ai-sdd.yaml`)

```yaml
# Existing config stays unchanged
overlays:
  hil:
    enabled: true
  policy_gate:
    risk_tier: T1

# New: project-level governance mode (from Codex)
governance:
  requirements_lock: warn   # off | warn | enforce

# New: remote overlay backends
overlay_backends:
  # CLI sidecar (pragmatic first transport — from Codex)
  coding_standards_cli:
    runtime: cli
    command: ["bun", "run", "tools/overlay-cli/src/index.ts"]
    timeout_ms: 5000
    failure_policy: warn
    env:
      PROJECT_ROOT: "."

  # MCP server (target transport)
  coding_standards_mcp:
    runtime: mcp
    command: ["bun", "run", "tools/mcp-server/src/index.ts"]
    transport: stdio
    timeout_ms: 5000
    failure_policy: warn

# New: remote overlays using those backends
remote_overlays:
  requirements_governor:
    backend: coding_standards_cli   # swap to coding_standards_mcp later
    enabled: true
    hooks: [pre_task, post_task]
    phases: [planning, design, implementation]  # phase filtering (from Codex)
    blocking: true                              # from Codex
    config:
      checks:
        pre_task: [lock_present, planning_completeness]
        post_task: [traceability, scope_drift, spec_hash, ac_coverage]
```

### 4.2 Config Schema (Zod)

```typescript
// src/config/remote-overlay-schema.ts

const OverlayBackendConfig = z.object({
  runtime: z.enum(["cli", "mcp"]),
  command: z.array(z.string()),
  tool: z.string().optional(),              // MCP tool name (required for mcp runtime)
  transport: z.enum(["stdio"]).default("stdio"),
  timeout_ms: z.number().default(5000),
  failure_policy: z.enum(["skip", "warn", "fail_closed"]).default("warn"),
  env: z.record(z.string()).optional(),     // env vars for CLI sidecar (from Codex)
});

const RemoteOverlayConfig = z.object({
  backend: z.string(),
  enabled: z.boolean().default(true),
  hooks: z.array(z.enum(["pre_task", "post_task"])),
  phases: z.array(z.string()).optional(),   // phase filtering (from Codex)
  blocking: z.boolean().default(true),      // from Codex
  config: z.record(z.unknown()).optional(),
});
```

### 4.3 Provider Registry + Chain Construction (from Codex)

Two separate concerns (Codex §6):

**`src/overlays/registry.ts`** — compiles config into providers:
1. Build `LocalOverlayProvider` instances from built-in overlay config
2. Build `CliOverlayProvider` or `McpOverlayProvider` instances from `remote_overlays` + `overlay_backends`
3. Resolve backend references (remote overlay config → backend config)

**`src/overlays/provider-chain.ts`** — orders + runs the chain:
1. Order: `hil(local) → remote overlays (insertion order) → policy_gate(local) → review(local) → paired(local) → confidence(local)`
2. `runPreProviderChain(chain, ctx)` — apply phase filtering, stop on first non-PASS
3. `runPostProviderChain(chain, ctx, result)` — same, for post-task hooks
4. Validate composition rules (extended to handle providers)

---

## 5. Extended Overlay Chain

```
HIL (local, default ON)
  ↓
Requirements Governor (remote MCP, configurable)
  ↓
Evidence Gate / Policy Gate (local)
  ↓
Agentic Review (local)
  ↓
Paired Workflow (local)
  ↓
Confidence (local)
  ↓
Agent Dispatch
```

Remote overlays slot in **after HIL, before local quality overlays**. This ensures:
- Human always has first say (HIL)
- Governance checks run before expensive review/paired workflows
- Local quality overlays remain fast, tightly coupled to execution

---

## 6. Minimal ai-sdd Changes (What Gets Added)

| Change | Files | Why |
|--------|-------|-----|
| `OverlayDecision`, `OverlayVerdict`, `OverlayHook`, `OverlayRuntime` types | `src/types/overlay-protocol.ts` | Normalized decision contract |
| `OverlayProvider` interface | `src/overlays/provider.ts` | Transport-agnostic provider |
| `LocalOverlayProvider` | `src/overlays/local-overlay-provider.ts` | Wraps existing BaseOverlay |
| `CliOverlayProvider` | `src/overlays/cli/cli-overlay-provider.ts` | CLI sidecar transport (from Codex) |
| `McpOverlayProvider` | `src/overlays/mcp/mcp-overlay-provider.ts` | MCP client delegation |
| `McpClientWrapper` | `src/overlays/mcp/mcp-client.ts` | Thin wrapper around @modelcontextprotocol/sdk Client |
| Provider registry | `src/overlays/registry.ts` | Compiles config → providers (from Codex) |
| Provider chain runner | `src/overlays/provider-chain.ts` | Orders + runs chain with phase filtering |
| Config schemas | `src/config/remote-overlay-schema.ts` | Zod schemas for backends + remote overlays |
| TaskDefinition extensions | `src/types/index.ts` | `requirement_ids`, `acceptance_criteria`, `scope_excluded`, `budget`, `phase` (from Codex) |
| `GatedHandoverState` type | `src/types/index.ts` | Typed governance handover payload (from Codex) |
| `governance` config block | `src/config/defaults.ts` | Project-level governance mode (from Codex) |
| `CANCELLED` state | `src/types/index.ts` | Only genuinely missing state from coding-standards |
| Engine verdict mapping | `src/core/engine.ts` | Map OverlayDecision → state transitions |
| Workflow-loader update | `src/core/workflow-loader.ts` | Parse + validate new TaskDefinition fields through 4-layer merge |
| Observability events | `src/observability/` | `remote_overlay.invoked`, `remote_overlay.failed` |
| Agent prompts | `data/integration/claude-code/agents/` | Requirements-first guidance |

**Not added**: coding-standards' 15-state machine, lock validation logic, graph tools, query engine, drift scripts, planning review workflow. All of that stays in coding-standards.

---

## 7. CANCELLED State Addition

The one genuinely missing state. Coding-standards has it; ai-sdd needs it.

```typescript
// Updated types/index.ts
export type TaskStatus =
  | "PENDING" | "RUNNING" | "COMPLETED"
  | "NEEDS_REWORK" | "HIL_PENDING" | "FAILED"
  | "CANCELLED";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:      ["RUNNING", "CANCELLED"],
  RUNNING:      ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"],
  COMPLETED:    [],
  NEEDS_REWORK: ["RUNNING", "FAILED", "CANCELLED"],
  HIL_PENDING:  ["RUNNING", "FAILED", "CANCELLED"],
  FAILED:       [],
  CANCELLED:    [],
};
```

- `CANCELLED` is terminal (like COMPLETED and FAILED)
- Reachable from any non-terminal state
- Triggered by: workflow cancellation, manual intervention, or governance FAIL + policy

---

## 8. What coding-standards Needs

| Change | Location | Why |
|--------|----------|-----|
| `overlay.invoke` MCP tool | `tools/mcp-server/src/overlay-facade.ts` | Single entry point for ai-sdd |
| Overlay router | `tools/mcp-server/src/overlay-router.ts` | Routes overlay_id + hook → internal tools |
| Pre-task checks | `tools/mcp-server/src/checks/pre-task/` | lock_present, planning_completeness |
| Post-task checks | `tools/mcp-server/src/checks/post-task/` | traceability, scope_drift, spec_hash, ac_coverage |
| Protocol types | `tools/mcp-server/src/types/overlay-protocol.ts` | Shared input/output schemas |
| Integration tests | `tools/mcp-server/tests/overlay-invoke.test.ts` | Real check execution against fixture locks |

The existing 6 graph tools remain unchanged. `overlay.invoke` is additive.

---

## 9. Implementation Tickets

### Phase 1: Types + Provider Abstraction (ai-sdd) — 5d

| Ticket | Description | Effort | Depends |
|--------|-------------|--------|---------|
| ROA-001 | `OverlayDecision`, `OverlayVerdict`, `OverlayHook`, `OverlayRuntime`, `OverlayEvidence` types + Zod schemas in `src/types/overlay-protocol.ts` | 0.5d | — |
| ROA-001b | TaskDefinition extensions (`requirement_ids`, `acceptance_criteria`, `scope_excluded`, `budget`, `phase`) + `GatedHandoverState` type + Zod schemas in `src/types/index.ts`. Wire through workflow-loader 4-layer merge. **(from Codex)** | 1d | — |
| ROA-001c | `governance` config block in ProjectConfig + `src/config/defaults.ts` (default: `requirements_lock: "warn"`) **(from Codex)** | 0.5d | ROA-001b |
| ROA-002 | `OverlayProvider` interface + `LocalOverlayProvider` wrapping existing BaseOverlay | 1d | ROA-001 |
| ROA-003 | Provider registry (`src/overlays/registry.ts`) + provider chain runner (`src/overlays/provider-chain.ts`) with phase filtering + updated composition rules **(registry from Codex)** | 1d | ROA-002 |
| ROA-004 | Engine integration: consume `OverlayDecision` verdicts instead of raw overlay results | 0.5d | ROA-003 |
| ROA-005 | Tests: local provider chain behaves identically to current overlay chain | 0.5d | ROA-004 |

**Exit gate**: All 177 existing tests pass. New tests prove local providers produce identical behavior. New TaskDefinition fields parsed correctly.

### Phase 2: CANCELLED State (ai-sdd) — 1.5d

| Ticket | Description | Effort | Depends |
|--------|-------------|--------|---------|
| ROA-006 | Add CANCELLED to TaskStatus + VALID_TRANSITIONS | 0.5d | — |
| ROA-007 | Engine + state-manager: handle CANCELLED transitions, CLI `cancel` command | 0.5d | ROA-006 |
| ROA-008 | Tests: CANCELLED reachable from all non-terminal states, terminal once entered | 0.5d | ROA-007 |

### Phase 3: CLI Sidecar Provider (ai-sdd) — 2d **(from Codex — pragmatic first transport)**

| Ticket | Description | Effort | Depends |
|--------|-------------|--------|---------|
| ROA-009 | `CliOverlayProvider`: spawn command, JSON stdin/stdout, timeout, failure policy | 1d | ROA-002, ROA-001 |
| ROA-010 | Config schemas: `overlay_backends` (cli + mcp) + `remote_overlays` Zod schemas + merge into ProjectConfig | 0.5d | ROA-009 |
| ROA-010b | Tests: mock CLI process returns verdicts, provider translates correctly, timeout + failure policy works | 0.5d | ROA-009 |

### Phase 4: MCP Client + Remote Provider (ai-sdd) — 2.5d

| Ticket | Description | Effort | Depends |
|--------|-------------|--------|---------|
| ROA-011 | `McpClientWrapper` using @modelcontextprotocol/sdk Client, stdio transport | 1d | ROA-001 |
| ROA-012 | `McpOverlayProvider` implementing OverlayProvider — same contract as CliOverlayProvider, different transport | 1d | ROA-011, ROA-002 |
| ROA-012b | Tests: mock MCP server returns verdicts, provider translates correctly, failure policy works | 0.5d | ROA-012 |

### Phase 5: Overlay Facade (coding-standards) — 3d

| Ticket | Description | Effort | Depends |
|--------|-------------|--------|---------|
| ROA-013 | `overlay.invoke` MCP tool registration + overlay router | 1d | — |
| ROA-014 | Pre-task checks: `lock_present`, `planning_completeness` calling existing validators | 0.5d | ROA-013 |
| ROA-015 | Post-task checks: `traceability`, `scope_drift`, `spec_hash` calling existing tools | 1d | ROA-013 |
| ROA-016 | `ac_coverage` post-task check (AC → test/output linkage) | 0.5d | ROA-015 |

### Phase 6: Integration + Agent Prompts (both repos) — 2.5d

| Ticket | Description | Effort | Depends |
|--------|-------------|--------|---------|
| ROA-017 | End-to-end test: ai-sdd engine → CLI sidecar → coding-standards → verdict → state transition | 0.5d | ROA-009, ROA-013 |
| ROA-017b | End-to-end test: ai-sdd engine → MCP → coding-standards → verdict → state transition | 0.5d | ROA-012, ROA-013 |
| ROA-018 | Observability: `remote_overlay.invoked`, `remote_overlay.timeout`, `remote_overlay.error` events | 0.5d | ROA-009 |
| ROA-019 | Agent prompt updates: requirements-first guidance, GO protocol, 90% confidence rule | 0.5d | — |
| ROA-020 | Documentation: config reference, setup guide, architecture diagram | 0.5d | ROA-017b |

---

## 10. Total Effort

| Phase | Where | Days |
|-------|-------|------|
| Phase 1: Types + Provider Abstraction | ai-sdd | 5d |
| Phase 2: CANCELLED State | ai-sdd | 1.5d |
| Phase 3: CLI Sidecar Provider | ai-sdd | 2d |
| Phase 4: MCP Client + Remote Provider | ai-sdd | 2.5d |
| Phase 5: Overlay Facade | coding-standards | 3d |
| Phase 6: Integration + Prompts | both | 2.5d |
| **Total** | | **16.5d** |

ai-sdd: ~12.5d, coding-standards: ~4d

**Parallelism:**
- Phase 1 and Phase 2 are independent (parallel)
- Phase 3 (CLI sidecar) depends on Phase 1
- Phase 4 (MCP) depends on Phase 1 — can run parallel with Phase 3
- Phase 5 (coding-standards) depends only on ROA-001 (shared protocol types)
- Phase 6 depends on Phase 3 + Phase 4 + Phase 5

**Recommended execution order (from Codex spike model):**
1. Spike 1: Phase 1 + Phase 2 (local abstraction, no regressions) → **milestone: identical behavior**
2. Spike 2: Phase 3 + Phase 5 (CLI sidecar + coding-standards facade) → **milestone: first remote governance in warn mode**
3. Spike 3: Phase 4 + Phase 6 (MCP transport, swap backend) → **milestone: full MCP integration**

---

## 11. What This Architecture Enables

### Today (after implementation)
- ai-sdd runs workflows with optional remote governance
- coding-standards provides requirements-first checks over MCP
- `governance_mode: warn` for gradual adoption

### Next (future work, out of scope)
- `governance_mode: enforce` for strict requirements-first
- Planning review as remote pre-task overlay
- Release readiness evaluation as remote post-workflow overlay
- Additional overlay providers (security scanning, compliance, etc.)

### Never
- Merging coding-standards' 15-state machine into ai-sdd
- Running coding-standards' graph/lock tools directly from engine
- Remote overlays mutating ai-sdd state or writing artifacts

---

## 12. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| MCP connection failures in production | `failure_policy: warn` default — never blocks on remote errors |
| Remote overlay latency | 5s timeout default, configurable per backend |
| Schema drift between repos | Shared `protocol_version: "1"` field; version mismatch → hard error |
| Behavioral regression during provider refactor | Phase 1 exit gate: all 177 tests pass unchanged |
| Remote overlay returns unsanctioned states | Zod validation on response; invalid → `fail_closed` regardless of policy |

---

## 13. Decision Log

| Decision | Agreed By | Rationale |
|----------|-----------|-----------|
| Don't merge coding-standards | C1, C2, CX (100%) | Keeps ai-sdd focused; governance is a separate concern |
| Single `overlay.invoke` tool, not many | C2, CX (67%) | ai-sdd stays generic; coding-standards owns routing |
| HIL stays local | C1, C2, CX (100%) | Owns queue + state transitions; can't be remote |
| Remote overlays slot after HIL, before local quality | C2, CX (67%) | Human first, governance before expensive reviews |
| Add CANCELLED state | C1, C2 (67%) | Only genuinely missing capability from coding-standards state machine |
| Don't add 15-state machine | C1, C2, CX (100%) | Other states map to overlay/phase/DAG mechanisms already present |
| Start with `warn` mode | CX (strong rec) | Gradual adoption; promote to enforce after evidence |
| Normalized OverlayDecision | C2, CX (100%) | Single mapping point in engine; clean abstraction |
| CLI sidecar as first transport | CX (adopted in rev 2) | Pragmatic: reuses existing CLIs, no MCP client needed initially |
| GatedHandoverState type | CX (adopted in rev 2) | Agents need typed interface to report governance metrics |
| TaskDefinition extensions | CX (adopted in rev 2) | Remote overlays need data to check against |
| Project-level governance config | CX (adopted in rev 2) | Simpler than per-overlay passthrough config |
| Registry + chain runner split | CX (adopted in rev 2) | Clean separation of config compilation vs chain execution |
| 3-spike execution model | CX (adopted in rev 2) | Local-first → CLI sidecar → MCP: each spike yields a milestone |
