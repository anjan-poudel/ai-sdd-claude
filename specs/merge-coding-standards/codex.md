# Proposal: Incremental Adoption of `coding-standards` into `ai-sdd`

Date: 2026-03-02
Source reviewed: `/Users/anjan/workspace/projects/coding-standards`
Target: `/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude`

## 1) Deep review summary

`coding-standards` is strongest in governance and repeatability operations:
- Deterministic quality gates (`reproducibility-check.sh`, `semantic-drift-check.sh`, spec-hash flow)
- Requirements lock + intake schema discipline (`requirements-input*.schema.yaml`, mode enforcement)
- Graph-based validation/query tooling (`tools/validators`, `tools/query-engine`)
- Explicit workflow governance contracts (`workflow/state-machine.yaml`, `events-contract.md`, state/context schemas)
- Rollout/release checklists and PR control templates (`workflow/*.md`, `rules/pull-request-checklist.md`, `toolgate.yaml`)

`ai-sdd` is strongest in runtime orchestration and agent execution:
- Executable multi-agent DAG engine with retries, loops, overlays, HIL, adapters, MCP server
- Typed expression DSL and artifact contract validation already implemented in runtime
- Observability event schemas and CLI surface (`run`, `status`, `complete-task`, `validate-config`)

Conclusion: do not merge as a monolith. Import governance assets as optional, enforceable layers on top of existing runtime.

## 2) Capability delta (what to merge)

High-value imports from `coding-standards`:
1. Drift and reproducibility gate pack (spec hash + semantic drift + scope exclusion checks)
2. Requirements intake + lock authoring/validation workflow (greenfield/brownfield mode discipline)
3. Traceability validation/query engine (REQ -> TASK -> TEST/CONTRACT gap detection)
4. Formal orchestration contracts (event envelope + state/context schema validation helpers)
5. CI governance templates (tool gates, PR checklist, rollout and release-readiness checklists)
6. Model routing profile abstraction for phase-aware provider/model selection

Lower-priority imports:
1. Extensive reference docs duplicated by current specs
2. Full workflow-state machine replacement (would conflict with existing task-state execution model)

## 3) Merge strategy

Principles:
1. Keep `ai-sdd` runtime model intact.
2. Add governance features as opt-in first, then graduate to default-on after evidence.
3. Land thin vertical slices (script + CLI hook + test + docs) per phase.
4. Prefer importing proven scripts/tools with minimal rewrites.

## 4) Incremental plan

### Phase A (Week 1): Quality Gate Foundation

Goal: add immediate reproducibility and drift protections around current workflows.

Scope:
- Add scripts to `ai-sdd`:
  - `scripts/spec-hash.sh`
  - `scripts/spec-hash-verify.sh`
  - `scripts/reproducibility-check.sh`
  - `scripts/semantic-drift-check.sh`
- Add repo-level config examples:
  - `rules/repro-check.config.example`
  - `rules/pull-request-checklist.md`
  - `toolgate.yaml`
- Add CI workflow to run gates on PRs.

Integration points in `ai-sdd`:
- `.github/workflows/` new gate workflow
- `README.md` + `docs/USER_GUIDE.md` gate usage section

Exit criteria:
1. Gate workflow runs on PR and fails on drift violations.
2. Spec hash can be generated and verified in CI.
3. Scope exclusion check can be toggled via config.

Risk:
- False positives in generic repos (no OpenAPI/lock files).

Mitigation:
- Make OpenAPI and lock-specific checks conditionally enabled per config.

### Phase B (Week 2): Requirements Lock Intake Pipeline

Goal: make requirements discipline first-class before generation/execution.

Scope:
- Import schema assets:
  - `rules/requirements-input.schema.yaml`
  - `rules/requirements-input.po.schema.yaml`
  - sample input files
- Add validator wrapper script:
  - `scripts/validate-requirements-input.sh`
- Add optional lock file contract support:
  - `.ai-sdd/requirements.input.yaml` (pre-lock)
  - `.ai-sdd/requirements.lock.yaml` (approved contract)
- Enforce lock mode (`greenfield|brownfield`) when lock exists.

Integration points in `ai-sdd`:
- `src/cli/commands/validate-config.ts` to validate requirements input/lock when present
- `src/cli/commands/run.ts` preflight checks before workflow start
- `src/types/index.ts` config extension for lock enforcement mode

Exit criteria:
1. `validate-config` reports schema errors for malformed requirements input.
2. `run` fails fast on invalid lock mode when lock is required by config.
3. Backward compatibility maintained for projects not using lock files.

