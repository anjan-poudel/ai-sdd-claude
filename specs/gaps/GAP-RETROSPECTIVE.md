# Gap Retrospective — Root Causes and Prevention

**Date:** 2026-03-03
**Scope:** All 24 gaps identified in `gap-analysis.md`
**Status:** 20 of 24 gaps fixed. 4 deferred (#7, #8, #19, #21).

---

## Executive Summary

The 24 gaps fall into **six root-cause patterns**. None of them required unusual skill to prevent — they are all consequences of known, avoidable development practices. Each pattern has a concrete prevention strategy that would have caught the issue before the code was committed.

---

## Pattern 1 — Config parsed but never read

**Affected gaps:** #1 (adapter hardcoded), #8 (--metrics ignored), #13 (config.workflow ignored), #23 (--port ignored)

### What happened

A config field or CLI flag was added to the schema/parser but the value was never read at the point where it would change runtime behaviour. Code was written top-down (parse first, use later) and "use later" never happened. The comment `// Phase 1: use mock` in `run.ts` is the clearest evidence.

```ts
// src/cli/commands/run.ts — original
const config = loadProjectConfig(projectPath);  // parsed
// ...
const adapter = new MockAdapter();  // config.adapter.type never read
```

### Why it happened

- No test existed that changed `config.adapter.type` and verified a different adapter was constructed.
- The gap between parsing config and using it was wide enough that it was easy to merge without noticing.
- `--port` was added to the CLI definition at the same time as the server was written with hardcoded stdio transport — the discrepancy was never caught because there was no test that passed `--port 9000` and verified port 9000 was used.

### How to prevent it

**Rule: every config field must have a test that proves it changes behaviour.**

```ts
// Prevention test for adapter selection
it("uses ClaudeCodeAdapter when config.adapter.type = claude_code", () => {
  const adapter = createAdapter({ type: "claude_code" });
  expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
  expect(adapter).not.toBeInstanceOf(MockAdapter);
});
```

The `satisfies never` exhaustive switch in `src/adapters/factory.ts` is the structural enforcement: adding a new `AdapterType` without a factory case is a **compile error**, not a runtime surprise.

For CLI flags: if a flag exists, there must be a test that passes the flag and asserts the behaviour it controls. If you can't write that test, the flag shouldn't exist yet.

---

## Pattern 2 — Component exists but is never wired into the call chain

**Affected gaps:** #2 (overlay chain never called), #3 (HIL_PENDING unreachable), #18 (eval scorer disconnected)

### What happened

Five overlay classes with full logic were implemented, and the chain utilities (`runPreTaskChain`, `runPostTaskChain`) were implemented — but `engine.ts` imported none of them. The overlay objects existed in isolation. The `src/eval/scorer.ts` module had a complete, tested confidence computation algorithm, but `ConfidenceOverlay` used its own independent ad-hoc heuristic that was written separately.

This pattern is: **implement components, forget to compose them**.

### Why it happened

- Components were developed in parallel or sequentially by different sessions/agents without an integration test that ran the full pipeline.
- The test for each overlay tested it in isolation (`overlay.preTask(ctx)` passes). Nothing tested that `engine.runTaskIteration` actually called the overlay.
- `HIL_PENDING` appeared in `VALID_TRANSITIONS` and tests, creating the illusion that it was reachable.

### How to prevent it

**Rule: every integration point must have an integration test.**

```ts
// Prevention test — verify overlay chain is called during engine dispatch
it("engine calls pre-task overlay chain before dispatch", async () => {
  let preTaskCalled = false;
  const testOverlay: BaseOverlay = {
    name: "test",
    enabled: true,
    preTask: async () => { preTaskCalled = true; return { proceed: true }; },
  };
  const engine = new Engine(workflow, state, agents, adapter, ..., [testOverlay]);
  await engine.run({});
  expect(preTaskCalled).toBe(true);  // would have caught gap #2 on day one
});
```

For the eval scorer: the `ConfidenceOverlay` test should have asserted that it imports from `src/eval/scorer.ts`, not that it produces some number. Structural coupling tests ("this module uses that module") prevent silent forks.

For `HIL_PENDING`: a test should verify that after `engine.runTaskIteration`, a task CAN enter `HIL_PENDING` when the overlay signals `hil_trigger: true`. If such a test existed, the unreachable state would have been caught immediately.

---

## Pattern 3 — Stub code that silently succeeds

**Affected gaps:** #11 (paired overlay pass-through), #12 (HIL notification hooks), #3 (partial)

### What happened

Placeholder implementations returned successful results without doing any work:

```ts
// src/overlays/paired/paired-overlay.ts — original
// Phase 1: pass-through
return { accept: true, new_status: "COMPLETED" };
```

```ts
// src/overlays/hil/hil-overlay.ts — original
void hooks; void hilId; void ctx;  // do nothing, return nothing
```

The stub passed through correctly enough that downstream code couldn't tell the difference. Users who configured `overlays.paired.enabled: true` got silent pass-through with no indication the feature wasn't running.

### Why it happened

- Stubs were written to keep the interface working during Phase 1 so other code could be tested.
- The stub returned the "correct" shape so no downstream assertion failed.
- No test asserted the negative: "when paired is enabled, the challenger agent ran".

### How to prevent it

**Rule: stubs that defer work must fail loudly, not silently succeed.**

```ts
// Instead of silent pass-through:
if (taskEnabled) {
  throw new NotImplementedError(
    "Paired overlay requires Phase 3 adapter injection. " +
    "Set overlays.paired.enabled: false to bypass."
  );
}
```

This is what the fix did: `paired-overlay.ts` now returns `accept: false, new_status: "NEEDS_REWORK"` with an actionable message. Any workflow that has `paired.enabled: true` will now fail visibly instead of appearing to succeed.

The general principle: **deferred features should fail at the boundary where they are invoked, not silently succeed**. This makes "Phase N" work visible in the test run immediately.

---

## Pattern 4 — External schema assumed without validation

**Affected gaps:** #5 (ClaudeCodeAdapter schema mismatch)

### What happened

`ClaudeCodeAdapter.parseOutput` was written to match a schema that the author believed the `claude` CLI would produce:

```ts
// What was assumed (wrong):
outputs: parsed["outputs"] ?? []
handover_state: parsed["handover_state"] ?? {}
tokens_used from parsed["usage"]["input_tokens"]
```

The actual `claude --print --output-format json` schema is:
```json
{ "result": "...", "is_error": false, "total_input_tokens": 123, "total_output_tokens": 45 }
```

Every real invocation fell through to the non-JSON fallback, returning zero token usage and raw stdout.

### Why it happened

- The adapter was written without running `claude --print --output-format json` and inspecting the output.
- No test used a fixture of the actual CLI output — tests used the assumed schema.
- The fallback path (`catch → raw_output: stdout.trim()`) masked the failure: the adapter always returned something, just not the right thing.

### How to prevent it

**Rule: test against real or authoritative fixture data, not assumed schemas.**

```ts
// Prevention test using real claude CLI JSON fixture
it("parses real claude CLI JSON schema", () => {
  const realCliOutput = JSON.stringify({
    result: "Architecture document",
    is_error: false,
    total_input_tokens: 100,
    total_output_tokens: 50,
  });
  const result = adapter.parseOutput("task-1", realCliOutput);
  expect(result.status).toBe("COMPLETED");
  expect(result.tokens_used?.input).toBe(100);
});
```

When integrating with any external CLI or API: run it once, capture the output, store it as a fixture, write tests against that fixture. If the schema changes, the test breaks — which is the correct behaviour.

A fallback path (`catch → raw fallback`) is not a safety net — it is a gap concealer. Any fallback that silently swallows a parse error should emit an observable signal (a log, a metric, a counter) so it can be detected.

---

## Pattern 5 — Missing state transition in error path

**Affected gaps:** #9 (injection detection → NEEDS_REWORK), #3 (partial)

### What happened

The injection detection branch in `complete-task.ts` printed an error message that said "Task set to NEEDS_REWORK" but then called `process.exit(1)` without performing the state transition. The error message was a lie.

```ts
// Original — message contradicts action
console.error(`Injection pattern detected... Task set to NEEDS_REWORK.`);
process.exit(1);  // ← no transition happened
```

The secret detection branch immediately above it (written earlier, presumably) correctly performed the transition. The injection detection branch was added later and the transition was omitted.

### Why it happened

- The two branches (secret detection, injection detection) handled the same outcome but were written at different times, and the second author didn't notice the first branch had the transition.
- The error message was copy-pasted from documentation intent, not from the code.
- No test verified the state after `complete-task` exits with injection content.

### How to prevent it

**Rule: error messages must describe what the code actually does, not what the author intends.**

Code review should flag any message that says "X happened" without the code doing X. Mechanically: if the message says "Task set to NEEDS_REWORK", grep for `transition.*NEEDS_REWORK` in the same branch. If it's absent, the message is wrong.

Test the state after every error path:

```ts
it("injection detection transitions task to NEEDS_REWORK", async () => {
  // Run complete-task with injection content
  await runCompleteTask(taskId, injectionContent);
  const taskState = stateManager.getTaskState(taskId);
  expect(taskState.status).toBe("NEEDS_REWORK");
});
```

The general principle: **every documented outcome must be observable in a test**.

---

## Pattern 6 — Empty directories as development promises

**Affected gaps:** #4 / #22 (empty src/integration/ dirs)

### What happened

Three empty directories were created as structural placeholders:
- `src/integration/claude-code/`
- `src/integration/openai/`
- `src/integration/roo-code/`

The actual integration code lived in `src/adapters/` (runtime) and `data/integration/` (scaffolding). The empty dirs created a false impression that additional integration code existed or was coming soon.

### Why it happened

- The directory structure was designed before the code was written.
- When the architecture was refined (integration code → adapters), the placeholder dirs were not cleaned up.
- There is no automated check for empty directories in a code review.

### How to prevent it

**Rule: directories must have at least one file on the day they are created.**

If a directory is created as a placeholder, it must have a `README.md` explaining what will go there, or an `.gitkeep` with a comment. An empty directory is a dangling reference.

Automated check in CI:
```bash
# Fail if any src/ directory has no source files
find src -type d | while read dir; do
  if [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
    echo "Empty directory: $dir"; exit 1
  fi
done
```

Alternatively, architecture decision records (ADRs) should document where integration code lives. Any new directory that contradicts the ADR should be rejected in review.

---

## Summary — Prevention Matrix

| Pattern | Root cause | Mechanically prevented by |
|---------|-----------|--------------------------|
| 1. Config never read | No config-to-behaviour binding test | Test: change config → assert different runtime behaviour |
| 2. Component not wired | No integration test spanning the full pipeline | Test: verify component is called during real engine run |
| 3. Stub silently succeeds | Placeholder returns successful shape | Stubs throw `NotImplementedError` or return hard failure |
| 4. External schema assumed | No real fixture test | Test against captured real CLI/API output fixture |
| 5. Error path missing state transition | Message and code are decoupled | Test: assert state after every documented error outcome |
| 6. Empty directories | Structure designed before code | Require at least one file per directory on creation |

---

## Cross-cutting observation: test coverage is not the same as behaviour coverage

All of these gaps existed in a codebase that had 177+ passing tests. The tests covered:
- Individual classes in isolation
- State machine transition logic
- DSL parsing and evaluation
- Security pattern detection

What the tests did **not** cover:
- That the engine actually called the overlay chain
- That the adapter was selected from config
- That config fields actually changed runtime behaviour
- That error messages corresponded to actual state changes
- That the eval framework was the one computing the confidence score

**Lesson: test count is a vanity metric. The relevant metric is: "does every documented behaviour have a test that would fail if the behaviour were removed?"** This is called behaviour coverage, not line coverage, and it requires deliberately thinking about what each component is supposed to do in the context of the whole system, not just in isolation.

---

## Recommended practices going forward

1. **Integration smoke test for every new wiring**: When you wire component A into component B, write a test that proves A is called when B runs.
2. **Exhaustive switches for all config-driven dispatch**: Use TypeScript's `satisfies never` — new enum values without dispatch cases are compile errors.
3. **No silent stubs**: Deferred features must either throw or return an explicit failure. Silent pass-through is forbidden.
4. **Fixtures for external schemas**: Capture real API/CLI output. Write tests against it. Update fixtures when schemas change.
5. **Error messages are contracts**: Every "X happened" in an error message must be tested by verifying X actually happened.
6. **No empty directories**: Create a file on the same commit that creates the directory.
7. **One integration test per CLI command**: Each CLI command should have one test that exercises it end-to-end with a real (but in-process) project directory, not just unit tests of the underlying functions.
