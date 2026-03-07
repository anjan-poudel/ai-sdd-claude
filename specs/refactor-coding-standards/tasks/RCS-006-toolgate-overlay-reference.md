# RCS-006: Add Overlay Cross-Reference to toolgate.yaml

**Phase:** 2
**Status:** PENDING
**Size:** XS (0.5 days)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Add a comment header to `toolgate.yaml` explaining that tool gates are now
enforced at runtime by ai-sdd's `PolicyGateOverlay` and this file serves as
a reference template.

## Change

Prepend to `toolgate.yaml`:

```yaml
# ──────────────────────────────────────────────────────────────────────────────
# Tool Gate Configuration (Reference Template)
#
# Runtime enforcement of tool gates is handled by ai-sdd's PolicyGateOverlay:
#   src/overlays/policy-gate/gate-overlay.ts
#
# This file serves as a reference template for configuring tool access controls
# and budget limits. When used with ai-sdd, these settings are loaded via the
# overlay configuration in .ai-sdd/ai-sdd.yaml.
#
# See: ai-sdd specs/merge-coding-standards/MERGE-PLAN-v2.md
# ──────────────────────────────────────────────────────────────────────────────
```

## Acceptance Criteria

```gherkin
Scenario: toolgate.yaml has ai-sdd cross-reference
  Given toolgate.yaml
  When the file is opened
  Then the first lines are a comment block referencing ai-sdd's PolicyGateOverlay
  And it explains this is a reference template
```

## Notes

- YAML comment only — no functional changes
- Existing toolgate.yaml content remains untouched below the header