Risk:
- Tight validation blocks teams not ready for lock discipline.

Mitigation:
- Feature flag: `governance.requirements_lock: off|warn|enforce`.

### Phase C (Weeks 3-4): Traceability Engine Integration

Goal: provide measurable REQ/TASK/TEST/CONTRACT coverage evidence.

Scope:
- Vendor or subtree import:
  - `tools/validators` (typed validation engine)
  - `tools/query-engine` (gap analysis queries)
- Add `ai-sdd traceability` CLI command:
  - `validate-lock`
  - `gaps`
  - `coverage --requirement REQ-xxx`
- Connect policy gate overlay to traceability results for T1/T2 tiers.

Integration points in `ai-sdd`:
- `src/cli/commands/` new `traceability.ts`
- `src/overlays/policy-gate/gate-overlay.ts` to optionally enforce traceability pass
- `src/cli/index.ts` command registration

Exit criteria:
1. Can detect `reqsWithoutTasks`, `reqsWithoutTests`, and unjustified contracts.
2. T2 gate can require zero critical traceability gaps.
3. CI uploads machine-readable gap report artifact.

Risk:
- Schema mismatch between `coding-standards` lock structure and `ai-sdd` artifacts/workflows.

Mitigation:
- Adapter layer mapping `ai-sdd` workflow/task outputs into lock graph nodes.

### Phase D (Week 5): Governance Contracts and Release Ops

Goal: production-grade operational contracts for orchestration and rollout.

Scope:
- Import governance docs/schemas:
  - `workflow/events-contract.md`
  - `workflow/state-store.schema.json`
  - `workflow/context.schema.json`
  - validation helper scripts
- Align `ai-sdd` observability/state payloads with schema validation.
- Add rollout checklists:
  - `workflow/production-rollout-checklist.md`
  - `workflow/release-readiness-v1.md`

Integration points in `ai-sdd`:
- `src/observability/events.ts` alignment checks
- `src/core/state-manager.ts` export/validation hooks
- `src/core/context-manager.ts` context bundle schema checks

Exit criteria:
1. State and context examples validate against schemas in CI.
2. Event envelope compatibility documented and tested.
3. Release readiness checklist used for first gated release.

Risk:
- Over-constraining a flexible orchestrator for varied project types.

Mitigation:
- Keep schema checks at "warn" for non-regulated templates; "enforce" for regulated template.

### Phase E (Week 6): Model Routing Profiles

Goal: improve reliability/cost via phase-aware provider-model routing.

Scope:
- Add `agents/model-routing.yaml` support.
- Add CLI utilities similar to:
  - `scripts/dryrun.sh`
  - `scripts/run-phase.sh`
- Allow task category/phase to choose model profile rather than static per-agent model only.

Integration points in `ai-sdd`:
- `src/core/agent-loader.ts` / adapter factory path
- `src/cli/commands/run.ts` task dispatch resolution

Exit criteria:
1. Dry-run shows selected provider/model per task.
2. Routing overrides applied without breaking existing agent configs.

Risk:
- Routing conflicts with agent `llm.model` declaration semantics.

Mitigation:
- Precedence contract: task override > routing profile > agent default.

## 5) Recommended execution order

1. Phase A
2. Phase B
3. Phase C
4. Phase D
5. Phase E

Reason: this sequence delivers immediate quality protection first, then requirement discipline, then deeper traceability and governance formalization.

## 6) Success metrics

Technical:
1. PR gate pass/fail reasons are deterministic and reproducible.
2. Drift incidents detected pre-merge (target: >80% of semantic drift class issues caught by CI gates).
3. Traceability critical gap count trends downward release-over-release.
4. Mean time to diagnose failed workflow run reduced by schema-validated state/context artifacts.

Adoption:
1. % projects using `requirements.input.yaml` and/or `requirements.lock.yaml`.
2. % workflows executed with governance mode `enforce`.
3. # releases passing release-readiness checklist without bypass.

## 7) Explicit non-goals (for first merge cycle)

1. Replacing `ai-sdd` engine/state machine with `coding-standards` state machine.
2. Forcing lock-based workflow on every template immediately.
3. Rewriting existing overlays/adapters before governance assets land.

## 8) First implementation ticket set (ready to create)

1. Import gate scripts + add PR CI gate workflow.
2. Add governance config block (`off|warn|enforce`) and wire into `validate-config`.
3. Add requirements input schema validation command path.
4. Add optional lock mode validation in `run` preflight.
5. Add docs section: "Governance Pack (experimental)" with migration path.

