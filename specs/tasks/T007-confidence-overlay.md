# T007: Confidence Overlay

**Phase:** 2 (Overlay Suite)
**Status:** COMPLETED
**Dependencies:** T004 (core engine), T006 (evidence policy gate)

---

## Context

The confidence overlay computes a weighted score from a set of evaluation metrics after each task run. When the score falls below a configurable threshold the engine returns the task for rework. When the score falls below a second, lower `low_confidence_threshold` the engine enters an automatic regeneration + escalation chain to seek higher-quality output rather than accepting poor work.

The overlay is **disabled by default** (`enabled` must be explicitly set to `true`). The default quality threshold is **0.7**.

---

## Two-Threshold Model

| Threshold | Config key | Default | Trigger |
|---|---|---|---|
| Quality bar | `threshold` | `0.7` | `score < threshold` → `NEEDS_REWORK` |
| Crisis level | `low_confidence_threshold` | *(disabled)* | `score < low_confidence_threshold` → regeneration chain |

`low_confidence_threshold` is intentionally **disabled until explicitly set**. When set it must be ≤ `threshold`.

---

## Regeneration + Escalation Chain

When `score < low_confidence_threshold` the engine enters the following chain (quality is inviolable — the engine never accepts poor-quality output):

```
1. Regeneration retries (up to max_regeneration_retries, default 3)
   Each retry applies a different sampling override (top_p + temperature) to
   nudge the model away from its previous low-confidence output.
   If the regenerated output passes confidence → done.

2. If retries exhausted AND paired mode is enabled:
   Dispatch the paired challenger agent once only (using the existing paired config).
   If challenger output passes confidence → done.

3. If challenger fails OR paired mode is not enabled:
   Escalate to HIL. The engine creates a HIL item and waits for human resolution.
   On HIL resolve: run one NEEDS_REWORK iteration with human notes as feedback.
   On HIL reject: task transitions to FAILED.
```

Regeneration retries do **not** consume `max_rework_iterations` budget — they are a sub-loop. The iteration counter is held constant during regen.

---

## Sampling Schedule on Regeneration Retries

Each retry uses progressively higher diversity sampling to explore different outputs:

| Retry | Default `top_p` | Default `temperature` |
|---|---|---|
| 1st | 0.9 | 0.2 |
| 2nd | 0.8 | 0.4 |
| 3rd | 0.7 | 0.6 |

If the retry count exceeds the schedule length, the last entry is reused. The schedule is fully configurable via `regen_sampling_schedule`. Sampling params are applied in `DispatchOptions.sampling_params` — only direct-mode adapters (OpenAI) honour them; delegation-mode adapters (claude_code) ignore them.

---

## Acceptance Criteria

```gherkin
Feature: Confidence overlay

  Scenario: Overlay disabled by default
    Given a workflow with no confidence overlay configuration
    When a task runs
    Then no confidence scoring occurs
    And no confidence.computed event is emitted

  Scenario: Score above threshold — task completes
    Given a task with confidence.enabled=true and threshold=0.7
    When the task produces output scoring 0.82
    Then the overlay returns accept:true
    And the task transitions to COMPLETED

  Scenario: Score below threshold — NEEDS_REWORK
    Given a task with confidence.enabled=true and threshold=0.7
    When the task produces output scoring 0.60
    Then the overlay returns accept:false with new_status NEEDS_REWORK
    And feedback states the confidence score

  Scenario: Per-task threshold override
    Given a workflow default threshold of 0.7
    And a specific task with confidence.threshold=0.85
    When that task produces output scoring 0.80
    Then the task goes to NEEDS_REWORK (0.80 < 0.85 threshold)

  Scenario: low_confidence_threshold not set → no regeneration signal
    Given a task with low_confidence_threshold not configured
    When the task scores below threshold
    Then the engine uses ordinary NEEDS_REWORK (no regeneration chain)

  Scenario: Score below low_confidence_threshold → regeneration signal
    Given a task with threshold=0.7 and low_confidence_threshold=0.5
    When the task scores 0.40
    Then the confidence.computed event includes confidence_action:regenerate
    And the engine enters the regeneration chain

  Scenario: Score between thresholds → ordinary rework
    Given a task with threshold=0.7 and low_confidence_threshold=0.5
    When the task scores 0.60
    Then the confidence.computed event has no confidence_action
    And the engine uses ordinary NEEDS_REWORK

  Scenario: Regeneration retries with sampling params
    Given a task with max_regeneration_retries=3 and low_confidence_threshold=0.5
    When the first dispatch scores 0.40
    Then retry 1 uses top_p=0.9, temperature=0.2
    And retry 2 uses top_p=0.8, temperature=0.4
    And retry 3 uses top_p=0.7, temperature=0.6
    And a confidence.regenerating event is emitted for each retry

  Scenario: Custom regen_sampling_schedule
    Given a task with regen_sampling_schedule: [{top_p:0.95, temperature:0.1}]
    When retries happen
    Then all retries use top_p=0.95, temperature=0.1 (last entry clamped)

  Scenario: Retries exhausted with paired mode — challenger escalation
    Given max_regeneration_retries=3, all failing, paired mode enabled
    When retries are exhausted
    Then the paired challenger agent is dispatched once
    And if the challenger output passes → task completes

  Scenario: Retries exhausted without paired mode — HIL escalation
    Given max_regeneration_retries=3, all failing, paired mode disabled
    When retries are exhausted
    Then a HIL item is created with reason "confidence below low_confidence_threshold"
    And the task transitions to HIL_PENDING

  Scenario: HIL resolve → rework with notes
    Given task is in HIL_PENDING after confidence escalation
    When the operator resolves the HIL item with notes
    Then the task transitions RUNNING → NEEDS_REWORK → RUNNING
    And the HIL notes are passed as rework feedback

  Scenario: HIL reject → FAILED
    Given task is in HIL_PENDING after confidence escalation
    When the operator rejects the HIL item
    Then the task transitions to FAILED

  Scenario: llm_judge requires evaluator_agent
    Given a task using llm_judge metric without evaluator_agent set
    When the workflow loads
    Then a validation error is raised: "llm_judge metric requires evaluator_agent"

  Scenario: llm_judge evaluator must differ from task agent
    Given a task assigned to agent "dev" using llm_judge with evaluator_agent "dev"
    When the workflow loads
    Then a validation error is raised: "llm_judge evaluator_agent must differ from task agent"

  Scenario: Confidence does not bypass policy gate
    Given confidence=0.99 (above threshold) and policy_gate.risk_tier=T2
    When the confidence overlay passes
    Then the policy gate still requires HIL sign-off
```

