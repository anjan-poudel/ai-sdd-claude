# Task Breakdown -- Async/Hybrid Workflow Collaboration for ai-sdd

## Summary
- Task groups: 8 (Jira Epics)
- Total tasks: 24 (+ 0 subtasks)
- Estimated effort: 12-15 days (parallel, 3 devs) / 30-38 days (sequential)
- Critical path: T-001 -> T-002 -> T-003 -> T-005 -> T-008 -> T-009 -> T-014 -> T-023 -> T-024

## Contents
- [tasks/index.md](tasks/index.md) -- all task groups

## Critical path

The longest dependency chain runs through the core engine (TG-01), the adapter framework (TG-02), Slack integration (TG-03), and ends at end-to-end integration (TG-08):

1. **T-001** (async state machine) -- foundational; every async component depends on it
2. **T-002** (AsyncTaskManager) -- wires async lifecycle into the engine
3. **T-003** (ApprovalManager) -- approval logic consumed by async task manager
4. **T-005** (adapter interfaces) -- all adapter implementations depend on this
5. **T-008** (adapter factory) -- wires adapters together, needed before any integration
6. **T-009** (Slack notification) -- first adapter; enables approval flow testing
7. **T-014** (Jira CRUD) -- needed for as-code sync
8. **T-023** (wire adapters into engine) -- integration of all components
9. **T-024** (end-to-end test) -- final verification

TG-03 through TG-06 (adapter implementations) can run in parallel once TG-02 is complete. TG-07 (GitHub/MVP2) can run in parallel with TG-08 once TG-02 is done. This parallelism is what compresses the 30-38 day sequential estimate down to 12-15 days with 3 developers.

## Key risks

1. **HIGH** -- Slack rate limiting under heavy polling (T-009, T-010). Mitigation: configurable poll interval, Retry-After header support.
2. **HIGH** -- Jira multi-hop transitions may not have a valid path (T-015). Mitigation: BFS path discovery with clear error reporting.
3. **MEDIUM** -- Confluence storage format incompatibility with markdown-it output (T-013). Mitigation: validate XHTML before POST, fallback to raw Markdown in `<pre>`.
4. **MEDIUM** -- GitHub Projects v2 GraphQL schema instability (T-020). Mitigation: pinned query fragments, fixture-based tests.
5. **MEDIUM** -- Polling misses messages during engine restart (T-010). Mitigation: resume from last-known timestamp in persisted state.

## Security blockers

No security-design-review was found. NFR-002 (Credential Security) is addressed by the adapter factory's fail-fast env var validation (T-008) and log sanitizer registration. All adapter tasks must ensure credentials are never logged or stored in config files.

## MVP split

- **MVP1 (MUST):** TG-01, TG-02, TG-03, TG-04, TG-05, TG-06, TG-08 -- Atlassian stack + core engine
- **MVP2 (SHOULD):** TG-07 -- GitHub stack (same adapter interfaces, different implementations)
