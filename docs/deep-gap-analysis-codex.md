# Deep Gap Analysis

Scope: current `ai-sdd` implementation only.

Method:

- source audit across `src/`, selected docs, and task-library assets
- runtime verification with `bun test`
- static verification with `bun run typecheck`
- implementation-to-doc/spec drift review

## Executive Summary

The project is further along than the surrounding planning docs suggest, but there are still several important implementation gaps.

The biggest pattern is this:

- runtime tests pass under Bun
- the TypeScript contract is not actually healthy
- some CLI and adapter behavior diverges from the documented operating model
- several “configurable” or “supported” features are only partially wired

This means the repo is usable for controlled workflows, but not yet internally coherent enough to be treated as a hardened orchestration framework.

## Verification Snapshot

### `bun test`

Result: passes locally.

Interpretation:

- the runtime paths covered by tests are mostly stable
- however, the tests do not prove that the documented contract is complete

### `bun run typecheck`

Result: fails with many errors across both `src/` and `tests/`.

Interpretation:

- the project currently does not satisfy its own strict TypeScript posture
- type safety is weaker than the code layout suggests

## Findings

## 1. Static type safety is broken across the codebase

Severity: High

Evidence:

- `tsconfig.json` enables strict settings including `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noUncheckedIndexedAccess`
- `bun run typecheck` fails on core source files and tests
- representative failures include:
  - missing Bun typing support in runtime code such as [claude-code-adapter.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/adapters/claude-code-adapter.ts:53) and [hil-overlay.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/hil/hil-overlay.ts:156)
  - exact-optional-property mismatches in [complete-task.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/complete-task.ts:174), [manifest-writer.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/constitution/manifest-writer.ts:29), and [defaults.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/config/defaults.ts:10)
  - type unsoundness in [workflow-loader.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/workflow-loader.ts:114)

Why this matters:

- strict TypeScript is currently not enforceable as a quality gate
- future refactors will rely more on tests than on compiler guarantees
- remote overlay and ecosystem integration work will become riskier because the core contracts are already loose

Recommendation:

- treat `typecheck` as a release blocker
- first fix Bun type support and `exactOptionalPropertyTypes` violations
- then remove unsafe casts and `Record<string, unknown>` coercions from config and workflow code

## 2. The task completion boundary is inconsistent across adapters

Severity: High

Evidence:

- `complete-task` is described as the atomic completion boundary in [complete-task.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/complete-task.ts:2)
- `ClaudeCodeAdapter` tells the agent to run `ai-sdd complete-task`, but the adapter itself runs `claude --print` and then returns `COMPLETED` with `outputs: []` and `handover_state.raw_output` in [claude-code-adapter.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/adapters/claude-code-adapter.ts:91) and [claude-code-adapter.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/adapters/claude-code-adapter.ts:145)
- `OpenAIAdapter` writes files directly in [openai-adapter.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/adapters/openai-adapter.ts:174) instead of using `complete-task`
- the engine then marks the task completed directly in [engine.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/engine.ts:463)

Why this matters:

- security sanitization, output allowlisting, and contract validation are not guaranteed on all execution paths
- the architecture says “complete-task is the transaction boundary”, but actual runtime behavior depends on adapter choice
- this is exactly the kind of drift that causes hard-to-debug cross-adapter behavior

Recommendation:

- choose one completion model and make it universal
- either:
  - all adapters must produce outputs through the engine’s validated write path
- or:
  - all adapters must delegate finalization through `complete-task`, and the engine must wait for that outcome rather than assuming completion

## 3. `status --next --json` is not dependency-aware

Severity: High

Evidence:

- the CLI advertises “next ready tasks” in [status.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/status.ts:59)
- implementation returns every task whose state is `PENDING`, without checking dependencies, in [status.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/status.ts:83)

Why this matters:

- the MCP tool `get_next_task` depends on this command
- MCP/agent clients can be told to work on blocked tasks
- external orchestration or IDE tooling built on top of `status --next --json` will make invalid scheduling decisions

Recommendation:

- load the active workflow graph and compute readiness against dependency completion
- add regression tests specifically for blocked-vs-ready tasks

## 4. Several CLI contracts are implemented only partially or misleadingly

Severity: High

Evidence:

- `--resume` is documented as meaningful in [README.md](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/README.md:137) and [USER_GUIDE.md](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/docs/USER_GUIDE.md:520), but `run.ts` explicitly makes it a no-op via unconditional state load in [run.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/run.ts:119)
- `status --metrics` is advertised in [README.md](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/README.md:151) and declared in [status.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/status.ts:60), but no metrics branch exists
- `serve --mcp --port 3000` is documented in [README.md](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/README.md:203) and [USER_GUIDE.md](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/docs/USER_GUIDE.md:593), but `serve.ts` supports no `--port` option in [serve.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/serve.ts:8)
- `validate-config` claims to validate workflow config, but only checks `.ai-sdd/workflow.yaml` in [validate-config.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/validate-config.ts:32), while runtime lookup in `run.ts` includes `specs/workflow.yaml`, feature workflows, and named workflows

Why this matters:

- operator expectations do not match actual runtime behavior
- downstream tool integrations can rely on options that are not real
- config validation can pass even when the workflow actually used by `run` is invalid

Recommendation:

- either implement the documented options fully or remove them from docs and help text
- align `validate-config` with the same workflow resolution logic used by `run`

## 5. Migration is still a stub but presented as a supported command

Severity: High

Evidence:

