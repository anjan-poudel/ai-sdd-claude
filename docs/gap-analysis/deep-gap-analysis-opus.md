# Deep Gap Analysis (Opus)

**Scope:** ai-sdd implementation at `/src`, CLI surface, config, adapters, overlays.
**Method:** Independent code review + verification of Codex and Gemini analyses. Every claim below is backed by a file:line reference.

## Meta-Review: Codex and Gemini Analyses

Both analyses are factually accurate. I verified all 13 claims; 12 confirmed, 1 partially confirmed. Where they differ is in framing and what they miss.

### Where Codex is stronger
- Better severity calibration. It correctly separates "broken" from "incomplete" from "misleading."
- More actionable. The 7-point priority order is executable.
- Honest about the positive signals (DAG loading, HIL resume, security primitives).

### Where Gemini is stronger
- Cleaner categorization (Orchestration, Type Safety, Phantom Surface).
- The "Phantom Operational Surface" framing is precisely right — it names the pattern rather than listing instances.
- More decisive on remediation: "prune the phantom surface" vs Codex's "either implement or remove."

### Where both are wrong or incomplete

1. **They overweight typecheck.** Both rank it #1 severity. It is not. The 53 errors are almost entirely `exactOptionalPropertyTypes` violations and missing `@types/bun` — mechanical fixes that don't change runtime behavior. The real #1 is the adapter completion boundary, because that is a *safety* gap, not a *hygiene* gap.

2. **They underweight the overlay chain's actual enforcement model.** Both note that Review is a passthrough and Paired is unimplemented, but neither asks the harder question: *does the overlay chain enforce its own composition rules?* It does — `src/overlays/composition-rules.ts` enforces order and mutual exclusivity at load time. The real gap is that individual overlays within the enforced chain can be no-ops, which means the chain is structurally sound but semantically hollow for certain configurations.

3. **Neither identifies the engine's missing output validation.** Engine at `engine.ts:464` accepts `result.outputs` from adapters without validating them against the task's declared `outputs` paths. This is distinct from the adapter boundary issue — even if all adapters used `complete-task`, the engine itself does not verify the contract.

4. **The `--resume` finding is overstated by both.** Codex calls it a "misleading contract." Gemini calls it a "dead flag." The code comment at `run.ts:120` explicitly says it is kept for backward compatibility. This is a documentation gap, not an implementation gap. The behavior (auto-resume) is correct.

5. **Neither addresses the task library's untested merge semantics.** `workflow-loader.ts` implements a 4-layer merge (ENGINE_TASK_DEFAULTS -> workflow defaults -> `use:` template -> task inline), but library templates that override overlay settings are not tested for precedence. A `use: standard-implement` that sets `hil.enabled: false` will silently override a workflow-level `defaults.hil.enabled: true`. There is no test or warning for this.

---

## Findings

Ordered by actual risk to the framework's mission (safe, deterministic workflow execution), not by ease of fix.

### 1. Adapter completion boundary is not enforced

**Severity: Critical**

The architecture document says `complete-task` is the single atomic transaction boundary. In practice:

- `ClaudeCodeAdapter` instructs the agent to call `complete-task` via CLI — correct pattern. (`claude-code-adapter.ts:107`)
- `OpenAIAdapter` writes files directly via `writeFileSync` + `renameSync` and returns populated `outputs[]`. (`openai-adapter.ts:132-140`)
- Engine accepts adapter-returned outputs at face value. (`engine.ts:464`)

This means: security sanitization, path allowlisting, and contract validation in `complete-task.ts:46-79` are bypassed for OpenAI adapter workflows. The safety model is adapter-dependent.

**What to do:** Two options, pick one:
- (a) Remove file-writing from adapters entirely. Adapters return content; engine routes through `complete-task` internally.
- (b) Extract the validation logic from `complete-task` into a shared function and call it from the engine's output acceptance path.

Option (b) is simpler. Option (a) is more correct long-term.

### 2. Engine does not validate adapter outputs against task declarations

**Severity: High**

Even when `complete-task` is used, the engine at `engine.ts:464-465` does:
```typescript
const outputs: TaskOutput[] = result.outputs ?? [];
this.stateManager.transition(taskId, "COMPLETED", { outputs });
```

It never checks:
- Whether `outputs` paths match the task's declared output paths
- Whether the number of outputs matches expectations
- Whether required outputs are present

The `complete-task` CLI command does path validation, but the engine's internal acceptance path does not. A well-behaved adapter could still produce unexpected outputs.

**What to do:** Add output validation in the engine between receiving adapter results and transitioning to COMPLETED. This is ~15 lines.

### 3. Confidence threshold is advisory but presented as configurable

**Severity: High** (disagree with both analyses rating this Medium)

`confidence-overlay.ts` stores `this.threshold` and emits it, but always returns `accept: true`. The config surface lets operators set `confidence.threshold: 0.9`, implying it will gate task completion. It does not.

This is not the same as PairedOverlay (which fails loudly) or ReviewOverlay (which checks handover state). ConfidenceOverlay is the only overlay that *silently ignores its own configuration*.

**What to do:** Either:
- Gate: when `score < threshold`, return `accept: false, new_status: "NEEDS_REWORK"` with feedback including the score.
- Or make it explicit: rename the config to `confidence.advisory_threshold` and document that it is informational only.

### 4. `status --next --json` returns blocked tasks

**Severity: High**

`status.ts:84-89` filters by `status === "PENDING"` without checking the workflow DAG. Downstream consumers (MCP `get_next_task`, IDE integrations) will schedule work on blocked tasks.

The fix requires loading the workflow definition alongside state and computing readiness. This is not trivial because `status` currently only loads state, not the workflow graph.

