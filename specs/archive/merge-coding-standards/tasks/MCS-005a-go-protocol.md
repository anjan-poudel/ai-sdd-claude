# MCS-005a: 90% Confidence Rule + GO Protocol

**Phase:** 1.2
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-004
**Effort:** 0.5d
**Ticket:** MCS-005a

## Context

The pre-init agent already has a QnA loop but has no confidence score, no formalised "LOCKED REQUIREMENTS" output, and no explicit GO gate. Formalising it prevents premature scaffold generation.

## Scope

1. Update `data/integration/claude-code/agents/sdd-scaffold.md`: add confidence scoring step before producing outputs; require "GO" from user before finalising.
2. Update `data/integration/claude-code/agents/sdd-ba.md`: add confidence protocol for the BA agent.

## Protocol to Add

```markdown
## Confidence Protocol (Mandatory)

Before producing any task specification or requirements document:
1. Deconstruct the request: list every explicitly stated requirement.
2. Identify ambiguities: what is unclear, missing, or assumed?
3. Calculate confidence (0–100):
   - 100%: all requirements explicit, all ACs clear, scope boundaries defined
   - <90%: ambiguities remain → STOP and ask clarifying questions only
4. If confidence ≥ 90%: present LOCKED REQUIREMENTS summary and ask user to respond "GO"
5. Write specifications ONLY after receiving "GO"

## Output Header (Mandatory)

All specification outputs must begin with:
LOCKED REQUIREMENTS
Confidence: [score]%
Approved: [timestamp]
```

## Acceptance Criteria

- scenario: "GO protocol embedded in scaffold agent"
  given: "sdd-scaffold.md and sdd-ba.md"
  when: "task completes"
  then:
    - "sdd-scaffold.md contains Confidence Protocol section"
    - "sdd-ba.md contains Confidence Protocol section"
    - "Both files require LOCKED REQUIREMENTS output header"

## Deliverables

1. Updated `data/integration/claude-code/agents/sdd-scaffold.md`
2. Updated `data/integration/claude-code/agents/sdd-ba.md`

## Tests Required

- Snapshot test: sdd-scaffold.md contains confidence protocol section

## Dependency Section

**Blocked by:** MCS-004
**Blocks:** MCS-005b
