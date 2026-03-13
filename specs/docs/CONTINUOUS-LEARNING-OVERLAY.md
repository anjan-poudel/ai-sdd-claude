# Continuous Learning as a Feature Overlay for ai-sdd

_A design paper on closing the feedback loop between workflow outcomes and future workflow quality._
_Date: 2026-03-13_

---

## Abstract

ai-sdd today treats each workflow run as an independent event. Outcomes — rework feedback,
HIL decisions, confidence scores, task durations, timeout events — are logged and discarded.
The system knows nothing more about how to run a workflow after the tenth run than it did on the
first. This paper proposes a **ContinuousLearning overlay** that turns every workflow run into a
learning event, accumulating signals that improve future runs: better prompts, better calibrated
parameters, earlier detection of likely failures, and eventually, self-improving workflow
definitions. The proposal is grounded in what was learned from the async-agents bugs and is
designed to fit the existing overlay architecture without requiring changes to the engine core.

---

## 1. The Problem: Closed-Loop Amnesia

The current ai-sdd lifecycle is:

```
Plan → Run → Complete → Discard
```

Between runs, nothing is preserved about *why* tasks succeeded or failed, how long they took,
what rework feedback was given, or what human reviewers decided at HIL gates. The next run starts
with identical priors regardless of the history accumulated across all previous runs.

This produces a class of recurring failures that compound over time:

- **Parameter miscalibration**: Timeout values, confidence thresholds, liveness intervals are
  set once at configuration time and never updated — even when empirical data clearly shows they
  are wrong (ISSUE-004: 5-minute timeout on tasks that routinely take 25 minutes).

- **Prompt drift**: Agent prompts erode in quality as the codebase they reference evolves —
  path references go stale, examples become outdated, context becomes irrelevant. There is no
  mechanism to detect this until a task fails.

- **Repeated failures**: The same rework patterns recur across runs because no signal is
  propagated back to the prompt that generated the failure. The agent receives identical
  instructions and reproduces identical mistakes.

- **HIL fatigue**: Human reviewers at HIL gates see the same categories of issues repeatedly,
  because the underlying prompts that generate those issues are never updated based on the
  review feedback.

- **Blind defaults**: Framework defaults (timeouts, thresholds, concurrent tasks) are guesses
  based on intuition. Real execution data is observed, logged, and immediately thrown away.

The fix is to close the loop. Every workflow run should leave the system slightly better
positioned to run the next one.

---

## 2. What Can Be Learned

There are four distinct classes of signal that ai-sdd generates and currently discards:

### 2.1 Outcome signals

| Event | Signal |
|-------|--------|
| Task enters NEEDS_REWORK | The agent's output did not meet the overlay's criteria — feedback is stored |
| Task exhausts max_rework_iterations | The agent could not recover from its initial failure mode |
| HIL gate fires | A human judged the output insufficient — the reason is a labelled training signal |
| Confidence score < threshold | The agent's self-assessed confidence was low — correlate with actual outcome |
| Traceability overlay fires | The agent went out of scope — the out-of-scope element is a signal about prompt clarity |
| Task succeeds on first iteration | The agent produced acceptable output immediately |

### 2.2 Parameter signals

| Measurement | Parameter to calibrate |
|-------------|----------------------|
| Actual task duration vs. timeout_ms | timeout_ms per task type |
| Liveness silence duration when agent was "working" | AI_SDD_LIVENESS_INTERVAL_MS |
| Number of rework iterations before COMPLETED | max_rework_iterations per task type |
| Confidence score distribution | confidence threshold per task type |
| Token count distribution per task | max_context_tokens guidance |

### 2.3 Human feedback signals

HIL resolutions and review outcomes are the highest-quality signal in the system because they
represent human judgement about what constitutes acceptable output. Currently this data is
logged and discarded after the review task completes. It should be accumulated a s a labelled
dataset keyed by task type and agent.

### 2.4 Structural signals

| Pattern | Implication |
|---------|-------------|
| Task A always fails when preceded by Task B | Dependency or context contamination |
| Tasks in group X always need more iterations than group Y | Group X has harder acceptance criteria or weaker prompts |
| Agent sdd-pe consistently produces out-of-scope elements | sdd-pe's prompt lacks sufficient scope constraints |
| Confidence scores are consistently optimistic (high score, then rework) | Confidence overlay threshold too low |

---

## 3. Proposed Architecture

