# RMS-006: ai-sdd Integration Test

**Phase:** 4
**Status:** PENDING
**Size:** S (1 day)
**Depends on:** RMS-002
**Target repo:** /Users/anjan/workspace/projects/ai/repeatability-mcp-server
**Package:** packages/requirement-lock-server

---

## What

Add an end-to-end integration test that simulates how ai-sdd agents will call
RMS tools during a workflow. This validates that lock_* tools work correctly
in the sequence ai-sdd's PolicyGateOverlay and agent dispatch would use them.

## Test Fixture

Create `src/__tests__/fixtures/ai-sdd-interop.lock.yaml` with:

- 3 requirements: REQ-001 (fully covered), REQ-002 (missing test), REQ-003 (no task)
- 4 tasks: TASK-001 (implements REQ-001), TASK-002 (implements REQ-002),
  TASK-003 (depends on TASK-001), TASK-004 (depends on TASK-003, not available)
- 2 test specs: TESTSPEC-001 (tests REQ-001), TESTSPEC-002 (tests REQ-002... actually missing to create gap)
- 2 acceptance criteria: AC-001 (for TASK-001), AC-002 (for TASK-002)
- 1 decision: DEC-001 (satisfies REQ-001)
- 1 gap: REQ-003 has no implementing task

## Test Scenarios

### 1. Full ai-sdd agent workflow simulation

Simulate the sequence ai-sdd's PolicyGateOverlay would call:

```typescript
// Step 1: Validate the lock file
const validation = await callTool('lock_validate', { lockFile: fixture });
expect(validation.success).toBe(false); // REQ-003 has no task

// Step 2: Find gaps
const gaps = await callTool('lock_find_gaps', { lockFile: fixture });
expect(gaps.reqsWithoutTasks).toContain('REQ-003');

// Step 3: Coverage report
const coverage = await callTool('lock_coverage_report', { lockFile: fixture });
const req001 = coverage.requirements.find(r => r.id === 'REQ-001');
expect(req001.covered).toBe(true);

// Step 4: Impact analysis
const impact = await callTool('lock_impact_analysis', {
  lockFile: fixture, reqId: 'REQ-001'
});
expect(impact.affectedTasks).toContain('TASK-001');

// Step 5: Available tasks
const available = await callTool('lock_available_tasks', { lockFile: fixture });
// TASK-004 depends on TASK-003 which depends on TASK-001 — chain not met
```

### 2. Error handling

```typescript
// Missing file
const missing = await callTool('lock_validate', { lockFile: '/nonexistent' });
expect(missing.success).toBe(false);
expect(missing.error).toBeDefined();

// Malformed YAML
const malformed = await callTool('lock_validate', { lockFile: malformedFixture });
expect(malformed.success).toBe(false);

// Non-existent requirement in impact analysis
const unknown = await callTool('lock_impact_analysis', {
  lockFile: fixture, reqId: 'REQ-999'
});
// Should return empty results, not crash
```

### 3. Session-based vs file-based consistency

Verify that building the same graph via `graph_*` tools produces the same
query results as loading via `lock_*` tools:

```typescript
// Build via session
const session = await callTool('graph_init', { metadata: { project: 'test' }});
await callTool('graph_add_node', { sessionId, node: { id: 'REQ-001', type: 'REQ', ... }});
// ... add all nodes and edges
const sessionGaps = await callTool('graph_query', { sessionId, pattern: 'gaps' });

// Load via lock file
const fileGaps = await callTool('lock_find_gaps', { lockFile: fixture });

// Compare
expect(fileGaps.reqsWithoutTasks).toEqual(sessionGaps.reqsWithoutTasks);
```

## Acceptance Criteria

```gherkin
Scenario: Full workflow simulation succeeds
  Given the interop fixture lock file
  When all 5 lock_* tools are called in sequence
  Then each returns structured JSON with expected results
  And REQ-003 is identified as a gap

Scenario: Error responses don't crash server
  Given a missing file path
  When lock_validate is called
  Then { error, success: false } is returned
  And subsequent calls still work

Scenario: Session and file-based results agree
  Given the same traceability data
  When queried via graph_* (session) and lock_* (file)
  Then gap analysis returns identical results
```

## Notes

- This test runs in the RMS repo — does NOT require ai-sdd installed
- Uses in-process MCP server (not stdio subprocess) for speed
- Test file: `src/__tests__/integration/ai-sdd-interop.test.ts`
