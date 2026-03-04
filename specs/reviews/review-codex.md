# Re-Review Feedback: ai-sdd-synthesis-2-claude

Date: 2026-02-27
Reviewer: Codex

## Summary

The spec has improved significantly and resolves most previously identified concerns. However, several cross-document inconsistencies remain. The most important are security contract contradictions, constitution section ownership mismatch, and gate/sign-off evidence mismatch.

## Findings (Ordered by Severity)

### 1. Security contract still inconsistent (blocking vs redaction + config namespace)

- Evidence:
  - `CONTRACTS.md` step 2 implies sanitization/redaction in task completion flow.
  - `T017` requires secret in task output to block write and transition to `NEEDS_REWORK`.
  - `T010` and `T011` still reference `observability.secret_patterns`, while canonical contract says `security.secret_patterns`.
- Impact:
  - Ambiguous runtime behavior at exactly the highest-risk point (secrets in artifacts).
- Suggestion:
  - Normalize everywhere:
    - Task output secret -> **block completion**, `NEEDS_REWORK`, no filesystem write.
    - Log/event secret -> **redact only**, non-blocking.
    - Single namespace: `security.secret_patterns`.

### 2. Reading Convention ownership still contradictory between T003 and T016

- Evidence:
  - `T003` treats `## Reading Convention` as AUTO-GENERATED section.
  - `T016` says engine owns only `## Workflow Artifacts`; Reading Convention is user-authored.
- Impact:
  - Resolver and manifest writer cannot be implemented deterministically.
- Suggestion:
  - Align `T003` to `T016` + `CONTRACTS.md`: only `## Workflow Artifacts` is engine-owned.

### 3. Pre-implementation gate claims PASSED but evidence/sign-offs are incomplete

- Evidence:
  - `PRE-IMPLEMENTATION-GATE.md` marked PASSED.
  - Sign-off table is blank.
  - `T000-spec-gate.md` marked COMPLETED but checklist entries are still unchecked.
- Impact:
  - Governance process appears inconsistent and weakens trust in gate status.
- Suggestion:
  - Either:
    - mark status as `READY_FOR_SIGNOFF`, or
    - complete checklist and fill required sign-off records.

### 4. Adapter identity naming still mixed (`operation_id` vs `idempotency_key`)

- Evidence:
  - Canonical docs introduce `operation_id`/`attempt_id`.
  - Several task docs/examples still use `idempotency_key` in adapter signatures/tests.
- Impact:
  - Interface drift and implementation churn.
- Suggestion:
  - Normalize all adapter signatures, acceptance criteria, and tests to `operation_id` + `attempt_id`.

### 5. MCP helper likely breaks `get_constitution()` typing

- Evidence:
  - MCP tool `get_constitution()` is typed as string.
  - Shared `_run_cli` always JSON-decodes stdout.
- Impact:
  - Runtime failure for text-returning CLI commands.
- Suggestion:
  - Split helper into `_run_cli_json` and `_run_cli_text`, or add `ai-sdd constitution --json`.

### 6. Confidence independence policy contradicted in same doc

- Evidence:
  - `T007` enforces evaluator agent must differ from task agent.
  - Later implementation note says the agent itself scores its own output.
- Impact:
  - Direct conflict in acceptance vs implementation guidance.
- Suggestion:
  - Replace implementation note with explicit evaluator-agent flow.

### 7. HIL config nesting inconsistent (`overlays.hil` vs top-level `hil`)

- Evidence:
  - `T010` places notify config under `overlays.hil`.
  - `T005` sample uses top-level `hil`.
- Impact:
  - Config parser ambiguity.
- Suggestion:
  - Keep one hierarchy (recommended: `overlays.hil`) across all docs.

### 8. Some docs still use stale vocabulary and stale architecture references

- Evidence:
  - `TASK-VISUALIZATION.md` still uses `--tool openai` examples.
  - `T010` still mentions `ContextReducer` in config comment.
- Impact:
  - Reader confusion and onboarding friction.
- Suggestion:
  - Run one final consistency pass across `INDEX`, `PLAN`, `TASK-VISUALIZATION`, and task files.

## Final Recommendation

The spec is close to implementation-ready. Resolve findings 1-4 before implementation starts, then perform a short consistency pass (5-8) to avoid avoidable churn during Phase 1.
