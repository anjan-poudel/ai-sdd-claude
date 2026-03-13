# Constitution Distillation from Lessons Learned

_Derived from `LESSONS-LEARNED.md` and the async-agents incident analysis._
_Date: 2026-03-13_

---

## Background

Seven lessons emerged from the async-agents incident and subsequent fix cycle. Each lesson
contains principles that should be encoded in agent constitutions — not left as documentation
that agents won't read, but as standing instructions injected into every agent's working context.

This document proposes which principles belong in:
1. **Common constitution** — added to every agent's prompt (all roles)
2. **Design agent additions** — sdd-architect, sdd-pe, sdd-le
3. **Implementation agent additions** — sdd-dev
4. **Review agent additions** — sdd-reviewer

---

## 1. Common Constitution (All Agents)

These principles apply regardless of role, phase, or artifact type. They belong in the
shared `constitution.md` template under a **## Agent Principles** section, or injected via
the `ConstitutionResolver` standards mechanism.

---

### 1.1 Verify Before You Act

> Before executing any action against an external system, tool, or file path, verify that
> the precondition is satisfied. Do not assume the environment matches what the specification
> says — check it.

**Origin**: L1 (healthCheck gate). Every agent assumes its inputs exist and its tools work.
Real environments deviate. An agent that checks first fails gracefully; one that assumes fails
ambiguously.

**Concrete rules**:
- Before reading an input artifact, verify the file exists. If it does not, halt with a
  specific error: "Input `<path>` not found — cannot proceed. Ensure the preceding task
  completed successfully."
- Before running a CLI command, verify the command is available: `which <cmd>`. If not
  available, halt with an actionable error — do not try alternatives silently.
- Before writing to an output path, verify the parent directory exists. Create it if needed
  rather than failing with a cryptic I/O error.

---

### 1.2 Output Paths Are Contracts

> The output path specified in `ai-sdd complete-task --output-path` is a contract. It must
> exactly match the path of the file you wrote. Never use a different path without explicit
> instruction.

**Origin**: L1 / ISSUE-012 (stale output paths). Path mismatches cause silent failure:
the engine marks the task complete but the downstream artifact is missing or wrong.

**Concrete rules**:
- The output path in `complete-task` must equal the actual file you wrote, character for character.
- If the task spec and constitution.md disagree on output path, halt and surface the conflict.
  Do not guess.
- Do not rename, move, or reorganise artifacts unless explicitly instructed. Upstream agents
  depend on exact paths.

---

### 1.3 Progress Is Visible

> Emit progress signals at meaningful intervals. Do not go silent for more than a few minutes
> without indicating what you are doing.

**Origin**: L3 (liveness as correctness). Silent agents are indistinguishable from hung agents.
Operators (and liveness monitors) need signals.

**Concrete rules**:
- At the start of each significant step (reading a file, making a decision, writing output),
  write a one-line status to stdout: `[step] Reading specs/design-l1.md...`
- If a step will take more than a few seconds, emit a keeping-alive signal: `[working] Analysing
  component interfaces...`
- Never suppress errors or warnings silently. If something unexpected happens, say so.

---

### 1.4 Scope Is Enforced by You, Not Just the Overlay

> Your output must stay within the scope defined by the requirements lock and your task
> specification. Do not add features, extend scope, or cross into adjacent tasks without
> explicit instruction — even if you judge the addition to be beneficial.

**Origin**: L4 / Traceability overlay. The traceability overlay will catch out-of-scope
elements as a rework trigger. The cheaper outcome is to enforce scope yourself first.

**Concrete rules**:
- Before finalising output, explicitly check: "Does anything I've written go beyond what
  my task specification requires?" If yes, remove it.
- If you identify something needed that was not specified, surface it as an open decision
  or a note — do not silently implement it.
- "I thought it would be useful" is not a justification for unspecified output.

---

### 1.5 Complete-Task Is the Only Valid Completion Mechanism

> When your output is ready, run `ai-sdd complete-task` with the exact output path and
> content file. Do not use `ai-sdd run`, do not write to state directly, and do not assume
> completion unless the command succeeds.

**Origin**: ISSUE-012 / sdd-architect / sdd-pe / sdd-reviewer all used `ai-sdd run --task`
which re-triggers the engine rather than completing the current task. This produces duplicate
executions, state corruption, and HIL loops.

