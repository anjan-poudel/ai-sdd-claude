# Lessons Learned — ai-sdd async-agents Implementation

_Derived from 12 post-release bugs and their fixes in the ai-coaching-assistant integration._
_Date: 2026-03-13_

---

## Executive Summary

The async-agents implementation exposed twelve bugs across three categories: **invisible failures**
(the system failed silently with no operator feedback), **specification drift** (agent prompts
diverged from the task library without detection), and **missing operator primitives** (the CLI
surface was designed from the engine's perspective, not the user's). Most failures were not novel
bugs — they were predictable gaps that better process and design would have caught. This document
captures the patterns, derives actionable principles, and maps each principle to a concrete
ai-sdd improvement.

---

## Part I — Lessons Learned

### Lesson 1: You cannot trust what you cannot execute

**What happened:** The entire async-agents implementation was written without ever running a real
agent dispatch. The `sdd-run` skill ran inside a Claude Code session where `CLAUDECODE=1` was set
in the environment, silently blocking the nested `claude` CLI spawn. Every agent task fell back to
the skill itself acting as developer — writing files and calling `complete-task` manually. The
result was a documentation artefact that looked like working software.

**The deeper pattern:** An assumption that is never tested is not an assumption — it is a silent
lie. The core assumption of `ClaudeCodeAdapter` ("I can spawn `claude` as a subprocess") was never
validated in the actual execution environment. The adapter had a `healthCheck()` method that was
never called.

**Principle: Mandatory adapter gate.** Every workflow run must execute `adapter.healthCheck()`
before the first task dispatch. A failing health check must be a hard error, not a warning. It is
better to fail immediately with an actionable message than to silently degrade and waste hours of
work.