The ContinuousLearning overlay is a post-workflow component — it does not intervene in task
execution but accumulates signals from every task lifecycle event and, after workflow completion,
synthesises learnings that are stored for use by future runs.

```
┌─────────────────────────────────────────────────────────┐
│                     Workflow Run                         │
│                                                          │
│  task.started ──┐                                        │
│  task.rework  ──┼──► LearningCollector (in-memory)       │
│  task.hil     ──┤    • buffers events keyed by run_id    │
│  task.completed┤    • no blocking, no side effects       │
│  hil.resolved ─┘                                        │
│                                                          │
│  workflow.completed                                      │
│         │                                                │
│         ▼                                                │
│  LearningPipeline.process(run_id)                        │
│  ├── ParameterCalibrator      → learned-params.yaml      │
│  ├── ReworkPatternAnalyser    → learning/patterns.yaml   │
│  ├── PromptDriftDetector      → learning/drift.yaml      │
│  └── HILFeedbackAggregator    → learning/hil-labels.yaml │
│                                                          │
└─────────────────────────────────────────────────────────┘
          │
          ▼
   .ai-sdd/learning/
   ├── learned-params.yaml      ← calibrated parameters
   ├── run-history.jsonl        ← per-run outcome record
   ├── patterns.yaml            ← recurring failure patterns
   ├── hil-labels.yaml          ← labelled HIL decisions
   └── drift-signals.yaml       ← prompt/path drift signals
          │
          ▼
   Next `ai-sdd run`
   ├── reads learned-params.yaml → overrides config defaults
   ├── reads patterns.yaml → adds contextual warnings to prompts
   └── reads drift-signals.yaml → warns operator at startup
```

The key design decisions:

1. **Non-blocking**: The learning pipeline runs *after* `workflow.completed`, not during execution.
   It never delays or blocks task dispatch. It is pure observation.

2. **Separate from human-authored config**: `learned-params.yaml` is written by the system.
   `ai-sdd.yaml` is written by the operator. They never merge automatically — the operator
   explicitly applies learned parameters via `ai-sdd learn apply`.

3. **Auditable and reversible**: Every learned parameter change is recorded with its provenance
   (run_id, evidence, timestamp). Applying a learning update is a reviewable diff, not a silent
   mutation.

4. **Opt-in by default for prompt changes**: Parameter calibration (timeouts, thresholds) can
   be applied automatically with operator review. Prompt changes are *proposals only* — they
   require explicit operator or BA review before being applied.

---

## 4. Component Design

### 4.1 LearningCollector

An event handler registered with the ObservabilityEmitter at workflow start. It buffers all
relevant events in memory keyed by task_id and hands them to the pipeline on workflow completion.

```typescript
interface TaskLearningRecord {
  task_id: string;
  agent: string;
  phase: string;
  iterations: number;
  duration_ms: number;
  final_status: TaskStatus;
  rework_events: ReworkEvent[];
  hil_events: HilEvent[];
  confidence_scores: number[];
  timeout_fired: boolean;
  liveness_warnings: number;
  tokens_used?: TokenUsage;
}
```

### 4.2 ParameterCalibrator

Analyses task duration and outcome distributions to recommend calibrated values:

- **timeout_ms**: P95 of observed durations for this task type × 1.5 safety factor.
  If observed P95 > current timeout, flag for increase.

- **confidence_threshold**: If a task with high confidence score (> threshold) later entered
  rework, the threshold is too low for this task type. Recommend increase.

- **liveness_interval**: If liveness warnings fired but the task completed successfully
  (agent was working, just slow), increase the interval to reduce noise.

- **max_rework_iterations**: If tasks consistently exhaust iterations without recovering,
  either the prompt needs improvement or the limit should increase. Surface both options.

Output: `learned-params.yaml` with per-task-type recommended values and the evidence behind them.

### 4.3 ReworkPatternAnalyser

Accumulates `rework_feedback` strings across runs and identifies recurring patterns using simple
text clustering (or, when an LLM is available, semantic clustering):

```yaml
# learning/patterns.yaml
patterns:
  - task_type: design-l2
    agent: sdd-pe
    frequency: 4/5 runs
    pattern: "Component interfaces missing error response types"
    evidence: [run-001, run-003, run-004, run-006]
    suggested_prompt_addition: |
      All component interfaces must include explicit error response types for every
      method. Do not use `any` or `unknown` for error fields.
```

These patterns are injected as additional context into the agent's prompt on the next run —
not as permanent prompt changes, but as run-time contextual warnings derived from history.