**Concrete rule**:
```bash
# CORRECT — signals completion of the current task
ai-sdd complete-task --task <task-id> \
  --output-path <exact-output-path> \
  --content-file <exact-output-path>

# WRONG — retriggers the engine, does not signal completion
ai-sdd run --task <task-id>
```

---

## 2. Design Agent Additions (sdd-architect, sdd-pe, sdd-le)

These additions apply to phases that produce specifiable, scope-bounded artifacts where
drift, concurrency contracts, and recovery paths are the primary failure modes.

---

### 2.1 Error Paths Are First-Class Design

> Every interface, API endpoint, event, and queue consumer you design must have an explicit
> error response type. A design that specifies happy-path behaviour only is incomplete.

**Origin**: L7 (concurrency designed in) + ReworkPatternAnalyser recurring pattern:
"Component interfaces missing error response types." This was the most common HIL rework
feedback in design-l2 tasks.

**Concrete rules**:
- Every interface method must declare: normal return type AND error return type (not `any`
  or `unknown`).
- Every async operation must specify: what happens if it times out, what happens if the
  downstream system is unavailable, and whether the failure is retryable.
- Explicitly design recovery paths before designing terminal failure states. The question
  to answer is: "How does an operator recover from this without data loss?"

---

### 2.2 Concurrency Contracts Are Explicit

> If a component can be called concurrently, say so. If it cannot, say so and design the
> constraint. "We'll worry about concurrency later" is a design defect, not a deferral.

**Origin**: L7. Seven race conditions were found in ai-sdd post-implementation because
concurrency was not designed — it was discovered.

**Concrete rules**:
- For every shared resource (file, database row, queue, in-memory state), document: who
  can read concurrently, who can write, and what the isolation mechanism is.
- If a component uses locking or serialisation, name the mechanism. Do not say "thread-safe"
  without specifying how.
- If a component accumulates listeners or callbacks, design the deregistration path alongside
  the registration path.

---

### 2.3 Timeout and Retry Are Configuration, Not Assumptions

> Do not hardcode timeout values. Every timeout is a measurable parameter that will be wrong
> at first and requires calibration from real execution data. Design timeout values as
> configuration that can be overridden without code changes.

**Origin**: L1 / ISSUE-004. The 5-minute timeout on tasks that routinely take 25 minutes
was a hardcoded intuition that was never updated because it was never configurable.

**Concrete rule**: For every async call, queue wait, or external dependency, include in the
design: the timeout parameter name, its default value, and where it is configurable (env var,
config file, or schema field).

---

## 3. Implementation Agent Additions (sdd-dev)

These apply during the coding and testing phase where output-path contracts, streaming
requirements, and test coverage are the primary failure modes.

---

### 3.1 Streaming Over Buffering for Long-Running Operations

> Do not buffer the entire output of a long-running process in memory before doing anything
> with it. Stream output incrementally — log it, emit progress signals, or process it
> chunk-by-chunk. Buffer only when the operation is known to be bounded and fast.

**Origin**: ISSUE-001 (liveness) + L3. Buffered output has no liveness signal; the operator
sees nothing for minutes and cannot distinguish "working" from "hung."

**Concrete rules**:
- When spawning a subprocess, use incremental stream reading (`reader.read()` loop), not
  `new Response(proc.stdout).text()`.
- When processing a file or API response that could be large, use a streaming API if available.
- Each chunk read must update a `lastActivityAt` timestamp that a liveness monitor can observe.

---

### 3.2 Test the Integration, Not Just the Unit

> A unit test that verifies the correct API exists is necessary but not sufficient. Write at
> least one integration test that verifies Component A is called when Component B runs in
> a real (non-mocked) scenario.

**Origin**: L2 (contracts enforced by tests). 24 post-implementation gaps were found in
ai-sdd because unit tests verified components in isolation but never verified their wiring.

**Concrete rules**:
- For every new CLI command: write a test that invokes it end-to-end with a real (temporary)
  project directory.
- For every new adapter, overlay, or integration point: write a test that verifies the
  component is called when the engine runs, not just that it behaves correctly in isolation.
- If you cannot write an integration test because the wiring is too complex, flag it as a
  design problem, not a test problem.

---

### 3.3 No Silent Stubs

> If a feature is deferred or not yet implemented, throw an explicit error with an actionable
> message. Returning successful results without doing the work produces silent, invisible debt
> that compounds into production incidents.

**Origin**: L2 / Development Standards §3. Silent stubs passed tests, shipped, and caused
production failures when the deferred work was never done.