**ai-sdd change:** `engine.run()` calls `this.adapter.healthCheck()` before entering the task
loop. Failure message must include the specific fix (e.g. "claude CLI not found — run: npm install
-g @anthropic-ai/claude-code"). This is a one-line guard that would have caught ISSUE-001 through
ISSUE-012 before they occurred.

---

### Lesson 2: Specification drift is a first-class bug

**What happened:** Agent prompts referenced `.ai-sdd/outputs/` paths that the task library had
moved to `specs/` months earlier. Nobody noticed because there was no automated check. The spec
(task library) and the implementation (agent prompts) had drifted, and the system had no way to
detect or surface the divergence.

**The bitter irony:** ai-sdd is a framework specifically designed to prevent specification drift in
software projects. It suffered from the exact failure it was built to prevent — in its own agent
definitions.

**The deeper pattern:** Any two artefacts that share a contract (agent prompt output path ↔ task
library expected path) will drift if the contract is not enforced by an automated check. Human
review and convention are insufficient. The only reliable guard is a test that fails when drift
occurs.

**Principle: Contracts between artefacts must be machine-verified.** If agent prompt A says it
will write to path X, and the task library expects path X, there must be a test that asserts this
equality and fails if either side changes without updating the other.

**ai-sdd changes:**
1. `tests/agent-prompts.test.ts` — parse every agent `.md` file, extract `--output-path` from the
   `complete-task` call, assert it matches the corresponding task library entry's `outputs[].path`.
2. `ai-sdd validate-config` — extend to also validate agent prompt / task library path alignment
   at init and before every `run`. This turns a runtime surprise into a startup error.
3. Long term: generate agent prompt output instructions from the task library programmatically,
   eliminating the possibility of drift at the source.

---

### Lesson 3: Invisible failures are indistinguishable from correct behaviour

**What happened:** When an agent ran for 20+ minutes with no output, the operator had no way to
know whether it was "working hard" or "silently hung". The absence of feedback triggered manual
interventions (kill, state repair, re-run) that cascaded into state corruption.

**The deeper pattern:** A system with no progress feedback creates a vacuum that operators fill
with guesswork and manual interventions, which introduce new failure modes. Liveness is not a
nice-to-have — it is a correctness property. A system that provides no feedback about its internal
state is, from the operator's perspective, indistinguishable from a crashed system.

**Principle: Every long-running operation must emit observable progress.** This means: streaming
output (not buffered), structured events on state transitions, human-readable progress lines on
stdout, and a liveness signal that fires when silence exceeds a threshold.

**ai-sdd changes:**
1. Adapters must stream stdout incrementally (not buffer until process exit). This is now enforced
   in `ClaudeCodeAdapter` via chunk-by-chunk reader.
2. `ObservabilityEmitter` events are now wired to a progress printer in `run.ts` that outputs
   human-readable lines for every significant state transition.
3. Liveness ticker (configurable interval, default 5 min) warns if no chunk has been received,
   includes the log file path for `tail -f`.
4. Long term: `ai-sdd logs --task <id> --follow` as a first-class CLI command.

---

### Lesson 4: Design for recovery before you need it

**What happened:** `FAILED` was a terminal state with no operator recovery path. The state machine
enforced this correctly — but without an escape hatch, operators were forced to edit
`workflow-state.json` directly, bypassing all hooks, all collaboration integrations, and all event
emissions. The escape hatch (manual JSON edit) was worse than a designed recovery command would
have been.

**The deeper pattern:** Every system that can enter a bad state will enter a bad state. Any
terminal state that an operator cannot manually escape from is a design flaw, not a safety feature.
The state machine is correct; the gap is the absence of authorised recovery operations.

**Principle: For every terminal state, design a recovery operation before shipping.** The recovery
operation should: (a) be a first-class CLI command, (b) validate preconditions, (c) emit events,
(d) replay any side effects that were bypassed, and (e) be documented in the CLI reference.

**ai-sdd changes:**
1. `ai-sdd task reset <id>` — moves FAILED/stuck tasks to PENDING with event emission.
2. `ai-sdd task replay-hooks <id>` — re-fires post-task collaboration hooks using stored refs.
3. Recovery commands are now in the CLI reference in `CLAUDE.md`.
4. Design principle added to constitution: every new terminal state must ship with a recovery
   command, documented and tested, at the same time as the state itself.

---

### Lesson 5: The operator's perspective is a different problem from the engine's perspective

**What happened:** The CLI surface was specified from the engine's internal perspective. The
engine has `hil resolve`, `run`, `status`. The operator, during an incident, needs `hil approve`
(natural language alias), `status --task <id>` (drill-down), `task reset` (recovery), and
`hil resolve` that advances state even when the engine is dead. None of these were in the original
spec because they were never derived from user-journey walkthroughs.

**The deeper pattern:** Engine design and operator design are two separate disciplines. Engine
design asks "what operations does the engine need to perform?" Operator design asks "what is the
operator trying to do at 2am when something is broken?" These questions have different answers.

**Principle: Every workflow phase requires an operator journey walkthrough before the CLI is
specced.** The walkthrough must cover: the happy path, the failure path, and the recovery path.
CLI commands must be derived from what the operator needs, not from what the engine exposes.

**ai-sdd changes:**
1. Add "operator journey" section to the sdd-ba agent prompt template: for every feature, the BA
   must specify the operator's workflows (start, monitor, intervene, recover) alongside the
   system's functional requirements.
2. Add an `operator_commands` section to the workflow YAML schema, listing the CLI commands an
   operator will use for that workflow. This makes the CLI contract explicit at design time.

---

### Lesson 6: The transaction boundary must be the only mutation path

**What happened:** `complete-task` was specified as "the single atomic transaction boundary" for
state mutation. But manual recovery operations (JSON edits, `task reset`) bypassed this boundary,
leaving collaboration hooks unfired and the mutation trail incomplete. The system had one path
designed with full integrity and a second path (manual repair) with none.

**The deeper pattern:** Every system accumulates bypass paths over time — admin endpoints, debug
scripts, manual database edits. Each bypass path is a hole in the integrity of the transaction
model. The solution is not to eliminate bypass paths (they are necessary for recovery) but to
make them emit the same side effects as the primary path.

**Principle: Bypass paths must replay the side effects of the primary path.** `task reset` must
emit state-transition events. `replay-hooks` must fire collaboration integrations. Bypass paths
are not exempt from the integrity model — they are alternative implementations of it.

**ai-sdd changes:**
1. `task reset` now emits a `task.reset` event via the state manager's event log (to be
   implemented as part of the StateManager audit trail work).
2. `replay-hooks` replays collaboration hooks using stored `collaboration_refs`.
3. Architecture principle: any command that mutates workflow state must either go through
   `complete-task` or explicitly declare and replay the side effects it is bypassing.

---

### Lesson 7: Concurrency correctness must be designed in, not added after

**What happened:** Seven concurrency bugs were found in the post-fix audit: non-atomic
read-modify-write on the state manager, TOCTOU in the PID lock, liveness timer leak on timeout,
multiple HIL creation paths for the same task, listener registration race in AsyncTaskManager,
non-atomic HIL queue + state transition, and approval deduplication race. None were caught by
tests because the tests did not exercise concurrent execution paths.