- the command exists in [migrate.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/migrate.ts:8)
- it always exits successfully after printing a placeholder message in [migrate.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/migrate.ts:20)
- it points to a placeholder URL in [migrate.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/migrate.ts:42)
- state/config loaders still instruct the user to “run ai-sdd migrate” on schema mismatch in [config-loader.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/config-loader.ts:76) and [state-manager.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/state-manager.ts:37)

Why this matters:

- recovery guidance is currently false confidence
- in a real schema bump, users will hit a dead-end path with a success exit code

Recommendation:

- until implemented, make `migrate` fail non-zero with an explicit “not implemented” status
- remove placeholder URL
- document a tested manual recovery procedure if migration remains deferred

## 6. Observability contracts are out of sync with emitted events

Severity: Medium

Evidence:

- the declared event types stop at the set in [index.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/types/index.ts:300) and [events.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/observability/events.ts:1)
- additional events are emitted but not typed/specified:
  - `task.hil_resuming` in [engine.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/engine.ts:261)
  - `task.hil_pending` in [engine.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/engine.ts:533)
  - `hil.notify_failed` in [hil-overlay.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/hil/hil-overlay.ts:164)
  - `paired.not_implemented` in [paired-overlay.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/paired/paired-overlay.ts:33)

Why this matters:

- event consumers cannot rely on a complete contract
- remote integrations and observability pipelines will drift from reality
- the project is already using observability as a contract surface, so partial typing is not enough

Recommendation:

- either fully type/spec every emitted event or explicitly make observability untyped
- the current middle state is misleading

## 7. Governance settings exist in config but are not wired into behavior

Severity: Medium

Evidence:

- governance defaults are defined in [defaults.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/config/defaults.ts:46)
- remote governance sections are parsed in [config-loader.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/config-loader.ts:93)
- a repo-wide search shows no runtime read path that changes local engine behavior based on `governance.requirements_lock`

Why this matters:

- `off | warn | enforce` looks like a real control knob, but today it is mostly schema surface
- configuration that does not affect runtime is operational debt

Recommendation:

- either wire governance mode into concrete checks now
- or remove it from the main config surface until it is behaviorally real

## 8. Review and paired overlays are not equivalent to their names

Severity: Medium

Evidence:

- `ReviewOverlay` does not run a reviewer loop; it only inspects `handover_state.review.decision` and otherwise passes through in [review-overlay.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/review/review-overlay.ts:20)
- `PairedOverlay` is explicitly not implemented and turns enabled usage into rework in [paired-overlay.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/paired/paired-overlay.ts:29)

Why this matters:

- overlay names imply substantive workflow behavior that does not currently exist
- “enabled” can mean “works”, “passes through”, or “fails loudly” depending on overlay

Recommendation:

- rename placeholders if they are intentionally skeletal
- or implement the real secondary-dispatch behavior before presenting them as workflow primitives

## 9. Some engine/config fields are dead or only partially honored

Severity: Medium

Evidence:

- config exposes `rate_limit_requests_per_minute`, `context_warning_threshold_pct`, and `context_hil_threshold_pct` in [config-loader.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/config-loader.ts:21) and [defaults.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/config/defaults.ts:17)
- a repo-wide search shows no runtime enforcement for those fields
- `ConfidenceOverlay` emits the threshold but does not act on it in [confidence-overlay.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/confidence/confidence-overlay.ts:32)

Why this matters:

- the config surface is larger than the real runtime surface
- operator tuning becomes guesswork when some knobs are inert

Recommendation:

- shrink the config to active fields only, or implement behavior for the dormant ones

## 10. Documentation is stale relative to implemented workflow resolution

Severity: Low

Evidence:

- `run.ts` resolves workflows from CLI name, feature workflow, `specs/workflow.yaml`, `.ai-sdd/workflow.yaml`, configured workflow name, default workflow, and bundled default in [run.ts](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/run.ts:40)
- the user guide still describes the old shorter search order in [USER_GUIDE.md](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/docs/USER_GUIDE.md:574)

Why this matters:

- people debugging workflow resolution will read the wrong model
- this also makes `validate-config` drift harder to notice

Recommendation:

- generate CLI/help docs from code paths where possible
- otherwise update docs whenever workflow resolution changes

## Positive Signals

The project does have several strong implementation qualities already:

- workflow DAG loading and dependency validation are present
- HIL resume handling is explicitly tested
- provider-chain abstraction for local and MCP overlays is in place
- security sanitizers and artifact validation primitives exist
- the state manager is small, deterministic, and mostly clean
- Bun runtime tests currently provide decent behavioral coverage

The issue is not lack of architecture. The issue is incomplete convergence between architecture, runtime behavior, and public contract.

## Priority Order

Recommended execution order:

1. Fix `typecheck` until it passes cleanly.
2. Unify task completion semantics across adapters.
3. Fix `status --next --json` to compute true readiness.
4. Remove or implement misleading CLI/doc features: `--metrics`, `--port`, `--resume`, `migrate`.
5. Wire or remove dead governance/config fields.
6. Normalize event contracts so observability is trustworthy.
7. Decide whether review/paired overlays are real features or placeholders.

## Bottom Line

`ai-sdd` is not blocked by lack of ideas. It is blocked by contract drift.

The core orchestration shape is good. The main gaps are:

- static correctness is not enforced
- completion semantics differ by adapter
- some CLI and config surfaces promise more than they deliver
- observability and governance contracts are only partially real

That means the next stage should be convergence and hardening, not more feature surface.