**Concrete rule**:
```typescript
// WRONG — silent stub
async function replay(): Promise<void> {
  return; // TODO
}

// CORRECT — explicit deferral
async function replay(): Promise<void> {
  throw new Error(
    "replay() is not yet implemented. See specs/tasks/T026.md for the implementation plan."
  );
}
```

---

## 4. Review Agent Additions (sdd-reviewer)

These additions define what the reviewer checks in addition to functional acceptance criteria.

---

### 4.1 Review Error and Recovery Paths Explicitly

> For every system component reviewed, verify that error paths and recovery mechanisms are
> specified. A component description that only covers the happy path is incomplete and should
> be returned for rework.

**Origin**: L4 (design recovery before terminal states). The reviewer is the last gate before
implementation. Recovery paths omitted here become incidents in production.

**Review checklist additions**:
- [ ] Every interface method has an explicit error return type (not `any` or `unknown`).
- [ ] Every async or external call has a documented failure mode and recovery path.
- [ ] No terminal failure state (`FAILED`, `REJECTED`) is reached without a preceding recovery
  attempt (retry, rework, HIL escalation).
- [ ] Timeouts and retry limits are configurable parameters, not hardcoded constants.

---

### 4.2 Review Operator Journeys, Not Just System Behaviours

> For every user-facing feature, verify that the operator journey is specified — what the
> operator sees, what actions are available, and what happens when things go wrong. A design
> that specifies system behaviour without operator visibility is incomplete.

**Origin**: L5 (operator journeys are requirements). The async-agents incident revealed that
operators had no visibility into what the engine was doing — no progress log, no liveness signal,
no clear recovery path. These are requirements failures, not just UX gaps.

**Review checklist additions**:
- [ ] The feature includes a description of what the operator sees when it runs.
- [ ] The feature includes a description of what the operator sees when it fails.
- [ ] If a component can hang or stall, there is a specified mechanism for the operator to
  detect and recover (log, timeout message, kill switch).
- [ ] Error messages are actionable: they say what happened AND what to do next.

---

### 4.3 Review Scope Boundaries

> Verify that the artifact under review does not contain elements that go beyond the task's
> requirements. Out-of-scope elements are a rework signal regardless of their quality.

**Origin**: L4 / Traceability overlay. The reviewer is a human traceability gate. Even if
the traceability overlay passes, the reviewer should spot scope creep that the LLM judge misses.

**Review checklist additions**:
- [ ] Every element of the artifact traces back to a specific FR or NFR.
- [ ] No features, endpoints, or components are present that are not referenced in requirements.
- [ ] "Nice to have" additions that were not specified are flagged as out-of-scope, not approved.

---

## 5. Implementation Plan

### Immediate actions
1. **Fix `sdd-architect.md`, `sdd-pe.md`, `sdd-reviewer.md`**: replace `ai-sdd run --task`
   with `ai-sdd complete-task`. This is a correctness bug, not a style issue.
2. **Add § Common Principles to agent prompts**: inject §1.1–1.5 into each agent `.md` file
   under a `## Principles` section.

### Medium term
3. **Create a shared `agents/common-principles.md`** standards file that the ConstitutionResolver
   auto-injects (matching the `standards/**/*.md` auto-discovery pattern). This prevents
   per-agent drift when principles need updating.
4. **Add design review checklist template** to `data/task-library/` so the `review-l2` task
   type automatically includes §4.1–4.3.

### Long term
5. **Wire ReworkPatternAnalyser** (from the ContinuousLearning overlay) to surface new
   recurring patterns as proposed additions to this constitution document, closing the loop
   between operational evidence and agent instructions.

---

## Summary Table

| Principle | Common | Design | Implement | Review |
|-----------|--------|--------|-----------|--------|
| Verify before you act | ✓ | | | |
| Output paths are contracts | ✓ | | | |
| Progress is visible | ✓ | | | |
| Scope enforced by agent | ✓ | | | |
| complete-task only | ✓ | | | |
| Error paths first-class | | ✓ | | |
| Concurrency contracts explicit | | ✓ | | |
| Timeout = configuration | | ✓ | | |
| Streaming over buffering | | | ✓ | |
| Test the integration | | | ✓ | |
| No silent stubs | | | ✓ | |
| Review error/recovery paths | | | | ✓ |
| Review operator journeys | | | | ✓ |
| Review scope boundaries | | | | ✓ |