### 4.4 HILFeedbackAggregator

HIL resolutions are the highest-quality labelled data in the system. Each resolution records:
- The task output that triggered HIL
- The human's decision (proceed / reject / rework with notes)
- The feedback text

Over time this accumulates into a dataset that can:
1. Train or fine-tune a lightweight classifier: "is this output likely to need HIL?"
2. Generate acceptance criteria refinements: recurring rejection reasons indicate gaps in the
   task's acceptance criteria
3. Feed back to the traceability overlay: recurring out-of-scope elements indicate unclear
   requirement boundaries

In the near term (before LLM-based analysis), this is a human-readable digest delivered to the
operator at the end of each workflow: "HIL fired 3 times on design-l2. Common feedback: [...]".

### 4.5 PromptDriftDetector

Monitors for divergence between agent prompts and the artefacts they reference:

- Parse every agent `.md` in `data/integration/claude-code/agents/`
- Extract `--output-path` values and input `Read` references
- Compare against current task library `outputs[].path` entries
- Compare against current `specs/` directory structure

Any divergence is flagged as a drift signal before the next `ai-sdd run`, preventing the
class of failures that caused ISSUE-002 and ISSUE-012.

---

## 5. CLI Surface

```bash
# Show accumulated learnings from all runs
ai-sdd learn show [--workflow <name>] [--task <id>]

# Show recommended parameter changes (does not apply them)
ai-sdd learn calibrate [--dry-run]

# Apply recommended parameter changes to ai-sdd.yaml (with review)
ai-sdd learn apply [--params-only] [--confirm]

# Show recurring rework patterns (human-readable digest)
ai-sdd learn patterns [--task <id>] [--since <date>]

# Show HIL feedback digest
ai-sdd learn hil-digest [--last-n-runs <n>]

# Reset learning data (start fresh)
ai-sdd learn reset [--confirm]
```

---

## 6. The Feedback Loop in Practice

A concrete walkthrough of how continuous learning changes the operator experience after
five workflow runs:

**After run 1:**
- `learned-params.yaml` is written with observed durations (no recommendations yet — need N≥3)
- `run-history.jsonl` has one entry
- No patterns detected yet

**After run 3:**
- `calibrate` output: "design-l2 timeout: observed P95 = 22m, current config = 10m. Recommend
  timeout_ms: 1980000 (22m × 1.5)"
- Pattern detected: "sdd-pe missing error types (2/3 runs)" → prompt suggestion generated

**After run 5:**
- Calibrated parameters applied via `ai-sdd learn apply` → timeout updated, liveness interval
  adjusted
- Pattern suggestion reviewed and accepted by BA → agent prompt updated
- HIL digest shows: "HIL fired on confidence in design tasks 3/5 runs. Confidence threshold
  0.7 may be too low for 'design' phase tasks. Consider 0.8."

**After run 10:**
- Parameters are well-calibrated. Timeout fires have dropped from 3/run to 0/run.
- Rework iterations average 1.2 (down from 2.1).
- HIL rate on design tasks dropped from 60% to 20%.
- The system has measurably improved its own performance without any framework code changes.

---

## 7. Towards Autonomous Prompt Evolution

The above is achievable with deterministic logic and heuristics. The longer-term vision is
to use the accumulated learning data as input to an LLM-assisted prompt evolution process:

**Phase 1 (near-term):** Deterministic calibration + pattern detection. No LLM involvement
in learning. Operator must explicitly approve all changes.

**Phase 2 (medium-term):** LLM-assisted pattern analysis. The ReworkPatternAnalyser submits
accumulated rework feedback to a reviewer agent, which synthesises prompt improvement proposals.
These are presented to the operator as diffs against the current agent `.md` files.

**Phase 3 (long-term):** Guided autonomous prompt evolution. After N runs with stable outcomes,
the system proposes prompt updates automatically. The operator approves via a HIL gate (closing
the meta-loop: ai-sdd uses its own HIL mechanism to govern its own self-improvement).

The Phase 3 design is intentionally slow and conservative:
- Changes are diffs, not replacements — the operator sees exactly what changed and why
- Each change must be validated: the next run after a prompt change is a held-out test
- If the change causes regression (more rework, lower confidence), it is rolled back automatically
- The change history is an append-only audit log — every prompt version is recoverable

This is the correct approach to autonomous improvement: **minimal, auditable, reversible, and
always with a human in the loop for substantive changes.**

---

## 8. Relationship to Existing Overlays

