# Review Feedback: `ai-sdd-synthesis-2-claude`

Date: 2026-02-27
Reviewer: Codex

## Overall Assessment

This synthesis is strong in architecture direction: DSL hardening, artifact contracts, overlay composition testing, and tool-native integrations are meaningful upgrades.
The main gaps are not conceptual; they are **contract consistency and failure semantics**. 
A few contradictions would create implementation churn or unsafe runtime behavior if not resolved before build-out.

## Findings (Ordered by Severity)

### Critical

1. **Idempotency contract is self-contradictory and breaks retry deduplication**
- Evidence:
  - `T015` requires idempotency key reuse on retry/resume ([tasks/T015-adapter-reliability.md:57](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T015-adapter-reliability.md:57)).
  - Same file’s reference implementation includes `attempt` in key generation ([tasks/T015-adapter-reliability.md:113](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T015-adapter-reliability.md:113)).
- Why this matters: including `attempt` changes the key each retry, so provider-side dedup cannot work.
- Recommendation:
  - Define two keys explicitly:
    - `operation_id` (stable across retries/resume): `workflow_id:task_id:task_run_id`
    - `attempt_id` (changes per retry): append `:attempt_n`
  - Require adapters to send `operation_id` to provider idempotency headers and log both IDs.

2. **Tool selector contract is inconsistent (`openai` vs `codex`)**
- Evidence:
  - `T010` uses `ai-sdd init --tool openai` ([tasks/T010-cli-and-config.md:77](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T010-cli-and-config.md:77)).
  - `T019` uses `ai-sdd init --tool codex` ([tasks/T019-codex-integration.md:64](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T019-codex-integration.md:64)).
- Why this matters: `init` UX and template routing become ambiguous; docs/tests will diverge immediately.
- Recommendation:
  - Normalize CLI vocabulary now. Suggested:
    - `--tool codex` for CLI UX path
    - `adapter.type: openai` for API runtime path
  - Add explicit alias/deprecation behavior if `openai` is kept as accepted CLI input.

3. **MCP `complete_task` write-then-run flow is non-atomic and unsafe**
- Evidence:
  - `T020` `complete_task` writes arbitrary path content directly, then executes `ai-sdd run --task` ([tasks/T020-roo-code-integration.md:155](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T020-roo-code-integration.md:155)).
- Why this matters:
  - Partial completion possible (file written, task not advanced).
  - Path traversal risk (`../../`) if not constrained.
  - Bypasses a single transaction boundary for sanitization + contract validation + state mutation.
- Recommendation:
  - Replace with engine-native command/API: `ai-sdd complete-task --task <id> --content-file <tmp>` that performs:
    1. path allowlist validation,
    2. sanitization,
    3. artifact contract validation,
    4. atomic state update,
    5. manifest update.

### High

4. **Manifest ownership rules are contradictory (artifacts-only vs artifacts+reading-convention)**
- Evidence:
  - `T016` implementation appends `## Reading Convention` as auto-generated ([tasks/T016-constitution-artifact-manifest.md:125](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T016-constitution-artifact-manifest.md:125)).
  - Same task says engine only replaces `## Workflow Artifacts` and preserves manual reading convention ([tasks/T016-constitution-artifact-manifest.md:145](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T016-constitution-artifact-manifest.md:145)).
  - `T003` marks `## Reading Convention` as AUTO-GENERATED/excluded from inheritance ([tasks/T003-constitution-system.md:118](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T003-constitution-system.md:118)).
- Why this matters: impossible to implement resolver/writer deterministically.
- Recommendation:
  - Choose one contract:
    - Option A: engine owns only `Workflow Artifacts`; Reading Convention is user-authored.
    - Option B: engine owns both sections under explicit markers.
  - Encode exact start/end markers and parser behavior in one canonical spec section.

5. **Artifact contract “missing registry” fallback defeats the safety model**
- Evidence:
  - `T013` rollback allows warning + skip validation if schema registry missing ([tasks/T013-artifact-contract.md:209](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T013-artifact-contract.md:209)).
- Why this matters: silently disables the main guarantee (“catch at load time”).
- Recommendation:
  - Make registry absence a hard startup error when any task declares contracts.
  - Keep permissive mode only behind explicit `--allow-legacy-untyped-artifacts` flag.

6. **`get_next_task` depends on undocumented CLI flag**
- Evidence:
  - MCP server calls `ai-sdd status --next --json` ([tasks/T020-roo-code-integration.md:152](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T020-roo-code-integration.md:152)).
  - CLI command list does not define `--next` ([tasks/T010-cli-and-config.md:194](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T010-cli-and-config.md:194)).
- Why this matters: integration surface depends on behavior that may never be implemented.
- Recommendation:
  - Add `status --next` to T010 acceptance criteria and schema now, or switch MCP to parse full `status --json` reliably.

### Medium

7. **Security config namespaces are inconsistent**
- Evidence:
  - `T017` acceptance uses `observability.secret_patterns` ([tasks/T017-security-prompt-injection.md:65](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T017-security-prompt-injection.md:65)).
  - Same task later defines `security.custom_secret_patterns` ([tasks/T017-security-prompt-injection.md:129](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T017-security-prompt-injection.md:129)).
- Recommendation:
  - Single source of truth: keep secret redaction patterns under `security.*`, and let observability consume that config.

8. **Policy gate failure state semantics conflict with bounded-loop invariant**
- Evidence:
  - `T006` fallback says gate failure keeps task `RUNNING` until rework ([tasks/T006-evidence-policy-gate.md:153](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T006-evidence-policy-gate.md:153)).
  - Composition invariants require no indefinite `RUNNING` tasks ([tasks/T014-overlay-composition-tests.md:74](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T014-overlay-composition-tests.md:74)).
- Recommendation:
  - Introduce explicit `NEEDS_REWORK` state; never leave failed gate tasks in `RUNNING`.

9. **Constitution parse failures are silently skipped**
- Evidence:
  - `T003` fallback skips malformed constitution layer with warning ([tasks/T003-constitution-system.md:170](/Users/anjan/workspace/projects/sdd-unified/specs/ai-sdd/ai-sdd-synthesis-2-claude/tasks/T003-constitution-system.md:170)).
- Why this matters: can silently drop governance rules.
- Recommendation:
  - Default to fail-fast for malformed project/root constitutions.
  - Allow permissive mode only for non-critical submodule layers with explicit config.

## Suggestions to Strengthen the Spec Before Implementation

1. **Add a Canonical Contracts Appendix**
- One page defining normalized names and enums: tool names, adapter types, task states, HIL states, event types, CLI flags.

2. **Specify Transaction Boundaries Explicitly**
- For every mutating flow (`run --task`, `complete_task`, HIL resolve), define atomic unit and rollback behavior.

3. **Add a State Machine Diagram for Task Lifecycle**
- Include `PENDING`, `RUNNING`, `NEEDS_REWORK`, `HIL_PENDING`, `COMPLETED`, `FAILED`, with allowed transitions.

4. **Define Backward-Compatibility Modes as Explicit Modes**
- `strict` (default for new projects) vs `legacy` (temporary), rather than hidden permissive fallbacks.

5. **Make Security Performance/Precision Requirements Concrete**
- Add non-functional targets: max false-positive rate for injection detector, max sanitizer latency per artifact, and minimum fixture coverage by category.

## Positive Highlights

- Strong direction on DSL safety and banning `eval`.
- Excellent emphasis on overlay composition invariants with CI gating.
- Good architectural move to tool-native integrations rather than heavy custom runtime layers.
- Clear push toward typed artifact contracts and model-agnostic runtime adapter abstraction.