---

## LLM-as-Judge Independence Policy

When `llm_judge` is used as an evaluation metric the judging model must **not** be the same agent as the agent being evaluated. Self-scoring creates a bias loop.

```yaml
tasks:
  implement:
    overlays:
      confidence:
        enabled: true
        metrics:
          - type: llm_judge
            weight: 0.5
            evaluator_agent: reviewer   # REQUIRED; must differ from task agent
```

Rules:
- `evaluator_agent` is **required** when metric type is `llm_judge`. Omitting it is a load-time error.
- `evaluator_agent` must not equal the task's assigned `agent` field. Violation is a load-time error.
- If the auto-resolved `evaluator_agent` equals the task agent at runtime (e.g. traceability overlay), the overlay skips silently.

---

## EvalMetric Types

| Type | Description |
|---|---|
| `output_completeness` | Fraction of expected output sections/fields present |
| `contract_compliance` | Whether declared artifact contract is satisfied |
| `lint_pass` | Boolean lint clean (1.0 or 0.0) |
| `llm_judge` | Separate evaluator agent scores output quality (0.0–1.0) |

Score is the weighted mean of all metric scores. Default weight = 1.0 / metric count when not specified.

---

## Workflow YAML Config

```yaml
tasks:
  implement:
    agent: dev
    overlays:
      confidence:
        enabled: true
        threshold: 0.80             # quality bar (default 0.7)
        low_confidence_threshold: 0.50   # crisis level — enables regen chain
        max_regeneration_retries: 3      # regen attempts before escalation (default 3)
        regen_sampling_schedule:         # per-retry sampling overrides
          - { top_p: 0.9, temperature: 0.2 }
          - { top_p: 0.8, temperature: 0.4 }
          - { top_p: 0.7, temperature: 0.6 }
        metrics:
          - type: output_completeness
            weight: 0.4
          - type: contract_compliance
            weight: 0.3
          - type: llm_judge
            weight: 0.3
            evaluator_agent: reviewer
      paired:
        enabled: true               # paired.challenger_agent is used for escalation
        driver_agent: dev
        challenger_agent: reviewer
```

Minimal config (threshold-only, no regen chain):

```yaml
overlays:
  confidence:
    enabled: true
    threshold: 0.85
```

---

## Observability Events

| Event | Emitted when |
|---|---|
| `confidence.computed` | After each confidence score computation |
| `confidence.regenerating` | At the start of each regeneration retry |

`confidence.computed` payload includes: `confidence_score`, `eval_result`, `below_low_threshold` (bool), `low_confidence_threshold` (when set), `confidence_action: "regenerate"` (when below low threshold).

`confidence.regenerating` payload includes: `task_id`, `regen_count`, `sampling_params`, `score`.

---

## Implementation Files

- `src/overlays/confidence/confidence-overlay.ts` — `ConfidenceOverlay` class
- `src/core/engine.ts` — regeneration loop, escalation chain, `resolveRegenSamplingParams()`
- `src/adapters/base-adapter.ts` — `SamplingParams` interface, `DispatchOptions.sampling_params`
- `src/adapters/openai-adapter.ts` — passes `sampling_params` to `chat.completions.create`
- `tests/overlays/confidence-overlay.test.ts` — unit tests
- `tests/engine.test.ts` — integration tests for regeneration + escalation + sampling

---

## Rollback / Fallback

- If confidence computation fails, log a warning and treat score as `0.0` (conservative — triggers rework).
- Disable the overlay via `enabled: false`; standard execution path continues unaffected.
- `low_confidence_threshold` omitted → regeneration chain never fires; overlay behaves as ordinary quality gate.