The ContinuousLearning overlay is a **post-workflow** overlay, not a task-level overlay. It sits
outside the existing overlay chain:

```
Existing overlay chain (per-task):
  HIL → Evidence Gate → Review → Paired → Traceability → Confidence → Agent

ContinuousLearning (per-workflow):
  workflow.completed → LearningPipeline → .ai-sdd/learning/
```

It does not interfere with task execution. It reads from the same ObservabilityEmitter events
that already exist. It writes to a new `.ai-sdd/learning/` directory. The only integration
point with the engine is a `post_workflow` hook (a new hook event alongside the existing
`post_task` and `on_loop_exit`).

The `patterns.yaml` output does interact with agent prompts at run time — but only by prepending
contextual warnings to the agent's assembled prompt, using the existing `ConstitutionResolver`
injection mechanism. This is equivalent to how `standards/*.md` files are already injected.

---

## 9. Privacy and Federation Considerations

### Project-local learning (default)
Learning data stays in `.ai-sdd/learning/` within the project. No data leaves the project.
This is the default and requires no consent.

### Cross-project learning (opt-in)
If an organisation runs ai-sdd across multiple projects, aggregate signals (anonymised, no
task content — only parameter measurements and error type distributions) could improve shared
defaults. This requires explicit opt-in and a central aggregation service. Design is deferred.

### What is not learned
Task *content* (the actual output of agents, the specific rework feedback text) is never
transmitted outside the project. Only aggregate statistics and pattern metadata are candidates
for federation. The HIL labels dataset stays local always.

---

## 10. Recommendations

### Immediate

1. **Instrument now.** The `LearningCollector` can be wired today as a passive emitter handler.
   No learning pipeline yet — just accumulate `run-history.jsonl`. This costs nothing and builds
   the dataset for future analysis.

2. **Parameter calibration is low-risk, high-value.** Timeout miscalibration (ISSUE-004) was
   the most immediately painful issue. A simple median/P95 calculator over `run-history.jsonl`
   that recommends timeout updates would have prevented it. Build this first.

3. **Prompt drift detection is urgent.** ISSUE-002 and ISSUE-012 (stale output paths in agent
   prompts) caused cascading failures across the entire workflow. The PromptDriftDetector is
   purely static analysis — no LLM, no runtime overhead — and should run as part of
   `validate-config`.

### Medium term

4. **HIL feedback digest after each workflow.** At `workflow.completed`, print a human-readable
   summary of HIL interventions and rework patterns to stdout. This costs one afternoon of
   work and immediately improves the operator's understanding of recurring issues.

5. **Rework pattern clustering.** After accumulating 3+ runs, run a simple clustering pass
   on rework feedback text and surface recurring patterns to the operator.

### Long term

6. **LLM-assisted prompt evolution proposals.** Submit accumulated patterns to a reviewer agent,
   get back a diff against the agent prompt, present to operator for HIL review.

7. **Cross-run confidence calibration.** Build a calibration curve: for each agent × task_type,
   what is the empirical relationship between self-reported confidence score and actual
   rework-free completion rate? Use this to auto-tune thresholds.

---

## 11. Conclusion

ai-sdd has all the instrumentation it needs to support continuous learning — structured events,
run-scoped observability, human feedback at HIL gates, outcome states in the state machine. What
is missing is the accumulation layer: the component that turns these events from ephemeral logs
into persistent learning that influences future runs.

The proposal here is deliberately conservative. It does not propose autonomous, unchecked
self-modification. It proposes a human-reviewed, auditable, reversible feedback loop where the
system's own operational history makes it progressively better at its job — calibrated parameters,
improved prompts, earlier failure detection — while keeping the operator in control of every
substantive change.

The philosophical framing matters: **continuous learning in ai-sdd is not about making the AI
smarter — it is about making the system empirically honest.** Parameters derived from real
measurements are better than parameters derived from intuition. Prompts refined from real
rework feedback are better than prompts written once and never updated. HIL feedback accumulated
over ten runs is worth more as training signal on the eleventh run than it is as an archived
log entry.

The most important insight from the async-agents incident is this: the system failed, in part,
because it had no memory. It ran the same broken configuration ten times and discovered the same
bugs ten times. A continuous learning overlay would have detected the timeout miscalibration
after run 1, the prompt drift before run 1, and the recurring rework pattern after run 2. The
bugs would still have existed — but the time to detection and correction would have collapsed
from weeks to hours.

That is the case for continuous learning in ai-sdd.
