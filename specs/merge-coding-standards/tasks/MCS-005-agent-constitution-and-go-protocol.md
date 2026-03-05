# MCS-005: Agent Constitution and GO Protocol in Scaffolding Prompts

**Phase:** B (Requirements Lock + Intake Discipline)  
**Status:** DRAFT  
**Dependencies:** None  
**Size:** M (2 days)

## Context

Prompt-level governance should enforce:
1. no gold-plating baseline
2. confidence threshold behavior
3. explicit GO approval before lock/spec finalization

## Scope

1. Add constitution baseline content to integration agent templates.
2. Update scaffold and BA prompts to include:
   - confidence assessment workflow
   - explicit `GO` gate before final output
3. Add planning artifact convention guidance (`plans/<feature>/`).

## Acceptance Criteria

1. Scaffold/BA prompts include explicit GO protocol language.
2. Agent templates include constitution constraints.
3. Integration tests/fixtures verify template content contains key protocol markers.
4. Docs explain GO behavior and operator expectation.

## Deliverables

1. Updates to files in `data/integration/claude-code/agents/` and related templates.
2. Documentation updates in project guides.
3. Tests or snapshot checks for prompt template content.

