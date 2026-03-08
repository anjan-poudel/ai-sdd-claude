# Hybrid Strategy: Keep `ai-sdd` Small, Use `coding-standards` as External Governance

Date: 2026-03-07

## Recommendation

Do not merge `coding-standards` in full.

The best way to get the value of both repos without making `ai-sdd` too large is:

1. merge only the **minimum local primitives** that `ai-sdd` must understand at runtime
2. keep heavy requirements-first governance in `coding-standards`
3. expose that governance through a **remote overlay** interface over MCP
4. keep a fallback path where the same checks can run as an external CLI sidecar if MCP is not ready

This gives you a clean split:

1. `ai-sdd` remains the workflow engine
2. `coding-standards` becomes the requirements-governor

## The Right Split

### Merge directly into `ai-sdd`

These are small, core concepts that `ai-sdd` must understand locally:

1. `GovernanceMode`
   `off | warn | enforce`

2. Task metadata needed by requirements-first workflows
   - `requirement_ids`
   - `acceptance_criteria`
   - `scope_excluded`
   - `phase`
   - optionally `budget`

3. A unified overlay abstraction that supports:
   - local overlays
   - remote overlays

4. Prompt-level minimum governance
   - agent constitution
   - 90% confidence rule
   - GO protocol

5. Evidence persistence
   `ai-sdd` should store remote overlay decisions/reports in state or output artifacts

These are small, local, and foundational. Without them, `ai-sdd` cannot even ask the external service the right questions.

### Keep in `coding-standards` as MCP/sidecar

These are the best candidates to stay external:

1. requirements lock graph authoring/export
2. lock validation rules
3. traceability query/gap analysis
4. semantic drift checks
5. reproducibility checks
6. scope-compliance and anti-overengineering checks
7. requirements input schema validation

Why these are good external candidates:
1. they are policy-heavy, not orchestration-heavy
2. they can be run on snapshots and artifacts
3. they do not need to own workflow state
4. they are naturally tool-like

### Do not merge

These should remain out of `ai-sdd` entirely:

1. duplicate workflow state machines
2. coding-standards team/process docs as runtime features
3. language-specific standards (`java/`, `kotlin/`)
4. org-scale features and predictive/ML ideas

## Best Abstraction

The cleanest abstraction is:

**Overlay = a decision-producing unit**  
**Decision source = local class or remote MCP service**

That means `ai-sdd` should stop thinking of overlays as only in-process classes and instead think of them as providers that emit a normalized decision.

### Normalized overlay decision

```ts
type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  updated_context?: Partial<AgentContext>;
  evidence?: {
    overlay_id: string;
    source: "local" | "mcp" | "cli";
    report_ref?: string;
    data?: Record<string, unknown>;
  };
}
```

The engine remains the enforcement point:
1. `PASS` -> continue
2. `REWORK` -> `NEEDS_REWORK`
3. `FAIL` -> `FAILED`
4. `HIL` -> `HIL_PENDING`

This is the key constraint: remote services decide, `ai-sdd` enforces.

## Candidate Remote Overlay

The best first remote overlay is not five different remote overlays. It is one bundle:

`requirements_governor`

### Why this is the best first MCP candidate

It can bundle the highest-value requirements-first checks behind one stable interface:

1. pre-task:
   - lock present?
   - task linked to requirements?
   - planning complete enough to proceed?

2. post-task:
   - scope drift
   - traceability gaps
   - spec hash drift
   - acceptance coverage summary

This gives you one remote governance overlay in the chain instead of scattering remote responsibilities everywhere.

## Proposed Chain

Recommended chain:

1. `hil` local
2. `requirements_governor` remote
3. `policy_gate` local
4. `review` local
5. `paired` local
6. `confidence` local

Why:
1. `hil` must stay local because it owns queue/state behavior
2. remote governance should happen before local review-style overlays
3. local overlays remain fast and tightly coupled to execution state

## What the Remote Server Should Look Like

Current `coding-standards` MCP server is graph-oriented, not overlay-oriented. That is fine. Do not force `ai-sdd` to call raw graph tools directly.

Add a thin MCP facade in `coding-standards`:

`overlay.invoke`

Input:
1. overlay id
2. hook (`pre_task` or `post_task`)
3. task metadata
4. artifact references
5. current task result when applicable
6. governance mode

Output:
1. normalized overlay decision
2. structured evidence

Internally, `coding-standards` can use:
1. `tools/validators`
2. `tools/query-engine`
3. existing scripts
4. graph exporter/lock tooling

`ai-sdd` does not need to know how those internals work.

## Why MCP Is Good Here

MCP is a good fit if you want:

1. clear service boundary
2. reusable governance across multiple orchestrators
3. minimal code import into `ai-sdd`
4. the option to run governance remotely or centrally

MCP is not inherently the best fit for everything. It is best for policy/query/evaluation operations, not for direct runtime ownership.

## Other Options

### Option A: MCP remote overlay

Best long-term architecture.

Pros:
1. clean boundary
2. reusable across tools
3. keeps `ai-sdd` small

Cons:
1. requires MCP client support in `ai-sdd`
2. adds remote failure modes
3. requires a new overlay-oriented MCP facade in `coding-standards`

### Option B: CLI sidecar overlay

Instead of MCP, `ai-sdd` shells out to `coding-standards` CLIs/scripts through a provider adapter.

Pros:
1. easiest first implementation
2. uses existing `validate-lock`, `query-lock`, and scripts directly
3. no MCP client work required initially

Cons:
1. weaker interface contract
2. more brittle process integration
3. less reusable than MCP

This is the best transitional option if you want value fast.

### Option C: CI-only governance

Keep governance entirely outside runtime. Run `coding-standards` only in CI.

Pros:
1. simplest
2. zero engine changes

Cons:
1. no live requirements-first steering during workflow execution
2. issues found late
3. weaker SDD backbone

This is too weak if the goal is to make requirements-first behavior part of the actual workflow.

## Recommended Path

### Near-term

1. add a transport-agnostic overlay provider abstraction to `ai-sdd`
2. keep all existing local overlays working unchanged via adapters
3. implement one external provider mode first: `cli`
4. expose one bundled governance overlay: `requirements_governor`

This gets the architecture right without forcing MCP client work immediately.

### Next step

1. add `McpOverlayProvider`
2. extend `coding-standards` MCP server with `overlay.invoke`
3. switch `requirements_governor` backend from `cli` to `mcp`

This gives you a safe migration path:

1. same overlay contract
2. same engine behavior
3. only transport changes

## Concrete Capability Placement

### Local in `ai-sdd`

1. overlay provider abstraction
2. overlay chain ordering
3. HIL queue and state transitions
4. governance mode config
5. minimal task schema additions
6. prompt constitution / GO protocol

### External in `coding-standards`

1. requirements graph tooling
2. lock validation
3. query/gap analysis
4. reproducibility and drift analysis
5. scope compliance / anti-overengineering checks

### Optional later

1. remote planning review
2. remote release-readiness evaluation
3. remote org-level policy packs

## Final Recommendation

The best of both repos comes from a **hybrid sidecar model**, not a direct merge.

If you want the most pragmatic implementation path:

1. merge only the local primitives `ai-sdd` must own
2. keep `coding-standards` external
3. treat it as a remote governance overlay provider
4. start with a `cli` transport if needed
5. move to MCP once the provider contract is stable

That keeps `ai-sdd` focused, keeps `coding-standards` valuable, and gives you a real requirements-first backbone without building a second monolith inside the first.

