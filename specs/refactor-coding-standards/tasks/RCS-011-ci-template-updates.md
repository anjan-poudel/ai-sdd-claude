# RCS-011: Update CI Template References

**Phase:** 4
**Status:** PENDING
**Size:** XS (0.5 days)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Audit all CI templates and configuration files in coding-standards for references
to enforcement commands or workflows that are now handled by ai-sdd. Update them
to either call `ai-sdd` CLI or document the split.

## Steps

1. **Grep for enforcement references**:
   ```bash
   grep -rn "run-phase\|check-iteration\|state-machine\|events-contract" \
     .github/ ci/ scripts/ *.yml *.yaml 2>/dev/null
   ```

2. **For each match, determine action**:
   - If it calls an archived script → update to call `ai-sdd` CLI equivalent
     or remove if no longer needed
   - If it references an archived file → update path to
     `archive/merged-to-ai-sdd/` or replace with ai-sdd equivalent
   - If it's a comment → update comment text

3. **Add ai-sdd integration note to CI docs** (if any CI README exists):
   ```markdown
   ## ai-sdd Integration

   Enforcement gates (policy checks, state transitions) are handled by ai-sdd.
   This CI configuration runs coding-standards analysis tools only:
   - Validation (schema checks, drift detection)
   - Coverage reports (gap analysis, orphan detection)
   - Reproducibility checks (spec hash verification)
   ```

## Acceptance Criteria

```gherkin
Scenario: No CI references to archived scripts
  Given all CI configuration files
  When searched for "run-phase.sh" or "check-iteration-limits.sh"
  Then no matches are found

Scenario: CI templates reference correct tools
  Given all CI configuration files
  When enforcement-related commands are found
  Then they either call ai-sdd CLI or document that ai-sdd handles enforcement
```

## Notes

- This is an audit task — changes depend on what's found in the grep
- If no CI templates exist, this task completes as "no changes needed"
- Do not modify any ai-sdd CI configuration (wrong repo)
