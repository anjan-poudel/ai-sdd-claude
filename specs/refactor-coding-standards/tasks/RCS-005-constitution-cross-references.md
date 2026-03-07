# RCS-005: Add Cross-References to agents/constitution.md

**Phase:** 2
**Status:** PENDING
**Size:** XS (0.5 days)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

The `agents/constitution.md` contains 10 mandatory agent rules. Several of these
rules are now enforced at runtime by ai-sdd overlays. Add cross-references to
indicate which rules have runtime enforcement in ai-sdd.

## Rules to Annotate

| Rule # | Rule | ai-sdd Enforcement |
|--------|------|---------------------|
| 2 | requirements.lock immutability | `PolicyGateOverlay` — validates lock file integrity before task execution |
| 4 | No gold-plating | `PlanningReviewOverlay` — scope drift detection during review |
| 5 | Planning review required | `PlanningReviewOverlay` — blocks task progression without review approval |

## Change

After each annotated rule, add an inline note:

```markdown
> *Runtime enforcement: This rule is enforced by ai-sdd's `<overlay-name>`.
> See ai-sdd `src/overlays/<path>` for implementation.*
```

Add a general note at the top of the constitution:

```markdown
> **Cross-reference:** Rules #2, #4, and #5 are enforced at runtime by ai-sdd
> overlays. The remaining rules are advisory guidelines. See ai-sdd's
> `src/overlays/` and `src/constitution/resolver.ts` for the enforcement layer.
```

## Acceptance Criteria

```gherkin
Scenario: Constitution rules have ai-sdd cross-references
  Given agents/constitution.md
  When rules #2, #4, and #5 are read
  Then each has an inline note about which ai-sdd overlay enforces it

Scenario: Constitution has general cross-reference note
  Given agents/constitution.md
  When opened
  Then there is a note at the top explaining the ai-sdd enforcement relationship
```

## Notes

- Keep all 10 rules intact — they remain good advisory guidance
- Only add notes, do not modify rule text
