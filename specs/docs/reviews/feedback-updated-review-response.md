# Response to feedback-updated-review.md

**Date:** 2026-02-28

---

## Accepted and Fixed

### Gap 1: Context Limit Warning System
**Files changed:** T010, T011, T016, CONTRACTS.md

- **T010**: Added `cost_enforcement: pause` (warn|pause|stop), `context_warning_threshold_pct: 80`, `context_hil_threshold_pct: 95` to engine config block.
- **T011**: Added `context.warning` event type to event table (with `pct_used`, `largest_artifact_paths`). Added two Gherkin scenarios: warning at 80% (non-blocking), HIL escalation at 95% in direct mode. Updated `cost.budget_exceeded` note to reference `cost_enforcement` mode.
- **T016**: Added "Pull Model: Advisory Guidance, Not Enforcement" section — clarifies the three escalation layers (warning event → HIL → provider error) and that the pull model is instructional, not a runtime restriction.
- **CONTRACTS.md §10**: Added three rows — `cost_enforcement`, `context_warning_threshold_pct`, `context_hil_threshold_pct`.

### Safeguard 1: Cost Budget Enforcement Mode
**File changed:** T010

Added `cost_enforcement: pause` to engine config (warn | pause | stop). The default `pause` triggers a HIL item when budget is exceeded, which is the safe default for interactive workflows. `stop` sets task to FAILED immediately (useful for unattended CI). `warn` logs only (useful for cost tracking without blocking).

### Safeguard 2: Circuit Breaker
**File changed:** T015

Added `circuit_breaker_failures: 5` and `circuit_breaker_reset_seconds: 60` to adapter retry/backoff config defaults. After N consecutive failures the adapter is temporarily disabled for the cool-off period then re-enabled.

### Q1 (Critical Question): What if an agent reads all artifacts anyway?
**File changed:** T016

Added "Pull Model: Advisory Guidance, Not Enforcement" section explaining: the engine cannot prevent an agent from reading files; the safeguards are event-based signals (`context.warning`, HIL escalation, provider `context_limit` error). Agents that follow the reading convention stay within limits; agents that don't will hit the warning/HIL path.

### Q3 (Critical Question): Delegation mode tool failure fallback
**File changed:** T004

Added a note under the RuntimeAdapter Interface section: tool call failures inside a delegation session surface to the engine as `TaskResult(status=FAILED, error_type=tool_error)`. Added `tool_error` to T015 error taxonomy (retryable, e.g. Read timeout / MCP server unavailable). Updated `AdapterError.error_type` literal and `retry_on` defaults.

---

## Pushed Back

### Gap 2: Artifact Contract Validation vs Pull Model Conflict
**Not a conflict.** Contract validation runs at *write time* inside `ai-sdd complete-task` step 3 — it validates the artifact that the producing agent just wrote, before it is committed to disk. The consuming agent's selective reading happens later and is entirely separate. There is no mismatch: validation is always full (one validation event per `complete-task`), reading is always selective. Adding validation levels would add complexity with no correctness benefit. The spec already supports bare-path contracts (Level 1, no registry, no section check) as the lightweight option.

### Gap 3: Integration Compatibility Matrix + `ai-sdd check-compatibility` CLI
Not a Phase 1 spec concern. The delegation dispatch model intentionally isolates adapter changes. Each integration task (T018/T019/T020) will document tested tool versions in its README at implementation time. Adding `compatibility.yaml` schema and a new CLI command to Phase 1 scope would inflate it for a problem that doesn't yet exist. Deferred to Phase 3 implementation.

### Strategic Risk 1: Cut T012 (Expression DSL) and T013 (Artifact Contract) to Phase 2
T012 is a security and correctness requirement (INDEX.md Key Design Decision #1: "no workflow runs with raw string exit_conditions"). Deferring it doesn't give you "simple boolean conditions" — it gives you either an unsafe `eval()` call or no conditions at all. This was a deliberate architectural choice made in the Level-2 synthesis to prevent injection attacks. Not moving it.

T013 already has three levels. Level 1 is a bare path (no registry, no section check) and adds near-zero overhead to Phase 1. The spec does not force projects to use Level 2 or 3 contracts. The concern about "overhead" is moot at Level 1.

### Strategic Risk 3: `ai-sdd init --wizard`
Phase 4 DX scope. The first-workflow SLO (≤30 min) is already a formal target in T010. A wizard that asks 5–7 questions is a worthwhile DX improvement but not a pre-sign-off requirement and not a Phase 1 item.

### Safeguard 3: Hard Memory Limit (`engine.max_memory_mb`)
Wrong layer for a spec. Hard memory limits are OS-level concerns (`ulimit -v`, `cgroups`, Docker `--memory`). Implementing them in Python requires platform-specific code (`resource.setrlimit` on Unix, unavailable on Windows) and adds significant complexity for marginal gain — the operator's deployment environment is the right place to enforce this. The existing `observability.memory_warning_mb` (emit an event at threshold) is the correct spec-level mechanism.

### Q2: Schema migrations between phases
Already answered. T010 has `ai-sdd migrate` CLI interface. CONTRACTS.md §9 has the schema versioning contract. `--allow-legacy-untyped-artifacts` handles the transition when artifact contracts are added to an existing project. No new spec work required.

### Q4: How are partial reads validated?
Same answer as Gap 2. Contract validation is a write-time operation on the produced artifact. What an agent subsequently reads is not subject to contract validation — it is the agent's own context management decision.

---

## Summary

| Finding | Decision |
|---|---|
| Gap 1: Context limit warning | Fixed — T010 + T011 + T016 + CONTRACTS.md |
| Gap 2: Validation vs pull model | Pushed back — not a conflict |
| Gap 3: Compatibility matrix + CLI | Pushed back — Phase 3 implementation concern |
| Strategic Risk 1: Cut T012/T013 | Pushed back — T012 is security-critical; T013 Level 1 is near-zero overhead |
| Strategic Risk 3: Init wizard | Pushed back — Phase 4 DX scope |
| Safeguard 1: Cost enforcement mode | Fixed — T010 |
| Safeguard 2: Circuit breaker | Fixed — T015 |
| Safeguard 3: Hard memory limit | Pushed back — OS-level concern |
| Q1: Pull model enforcement | Fixed — T016 clarification |
| Q2: Schema migrations | Pushed back — already answered |
| Q3: Delegation tool failures | Fixed — T004 + T015 |
| Q4: Partial read validation | Pushed back — same as Gap 2 |
