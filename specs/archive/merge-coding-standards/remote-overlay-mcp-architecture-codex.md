# Proposal: Use `coding-standards` as a Remote Overlay MCP Server

Date: 2026-03-07

## Problem

Merging `coding-standards` into `ai-sdd` wholesale is the wrong shape.

`ai-sdd` already has:
1. orchestration
2. task state
3. HIL
4. adapters
5. overlay chaining

What it lacks is not another full framework. It lacks an external governance plane that can enforce requirements-first behavior without bloating the core runtime.

## Core Idea

Treat `coding-standards` as a **remote overlay provider** over MCP.

That means:
1. `ai-sdd` stays the workflow engine and source of truth.
2. `coding-standards` becomes a policy and traceability service.
3. overlays become transport-agnostic: some run locally in-process, others run remotely over MCP.

This keeps the backbone of SDD in `ai-sdd`, while moving requirements-first governance into a separate, swappable system.

## Best Abstraction

The right abstraction is:

**`ai-sdd` = orchestration and enforcement plane**  
**Overlay providers = decision plane**  

In more concrete terms:
1. The engine owns state transitions.
2. Overlays only return normalized decisions.
3. Those decisions can come from a local class or a remote MCP server.

This is the critical boundary. Remote overlays must not directly mutate workflow state or write artifacts. They return a decision; `ai-sdd` applies it.

## Recommended Interface

Keep the existing overlay semantics (`preTask`, `postTask`, `awaitResolution`) but introduce a transport-neutral layer under them.

### 1. Normalized decision contract

```ts
type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  updated_context?: Partial<AgentContext>;
  evidence?: {
    overlay_id: string;
    source: "local" | "mcp";
    checks?: string[];
    report_ref?: string;
    data?: Record<string, unknown>;
  };
}
```

Engine mapping:
1. `PASS` -> continue / accept result
2. `REWORK` -> `NEEDS_REWORK`
3. `FAIL` -> `FAILED`
4. `HIL` -> `HIL_PENDING`

### 2. Overlay provider interface

```ts
interface OverlayProvider {
  readonly id: string;
  readonly runtime: "local" | "mcp";
  readonly hooks: Array<"pre_task" | "post_task">;

  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}
```

### 3. Two concrete provider types

1. `LocalOverlayProvider`
   Wraps existing in-process overlays (`hil`, `policy_gate`, `review`, `paired`, `confidence`).

2. `McpOverlayProvider`
   Calls a remote MCP tool and converts the response into `OverlayDecision`.

## How This Fits the Current Codebase

Current state:
1. [`src/overlays/base-overlay.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/base-overlay.ts)
   already defines the overlay hook model.
2. [`src/overlays/composition-rules.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/composition-rules.ts)
   already defines the overlay chain contract.
3. [`src/core/engine.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/engine.ts)
   already treats overlays as gatekeepers around dispatch.
4. [`src/integration/mcp-server/server.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/integration/mcp-server/server.ts)
   shows the repo already accepts MCP as a system boundary.

So the proposal is not a reinvention. It is a generalization:

1. keep the current overlay chain
2. wrap local overlays in a provider adapter
3. add remote provider adapters for MCP-backed overlays

## What `coding-standards` Should Do Remotely

`coding-standards` is best used for overlays that are:
1. policy-heavy
2. traceability-heavy
3. requirements-lock aware
4. not responsible for task orchestration

Good remote overlays:
1. `requirements_first`
   Pre-task: lock present, planning completeness, GO/approval status
   Post-task: requirement-task linkage, scope drift, acceptance coverage summary

2. `traceability_gate`
   Post-task: REQ -> TASK -> TEST/CONTRACT gap checks

3. `spec_drift_gate`
   Post-task: spec hash and contract drift checks

4. `planning_review`
   Pre-task: external plan review before implementation dispatch

Bad remote overlays:
1. `hil`
   HIL must stay local because it directly coordinates state transitions and queue waiting.

2. `confidence`
   Can remain local unless there is a strong reason to externalize scoring.

3. anything that writes files directly into the project
   Remote overlay should evaluate and return a verdict, not mutate the repo.

## Recommended Remote Protocol

Do not bind `ai-sdd` to many specialized MCP tools. Use one generic remote overlay invocation contract.

### MCP tool on `coding-standards`

`overlay.invoke`

Input:

```json
{
  "protocol_version": "1",
  "overlay_id": "requirements_first",
  "hook": "post_task",
  "workflow": {
    "id": "default-sdd",
    "run_id": "..."
  },
  "task": {
    "id": "implement-feature",
    "phase": "implementation",
    "requirement_ids": ["REQ-001"],
    "acceptance_criteria": [],
    "scope_excluded": ["logging", "cache"]
  },
  "artifacts": {
    "requirements_lock_path": ".ai-sdd/requirements.lock.yaml",
    "state_path": ".ai-sdd/state/workflow-state.json"
  },
  "result": {
    "outputs": [],
    "handover_state": {}
  },
  "config": {
    "mode": "warn"
  }
}
```

Output:

```json
{
  "protocol_version": "1",
  "verdict": "REWORK",
  "feedback": "Scope drift: excluded term 'cache' found",
  "evidence": {
    "overlay_id": "requirements_first",
    "checks": ["scope_excluded", "traceability"],
    "data": {
      "violations": ["cache"]
    }
  }
}
```

This keeps `ai-sdd` generic. The remote server can change internal implementation without changing the engine contract.

## Configuration Model

Public config should stay backward compatible. Do not replace today’s overlay config with a generic registry overnight. Compile the current config into an internal provider chain.

### Recommended config extension

```yaml
overlay_backends:
  coding_standards:
    runtime: mcp
    command: ["node", "/opt/coding-standards/tools/mcp-server/dist/index.js"]
    tool: "overlay.invoke"
    timeout_ms: 5000

remote_overlays:
  requirements_first:
    backend: coding_standards
    enabled: true
    hooks: [pre_task, post_task]
    phases: [planning, design, implementation]
    blocking: true
    config:
      governance_mode: warn
      checks:
        pre_task: [lock_present, planning_review]
        post_task: [traceability, scope_excluded, spec_hash]
```

Existing local overlay config remains:

```yaml
overlays:
  hil:
    enabled: true
```

Internal compilation result:
1. local built-ins -> `LocalOverlayProvider`
2. remote entries -> `McpOverlayProvider`
3. engine receives one unified ordered provider chain

## Chain Design

Keep the chain concept, but think in terms of responsibilities:

1. `hil` local
2. `requirements_first` remote
3. `policy_gate` local
4. `review` local
5. `paired` local
6. `confidence` local

This means the new backbone is:

`HIL(local) -> Requirements-First Governance(remote MCP) -> Local Quality/Review Overlays`

That is the right split:
1. remote service owns requirements discipline
2. local engine owns execution safety and workflow state

## Why This is Better Than Full Merge

1. `ai-sdd` stays small and coherent.
2. `coding-standards` can evolve independently as a governance service.
3. teams can swap governance providers without rewriting the engine.
4. local-only workflows still work.
5. remote governance can be introduced gradually per project or per task phase.

## Minimal Refactor Needed in `ai-sdd`

### Phase 1

1. Introduce `OverlayDecision`.
2. Introduce `OverlayProvider`.
3. Wrap existing local overlays in provider adapters.
4. Leave engine behavior unchanged apart from consuming normalized decisions.

### Phase 2

1. Add MCP client-side provider:
   `src/overlays/mcp/mcp-overlay-provider.ts`
2. Add config support for `overlay_backends` and `remote_overlays`.
3. Build unified provider chain from local + remote definitions.

### Phase 3

1. Implement remote `requirements_first` overlay against `coding-standards`.
2. Make it advisory first (`warn`).
3. Promote to blocking only after evidence.

## Important Guardrails

1. Remote overlays must be **pure decision services**.
2. Remote overlays must be **idempotent** for the same request.
3. Remote overlays must never directly change ai-sdd state.
4. `ai-sdd` must have a clear fallback if remote overlay is unavailable:
   - `off`: skip
   - `warn`: emit warning and continue
   - `enforce`: fail closed

## Recommended Default Behavior

1. Default remote governance mode: `warn`
2. Default remote overlay scope: `planning` and `design` first, then expand to implementation
3. Default architecture choice: native `ai-sdd` engine, external `coding-standards` governance

## Final Recommendation

Do not merge `coding-standards` into `ai-sdd`.

Build a **remote overlay abstraction** in `ai-sdd`, then run `coding-standards` as an MCP-based governance provider behind it.

The right model is:
1. `ai-sdd` is the workflow engine
2. overlays are policy decisions
3. those policy decisions may be local or remote
4. `coding-standards` supplies the remote requirements-first overlay bundle

That gives you the requirements-first backbone without turning `ai-sdd` into a second monolith.