**The deeper pattern:** Concurrency bugs are invisible in single-threaded tests. They only surface
under real concurrent load or specific timing conditions. The only reliable way to prevent them
is to reason about concurrency at design time — before implementation — and write tests that
exercise concurrent paths explicitly.

**Principle: Any component that can be called from concurrent async operations needs an explicit
concurrency contract.** The contract must specify: which operations are atomic, which state is
shared, and what the invariants are across concurrent calls. This must be documented in the
component's header and tested with concurrent exercisers.

**ai-sdd changes:**
1. StateManager: write-lock queue (serialise all persist() calls).
2. ClaudeCodeAdapter: move all cleanup into a `finally` block.
3. Engine HIL path: guard HIL creation — if task is already HIL_PENDING, do not create a new item.
4. AsyncTaskManager: start listener before posting notification.
5. Tests: add concurrent-execution exercisers for StateManager and ApprovalManager.

---

## Part II — Incorporation into ai-sdd

### Category A — Framework-level changes (engine + adapters)

| Change | Addresses | Priority |
|--------|-----------|----------|
| Mandatory `healthCheck()` gate before first dispatch | L1 | Critical |
| Streaming (chunk-by-chunk) as adapter interface contract | L3 | High |
| Progress printer wired to emitter in `run.ts` | L3 | High |
| StateManager write-lock serialiser | L7 | High |
| HIL creation guard (no duplicate HIL per task) | L7 | High |
| `finally` block cleanup in ClaudeCodeAdapter | L7 | Medium |
| AsyncTaskManager: listener before notification | L7 | Medium |

### Category B — CLI surface changes

| Change | Addresses | Priority |
|--------|-----------|----------|
| `ai-sdd task reset <id>` | L4 | Critical (done) |
| `ai-sdd task replay-hooks <id>` | L6 | High (done) |
| `ai-sdd hil approve` alias | L5 | Medium (done) |
| `ai-sdd status --task <id>` | L3, L5 | Medium (done) |
| `ai-sdd logs --task <id> --follow` | L3 | Medium |
| `ai-sdd validate-config` agent prompt audit | L2 | High |

### Category C — Process and constitution changes

| Change | Addresses | Priority |
|--------|-----------|----------|
| `tests/agent-prompts.test.ts` contract validation | L2 | Critical |
| Operator journey walkthrough in sdd-ba template | L5 | High |
| `operator_commands` section in workflow YAML schema | L5 | Medium |
| Every terminal state ships with a recovery command | L4 | High |
| Concurrency contract documentation in component headers | L7 | Medium |
| CI gate: `validate-config` runs on every PR | L2 | High |

### Category D — Design philosophy additions to constitution.md

Add the following to the "Development Standards" section:

1. **Test your execution environment.** Every adapter must call `healthCheck()` before its first
   dispatch. A health check that is never called is not a health check.

2. **Contracts between artefacts are enforced by tests, not by convention.** If two artefacts
   share a contract (paths, schemas, command names), there is a test that fails when they diverge.

3. **Liveness is a correctness property.** Any operation expected to take more than 30 seconds
   must emit incremental progress. Buffered, fire-and-forget operations are not acceptable for
   user-facing workflows.

4. **Design recovery before you ship terminal states.** Every terminal state in the state machine
   ships with a corresponding recovery CLI command, documented and tested.

5. **Bypass paths replay side effects.** Any command that mutates state outside the primary
   transaction boundary must explicitly replay the side effects that would have fired through the
   primary path.

6. **Operator journeys are requirements.** The operator's start/monitor/intervene/recover
   workflows are specified alongside the system's functional requirements, not derived from them
   post-hoc.

---

## Summary

The twelve bugs were not random. They clustered into three root causes:

1. **An assumption that was never tested** (CLAUDECODE env, output paths, timeout values)
2. **A system designed without an operator model** (no liveness, no recovery commands, no
   meaningful feedback)
3. **Concurrency correctness treated as an implementation detail** (state races, lock races,
   listener races)

Each root cause has a corresponding design principle that, if applied from the start, would have
prevented the bugs entirely. The principles are not complex — they are the standard practices of
distributed systems engineering applied to AI orchestration: test your environment, enforce your
contracts, design for observability, design for recovery, and reason about concurrency explicitly.

The fact that these principles were not applied initially reflects a fundamental challenge in
AI-assisted development: it is easy to produce software that looks correct (passes surface-level
review) but has never been executed in anger. The lesson is that AI-assisted development requires
*more* rigour in testing and operational design, not less — because the cost of invisible failures
is magnified when the system is opaque.