**What to do:** Import `WorkflowLoader` in `status.ts`. For `--next`, load the active workflow, build the dependency map, and filter PENDING tasks to only those whose dependencies are all COMPLETED.

### 5. TypeScript strict mode is not satisfied

**Severity: Medium** (both analyses say High; I disagree)

53 errors from `tsc --noEmit`. Breakdown:
- ~30 are `exactOptionalPropertyTypes` violations (`paths: undefined` assigned to `paths?: string[]`)
- ~15 are missing `@types/bun` (Bun.spawn, Bun.file)
- ~5 are genuine type unsoundness (unsafe casts in workflow-loader, missing override modifiers)
- ~3 are in test files

The `exactOptionalPropertyTypes` errors are the strictest TypeScript setting — most projects don't enable it. The Bun typing issues are environment-specific.

I rate this Medium because:
- Runtime behavior is unaffected (all 177 tests pass)
- The fixes are mechanical (add `| undefined`, install `@types/bun`, add `override`)
- No architectural decision is needed

That said, it should be a CI gate. Mechanical does not mean unimportant.

**What to do:** Fix in one pass. Install `@types/bun`. Replace `undefined` assignments with omitted properties. Add `override` modifiers. Budget: 2-3 hours.

### 6. Observability emitter accepts untyped event strings

**Severity: Medium**

`emitter.ts:55` accepts `type: string`, not `type: EventType`. Four events are emitted without type coverage:
- `task.hil_resuming` (engine.ts:261)
- `task.hil_pending` (engine.ts:533)
- `paired.not_implemented` (paired-overlay.ts:33)
- `hil.notify_failed` (hil-overlay.ts:164)

The fix is two-part: add the 4 events to `EventType`, then change `emit()` signature to accept `EventType` only.

**What to do:** Add events to the union type, tighten `emit()` signature, fix any resulting compile errors. ~30 minutes.

### 7. Task library merge precedence is untested

**Severity: Medium** (missed by both analyses)

`workflow-loader.ts` implements ENGINE_TASK_DEFAULTS -> workflow defaults -> `use:` template -> task inline. But:
- No test verifies that a `use:` template's overlay settings correctly override workflow defaults
- No test verifies that task inline correctly overrides `use:` template
- The merge at `workflow-loader.ts:114` uses object spread, which does shallow merge — nested overlay config may not merge as expected

A library template setting `hil.enabled: false` will silently win over a workflow default of `hil.enabled: true` if the template is applied after defaults. This is by design, but there is no test proving it and no documentation warning about it.

**What to do:** Add 3 tests: template overrides default, inline overrides template, nested overlay merge works correctly.

### 8. `validate-config` checks only one workflow path

**Severity: Low**

`validate-config.ts:32` only checks `.ai-sdd/workflow.yaml`. The runtime (`run.ts:50-94`) checks 6 paths. A workflow at `specs/workflow.yaml` (the recommended greenfield location per CLAUDE.md) will not be validated.

**What to do:** Extract the workflow resolution logic from `run.ts` into a shared function. Use it in both `run` and `validate-config`.

### 9. Dead config fields

**Severity: Low**

Three fields are parsed but never read:
- `rate_limit_requests_per_minute` (defaults.ts:19)
- `context_warning_threshold_pct` (defaults.ts:22)
- `context_hil_threshold_pct` (defaults.ts:23)

Plus `governance.requirements_lock` (defaults.ts:46-48) — parsed but never checked anywhere.

**What to do:** Remove from config surface. Add back when implemented. Dead config is worse than missing config because it implies control that doesn't exist.

### 10. `migrate` command succeeds without doing anything

**Severity: Low**

`migrate.ts:20` prints a message and exits 0. State loaders at `config-loader.ts:76` and `state-manager.ts:37` tell users to run `ai-sdd migrate` on schema mismatch.

**What to do:** Make it exit with code 1 and print "Migration is not yet implemented. Manual recovery: [instructions]." Remove the placeholder URL.

---

## What Both Analyses Got Right

- The core diagnosis is correct: **contract drift** is the primary risk.
- The architecture is sound. DAG loading, HIL state machine, overlay composition rules, atomic state persistence — these work.
- The project is usable for controlled workflows but not yet hardened.
- Feature development should pause until convergence is achieved.

## What I Would Add

### The real severity ranking

| # | Finding | Risk | Effort |
|---|---------|------|--------|
| 1 | Adapter completion boundary | Safety | M |
| 2 | Engine output validation | Safety | S |
| 3 | Confidence threshold ignored | Trust | S |
| 4 | status --next blocked tasks | Correctness | M |
| 5 | typecheck failures | Hygiene | M |
| 6 | Untyped observability events | Contract | S |
| 7 | Task library merge untested | Correctness | S |
| 8 | validate-config single path | Correctness | S |
| 9 | Dead config fields | Trust | XS |
| 10 | migrate stub exits 0 | Trust | XS |

S = small (< 1 day), M = medium (1-2 days), XS = trivial (< 1 hour)

### The execution sequence

**Week 1: Safety**
- Fix #1 (adapter boundary) and #2 (engine output validation)
- These are the only findings that can cause silent data integrity issues

**Week 2: Correctness**
- Fix #4 (status --next) and #7 (merge precedence tests)
- Fix #5 (typecheck) — mechanical but time-consuming

**Week 3: Trust**
- Fix #3 (confidence threshold), #6 (observability), #8 (validate-config)
- Fix #9 (dead config) and #10 (migrate) — trivial

## Bottom Line

Both prior analyses correctly identify the disease (contract drift) but misprior the symptoms. Typecheck failures are the most visible gap but not the most dangerous. The adapter completion boundary and engine output validation gaps are the ones that can cause silent correctness violations in production workflows.

The project needs 2-3 focused weeks of convergence work, not months. The architecture does not need redesign — it needs its own contracts enforced.
