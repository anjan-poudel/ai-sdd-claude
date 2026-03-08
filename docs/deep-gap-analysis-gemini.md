# Deep Gap Analysis (Gemini Revision)

**Scope:** Current `ai-sdd` implementation.
**Methodology:** Review of the Codex source audit, structural analysis of the core engine contracts, and evaluation of framework operational readiness.

## Executive Summary

The `ai-sdd` project has successfully validated its core thesis: the engine can orchestrate multi-agent workflows, manage HIL transitions, and execute passing runtime paths under Bun. However, the framework currently suffers from severe **contract drift**. 

While the "happy paths" work, the static guarantees (TypeScript), operational contracts (CLI/Config), and core state boundaries (Adapters) are inconsistent. The project is currently a high-functioning prototype, not yet a hardened orchestrator.

## Finding Categories & Analysis

### Category 1: Critical Orchestration & State Integrity
*These issues undermine the framework's primary purpose: safe, deterministic workflow execution.*

*   **Inconsistent Task Completion Boundaries:** The engine lacks a single, heavily enforced gateway for task completion. The `ClaudeCodeAdapter` uses CLI triggers, while the `OpenAIAdapter` mutates state/files directly. 
    *   *Impact:* Security sanitization and artifact validation cannot be reliably enforced if adapters can bypass the engine's write paths.
*   **Dependency-Blind Task Resolution:** `status --next --json` returns all `PENDING` tasks without evaluating the DAG (Directed Acyclic Graph) for uncompleted dependencies.
    *   *Impact:* MCP tools relying on this will instruct agents to begin tasks that are legitimately blocked, leading to inevitable execution failures.

### Category 2: The Illusion of Type Safety
*These issues make the codebase dangerous to modify and scale.*

*   **Systemic `typecheck` Failures:** Despite strict `tsconfig.json` settings, the codebase fails static compilation. Key areas like adapter interfaces, config loaders, and workflow loaders contain unsafe casts or missing Bun typings.
    *   *Impact:* Refactoring is currently "flying blind." The compiler cannot protect against regressions during the upcoming remote overlay architectural changes.
*   **Observability Schema Drift:** Events are emitted at runtime (e.g., `task.hil_resuming`, `paired.not_implemented`) that are not defined in the core event schemas.
    *   *Impact:* Downstream consumers of these events (dashboards, audit logs) will break or silently miss state transitions.

### Category 3: Phantom Operational Surface
*These issues erode operator and developer trust by promising functionality that does not exist.*

*   **Fake Success on Migrations:** The `migrate` command executes successfully but does nothing. 
    *   *Impact:* High risk of data loss or unrecoverable state during an actual schema bump.
*   **Dead CLI Flags & Config Knobs:** Flags like `--resume`, `--metrics`, and `--port`, along with config settings like `rate_limit_requests_per_minute` and `governance.requirements_lock`, exist in the schema but are disconnected from runtime logic.
    *   *Impact:* Operators cannot tune the system predictably. 
*   **Stubbed Core Overlays:** `ReviewOverlay` and `PairedOverlay` exist in name but lack their described functional loops.

## Remediation Strategy & Priority Plan

To graduate `ai-sdd` to a hardened orchestration framework, the focus must shift entirely from feature development to **convergence and contract enforcement**.

**Phase 1: Secure the Foundations (Immediate)**
1.  **Strict Type Enforcement:** Fix all `bun run typecheck` errors. Make this a CI release blocker. Remove `Record<string, unknown>` where strict interfaces belong.
2.  **Unify the Completion Boundary:** Force all adapters to use a single, validated engine ingress point (e.g., `complete-task`) to finalize work. No adapter should write terminal state directly.

**Phase 2: Correct the Logic (Short-term)**
3.  **DAG-Aware Status:** Rewrite `status --next` to perform a true graph traversal, ensuring it only returns tasks where all dependencies are `COMPLETED`.
4.  **Sync Observability:** Audit all `emit()` calls and ensure 1:1 mapping with the TypeScript event contracts.

**Phase 3: Prune the Phantom Surface (Short-term)**
5.  **Remove Dead Code:** Delete CLI flags and config properties that lack runtime implementations.
6.  **Hard-Fail Unimplemented Features:** Update `migrate`, `ReviewOverlay`, and `PairedOverlay` to explicitly throw `NotImplementedError` or log clear warnings, rather than silently succeeding.

## Conclusion
The architecture is sound, but the implementation is sloppy at the edges. Fixing the type safety and unifying the adapter boundaries will drastically reduce the friction of future feature work (like the MCP Remote Overlay integration).